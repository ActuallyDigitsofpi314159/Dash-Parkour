#!/usr/bin/env node
// DASH Parkour party server.
//
// 1. Keeps the list of multiplayer parties and passes connection codes between
//    a host and the players joining them. The game itself runs peer to peer
//    (WebRTC): once players are connected nothing goes through this server, so
//    a Raspberry Pi 3B handles hundreds of parties easily.
// 2. Moderation: /kick and /ban from the game, for the people holding an
//    admin key (made by setup.sh, kept on the Pi only).
// 3. Optionally serves your website's files (SITE_DIR), e.g. the games.
//
// No packages needed: plain Node.js 14 or newer.
//   node server.js                         (port 8787, all addresses)
//   HOST=127.0.0.1 PORT=8787 DATA_DIR=/var/lib/dash-party SITE_DIR=/opt/dash-party/repo node server.js
//
// Parties live in memory (a restart empties the list; hosts make a new
// party). Bans and admin keys are files in DATA_DIR.

"use strict";
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || "0.0.0.0";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const SITE_DIR = process.env.SITE_DIR ? path.resolve(process.env.SITE_DIR) : "";
const MAX_PARTIES = Number(process.env.MAX_PARTIES) || 300;
const PARTY_TTL = 15000; // a party disappears 15 s after its host stops checking in
const REQUEST_TTL = 30000; // a join request is dropped 30 s after the joiner stops asking
const MAX_BODY = 16 * 1024; // connection codes are ~1-3 KB
const MAX_CODE = 6000;

// [v1.1] The addresses, from the setup (or PARTY_HOST / SITE_DOMAIN). The party
// address only shows a status page (and the API); the game is on the website,
// at /dash-parkour/ ([v1.3] it used to be /dashparkour, which still redirects).
const SETUP_CONF = {};
try {
  for (const line of fs.readFileSync(process.env.SETUP_CONF || "/etc/dash-party/setup.conf", "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) SETUP_CONF[m[1]] = m[2];
  }
} catch (e) {}
const SITE_DOMAIN = (process.env.SITE_DOMAIN || SETUP_CONF.DOMAIN || "digitsandkineto.com").toLowerCase();
const PARTY_HOST = (process.env.PARTY_HOST || SETUP_CONF.PARTY_HOST || "party." + SITE_DOMAIN).toLowerCase();
const GAME_PATH = "/dash-parkour/";
const OLD_GAME_PATH = "/dashparkour"; // [v1.3] old links still work (they redirect)
// [v1.1] the full (non-Khan-Academy) build: no size cap and one loading screen fewer
const GAME_FILES = ["dash-parkour.html", "dash-parkour.ka.html"];
// [v1.3] up to 12 players in a party; moderators (admin keys) can join on top of that
const MAX_PLAYERS = 12;
const MAX_IN_PARTY = MAX_PLAYERS + 4;
const LIVE_MS = 6000; // a joiner who hasn't asked for this long has stopped waiting

const parties = new Map(); // id -> party
const requests = new Map(); // rid -> join request
const startedAt = Date.now();
const stats = { made: 0, joins: 0, kicks: 0, bans: 0, errors: 0 };

const id = (bytes) => crypto.randomBytes(bytes).toString("base64").replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" }[c]));
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const hashPass = (salt, pass) => sha(salt + "\u0000" + pass);
// [v1.4] ' is kept: "Kineto's party" used to be listed as "Kinetos party"
const clean = (s, max) => String(s == null ? "" : s).replace(/[\u0000-\u001f<>"\\`]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const cleanDev = (s) => String(s || "").replace(/[^\w-]/g, "").slice(0, 40);
const sameText = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const norm = (n) => clean(String(n == null ? "" : n).replace(/[\u2018\u2019]/g, "'"), 16).toLowerCase(); // (either apostrophe matches)

function log(...a) {
  if (!process.env.QUIET) console.log(new Date().toISOString(), ...a);
}

// ---------------- files: admin keys and bans ----------------
try {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
} catch (e) {}
const ADMIN_FILE = path.join(DATA_DIR, "admins.json"); // [{ name, hash }] (sha256 of each key)
const BANS_FILE = path.join(DATA_DIR, "bans.json");
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    return fallback;
  }
}
function writeJson(file, data) {
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
let admins = readJson(ADMIN_FILE, []);
let bans = readJson(BANS_FILE, []); // [{ id, name, ips: [hash], devs: [id], at, by }]
// the admin file can be changed while running (dash-party keys)
fs.watchFile(ADMIN_FILE, { interval: 5000 }, () => {
  admins = readJson(ADMIN_FILE, []);
  log("admin keys reloaded:", admins.length);
});
fs.watchFile(BANS_FILE, { interval: 5000 }, () => {
  bans = readJson(BANS_FILE, bans);
});
const ipKey = (ip) => sha("dash-ip\u0000" + ip).slice(0, 32); // addresses are stored hashed
function isBanned(ip, dev) {
  const k = ipKey(ip);
  for (const b of bans) {
    if ((b.ips || []).includes(k) || (dev && (b.devs || []).includes(dev))) return b;
  }
  return null;
}
// [v1.7] The developers' names (Digitsofpi, Kineto, and look-alikes: "K1neto",
// "Digits of Pi", "xKinetox"...) need an admin key: a party can't be made or joined
// with one without it, and a player in a party who uses one anyway is removed.
const DEV_NAMES = ["digitsofpi", "kineto"];
const LOOK = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t", 8: "b", "@": "a", $: "s", "|": "i", "!": "i", l: "i" };
function devName(n) {
  const t = String(n == null ? "" : n).toLowerCase().replace(/[0134578@$|!l]/g, (c) => LOOK[c]).replace(/[^a-z]/g, "");
  return DEV_NAMES.find((d) => t.includes(d)) || "";
}
const DEV_NAME_MSG = "That name belongs to the game's makers. Pick another name to play.";
function adminFor(key) {
  if (!key || String(key).length < 8) return null; // [v1.4] keys can be chosen (dash-party setkey): 8+ characters
  const h = sha(String(key));
  for (const a of admins) if (a && a.hash && sameText(a.hash, h)) return a;
  return null;
}
// [v1.3] Same Wi-Fi: two players behind the same home connection share a public
// address (IPv4), or the same /64 network (IPv6). Then the game links them with
// local addresses, which works on networks that block the usual way.
function netKey(ip) {
  let s = String(ip || "").toLowerCase();
  if (s.startsWith("::ffff:")) s = s.slice(7);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(s)) return "4:" + s;
  if (!s.includes(":")) return "";
  // expand "::" and keep the first 4 groups
  const [head, tail] = s.split("::");
  const a = head ? head.split(":") : [];
  const b = tail !== undefined && tail ? tail.split(":") : [];
  const groups = tail === undefined ? a : a.concat(new Array(Math.max(0, 8 - a.length - b.length)).fill("0"), b);
  return "6:" + groups.slice(0, 4).map((g) => parseInt(g || "0", 16)).join(":");
}
const sameNet = (a, b) => {
  const x = netKey(a);
  return !!x && x === netKey(b);
};

// ---------------- [v1.3] phone notices (ntfy) ----------------
// DATA_DIR/notify.json: { "topic": "...", "server": "https://ntfy.sh" } (made by
// "dash-party notify on"). Subscribe to the same topic in the ntfy app.
// [v1.8] What is sent (not every party made any more):
//  * a party with 2 or more players in it (once per party);
//  * the server back after being down (a crash, a power cut, or stopped for more than
//    2 minutes: a normal restart or update says nothing), and a crash as it happens;
//  * a new record: the most players online at once, or in multiplayer at once;
//  * the Cloudflare relay hard-stopping (and why), and coming back;
//  * someone locked out for guessing admin keys, or using a developer's name.
const NOTIFY_FILE = path.join(DATA_DIR, "notify.json");
let notifyConf = readJson(NOTIFY_FILE, null);
fs.watchFile(NOTIFY_FILE, { interval: 5000 }, () => {
  notifyConf = readJson(NOTIFY_FILE, null);
  log("notify settings reloaded:", notifyConf && notifyConf.topic ? "on" : "off");
});
// o: { tags, priority ("min" "low" "default" "high" "urgent"), click }; done: called when sent
function notifySend(title, body, o, done) {
  o = o || {};
  const c = notifyConf;
  const fin = () => {
    if (done) done();
    done = null;
  };
  if (!c || !c.topic || !/^[\w-]{8,64}$/.test(c.topic)) return fin();
  let u;
  try {
    u = new URL("/" + c.topic, c.server || "https://ntfy.sh");
  } catch (e) {
    return fin();
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return fin();
  const ascii = (x) => String(x).replace(/[‘’]/g, "'").replace(/[^\x20-\x7e]/g, "?"); // headers must be plain text
  const headers = { Title: ascii(title), Tags: o.tags || "video_game", Priority: o.priority || "default", "Content-Type": "text/plain; charset=utf-8", "Content-Length": Buffer.byteLength(body) };
  if (o.click !== null) headers.Click = o.click || "https://" + SITE_DOMAIN + GAME_PATH;
  const req = require(u.protocol === "https:" ? "https" : "http").request(u, { method: "POST", timeout: 8000, headers });
  req.on("response", (res) => {
    if (res.statusCode >= 300) log("notify: ntfy said", res.statusCode);
    res.resume();
    fin();
  });
  req.on("timeout", () => req.destroy(new Error("timed out")));
  req.on("error", (e) => {
    log("notify: couldn't reach ntfy:", e.message);
    fin();
  });
  req.end(body);
}
// the same notice at most once per `every` ms (key: what it is about)
const notifiedAt = new Map();
function notifyOnce(key, every, title, body, o) {
  const now = Date.now();
  for (const [k, t] of notifiedAt) if (now - t > 24 * 3600 * 1000) notifiedAt.delete(k);
  if (notifiedAt.has(key) && now - notifiedAt.get(key) < every) return;
  notifiedAt.set(key, now);
  notifySend(title, body, o);
}
// a party now has 2 or more players (called from its heartbeat)
function notifyParty(p) {
  if (p.notified2 || p.n < 2) return;
  p.notified2 = true;
  const names = [p.host].concat((p.roster || []).map((x) => x.name)).filter((x, i, a) => x && a.indexOf(x) === i);
  const who = names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : p.n + " players";
  // (a party listed again after a restart isn't news: once per host and name a while)
  notifyOnce("party:" + ipKey(p.hostIp) + "\u0000" + p.name.toLowerCase(), 20 * 60 * 1000, "DASH party: " + p.name + " (" + p.n + " players)", who + " are playing in \"" + p.name + "\" (" + (p.priv ? "private" : "public") + ", up to " + p.max + "). Open DASH Parkour > Multiplayer to join.");
}
// [v1.8] was the server down? (alive.json: written every minute; "clean" on a normal stop)
const ALIVE_FILE = path.join(DATA_DIR, "alive.json");
(function () {
  const last = readJson(ALIVE_FILE, null);
  const fmtMin = (ms) => {
    const m = Math.round(ms / 60000);
    return m < 60 ? m + " minute" + (m === 1 ? "" : "s") : Math.floor(m / 60) + " h " + (m % 60) + " min";
  };
  if (last && last.at) {
    const gap = Date.now() - last.at;
    if (!last.clean) {
      setTimeout(() => notifySend("Party server is back", "It went down without stopping properly (a crash, a power cut or the internet) around " + fmtMin(gap) + " ago" + (last.why ? " (" + last.why + ")" : "") + ", and is running again.", { tags: "warning", priority: "high", click: null }), 5000);
    } else if (gap > 2 * 60 * 1000) {
      setTimeout(() => notifySend("Party server is back", "It was stopped for " + fmtMin(gap) + " and is running again.", { tags: "white_check_mark", click: null }), 5000);
    }
  }
  const alive = () => writeJson(ALIVE_FILE, { at: Date.now(), clean: false });
  alive();
  setInterval(alive, 60000).unref();
})();
process.on("uncaughtException", (e) => {
  log("CRASH:", e && e.stack ? e.stack : e);
  try {
    writeJson(ALIVE_FILE, { at: Date.now(), clean: false, why: String((e && e.message) || e).slice(0, 120) });
  } catch (err) {}
  let left = false;
  const leave = () => {
    if (!left) {
      left = true;
      process.exit(1); // (systemd starts it again)
    }
  };
  notifySend("Party server crashed", String((e && e.message) || e).slice(0, 300) + "\n\nIt restarts by itself. Details: dash-party errors", { tags: "rotating_light", priority: "urgent", click: null }, leave);
  setTimeout(leave, 2500);
});

// ---------------- rate limit (requests per 10 s, per address) ----------------
const hits = new Map();
function limited(ip, cost, cap) {
  const now = Date.now();
  let h = hits.get(ip);
  if (!h || now - h.t > 10000) h = { t: now, n: 0 };
  h.n += cost || 1;
  hits.set(ip, h);
  return h.n > (cap || 150);
}
const adminTries = new Map(); // wrong admin keys: at most 5 a minute per address

// ---------------- [v1.6] bot protection ----------------
// 1. A small puzzle (proof of work) before making or joining a party: the game asks
//    for a puzzle, finds a number whose hash with it starts with POW_BITS zero bits
//    (a split second for one player, but a script making thousands of parties or
//    join requests has to do that work every time). Puzzles are signed by the server
//    (nothing to remember until one is used), good for 3 minutes, and work once.
// 2. Limits per home connection (IPv4 address, or IPv6 /64): parties open at once,
//    parties made per hour, join requests per minute and join requests waiting at once.
const POW_SECRET = crypto.randomBytes(32);
const POW_BITS = { create: 17, join: 15 };
const POW_MS = 3 * 60 * 1000;
const powUsed = new Map(); // puzzle -> expiry (so each works once)
function powHash(str) {
  // (FNV-1a, then a final mix; the game has the same one)
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
function powMake(kind) {
  const body = kind + "." + Date.now().toString(36) + "." + id(6);
  const sig = crypto.createHmac("sha256", POW_SECRET).update(body).digest("base64").replace(/[+/=]/g, "").slice(0, 16);
  return { c: body + "." + sig, bits: POW_BITS[kind] };
}
// "" when it's good, otherwise why not
function powCheck(kind, pow) {
  const c = String((pow && pow.c) || ""),
    n = String((pow && pow.n) || "");
  if (!c) return "old";
  const parts = c.split(".");
  if (parts.length !== 4 || parts[0] !== kind || n.length > 12) return "bad";
  const sig = crypto.createHmac("sha256", POW_SECRET).update(parts.slice(0, 3).join(".")).digest("base64").replace(/[+/=]/g, "").slice(0, 16);
  if (!sameText(sig, parts[3])) return "bad";
  const at = parseInt(parts[1], 36);
  if (!(Date.now() - at < POW_MS)) return "stale";
  if (powUsed.has(c)) return "used";
  if (powHash(c + ":" + n) >>> (32 - POW_BITS[kind]) !== 0) return "bad";
  powUsed.set(c, at + POW_MS);
  return "";
}
const POW_MSG = { old: "There's a newer version of the game: refresh the page, then try again.", stale: "That took too long. Try again.", used: "Try again.", bad: "Something went wrong. Try again." };
const PARTIES_OPEN_PER_NET = 3;
const PARTIES_PER_HOUR = 12;
const JOINS_PER_MIN = 12;
const JOINS_WAITING_PER_NET = 4;
const netCount = new Map(); // net -> { made: [times], joins: [times] }
function netUse(ip) {
  const k = netKey(ip) || String(ip);
  let u = netCount.get(k);
  if (!u) netCount.set(k, (u = { made: [], joins: [] }));
  const now = Date.now();
  u.made = u.made.filter((t) => now - t < 3600e3);
  u.joins = u.joins.filter((t) => now - t < 60e3);
  return u;
}

// ---------------- tidy up ----------------
setInterval(() => {
  const now = Date.now();
  for (const [pid, p] of parties) if (now - p.beat > PARTY_TTL) dropParty(pid, "host stopped answering");
  for (const [rid, r] of requests) if (now - r.seen > REQUEST_TTL || !parties.has(r.party)) requests.delete(rid);
  for (const [ip, h] of hits) if (now - h.t > 60000) hits.delete(ip);
  for (const [ip, t] of adminTries) if (now - t.t > 60000) adminTries.delete(ip);
  for (const [c, until] of powUsed) if (until < now) powUsed.delete(c);
  for (const [k, u] of netCount) if (!u.made.some((t) => now - t < 3600e3) && !u.joins.some((t) => now - t < 60e3)) netCount.delete(k);
}, 5000).unref();
// a status file for the dashboard (dash-party)
setInterval(() => {
  try {
    writeJson(path.join(DATA_DIR, "status.json"), { at: Date.now(), online: onlineNow(), parties: parties.size, players: [...parties.values()].reduce((a, p) => a + p.n, 0), up: Math.round((Date.now() - startedAt) / 1000), stats, bans: bans.length, admins: admins.length });
  } catch (e) {}
}, 10000).unref();

// ---------------- room history (dash-party history) ----------------
// The last 50 parties, open and closed, with who made them, who came and went
// and how long they lasted. Kept in DATA_DIR/history.json so a restart keeps it.
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
const HISTORY_MAX = 50;
const EVENTS_MAX = 80; // timeline entries kept per party
let history = []; // finished parties, newest first
{
  const old = readJson(HISTORY_FILE, null);
  if (old && Array.isArray(old.rooms)) {
    // parties still open when the server stopped ended with it
    history = old.rooms.slice(0, HISTORY_MAX).map((h) => (h.ended ? h : Object.assign(h, { ended: old.at || Date.now(), end: "server restarted", n: 0 })));
  }
}
let historyDirty = true;
function hEvent(p, kind, name) {
  const h = p.hist;
  h.events.push({ t: Date.now(), kind, name: name || "" });
  if (h.events.length > EVENTS_MAX) {
    h.events.splice(1, 1); // keep the first entry ("made") and the newest ones
    h.trimmed = (h.trimmed || 0) + 1;
  }
  historyDirty = true;
}
function newHistory(p, ip) {
  p.hist = { id: p.id, name: p.name, host: p.host, hostId: ipKey(ip).slice(0, 8), priv: p.priv, max: p.max, made: p.made, ended: 0, end: "", n: 1, peak: 1, playMs: 0, players: [], tries: 0, wrongPass: 0, full: 0, bannedTries: 0, kicks: 0, bans: 0, events: [] };
  p.wasPlaying = false;
  hEvent(p, "made", p.host);
}
// the host's check-in: who joined and left since the last one
function hRoster(p, roster) {
  const h = p.hist;
  const key = (x) => x.rid || "slot" + x.slot + ":" + x.name;
  const before = new Map((p.lastRoster || []).map((x) => [key(x), x]));
  const now = new Map(roster.map((x) => [key(x), x]));
  for (const [k, x] of now) {
    if (before.has(k)) continue;
    hEvent(p, "join", x.name);
    if (x.name && !h.players.includes(x.name) && h.players.length < 40) h.players.push(x.name);
  }
  for (const [k, x] of before) if (!now.has(k)) hEvent(p, "leave", x.name);
  p.lastRoster = roster;
}
function hBeat(p, now) {
  const h = p.hist;
  if (p.playing && p.lastBeat) h.playMs += Math.min(now - p.lastBeat, PARTY_TTL);
  if (p.playing !== p.wasPlaying) hEvent(p, p.playing ? "start" : "stop", "");
  p.wasPlaying = p.playing;
  p.lastBeat = now;
  if (h.n !== p.n) historyDirty = true;
  h.n = p.n;
  h.peak = Math.max(h.peak, p.n);
}
function writeHistory() {
  if (!historyDirty) return;
  historyDirty = false;
  const open = [...parties.values()].sort((a, b) => b.made - a.made).map((p) => p.hist);
  try {
    writeJson(HISTORY_FILE, { at: Date.now(), rooms: open.concat(history).slice(0, HISTORY_MAX) });
  } catch (e) {}
}
setInterval(writeHistory, 5000).unref();

function dropParty(pid, why) {
  const p = parties.get(pid);
  parties.delete(pid);
  // [v1.8] the host closed it: its relay logins stop too (they'd work for hours otherwise)
  if (/^(host closed it|closed by a moderator|a developer)/.test(why || "") && typeof turnIssued !== "undefined") {
    setTimeout(() => {
      const c = turnConf();
      if (!c || c.kind !== "cloudflare") return;
      let n = 0;
      for (const [k, t] of turnIssued) if (t.party === pid) revokeTurn(c, t.username), turnIssued.delete(k), n++;
      if (n) saveIssued();
    }, 5000);
  }
  for (const [rid, r] of requests) if (r.party === pid) requests.delete(rid);
  if (p && p.hist) {
    p.hist.ended = Date.now();
    p.hist.end = why || "closed";
    hEvent(p, "end", p.hist.end);
    history.unshift(p.hist);
    if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
  }
}
// save the history on a normal stop (systemctl stop / restart)
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    try {
      writeJson(ALIVE_FILE, { at: Date.now(), clean: true }); // [v1.8] (a normal stop: no "was down" notice unless it stays down)
    } catch (e) {}
    for (const pid of [...parties.keys()]) dropParty(pid, "server restarted");
    historyDirty = true;
    writeHistory();
    process.exit(0);
  });
}
// ---------------- [v1.5] player stats (dash-party stats) ----------------
// Every game on the website says hello every 15 s (multiplayer or not), with its
// random device id (stored hashed), which screen it's on and whether it's in a
// party. From that: who is online now, peaks, players per day, new players and
// the busiest hours. Kept in DATA_DIR/stats.json. No names or addresses.
const STATS_FILE = path.join(DATA_DIR, "stats.json");
const ONLINE_MS = 25000; // seen in the last 25 s = online (games check in every 10 s)
const online = new Map(); // device hash -> { seen, mp, game, name, inv, pid, banned }
// [v1.5] player invites: online players are shown by a random public id (pid), never
// by their device id (that one is what bans use).
const pidToDev = new Map(); // pid -> device hash
const inbox = new Map(); // device hash -> [invite] (handed over with the next hello)
const pinvLast = new Map(); // "from>to" -> when (one invite per player every 15 s)
const pinvSent = new Map(); // from -> [times] (at most 12 a minute)
const PINV_GAP = 15000;
const PINV_MS = 120000;
const devHash = (dev) => sha("dash-dev\u0000" + dev).slice(0, 16);
let pstats = readJson(STATS_FILE, null);
if (!pstats || typeof pstats !== "object" || !pstats.days) {
  pstats = { since: Date.now(), devices: {}, days: {}, hourSum: new Array(24).fill(0), hourN: new Array(24).fill(0), peak: { n: 0, at: 0 }, mpPeak: { n: 0, at: 0 }, hellos: 0 };
}
const dayKey = (t) => {
  const d = new Date(t);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};
function statDay(t) {
  const k = dayKey(t);
  let d = pstats.days[k];
  if (!d) {
    d = pstats.days[k] = { players: 0, newPlayers: 0, mpPlayers: 0, peak: 0, mpPeak: 0, parties: 0, joins: 0, linkFails: 0, failWhy: {}, seen: {}, mpSeen: {} };
    // keep 120 days
    const keys = Object.keys(pstats.days).sort();
    while (keys.length > 120) delete pstats.days[keys.shift()];
  }
  return d;
}
function statHello(dev, mp, game, extra) {
  if (!dev) return "";
  const now = Date.now();
  const h = devHash(dev);
  const was = online.get(h);
  let pid = was && was.pid;
  if (!pid) {
    pid = id(6);
    pidToDev.set(pid, h);
  }
  extra = extra || {};
  online.set(h, { seen: now, mp: !!mp, game: !!game, name: extra.name || "", inv: extra.inv !== false, pid, banned: !!extra.banned });
  pstats.hellos++;
  const d = statDay(now);
  if (!d.seen[h]) {
    d.seen[h] = 1;
    d.players++;
    if (!pstats.devices[h]) {
      pstats.devices[h] = dayKey(now);
      d.newPlayers++;
    }
  }
  if (mp && !d.mpSeen[h]) {
    d.mpSeen[h] = 1;
    d.mpPlayers++;
  }
  return h;
}
function onlineNow() {
  const now = Date.now();
  let n = 0, mp = 0, game = 0;
  for (const [k, o] of online) {
    if (now - o.seen > ONLINE_MS) {
      online.delete(k);
      pidToDev.delete(o.pid);
      inbox.delete(k);
      continue;
    }
    n++;
    if (o.mp) mp++;
    if (o.game) game++;
  }
  return { n, mp, game };
}
// once a minute: peaks and the busy-hours average, then save
setInterval(() => {
  const now = Date.now();
  for (const [k, t] of pinvLast) if (now - t > PINV_GAP) pinvLast.delete(k);
  for (const [k, a] of pinvSent) {
    const keep = a.filter((t) => now - t < 60000);
    if (keep.length) pinvSent.set(k, keep);
    else pinvSent.delete(k);
  }
  const o = onlineNow();
  const d = statDay(now);
  d.peak = Math.max(d.peak, o.n);
  d.mpPeak = Math.max(d.mpPeak, o.mp);
  // [v1.8] a new record: a phone notice (from 3 players up, at most every 15 minutes)
  if (o.n > pstats.peak.n && o.n >= 3) notifyOnce("rec:on", 15 * 60 * 1000, "New record: " + o.n + " players online!", "The most players on DASH Parkour at once so far (the last record was " + pstats.peak.n + ").", { tags: "trophy" });
  if (o.mp > pstats.mpPeak.n && o.mp >= 3) notifyOnce("rec:mp", 15 * 60 * 1000, "New record: " + o.mp + " in multiplayer!", "The most players in multiplayer at once so far (the last record was " + pstats.mpPeak.n + ").", { tags: "trophy" });
  if (o.n > pstats.peak.n) pstats.peak = { n: o.n, at: now };
  if (o.mp > pstats.mpPeak.n) pstats.mpPeak = { n: o.mp, at: now };
  const hr = new Date(now).getHours();
  pstats.hourSum[hr] += o.n;
  pstats.hourN[hr]++;
  try {
    writeJson(STATS_FILE, pstats);
  } catch (e) {}
}, 60000).unref();
function statsSummary() {
  const o = onlineNow();
  const days = Object.keys(pstats.days).sort().slice(-30).map((k) => {
    const d = pstats.days[k];
    return { day: k, players: d.players, newPlayers: d.newPlayers, mpPlayers: d.mpPlayers, peak: d.peak, mpPeak: d.mpPeak, parties: d.parties, joins: d.joins, linkFails: d.linkFails || 0, failWhy: d.failWhy || {} };
  });
  return { now: o, peak: pstats.peak, mpPeak: pstats.mpPeak, totalPlayers: Object.keys(pstats.devices).length, since: pstats.since, days, hours: pstats.hourSum.map((v, i) => (pstats.hourN[i] ? Math.round((v / pstats.hourN[i]) * 10) / 10 : 0)) };
}

// ---------------- [v1.5] developer invites ----------------
// Digitsofpi or Kineto (with their admin key) invite every player online to the
// party they are in. Everyone's next hello carries the invite for 2 minutes, with
// a pass that lets them into that party even if it is private.
let invite = null; // { id, from, fromDev, party, name, token, until }
const INVITE_MS = 120000;

// [v1.5] is this device in the party (its host, or a player the host let in)?
function inParty(p, dev) {
  if (!dev) return false;
  if (p.hostDev === dev) return true;
  for (const x of p.roster) {
    const r = x.rid && requests.get(x.rid);
    if (r && r.party === p.id && r.dev === dev) return true;
  }
  return false;
}
// [v1.5] the device hashes of everyone in the party (to leave them out of invites)
function partyHashes(p) {
  const out = new Set();
  if (!p) return out;
  if (p.hostDev) out.add(devHash(p.hostDev));
  for (const x of p.roster) {
    const r = x.rid && requests.get(x.rid);
    if (r && r.party === p.id && r.dev) out.add(devHash(r.dev));
  }
  return out;
}
const publicParty = (p) => ({ id: p.id, name: p.name, priv: p.priv, n: p.n, max: p.max, playing: p.playing, host: p.host });

// ---------------- [v1.5] relay (TURN) for players who can't link directly ----------------
// Players still link directly when they can; the relay is only used when that fails
// (phone data, school and work networks, strict routers). Set up with
// "dash-party turn set" (DATA_DIR/turn.json, read again every minute, no restart):
//  - { kind: "cloudflare", id, token, account, analytics, budgetGB }: Cloudflare's TURN.
//    Free for 1,000 GB a month, then paid, so it is guarded: the server reads this
//    month's relay traffic from Cloudflare's own meter every 10 minutes and turns the
//    relay off (and cancels every login it gave out) at budgetGB (500 by default).
//    If the meter can't be read for 30 minutes the relay is off too, so it can never
//    run on unwatched. Without an analytics token it isn't used at all.
//  - { kind: "pi", urls, secret }: a relay on this Pi (coturn), free, using the home
//    internet connection (dash-party turn pi sets it up).
//  - [v1.6] { kind: "metered", app, key }: Metered's free plan (no card on the account,
//    so it can never charge: past its free amount it simply stops for the month and
//    games link directly only). dash-party turn metered sets it up.
// Bot protection: logins only go to a game that is hosting a party (its party token)
// or asking to join one (its join request), each gets its own login, a few a day per
// address and a cap per day overall, and a login that moves more than 1 GB (no game
// comes close) is cancelled.
const TURN_FILE = path.join(DATA_DIR, "turn.json");
const TURN_USE_FILE = path.join(DATA_DIR, "turn-usage.json");
const TURN_ISSUED_FILE = path.join(DATA_DIR, "turn-issued.json");
const TURN_TTL = 3 * 3600; // seconds each login works for (longer than a party session)
const TURN_DAY_CAP = 200; // logins a day, everyone together
const TURN_IP_CAP = 8; // logins a day from one address
const TURN_PARTY_CAP = 10; // [v1.8] logins a day for one party's join requests
const TURN_LOGIN_MAX = 300e6; // bytes one login may move (an evening of DASH through the relay is ~50 MB)
// [v1.8] Cloudflare's free relay traffic is 1,000 GB a month. The guard (see readTurnMeter):
//  * the meter is Cloudflare's own (it shows traffic about 30 s after it happens), read
//    every minute: the last 30 days, and today;
//  * 30 days, not this calendar month, so it doesn't matter which day Cloudflare's billing
//    month starts: any 30 days stay under budgetGB, and with today's limit any 31 days
//    stay under budgetGB + dayGB (950 + 60 at most, under 1,000);
//  * a day's share (dayGB) is the most bots or a misused login can use up: then the relay
//    is off until tomorrow (UTC), not for the rest of the month;
//  * the HARD STOP: at the budget, at today's share, when the traffic is fast enough to
//    reach either within 15 minutes, or when the meter hasn't been read for 10 minutes,
//    the relay key itself is deleted at Cloudflare (with the account token): every login
//    ever made from it stops at once, even ones this server has forgotten (a restart).
//    A new key is made by itself once it is allowed again (tomorrow, or as old traffic
//    leaves the 30 days). Without the account token, every login given out is cancelled
//    one by one instead (they are kept in turn-issued.json, so a restart doesn't lose them).
const CF_FREE_GB = 1000;
function turnConf() {
  let j = {};
  try {
    j = JSON.parse(fs.readFileSync(TURN_FILE, "utf8")) || {};
  } catch (e) {}
  if (!j.kind && (j.id || j.api || process.env.TURN_KEY_ID)) j.kind = "cloudflare";
  if (j.kind === "cloudflare") {
    j.id = String(j.id || process.env.TURN_KEY_ID || "").trim();
    j.token = String(j.token || process.env.TURN_KEY_TOKEN || "").trim();
    j.account = String(j.account || process.env.CF_ACCOUNT_ID || "").trim();
    j.api = String(j.api || "").trim(); // [v1.8] account token: Calls (Realtime) Edit + Account Analytics Read
    j.analytics = String(j.analytics || j.api || process.env.CF_ANALYTICS_TOKEN || "").trim();
    j.budgetGB = Math.min(950, Math.max(1, Number(j.budgetGB) || 900));
    j.dayGB = Math.min(j.budgetGB / 5, Math.max(1, Number(j.dayGB) || Math.max(10, Math.round(j.budgetGB / 15))));
    if (!(j.id && j.token) && !(j.api && j.account)) return null;
    return j;
  }
  if (j.kind === "pi" && j.secret && Array.isArray(j.urls) && j.urls.length) return j;
  if (j.kind === "metered") {
    j.app = String(j.app || "").trim().toLowerCase();
    j.key = String(j.key || "").trim();
    if (!/^[a-z0-9-]{1,63}$/.test(j.app) || !/^[\w-]{8,200}$/.test(j.key)) return null;
    return j;
  }
  return null;
}
// { month (kept for dash-party), bytes (last 30 days), today, day, at, rate (bytes/s),
//   lockUntil, lockWhy }
let turnUse = readJson(TURN_USE_FILE, {});
const turnMonth = () => new Date().toISOString().slice(0, 7);
const turnIssued = new Map(); // owner (party or join request) -> { servers, username, until, party }
for (const [k, t] of Object.entries(readJson(TURN_ISSUED_FILE, {}) || {})) if (t && t.until > Date.now()) turnIssued.set(k, { servers: [], username: t.username, until: t.until, party: t.party });
function saveIssued() {
  const o = {};
  for (const [k, t] of turnIssued) if (t.username) o[k] = { username: t.username, until: t.until, party: t.party };
  writeJson(TURN_ISSUED_FILE, o);
}
let turnDay = { day: "", n: 0, ips: new Map(), parties: new Map() };
const nextUtcDay = () => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
};
function turnState() {
  const c = turnConf();
  if (!c) return { on: false, why: "not set up" };
  if (c.kind === "pi") return { on: true, kind: "pi" };
  if (c.kind === "metered") return meteredBad && Date.now() - meteredBad.at < 30 * 60 * 1000 ? { on: false, kind: "metered", why: meteredBad.why } : { on: true, kind: "metered" };
  const info = { kind: "cloudflare", gb: (turnUse.bytes || 0) / 1e9, todayGB: (turnUse.today || 0) / 1e9, budgetGB: c.budgetGB, dayGB: c.dayGB };
  const off = (why) => Object.assign({ on: false, why }, info);
  if (!c.account || !c.analytics) return off("no usage meter (account ID and analytics token): off so it can't charge you");
  if (turnUse.lockUntil && turnUse.lockUntil > Date.now()) return off(turnUse.lockWhy || "stopped");
  if (!c.id || !c.token) return off("no relay key yet");
  if (!turnUse.at || turnUse.v !== 2) return off("waiting for the first usage reading");
  if (Date.now() - turnUse.at > 3 * 60 * 1000) return off("usage meter not read for 3 minutes");
  if (turnUse.bytes >= c.budgetGB * 1e9 * 0.97) return off("30-day budget nearly used (" + c.budgetGB + " GB)");
  if (turnUse.today >= c.dayGB * 1e9 * 0.97) return off("today's share used (" + c.dayGB + " GB)");
  return Object.assign({ on: true }, info);
}
// token: an API token, or [v1.8] { email, key } (the Global API Key, only while setting up)
function cfRequest(host, pth, token, body, method) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? "" : JSON.stringify(body);
    const auth = token && typeof token === "object" ? { "X-Auth-Email": token.email, "X-Auth-Key": token.key } : { Authorization: "Bearer " + token };
    const req = https.request({ method: method || (body === undefined ? "GET" : "POST"), host, path: pth, headers: Object.assign(auth, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }), timeout: 10000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let j = {};
        try {
          j = text ? JSON.parse(text) : {};
        } catch (e) {}
        if (res.statusCode < 200 || res.statusCode >= 300) {
          const m = j && j.errors && j.errors[0] && j.errors[0].message;
          return reject(Object.assign(new Error("Cloudflare said " + res.statusCode + (m ? ": " + m : "")), { status: res.statusCode }));
        }
        resolve(j);
      });
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end(data);
  });
}
function cloudflareIce(c, owner) {
  return cfRequest("rtc.live.cloudflare.com", "/v1/turn/keys/" + encodeURIComponent(c.id) + "/credentials/generate-ice-servers", c.token, { ttl: TURN_TTL, customIdentifier: String(owner || "").slice(0, 60) }).then((j) => {
    let list = j.iceServers;
    if (list && !Array.isArray(list)) list = [list];
    // (browsers can't use port 53)
    const servers = (list || []).map((x) => ({ urls: [].concat(x.urls || []).filter((u) => !/:53(\?|$)/.test(u)), username: x.username, credential: x.credential })).filter((x) => x.urls.length);
    if (!servers.some((x) => x.username)) throw new Error("no relay login in the answer");
    return servers;
  });
}
function revokeTurn(c, username) {
  if (!username || !c || c.kind !== "cloudflare" || !c.id || !c.token) return Promise.resolve();
  return cfRequest("rtc.live.cloudflare.com", "/v1/turn/keys/" + encodeURIComponent(c.id) + "/credentials/" + encodeURIComponent(username) + "/revoke", c.token, {}).catch((e) => log("TURN: couldn't cancel a login:", e.message));
}
function revokeAllTurn(why) {
  const c = turnConf();
  let n = 0;
  for (const [k, t] of turnIssued) {
    if (t.until > Date.now()) {
      revokeTurn(c, t.username);
      n++;
    }
    turnIssued.delete(k);
  }
  saveIssued();
  if (n) log("TURN: cancelled", n, "relay logins (" + why + ")");
}
// [v1.8] the relay key (made and deleted with the account token)
const cfKeysPath = (c) => "/client/v4/accounts/" + encodeURIComponent(c.account) + "/calls/turn_keys";
function cfMakeKey(c) {
  return cfRequest("api.cloudflare.com", cfKeysPath(c), c.api, { name: "dash-parkour-" + new Date().toISOString().slice(0, 10) }).then((j) => {
    const r = j.result || j;
    if (!r.uid || !r.key) throw new Error("no key in Cloudflare's answer");
    return { id: String(r.uid), token: String(r.key) };
  });
}
function saveTurnConf(patch) {
  let j = {};
  try {
    j = JSON.parse(fs.readFileSync(TURN_FILE, "utf8")) || {};
  } catch (e) {}
  writeJson(TURN_FILE, Object.assign(j, patch));
}
let cfStopping = false;
async function hardStop(why, until) {
  turnUse.lockUntil = Math.max(turnUse.lockUntil || 0, until);
  turnUse.lockWhy = why;
  writeJson(TURN_USE_FILE, turnUse);
  const c = turnConf();
  revokeAllTurn(why);
  if (!c || c.kind !== "cloudflare" || !c.api || !c.account || !c.id || cfStopping) return;
  cfStopping = true;
  try {
    await cfRequest("api.cloudflare.com", cfKeysPath(c) + "/" + encodeURIComponent(c.id), c.api, undefined, "DELETE");
    saveTurnConf({ id: "", token: "" });
    log("TURN: HARD STOP (" + why + "): the relay key is deleted, every relay login has stopped");
    notifyOnce("relay:stop", 3600 * 1000, "Relay stopped", "Cloudflare relay hard stop: " + why + ". Players link directly only until it comes back by itself.", { tags: "no_entry", priority: "high", click: null });
  } catch (e) {
    if (e.status === 404) saveTurnConf({ id: "", token: "" });
    log("TURN: HARD STOP (" + why + "): couldn't delete the relay key (" + e.message + "), logins cancelled one by one");
  } finally {
    cfStopping = false;
  }
}
// Cloudflare's meter: the relay traffic (what it bills), and the logins using the most
const gqlDay = (d) => d.toISOString().slice(0, 10);
let meterBusy = false;
async function readTurnMeter() {
  const c = turnConf();
  if (!c || c.kind !== "cloudflare" || !c.account || !c.analytics || meterBusy) return;
  if (!/^[0-9a-f]{32}$/i.test(c.account)) return log("TURN: the account ID doesn't look right (32 letters and numbers)");
  meterBusy = true;
  const q = (inner) => cfRequest("api.cloudflare.com", "/client/v4/graphql", c.analytics, { query: '{ viewer { accounts(filter: { accountTag: "' + c.account + '" }) { ' + inner + " } } }" });
  const sum = async (from) => {
    const j = await q('callsTurnUsageAdaptiveGroups(limit: 10000, filter: { date_geq: "' + from + '", date_leq: "' + gqlDay(new Date()) + '" }) { dimensions { keyId } sum { egressBytes } }');
    if (j.errors && j.errors.length) throw new Error(String(j.errors[0].message || "query error"));
    const acc = j.data && j.data.viewer && j.data.viewer.accounts && j.data.viewer.accounts[0];
    if (!acc) throw new Error("no such account (check the account ID and the token's access)");
    let b = 0;
    for (const g of acc.callsTurnUsageAdaptiveGroups || []) b += Number(g.sum && g.sum.egressBytes) || 0;
    return b;
  };
  try {
    const now = Date.now(), day = gqlDay(new Date());
    const bytes = await sum(gqlDay(new Date(now - 29 * 864e5)));
    const today = await sum(day);
    const prev = turnUse;
    // (how fast it's going: measured over at least 30 s, the meter's own delay)
    let rate = prev.v === 2 && prev.day === day ? prev.rate || 0 : 0;
    if (prev.v === 2 && prev.day === day && prev.at && now - prev.at >= 30000) rate = Math.max(0, (today - prev.today) / ((now - prev.at) / 1000));
    turnUse = { v: 2, month: turnMonth(), bytes, today, day, at: now, rate, lockUntil: prev.lockUntil || 0, lockWhy: prev.lockWhy || "" };
    writeJson(TURN_USE_FILE, turnUse);
    const soon = rate * 15 * 60; // what 15 more minutes like the last one would add
    if (bytes + soon >= c.budgetGB * 1e9) {
      // (stays off until the 30 days have room again: checked once a day)
      await hardStop("30-day budget (" + c.budgetGB + " GB) reached or about to be", nextUtcDay());
    } else if (today + soon >= c.dayGB * 1e9) {
      await hardStop("today's share (" + c.dayGB + " GB) reached or about to be: back tomorrow (UTC)", nextUtcDay());
    } else if (turnUse.lockUntil && turnUse.lockUntil <= now && c.api && (!c.id || !c.token)) {
      // allowed again: a new relay key
      const k = await cfMakeKey(c);
      saveTurnConf(k);
      turnUse.lockUntil = 0;
      turnUse.lockWhy = "";
      writeJson(TURN_USE_FILE, turnUse);
      log("TURN: relay back on with a new key");
      notifySend("Relay back on", "The Cloudflare relay is on again (with a new key).", { tags: "white_check_mark", priority: "low", click: null });
    }
  } catch (e) {
    log("TURN: couldn't read the usage meter:", e.message);
    meterBusy = false;
    return;
  }
  // logins moving far more than a game would (someone using the relay for something else)
  try {
    const since = gqlDay(new Date(Date.now() - 864e5));
    const j = await q('callsTurnUsageAdaptiveGroups(limit: 20, orderBy: [sum_egressBytes_DESC], filter: { date_geq: "' + since + '", date_leq: "' + gqlDay(new Date()) + '" }) { dimensions { username } sum { egressBytes } }');
    const acc = j.data && j.data.viewer && j.data.viewer.accounts && j.data.viewer.accounts[0];
    for (const g of (acc && acc.callsTurnUsageAdaptiveGroups) || []) {
      const u = g.dimensions && g.dimensions.username;
      if (u && Number(g.sum && g.sum.egressBytes) > TURN_LOGIN_MAX) {
        const c2 = turnConf();
        let known = false;
        for (const [k, t] of turnIssued) if (t.username === u) { known = true; turnIssued.delete(k); }
        if (known) {
          log("TURN: cancelling a login that used", Math.round(g.sum.egressBytes / 1e6), "MB");
          revokeTurn(c2, u);
          saveIssued();
        }
      }
    }
  } catch (e) {}
  meterBusy = false;
}
setInterval(readTurnMeter, 60 * 1000).unref();
setTimeout(readTurnMeter, 3000).unref();
// the meter can't be read (Cloudflare or the internet down): no new logins after 3
// minutes (turnState), and after 10 the hard stop, so nothing runs on unwatched
setInterval(() => {
  const c = turnConf();
  if (!c || c.kind !== "cloudflare" || !c.id) return;
  if (turnUse.at && Date.now() - turnUse.at > 10 * 60 * 1000 && (turnIssued.size || c.api)) hardStop("usage meter not read for 10 minutes", Date.now() + 5 * 60 * 1000);
}, 30 * 1000).unref();
// [v1.6] Metered: its ICE servers list for the app's credential (fetched at most every
// 10 minutes; the same login for everyone, handed out only as above). Just one
// relay by UDP and one by TCP (port 443, which gets through the strictest
// networks): every extra address makes the connection codes longer.
let meteredCache = null; // { at, servers }
let meteredBad = null; // { at, why }: a wrong key or app name (checked again after 30 min)
function meteredIce(c) {
  if (meteredCache && meteredCache.key === c.app + c.key && Date.now() - meteredCache.at < 10 * 60 * 1000) return Promise.resolve(meteredCache.servers);
  return new Promise((resolve, reject) => {
    const req = https.request({ method: "GET", host: c.app + ".metered.live", path: "/api/v1/turn/credentials?apiKey=" + encodeURIComponent(c.key), timeout: 10000 }, (res) => {
      const chunks = [];
      res.on("data", (d) => chunks.push(d));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (res.statusCode === 401 || res.statusCode === 400 || res.statusCode === 404) {
          meteredBad = { at: Date.now(), why: res.statusCode === 404 ? "Metered doesn't know that app name" : "Metered says the API key isn't right" };
          return reject(new Error(meteredBad.why));
        }
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error("Metered said " + res.statusCode));
        let list;
        try {
          list = JSON.parse(text);
        } catch (e) {
          return reject(e);
        }
        if (!Array.isArray(list)) list = list && list.iceServers;
        const turns = [];
        for (const x of list || []) for (const u of [].concat((x && x.urls) || [])) if (/^turns?:/.test(u) && x.username && !/:53(\?|$)/.test(u)) turns.push({ urls: u, username: x.username, credential: x.credential });
        const udp = turns.find((t) => /^turn:/.test(t.urls) && !/transport=tcp/.test(t.urls));
        const tcp = turns.find((t) => /:443\?transport=tcp/.test(t.urls)) || turns.find((t) => /transport=tcp/.test(t.urls));
        const servers = [udp, tcp].filter(Boolean).map((t) => ({ urls: [t.urls], username: t.username, credential: t.credential }));
        if (!servers.length) return reject(new Error("no relay in Metered's answer"));
        meteredBad = null;
        meteredCache = { at: Date.now(), key: c.app + c.key, servers };
        resolve(servers);
      });
    });
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end();
  });
}
// a login for a relay on this Pi (coturn's shared-secret logins)
function piIce(c) {
  const username = Math.floor(Date.now() / 1000 + TURN_TTL) + ":dash";
  const credential = crypto.createHmac("sha1", c.secret).update(username).digest("base64");
  return [{ urls: c.urls.slice(0, 4), username, credential }];
}
// owner: "p:" + party id (a host) or "r:" + join request id (a joiner)
// partyId: the party it is for ([v1.8] each party's join requests get a few a day)
function getIce(owner, ip, partyId) {
  const st = turnState();
  if (!st.on) return Promise.resolve([]);
  const have = turnIssued.get(owner);
  if (have && have.servers && have.servers.length && have.until - Date.now() > 20 * 60 * 1000) return Promise.resolve(have.servers);
  const day = gqlDay(new Date());
  if (turnDay.day !== day) turnDay = { day, n: 0, ips: new Map(), parties: new Map() };
  const ipKey = netKey(ip) || ip;
  const ipN = turnDay.ips.get(ipKey) || 0;
  const ptN = (partyId && turnDay.parties.get(partyId)) || 0;
  if (turnDay.n >= TURN_DAY_CAP || ipN >= TURN_IP_CAP || ptN >= TURN_PARTY_CAP) return Promise.resolve([]);
  turnDay.n++;
  turnDay.ips.set(ipKey, ipN + 1);
  if (partyId) turnDay.parties.set(partyId, ptN + 1);
  const c = turnConf();
  const made = c.kind === "pi" ? Promise.resolve(piIce(c)) : c.kind === "metered" ? meteredIce(c) : cloudflareIce(c, owner);
  return made.then(
    (servers) => {
      if (!turnState().on) return []; // (stopped while asking)
      const login = servers.find((x) => x.username);
      turnIssued.set(owner, { servers, username: login && login.username, until: Date.now() + TURN_TTL * 1000, party: partyId || "" });
      if (c.kind === "cloudflare") saveIssued();
      return servers;
    },
    (e) => {
      log("TURN: couldn't get a relay login:", e.message);
      return [];
    }
  );
}
setInterval(() => {
  let gone = 0;
  for (const [k, t] of turnIssued) if (t.until < Date.now()) turnIssued.delete(k), gone++;
  if (gone) saveIssued();
}, 10 * 60 * 1000).unref();

// ---------------- HTTP helpers ----------------
const API_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Private-Network": "true",
  "X-Content-Type-Options": "nosniff",
};
function send(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({ "Content-Length": Buffer.byteLength(body) }, API_HEADERS));
  res.end(body);
}
const fail = (res, code, error, extra) => send(res, code, Object.assign({ error }, extra || {}));
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("too big"));
        req.destroy();
      } else chunks.push(c);
    });
    req.on("end", () => {
      try {
        const v = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
        resolve(v && typeof v === "object" && !Array.isArray(v) ? v : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}
// Only Cloudflare's tunnel (on this same Pi) and the Pi itself can reach the
// server when HOST=127.0.0.1, so its CF-Connecting-IP header can be trusted.
const clientIp = (req) => {
  const local = req.socket.remoteAddress === "127.0.0.1" || req.socket.remoteAddress === "::1" || req.socket.remoteAddress === "::ffff:127.0.0.1";
  return String((local && req.headers["cf-connecting-ip"]) || req.socket.remoteAddress || "?");
};

// ---------------- the website (optional) ----------------
const MIME = { ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".mp4": "video/mp4", ".webm": "video/webm", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf" };
function serveSite(req, res, urlPath) {
  if (!SITE_DIR) return fail(res, 404, "Not found.");
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch (e) {
    return fail(res, 400, "Bad address.");
  }
  // never: hidden files (.git, .env...), the server's own folder, odd paths
  const parts = rel.split("/").filter(Boolean);
  if (parts.some((s) => s.startsWith(".") || s === "dash-server" || s === "node_modules" || /[\\\u0000]/.test(s))) return fail(res, 404, "Not found.");
  let file = path.resolve(SITE_DIR, parts.join(path.sep));
  if (file !== SITE_DIR && !file.startsWith(SITE_DIR + path.sep)) return fail(res, 404, "Not found.");
  fs.stat(file, (err, st) => {
    if (!err && st.isDirectory()) {
      file = path.join(file, "index.html");
      return fs.stat(file, (e2, st2) => (e2 || !st2.isFile() ? (parts.length ? fail(res, 404, "Not found.") : listGames(res)) : sendFile(req, res, file, st2)));
    }
    if (err || !st.isFile()) return fail(res, 404, "Not found.");
    sendFile(req, res, file, st);
  });
}
function sendFile(req, res, file, st) {
  const type = MIME[path.extname(file).toLowerCase()];
  if (!type) return fail(res, 404, "Not found.");
  const etag = '"' + st.size.toString(36) + "-" + Math.floor(st.mtimeMs).toString(36) + '"';
  const headers = { "Content-Type": type, "Cache-Control": "public, max-age=60", ETag: etag, "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin" };
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  headers["Content-Length"] = st.size;
  res.writeHead(200, headers);
  if (req.method === "HEAD") return res.end();
  fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
}
// no index.html yet: a simple page listing the games
function listGames(res) {
  let names = [];
  try {
    names = fs.readdirSync(SITE_DIR).filter((f) => /\.html?$/i.test(f) && !f.startsWith(".")).sort();
  } catch (e) {}
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const items = names.map((n) => `<li><a href="/${encodeURIComponent(n)}">${esc(n.replace(/\.html?$/i, "").replace(/[-_]/g, " "))}</a></li>`).join("");
  const body = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Games</title><style>body{font:18px system-ui,sans-serif;background:#0d0f16;color:#f5f4f0;max-width:640px;margin:40px auto;padding:0 16px}a{color:#b8f279}li{margin:10px 0}</style><h1>Games</h1><ul>${items || "<li>No games here yet.</li>"}</ul>`;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(body), "X-Content-Type-Options": "nosniff" });
  res.end(body);
}

// [v1.1] The party address's page: is the server up, and where the game is.
const fmtUp = (sec) => {
  sec = Math.max(0, Math.round(sec));
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return (d ? d + "d " : "") + (d || h ? h + "h " : "") + m + "m";
};
// [v1.7] Setting up the Metered relay from a browser (typing the key on the Pi was
// too fiddly): log into Metered in another tab, copy the line with your app name and
// API key, and paste it here with an admin key. The server checks it with Metered
// and saves it (the same file as "dash-party turn metered").
function relayPage(res) {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>DASH Parkour relay setup</title>
<style>:root{color-scheme:dark}body{font:17px/1.5 system-ui,-apple-system,sans-serif;background:#0d0f16;color:#f5f4f0;max-width:620px;margin:0 auto;padding:32px 16px}h1{font-size:26px;margin:0 0 6px}ol{padding-left:22px}li{margin:6px 0}code{background:#1b1f2c;padding:1px 6px;border-radius:6px;font-size:15px}label{display:block;font-weight:600;margin:18px 0 6px}input,textarea{width:100%;box-sizing:border-box;font:16px ui-monospace,monospace;background:#151927;color:#f5f4f0;border:2px solid #2c3247;border-radius:10px;padding:10px}textarea{height:110px}button{margin-top:18px;width:100%;font:700 19px system-ui;background:#e11;color:#fff;border:3px solid #000;border-radius:14px;padding:12px;cursor:pointer}button:disabled{opacity:.6}#out{margin-top:18px;padding:12px 14px;border-radius:10px;display:none}.good{background:#14361f;border:1px solid #1f8a4c}.bad{background:#3a1416;border:1px solid #b3261e}small{color:#9aa0b4}</style></head>
<body><h1>Relay setup</h1><p><b>Using Cloudflare (1,000 GB a month)?</b> Set it up on <a href="/cloudflare" style="color:#7ab8ff">the Cloudflare page</a> instead.</p><p>For players whose networks block direct links. Uses Metered's free plan: <b>never add a card</b> there, and it can never charge you.</p>
<ol><li>Log into <a href="https://dashboard.metered.ca" target="_blank" rel="noopener" style="color:#7ab8ff">your Metered dashboard</a> in another tab.</li>
<li>Open <b>TURN Server</b>, then <b>Developers</b> (or <b>Credentials</b>; add a credential if there isn't one).</li>
<li>Copy the line or code example that has <code>.metered.live</code> and <code>apiKey=</code> in it (copying the whole example is fine), and paste it below.</li></ol>
<form id="f"><label for="t">Paste from Metered</label><textarea id="t" autocomplete="off" spellcheck="false" placeholder="https://YOURAPP.metered.live/api/v1/turn/credentials?apiKey=..."></textarea>
<label for="k">Your admin key <small>(from dash-party keys / setkey)</small></label><input id="k" type="password" autocomplete="off">
<button id="b" type="submit">Turn the relay on</button></form><div id="out"></div>
<script>
var f=document.getElementById("f"),o=document.getElementById("out"),b=document.getElementById("b");
f.onsubmit=function(e){e.preventDefault();b.disabled=true;o.style.display="none";
fetch("/api/turnset",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:document.getElementById("t").value,key:document.getElementById("k").value.replace(/\\s+/g,"")})})
.then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})}).then(function(x){o.className=x.ok?"good":"bad";o.textContent=x.ok?x.j.text:(x.j.error||"That didn't work.");o.style.display="block";b.disabled=false})
.catch(function(){o.className="bad";o.textContent="Couldn't reach the party server. Try again.";o.style.display="block";b.disabled=false})};
</script></body></html>`;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" });
  res.end(body);
}
// [v1.8] Setting up Cloudflare's relay from a browser: the account ID, ONE account API
// token (Calls / Realtime: Edit, and Account Analytics: Read) and an admin key. The server
// checks the token, makes its own relay key with it, and guards it (see the TURN notes).
function cloudflarePage(res) {
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>DASH Parkour: Cloudflare relay</title>
<style>:root{color-scheme:dark}body{font:17px/1.5 system-ui,-apple-system,sans-serif;background:#0d0f16;color:#f5f4f0;max-width:640px;margin:0 auto;padding:32px 16px}h1{font-size:26px;margin:0 0 6px}ol{padding-left:22px}li{margin:7px 0}code{background:#1b1f2c;padding:1px 6px;border-radius:6px;font-size:15px}a{color:#7ab8ff}label{display:block;margin:16px 0 6px;font-weight:600}input{width:100%;box-sizing:border-box;padding:11px;border-radius:10px;border:1px solid #39405a;background:#151926;color:#fff;font:15px ui-monospace,Menlo,monospace}button{margin-top:18px;padding:12px 18px;border:0;border-radius:10px;background:#f63;color:#fff;font:700 17px system-ui,sans-serif;cursor:pointer}button.alt{background:#2b3350;margin-left:8px}button:disabled{opacity:.5}#out{display:none;margin-top:18px;padding:14px;border-radius:10px;white-space:pre-line}.good{background:#13381f}.bad{background:#4a1616}small{color:#a9aec2}.box{background:#151926;border-radius:12px;padding:12px 16px;margin:14px 0;color:#cfd3e2;font-size:15px}</style></head>
<body><h1>Cloudflare relay</h1><p>For players whose networks block direct links. Cloudflare relays <b>1,000 GB a month for free</b>. This server watches Cloudflare's own meter every minute and <b>hard-stops the relay</b> well before that, so it can't go over.</p>
<h2 style="font-size:20px;margin:22px 0 4px">Set it up</h2>
<ol><li>Open <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener">Cloudflare: My Profile, API Tokens</a>.</li>
<li>Next to <b>Global API Key</b>, press <b>View</b>, type your password, and copy the key.</li>
<li>Paste it below with the email you log into Cloudflare with, and your admin key. That's all.</li></ol>
<p><small>The server uses the Global API Key once, to make its own token that can only make relay keys and read the usage meter, and then forgets it. It is never saved.</small></p>
<form id="f"><label for="e">Cloudflare email</label><input id="e" type="email" autocomplete="off" spellcheck="false">
<label for="gk">Global API Key</label><input id="gk" type="password" autocomplete="off" spellcheck="false">
<label for="k">Your admin key <small>(from dash-party keys / setkey)</small></label><input id="k" type="password" autocomplete="off">
<button id="b" type="submit">Set up the relay</button><button id="s" class="alt" type="button">Check usage</button></form><div id="out"></div>
<details style="margin-top:18px"><summary style="cursor:pointer;color:#a9aec2">Or use an API token you made yourself</summary>
<p><small>Make a custom token with two Account permissions: <code>Calls</code> (or <code>Realtime</code>) <b>Edit</b> and <code>Account Analytics</code> <b>Read</b>. Then fill in these instead of the email and key above (with your admin key).</small></p>
<label for="a">Account ID</label><input id="a" autocomplete="off" spellcheck="false" placeholder="32 letters and numbers">
<label for="t">API token</label><input id="t" type="password" autocomplete="off" spellcheck="false"></details>
<label for="g">Limit for any 30 days, in GB <small>(900 if empty; at most 950)</small></label><input id="g" inputmode="numeric" autocomplete="off" placeholder="900">
<div class="box"><b>How it's guarded</b><br>Logins only go to games hosting or joining a party (a few a day per address and per party, 200 a day in all). Each login that moves more than 300 MB is cancelled. A day's share (a fifteenth of the limit) is the most any day can use, so bots can only stop the relay until the next day. The hard stop also comes if the traffic is fast enough to reach a limit within 15 minutes, or if Cloudflare's meter can't be read for 10 minutes. The relay comes back by itself, with a new key, once it's allowed again.</div>
<script>
var f=document.getElementById("f"),o=document.getElementById("out"),b=document.getElementById("b"),v=function(i){return document.getElementById(i).value.replace(/\\s+/g,"")};
function show(x){o.className=x.ok?"good":"bad";o.textContent=x.ok?x.j.text:(x.j.error||"That didn't work.");o.style.display="block";b.disabled=false}
function call(u,d){b.disabled=true;fetch(u,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(d)}).then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})}).then(show).catch(function(){show({ok:false,j:{error:"Couldn't reach the party server. Try again."}})})}
f.onsubmit=function(e){e.preventDefault();var mine=v("t");if(!mine&&(!v("e")||!v("gk"))){show({ok:false,j:{error:"Fill in your Cloudflare email and Global API Key."}});return}o.className="good";o.textContent="Setting it up with Cloudflare... (this takes up to half a minute)";o.style.display="block";call("/api/cfset",mine?{account:v("a"),token:mine,budget:v("g"),key:v("k")}:{email:document.getElementById("e").value.trim(),gkey:v("gk"),budget:v("g"),key:v("k")})};
document.getElementById("s").onclick=function(){call("/api/cfstatus",{key:v("k")})};
</script></body></html>`;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" });
  res.end(body);
}
function cfStatusText() {
  const st = turnState();
  if (st.kind !== "cloudflare") return st.on ? "The relay is on, but it isn't Cloudflare's (" + (st.kind || "?") + ")." : "The relay is off: " + st.why + ".";
  const gb = (x) => (Math.round(x * 100) / 100).toLocaleString("en-US");
  const read = turnUse.at ? Math.round((Date.now() - turnUse.at) / 1000) + " s ago" : "not yet";
  return (st.on ? "The relay is ON (Cloudflare)." : "The relay is OFF: " + st.why + ".") + "\nLast 30 days: " + gb(st.gb) + " of " + st.budgetGB + " GB\nToday (UTC): " + gb(st.todayGB) + " of " + gb(st.dayGB) + " GB\nMeter read " + read + ". Logins given out today: " + turnDay.n + ".";
}
function statusPage(req, res) {
  const players = [...parties.values()].reduce((a, p) => a + p.n, 0);
  const onl = onlineNow(); // [v1.8] (every game on the website checks in, in a party or not)
  const playing = [...parties.values()].filter((p) => p.playing).length;
  let piUp = 0, load = "";
  try {
    piUp = require("os").uptime();
    load = require("os").loadavg()[0].toFixed(2);
  } catch (e) {}
  const mem = Math.round(process.memoryUsage().rss / 1048576);
  const row = (k, v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
  const game = "https://" + SITE_DOMAIN + GAME_PATH;
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="30"><title>DASH Parkour party server</title>
<style>:root{color-scheme:dark}body{font:17px/1.5 system-ui,-apple-system,sans-serif;background:#0d0f16;color:#f5f4f0;max-width:560px;margin:0 auto;padding:32px 16px}h1{font-size:26px;margin:0 0 4px}.ok{display:inline-block;background:#1f8a4c;color:#fff;border-radius:999px;padding:2px 12px;font-weight:600;font-size:14px}table{border-collapse:collapse;width:100%;margin:22px 0}th,td{text-align:left;padding:9px 0;border-bottom:1px solid #262a38}th{color:#9aa0b4;font-weight:500;width:58%;padding-right:12px}a.play{display:block;text-align:center;background:#e11;color:#fff;text-decoration:none;font-weight:700;font-size:20px;border-radius:14px;padding:14px;border:3px solid #000}small{color:#9aa0b4}</style></head>
<body><h1>DASH Parkour party server</h1><span class="ok">Online</span>
<table>${row("Server up for", fmtUp((Date.now() - startedAt) / 1000))}${row("Raspberry Pi up for", piUp ? fmtUp(piUp) : "?")}${row("Parties open", parties.size)}${row("Parties playing", playing)}${row("Players online", onl.n)}${row("Players in parties", players)}${row("Online, not in a party", Math.max(0, onl.n - players))}${row("Parties made since start", stats.made)}${row("Pi load (1 min)", load || "?")}${row("Server memory", mem + " MB")}</table>
<a class="play" href="${game}">Play DASH Parkour</a>
<p><small>This page refreshes every 30 seconds. The game lives at <a href="${game}" style="color:#b8f279">${SITE_DOMAIN + GAME_PATH}</a>.</small></p></body></html>`;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(req.method === "HEAD" ? undefined : body);
}

// ---------------- the API ----------------
async function handle(req, res) {
  const url = new URL(req.url, "http://x");
  const p0 = url.pathname.replace(/\/+$/, "") || "/";
  const ip = clientIp(req);
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (limited(ip, req.method === "GET" ? 1 : 2)) return fail(res, 429, "Too many requests. Slow down a little.");

  if (!p0.startsWith("/api/")) {
    if (req.method !== "GET" && req.method !== "HEAD") return fail(res, 405, "Not allowed.");
    const host = String(req.headers.host || "").toLowerCase().replace(/:\d+$/, "");
    // [v1.1] the party address: just the status page (the game is on the website)
    if (host === PARTY_HOST || host.startsWith("party.") || !SITE_DIR) {
      if (p0 === "/") return statusPage(req, res);
      if (p0 === "/relay") return relayPage(res); // [v1.7]
      if (p0 === "/cloudflare") return cloudflarePage(res); // [v1.8]
      res.writeHead(302, { Location: "https://" + SITE_DOMAIN + GAME_PATH, "Cache-Control": "no-store" });
      return res.end();
    }
    // the website: the game at /dash-parkour/ (old /dashparkour links redirect there)
    if (p0.toLowerCase() === OLD_GAME_PATH) {
      res.writeHead(301, { Location: GAME_PATH + url.search, "Cache-Control": "public, max-age=3600" });
      return res.end();
    }
    if (p0.toLowerCase() === GAME_PATH.replace(/\/$/, "")) {
      const tryFile = (i) => {
        if (i >= GAME_FILES.length) return fail(res, 404, "The game isn't on the server yet.");
        const file = path.join(SITE_DIR, GAME_FILES[i]);
        fs.stat(file, (err, st) => (err || !st.isFile() ? tryFile(i + 1) : sendFile(req, res, file, st)));
      };
      return tryFile(0);
    }
    // [v1.5] the game's own files (audio/...) sit next to dash-parkour.html at the
    // top of the repo; the page asks for them under /dash-parkour/
    if (p0.toLowerCase().startsWith(GAME_PATH) && p0.length > GAME_PATH.length) {
      return serveSite(req, res, url.pathname.slice(GAME_PATH.length - 1));
    }
    return serveSite(req, res, url.pathname);
  }
  if (req.method === "GET" && p0 === "/api/ice") {
    // [v1.5] only for a game hosting a party or asking to join one (see the relay notes)
    const pid = String(url.searchParams.get("party") || "");
    const rid = String(url.searchParams.get("rid") || "");
    let owner = "";
    const hp = pid && parties.get(pid);
    if (hp && sameText(String(url.searchParams.get("token") || ""), hp.token)) owner = "p:" + pid;
    const jr = !owner && rid && requests.get(rid);
    if (jr && !jr.done && parties.has(jr.party)) owner = "r:" + rid;
    if (!owner) return send(res, 200, { iceServers: [] });
    return getIce(owner, ip, owner.charAt(0) === "p" ? pid : jr.party).then((servers) => send(res, 200, { iceServers: servers }));
  }
  if (req.method === "GET" && p0 === "/api/turn" && (ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1")) {
    // [v1.5] for dash-party turn (on the Pi itself only)
    return send(res, 200, Object.assign({ month: turnUse.month, gb: turnUse.bytes ? Math.round(turnUse.bytes / 1e7) / 100 : 0, readAt: turnUse.at || 0, loginsToday: turnDay.n }, turnState()));
  }
  // [v1.6] a puzzle to solve before making or joining a party (see bot protection)
  if (req.method === "GET" && p0 === "/api/pow") {
    const kind = url.searchParams.get("k") === "join" ? "join" : "create";
    return send(res, 200, powMake(kind));
  }
  if (req.method === "GET" && p0 === "/api/health") {
    return send(res, 200, { ok: true, game: "DASH Parkour party server", parties: parties.size, uptime: Math.round(process.uptime()) });
  }
  const dev = cleanDev(url.searchParams.get("dev"));

  // list (and search) parties
  if (req.method === "GET" && p0 === "/api/parties") {
    const q = clean(url.searchParams.get("q"), 24).toLowerCase();
    // [v1.7] ?id=: just that party (a party link from SHARE in the game)
    const want = String(url.searchParams.get("id") || "").slice(0, 20);
    const list = [...parties.values()]
      .filter((p) => !p.modClosed && (want ? p.id === want : !q || p.name.toLowerCase().includes(q)))
      .sort((a, b) => (a.n >= a.max) - (b.n >= b.max) || b.n - a.n || b.made - a.made)
      .slice(0, 60)
      .map(publicParty);
    return send(res, 200, { parties: list, banned: !!isBanned(ip, dev) });
  }

  // joiner: is my connection code ready?
  let m = /^\/api\/join\/([\w-]{8,40})$/.exec(p0);
  if (req.method === "GET" && m) {
    const r = requests.get(m[1]);
    if (!r || !parties.has(r.party)) return send(res, 200, { state: "gone" });
    r.seen = Date.now();
    if (r.dropped) return send(res, 200, { state: "dropped" }); // [v1.5] ask again
    const p = parties.get(r.party);
    // [v1.3] same: on the host's Wi-Fi (the game then links them with local addresses)
    // hostAway: the host's game hasn't checked in for a while (tab hidden, asleep...)
    // hrl: [v1.5] the host's game reads relay addresses
    return send(res, 200, r.offer ? { state: "offer", offer: r.offer, same: r.same, hrl: !!p.relay } : { state: "waiting", playing: p.playing, same: r.same, hostAway: Date.now() - p.beat > LIVE_MS, hrl: !!p.relay });
  }

  if (req.method !== "POST") return fail(res, 404, "Not found.");
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return fail(res, 400, "Bad request.");
  }
  const bdev = cleanDev(body.dev);

  // [v1.6] a game being closed: not online any more (straight away, not 25 s later)
  if (p0 === "/api/bye") {
    if (bdev) online.delete(devHash(bdev));
    return send(res, 200, { ok: true });
  }
  // [v1.5] every game, every 15 s: counted for the stats; gets a developer's invite
  if (p0 === "/api/hello") {
    const banned = !!isBanned(ip, bdev);
    // [v1.5] name: the multiplayer name (for the invite list); inv: 0 = no invites from players
    const hname = clean(body.name, 16);
    // [v1.7] (not listed under a developer's name)
    const h = statHello(bdev, body.mp, body.game, { name: devName(hname) ? "" : hname, inv: body.inv !== 0 && body.inv !== false, banned });
    const out = { online: onlineNow().n };
    if (invite && Date.now() < invite.until && invite.fromDev !== bdev && parties.has(invite.party) && !banned && !(invite.skip && invite.skip.has(devHash(bdev)))) {
      out.invite = { id: invite.id, from: invite.from, party: invite.party, name: invite.name, token: invite.token };
    }
    // [v1.5] invites from players (handed over once)
    const box = h && inbox.get(h);
    if (box) {
      inbox.delete(h);
      const now = Date.now();
      const live = banned ? [] : box.filter((v) => now < v.until && parties.has(v.party));
      if (live.length) out.pinvites = live.map((v) => ({ id: v.id, from: v.from, dev: v.dev, party: v.party, name: v.name, token: v.token }));
    }
    return send(res, 200, out);
  }
  // [v1.5] a join that didn't link up, and why (no addresses: only which kinds each
  // side had and how far the link got). Counted per day for dash-party stats.
  if (p0 === "/api/joinlog") {
    const why = clean(body.why, 20) || "?";
    const tag = [why, "ice:" + clean(body.ice, 30), body.mePub ? "me:pub" : "me:nopub", body.hostPub ? "host:pub" : "host:nopub", body.same ? "samenet" : "", body.mic ? "mic" : "", body.meRelay ? "me:relay" : "", body.hostRelay ? "host:relay" : ""].filter(Boolean).join(" ");
    const d = statDay(Date.now());
    d.linkFails = (d.linkFails || 0) + 1;
    d.failWhy = d.failWhy || {};
    if (Object.keys(d.failWhy).length < 60 || d.failWhy[tag]) d.failWhy[tag] = (d.failWhy[tag] || 0) + 1;
    const lp = parties.get(String(body.party || ""));
    if (lp) hEvent(lp, "linkfail", tag);
    log("LINK FAIL", tag);
    return send(res, 200, { ok: true });
  }
  // [v1.5] who is online (for the invite screen): players with a name who take invites
  if (p0 === "/api/online") {
    const me = bdev ? devHash(bdev) : "";
    const q = norm(body.q);
    const now = Date.now();
    const list = [];
    const inMine = partyHashes(parties.get(String(body.party || ""))); // (already in your party)
    for (const [k, o] of online) {
      if (k === me || inMine.has(k) || now - o.seen > ONLINE_MS || !o.name || !o.inv || o.banned) continue;
      if (q && !norm(o.name).includes(q)) continue;
      list.push({ id: o.pid, name: o.name, mp: o.mp, game: o.game, starts: q ? norm(o.name).startsWith(q) : false });
    }
    list.sort((a, b) => b.starts - a.starts || a.name.localeCompare(b.name));
    return send(res, 200, { players: list.slice(0, 60).map((x) => ({ id: x.id, name: x.name, mp: x.mp, game: x.game })), online: onlineNow().n });
  }
  // [v1.5] invite one player to the party you are in (any player; 15 s per player)
  if (p0 === "/api/pinvite") {
    if (!bdev) return fail(res, 400, "Bad request.");
    if (isBanned(ip, bdev)) return fail(res, 403, "You can't invite players right now.", { banned: true });
    let who = null;
    if (body.key) {
      const t = adminTries.get(ip) || { t: Date.now(), n: 0 };
      if (t.n >= 5) return fail(res, 429, "Too many wrong keys. Wait a minute.");
      who = adminFor(body.key);
      if (!who) {
        t.n++;
        adminTries.set(ip, t);
        if (t.n === 5) notifyOnce("admguess:" + ipKey(ip), 3600 * 1000, "Admin key guessing", "Someone got 5 admin keys wrong in a minute and is locked out for now (address " + ipKey(ip).slice(0, 8) + "). Check dash-party errors.", { tags: "lock", priority: "high", click: null });
        return fail(res, 403, "That admin key isn't right.", { badKey: true });
      }
    }
    const pp = parties.get(String(body.party || ""));
    if (!pp) return fail(res, 404, "Make or join a party first, then invite players to it.");
    if (!who && !inParty(pp, bdev)) return fail(res, 403, "You can only invite players to a party you are in.");
    const from = devHash(bdev);
    const to = pidToDev.get(String(body.to || ""));
    const target = to && online.get(to);
    if (!target || Date.now() - target.seen > ONLINE_MS) return fail(res, 404, "That player isn't online any more.");
    if (to === from) return fail(res, 400, "That's you!");
    // (a developer's invite gets through even when the player turned invites off)
    if (!who && !target.inv) return fail(res, 403, clean(target.name, 16) + " isn't taking invites.");
    const now = Date.now();
    const pair = from + ">" + to;
    if (now - (pinvLast.get(pair) || 0) < PINV_GAP) {
      return fail(res, 429, "You just invited " + clean(target.name, 16) + ". Wait a few seconds.", { wait: Math.ceil((PINV_GAP - (now - pinvLast.get(pair))) / 1000) });
    }
    const sent = (pinvSent.get(from) || []).filter((t) => now - t < 60000);
    if (!who && sent.length >= 12) return fail(res, 429, "That's a lot of invites. Wait a minute.");
    sent.push(now);
    pinvSent.set(from, sent);
    pinvLast.set(pair, now);
    // a pass for this one invite: lets them in without the passcode (a player in the
    // party invited them), for 2 minutes
    if (!pp.pinv) pp.pinv = new Map();
    for (const [tk, until] of pp.pinv) if (now > until) pp.pinv.delete(tk);
    const token = id(12);
    pp.pinv.set(token, now + PINV_MS);
    const box = inbox.get(to) || [];
    // (one invite per party in the box: the newest)
    let vfrom = clean(body.from, 16) || (who ? clean(who.name, 16) : "A player");
    if (devName(vfrom) && !who) vfrom = "A player"; // [v1.7] (a developer's name needs the key)
    const v = { id: id(6), from: vfrom, dev: !!who, party: pp.id, name: pp.name, token, until: now + PINV_MS };
    inbox.set(to, box.filter((x) => x.party !== pp.id).concat(v).slice(-5));
    hEvent(pp, "invite", v.from + " -> " + clean(target.name, 16));
    return send(res, 200, { ok: true, text: "Invited " + clean(target.name, 16) + "!" });
  }
  // [v1.5] the stats, for Digitsofpi and Kineto (admin key)
  if (p0 === "/api/stats" || p0 === "/api/invite") {
    const t = adminTries.get(ip) || { t: Date.now(), n: 0 };
    if (t.n >= 5) return fail(res, 429, "Too many wrong keys. Wait a minute.");
    const who = adminFor(body.key);
    if (!who) {
      t.n++;
      adminTries.set(ip, t);
      if (t.n === 5) notifyOnce("admguess:" + ipKey(ip), 3600 * 1000, "Admin key guessing", "Someone got 5 admin keys wrong in a minute and is locked out for now (address " + ipKey(ip).slice(0, 8) + "). Check dash-party errors.", { tags: "lock", priority: "high", click: null });
      return fail(res, 403, "That admin key isn't right.", { badKey: true });
    }
    if (p0 === "/api/stats") return send(res, 200, statsSummary());
    const ip2 = parties.get(String(body.party || ""));
    if (!ip2) return fail(res, 404, "Make or join a party first, then invite everyone to it.");
    ip2.inviteToken = id(12);
    ip2.inviteUntil = Date.now() + INVITE_MS;
    invite = { id: id(6), from: clean(body.from, 16) || clean(who.name, 16), fromDev: bdev, party: ip2.id, name: ip2.name, token: ip2.inviteToken, until: ip2.inviteUntil };
    hEvent(ip2, "invite", invite.from);
    log("INVITE from", who.name, "to", ip2.id);
    // ([v1.5] not counting the players already in the party)
    const ph = partyHashes(ip2);
    ph.add(devHash(bdev));
    let others = 0;
    for (const [k, o] of online) if (Date.now() - o.seen <= ONLINE_MS && !ph.has(k)) others++;
    invite.skip = ph; // (and they don't get it)
    return send(res, 200, { ok: true, online: onlineNow().n, text: "Invited everyone online (" + others + " other player" + (others === 1 ? "" : "s") + ") to " + ip2.name + "." });
  }

  // joiner's answer code
  m = /^\/api\/join\/([\w-]{8,40})\/answer$/.exec(p0);
  if (m) {
    const r = requests.get(m[1]);
    if (!r || !parties.has(r.party)) return fail(res, 404, "The party closed.");
    const code = String(body.code || "");
    if (!code || code.length > MAX_CODE) return fail(res, 400, "Bad connection code.");
    r.answer = code;
    r.answerAt = Date.now();
    r.seen = Date.now();
    return send(res, 200, { ok: true });
  }

  // [v1.7] the game checks an admin key before it unlocks a developer's name
  if (p0 === "/api/admcheck") {
    const t = adminTries.get(ip) || { t: Date.now(), n: 0 };
    if (t.n >= 5) return fail(res, 429, "Too many wrong keys. Wait a minute.");
    const who = adminFor(body.key);
    if (!who) {
      t.n++;
      adminTries.set(ip, t);
      if (t.n === 5) notifyOnce("admguess:" + ipKey(ip), 3600 * 1000, "Admin key guessing", "Someone got 5 admin keys wrong in a minute and is locked out for now (address " + ipKey(ip).slice(0, 8) + "). Check dash-party errors.", { tags: "lock", priority: "high", click: null });
      log("ADMIN: wrong key (name check) from", ipKey(ip).slice(0, 8));
      return fail(res, 403, "That admin key isn't right.", { badKey: true });
    }
    return send(res, 200, { ok: true });
  }

  // [v1.8] the Cloudflare relay page (/cloudflare): set up, and usage
  if (p0 === "/api/cfset" || p0 === "/api/cfstatus") {
    const t = adminTries.get(ip) || { t: Date.now(), n: 0 };
    if (t.n >= 5) return fail(res, 429, "Too many wrong keys. Wait a minute.");
    const who = adminFor(String(body.key || "").replace(/\s+/g, ""));
    if (!who) {
      t.n++;
      adminTries.set(ip, t);
      if (t.n === 5) notifyOnce("admguess:" + ipKey(ip), 3600 * 1000, "Admin key guessing", "Someone got 5 admin keys wrong in a minute and is locked out for now (address " + ipKey(ip).slice(0, 8) + "). Check dash-party errors.", { tags: "lock", priority: "high", click: null });
      log("ADMIN: wrong key (Cloudflare page) from", ipKey(ip).slice(0, 8));
      return fail(res, 403, "That admin key isn't right.", { badKey: true });
    }
    if (p0 === "/api/cfstatus") return send(res, 200, { ok: true, text: cfStatusText() });
    let account = String(body.account || "").trim().toLowerCase();
    let api = String(body.token || "").trim();
    const email = String(body.email || "").trim();
    const gkey = String(body.gkey || "").trim();
    const budgetGB = Math.min(950, Math.max(1, Math.floor(Number(body.budget) || 900)));
    const easy = !!(email || gkey);
    if (easy) {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(res, 400, "Type the email you log into Cloudflare with.");
      // ([v1.8] new keys: cfk_ and 48 more; older ones: 37 letters a-f and numbers)
      if (!/^(cfk_[A-Za-z0-9_-]{30,90}|[0-9a-f]{30,50})$/i.test(gkey)) return fail(res, 400, "That doesn't look like the Global API Key (it starts with cfk_, or is about 37 letters and numbers). Copy it again from Cloudflare.");
    } else {
      if (!/^[0-9a-f]{32}$/.test(account)) return fail(res, 400, "The Account ID should be 32 letters (a-f) and numbers.");
      if (!/^[\w-]{20,200}$/.test(api)) return fail(res, 400, "That doesn't look like an API token. Copy it again from Cloudflare.");
    }
    return (async () => {
      let made = "";
      if (easy) {
        // [v1.8] the easy way: with the Global API Key (used for this and then forgotten),
        // find the account and make a token that can only do what the relay needs
        const G = { email, key: gkey };
        const accs = await cfRequest("api.cloudflare.com", "/client/v4/accounts?per_page=50", G).catch((e) => {
          throw new Error(e.status === 403 || e.status === 400 || e.status === 401 ? "the email or Global API Key isn't right" : e.message);
        });
        const list = (accs && accs.result) || [];
        if (!list.length) throw new Error("no account found for that login");
        const acc = (account && list.find((a) => a.id === account)) || list[0];
        account = acc.id;
        const pg = await cfRequest("api.cloudflare.com", "/client/v4/user/tokens/permission_groups", G);
        const groups = (pg && pg.result) || [];
        const pick = (test) => groups.find((g) => test(String(g.name || "")) && (g.scopes || []).some((x) => /account/.test(x)));
        const calls = pick((n) => /^(calls|realtime)\b/i.test(n) && /(write|edit|admin)/i.test(n)) || pick((n) => /(calls|realtime)/i.test(n) && /(write|edit|admin)/i.test(n));
        const ana = pick((n) => /^account analytics read$/i.test(n)) || pick((n) => /analytics/i.test(n) && /read/i.test(n));
        if (!calls || !ana) throw new Error("couldn't find the Realtime and Analytics permissions in your account");
        const tok = await cfRequest("api.cloudflare.com", "/client/v4/user/tokens", G, {
          name: "dash-parkour relay (" + new Date().toISOString().slice(0, 10) + ")",
          policies: [{ effect: "allow", resources: { ["com.cloudflare.api.account." + account]: "*" }, permission_groups: [{ id: calls.id }, { id: ana.id }] }],
        });
        api = String((tok && tok.result && tok.result.value) || "");
        if (!api) throw new Error("Cloudflare didn't give back the new token");
        made = " (account \"" + String(acc.name || account).slice(0, 60) + "\")";
      }
      const c = { kind: "cloudflare", account, api, analytics: api, budgetGB };
      // the token can read the meter... (a new token can take a few seconds to work)
      let g = null;
      for (let tries = 0; tries < (easy ? 6 : 1); tries++) {
        if (tries) await new Promise((r) => setTimeout(r, 2000));
        g = await cfRequest("api.cloudflare.com", "/client/v4/graphql", api, { query: '{ viewer { accounts(filter: { accountTag: "' + account + '" }) { callsTurnUsageAdaptiveGroups(limit: 1, filter: { date_geq: "' + gqlDay(new Date()) + '", date_leq: "' + gqlDay(new Date()) + '" }) { sum { egressBytes } } } } }' }).catch((e) => ({ errors: [{ message: e.message }] }));
        if (!(g.errors && g.errors.length)) break;
      }
      if (g.errors && g.errors.length) throw new Error("the token can't read the usage meter (add Account Analytics: Read): " + g.errors[0].message);
      if (!(g.data && g.data.viewer && g.data.viewer.accounts && g.data.viewer.accounts[0])) throw new Error("the token can't see that account (check the Account ID, and pick the account under Account Resources)");
      // ...and make (and delete) relay keys
      const old = turnConf();
      let k = null,
        kErr = null;
      for (let tries = 0; tries < (easy ? 5 : 1) && !k; tries++) {
        if (tries) await new Promise((r) => setTimeout(r, 2000));
        k = await cfMakeKey(c).catch((e) => ((kErr = e), null));
      }
      if (!k) throw new Error("the token can't make relay keys (add Calls or Realtime: Edit): " + (kErr ? kErr.message : "?"));
      if (old && old.kind === "cloudflare" && old.api && old.account && old.id) {
        cfRequest("api.cloudflare.com", cfKeysPath(old) + "/" + encodeURIComponent(old.id), old.api, undefined, "DELETE").catch(() => {});
      }
      revokeAllTurn("relay set up again");
      writeJson(TURN_FILE, Object.assign(c, k));
      turnUse = { lockUntil: 0 };
      writeJson(TURN_USE_FILE, turnUse);
      await readTurnMeter();
      log("RELAY: Cloudflare set up from the relay page by", who.name, "(limit " + budgetGB + " GB)");
      send(res, 200, { ok: true, text: "Done! The relay is set up with Cloudflare" + made + ".\n\n" + cfStatusText() + "\n\nTest it by joining a party from the game with ?relaytest at the end of its address." });
    })().catch((e) => fail(res, 400, "Cloudflare didn't accept that: " + e.message));
  }

  // [v1.7] the relay setup page (/relay): an admin key and the line pasted from Metered
  if (p0 === "/api/turnset") {
    const t = adminTries.get(ip) || { t: Date.now(), n: 0 };
    if (t.n >= 5) return fail(res, 429, "Too many wrong keys. Wait a minute.");
    const who = adminFor(String(body.key || "").replace(/\s+/g, ""));
    if (!who) {
      t.n++;
      adminTries.set(ip, t);
      if (t.n === 5) notifyOnce("admguess:" + ipKey(ip), 3600 * 1000, "Admin key guessing", "Someone got 5 admin keys wrong in a minute and is locked out for now (address " + ipKey(ip).slice(0, 8) + "). Check dash-party errors.", { tags: "lock", priority: "high", click: null });
      log("ADMIN: wrong key (relay setup) from", ipKey(ip).slice(0, 8));
      return fail(res, 403, "That admin key isn't right.", { badKey: true });
    }
    const text = String(body.text || "").slice(0, 6000);
    const am = /(?:https?:\/\/)?([a-z0-9-]{1,63})\.metered\.live/i.exec(text);
    const km = /apiKey=([\w-]{8,200})/.exec(text);
    if (!am || !km) {
      return fail(res, 400, "Couldn't find " + (!am ? "your app name (the part before .metered.live)" : "the API key (apiKey=...)") + " in that. Copy the whole line or example from Metered's Developers page.");
    }
    const c = { kind: "metered", app: am[1].toLowerCase(), key: km[1] };
    const prevBad = meteredBad, prevCache = meteredCache;
    meteredCache = null;
    return meteredIce(c).then(() => {
      writeJson(TURN_FILE, c);
      log("RELAY: Metered set up from the relay page by", who.name, "(app " + c.app + ")");
      send(res, 200, { ok: true, text: "Done! The relay is on: Metered, app " + c.app + ". Test it by joining a party from the game with ?relaytest at the end of its address." });
    }, (e) => {
      meteredBad = prevBad;
      meteredCache = prevCache;
      fail(res, 400, "Metered didn't accept that (" + e.message + "). Check you copied it from the right app, and try again.");
    });
  }

  // moderators: /kick and /ban (and unban) from the game
  if (p0 === "/api/admin") {
    const t = adminTries.get(ip) || { t: Date.now(), n: 0 };
    if (t.n >= 5) return fail(res, 429, "Too many wrong keys. Wait a minute.");
    const who = adminFor(body.key);
    if (!who) {
      t.n++;
      adminTries.set(ip, t);
      if (t.n === 5) notifyOnce("admguess:" + ipKey(ip), 3600 * 1000, "Admin key guessing", "Someone got 5 admin keys wrong in a minute and is locked out for now (address " + ipKey(ip).slice(0, 8) + "). Check dash-party errors.", { tags: "lock", priority: "high", click: null });
      log("ADMIN: wrong key from", ipKey(ip).slice(0, 8));
      return fail(res, 403, "That admin key isn't right.", { badKey: true });
    }
    return adminAction(res, who, body);
  }

  // host: make a party
  if (p0 === "/api/parties") {
    if (isBanned(ip, bdev)) return fail(res, 403, "You can't host multiplayer games right now.", { banned: true });
    if (parties.size >= MAX_PARTIES) return fail(res, 503, "The party server is full. Try again in a bit.");
    // [v1.6] bot protection
    const pw = powCheck("create", body.pow);
    if (pw) return fail(res, pw === "old" ? 426 : 403, POW_MSG[pw], { pow: pw });
    const use = netUse(ip);
    const hn = netKey(ip) || String(ip);
    let open = 0;
    for (const q of parties.values()) if ((netKey(q.hostIp) || String(q.hostIp)) === hn) open++;
    if (open >= PARTIES_OPEN_PER_NET) return fail(res, 429, "You already have " + open + " parties open. Close one first.");
    if (use.made.length >= PARTIES_PER_HOUR) return fail(res, 429, "That's a lot of parties in an hour. Wait a while and try again.");
    // [v1.7] a developer's name needs their admin key
    let hostAdmin = false;
    if (devName(body.host)) {
      const t = adminTries.get(ip) || { t: Date.now(), n: 0 };
      if (t.n >= 5) return fail(res, 429, "Too many wrong keys. Wait a minute.");
      if (!adminFor(body.key)) {
        if (body.key) {
          t.n++;
          adminTries.set(ip, t);
          if (t.n === 5) notifyOnce("admguess:" + ipKey(ip), 3600 * 1000, "Admin key guessing", "Someone got 5 admin keys wrong in a minute and is locked out for now (address " + ipKey(ip).slice(0, 8) + "). Check dash-party errors.", { tags: "lock", priority: "high", click: null });
        }
        log("NAME: a developer's name without the admin key (party)", ipKey(ip).slice(0, 8));
        return fail(res, 403, DEV_NAME_MSG, { devName: true });
      }
      hostAdmin = true;
    }
    use.made.push(Date.now());
    const name = clean(body.name, 24);
    if (!name) return fail(res, 400, "Give your party a name.");
    const priv = !!body.priv;
    const pass = String(body.pass || "").slice(0, 24);
    if (priv && !pass) return fail(res, 400, "A private party needs a passcode.");
    const max = Math.max(2, Math.min(MAX_PLAYERS, Math.round(Number(body.max) || 4)));
    const p = { id: id(6), token: id(18), name, priv, salt: id(9), pass: "", max, n: 1, playing: false, host: clean(body.host, 16) || "Host", hostIp: ip, hostDev: bdev, hostAdmin, roster: [], kicks: [], made: Date.now(), beat: Date.now() };
    p.pass = priv ? hashPass(p.salt, pass) : "";
    newHistory(p, ip);
    parties.set(p.id, p);
    stats.made++;
    statDay(Date.now()).parties++;
    log("party made", p.id, JSON.stringify(p.name), priv ? "(private)" : "");
    return send(res, 200, { id: p.id, token: p.token });
  }

  m = /^\/api\/parties\/([\w-]{4,20})\/(beat|close|offer|join)$/.exec(p0);
  if (!m) return fail(res, 404, "Not found.");
  const p = parties.get(m[1]);
  const action = m[2];
  if (!p) return fail(res, 404, action === "join" ? "That party has closed." : "That party is no longer listed.");

  if (action === "join") {
    const jname = clean(body.name, 16) || "Player";
    p.hist.tries++;
    let waiting = 0;
    for (const r of requests.values()) if (r.party === p.id && !r.done) waiting++;
    // [v1.7] a developer's name needs their admin key (checked just below)
    if (devName(jname) && !body.key) {
      hEvent(p, "devname", jname);
      log("NAME: a developer's name without the admin key (join)", ipKey(ip).slice(0, 8));
      return fail(res, 403, DEV_NAME_MSG, { devName: true });
    }
    // [v1.3] moderators (Digitsofpi and Kineto) join any party at any time: private,
    // full or not. Their admin key is checked here, so nobody else can.
    if (body.key) {
      const t = adminTries.get(ip) || { t: Date.now(), n: 0 };
      if (t.n >= 5) return fail(res, 429, "Too many wrong keys. Wait a minute.");
      const who = adminFor(body.key);
      if (!who) {
        t.n++;
        adminTries.set(ip, t);
        if (t.n === 5) notifyOnce("admguess:" + ipKey(ip), 3600 * 1000, "Admin key guessing", "Someone got 5 admin keys wrong in a minute and is locked out for now (address " + ipKey(ip).slice(0, 8) + "). Check dash-party errors.", { tags: "lock", priority: "high", click: null });
        log("ADMIN: wrong key (join) from", ipKey(ip).slice(0, 8));
        return fail(res, 403, "That admin key isn't right.", { badKey: true });
      }
      if (p.n >= MAX_IN_PARTY) return fail(res, 409, "That party is completely full.");
      if (waiting >= MAX_IN_PARTY) return fail(res, 429, "Lots of players are joining this party right now. Try again in a moment.");
      const rid = id(12);
      requests.set(rid, { rid, party: p.id, name: jname, ip, dev: bdev, admin: true, same: sameNet(ip, p.hostIp), rl: !!body.rl, offer: "", answer: "", given: false, done: false, seen: Date.now() });
      stats.joins++;
    statDay(Date.now()).joins++;
      hEvent(p, "adminjoin", jname + " (" + clean(who.name, 24) + ")");
      log("ADMIN", who.name, "joining", p.id);
      return send(res, 200, { rid });
    }
    if (isBanned(ip, bdev)) {
      p.hist.bannedTries++;
      hEvent(p, "banned", jname);
      return fail(res, 403, "You can't join multiplayer games right now.", { banned: true });
    }
    // [v1.6] bot protection
    const pwj = powCheck("join", body.pow);
    if (pwj) return fail(res, pwj === "old" ? 426 : 403, POW_MSG[pwj], { pow: pwj });
    const juse = netUse(ip);
    if (juse.joins.length >= JOINS_PER_MIN) return fail(res, 429, "That's a lot of joins in a minute. Wait a little and try again.");
    const jn = netKey(ip) || String(ip);
    let jw = 0;
    for (const r of requests.values()) if (!r.done && (netKey(r.ip) || String(r.ip)) === jn) jw++;
    if (jw >= JOINS_WAITING_PER_NET) return fail(res, 429, "You're already joining a few parties. Wait for those first.");
    juse.joins.push(Date.now());
    const invTok = String(body.invite || "");
    let invited = !!invTok && !!p.inviteToken && Date.now() < p.inviteUntil && sameText(invTok, p.inviteToken); // [v1.5] a developer's invite
    // [v1.5] or a player's invite (good for 2 minutes, so a retried join still gets in)
    if (!invited && invTok && p.pinv && p.pinv.has(invTok) && Date.now() < p.pinv.get(invTok)) {
      invited = true;
    }
    if (p.priv && !invited && !sameText(hashPass(p.salt, String(body.pass || "").slice(0, 24)), p.pass)) {
      p.hist.wrongPass++;
      hEvent(p, "wrongpass", jname);
      return fail(res, 403, "Wrong passcode.");
    }
    if (p.n >= p.max) {
      p.hist.full++;
      hEvent(p, "full", jname);
      return fail(res, 409, "That party is full.");
    }
    if (waiting >= MAX_PLAYERS) return fail(res, 429, "Lots of players are joining this party right now. Try again in a moment.");
    const rid = id(12);
    requests.set(rid, { rid, party: p.id, name: jname, ip, dev: bdev, admin: false, same: sameNet(ip, p.hostIp), rl: !!body.rl, offer: "", answer: "", given: false, done: false, seen: Date.now() });
    stats.joins++;
    statDay(Date.now()).joins++;
    return send(res, 200, { rid });
  }

  // everything below is the host's, checked by its secret token
  if (!sameText(body.token || "", p.token)) return fail(res, 403, "Not your party.");

  if (action === "close") {
    dropParty(p.id, "host closed it");
    log("party closed", p.id);
    return send(res, 200, { ok: true });
  }
  if (action === "beat") {
    if (p.modClosed || isBanned(p.hostIp, p.hostDev)) {
      dropParty(p.id, "closed by a moderator");
      return fail(res, 403, "A moderator closed this party.", { closed: true });
    }
    p.beat = Date.now();
    p.relay = !!body.rl; // [v1.5] reads relay addresses
    p.n = Math.max(1, Math.min(MAX_IN_PARTY, Math.round(Number(body.n) || 1)));
    p.playing = !!body.playing;
    setTimeout(() => parties.get(p.id) === p && notifyParty(p), 0); // [v1.8] (after the roster below)
    // who is in the party: [{ slot, name, rid }] (rid = how they joined)
    if (Array.isArray(body.roster)) {
      p.roster = body.roster.slice(0, MAX_IN_PARTY).map((x) => ({ slot: Math.round(Number(x && x.slot)) || 0, name: clean(x && x.name, 16), rid: String((x && x.rid) || "").slice(0, 40) }));
      hRoster(p, p.roster);
    }
    // [v1.7] a developer's name without the admin key: the host's party closes, and a
    // player using one is removed (also from parties made before this, and by games
    // that don't check it themselves)
    if (body.host !== undefined) p.host = clean(body.host, 16) || p.host;
    if (devName(p.host) && !p.hostAdmin) {
      dropParty(p.id, "a developer's name without the admin key");
      log("NAME: closed", p.id, "(host used a developer's name without the key)");
      notifyOnce("devname:" + ipKey(p.hostIp), 3600 * 1000, "Developer name used", "Someone hosted a party as \"" + p.host + "\" without the admin key. The party was closed.", { tags: "warning", priority: "high", click: null });
      return fail(res, 403, DEV_NAME_MSG, { closed: true, devName: true });
    }
    p.nameKicked = p.nameKicked || new Set();
    for (const x of p.roster) {
      const r = requests.get(x.rid);
      if (devName(x.name) && !(r && r.admin) && !p.nameKicked.has(x.slot + ":" + x.rid)) {
        p.nameKicked.add(x.slot + ":" + x.rid);
        p.kicks.push(x.slot);
        hEvent(p, "devname", x.name);
        log("NAME: removing", JSON.stringify(x.name), "from", p.id, "(a developer's name without the key)");
      }
    }
    hBeat(p, p.beat);
    // [v1.3] live: the joiners still waiting, so the host's game drops the ones who left
    // at once instead of waiting on them (that's what left people stuck at "waiting
    // for the host"). One who has the host's code is busy making a reply, not asking.
    const now = Date.now();
    // [v1.5] acks: the answers the host's game got. An answer is sent with every beat
    // until then (one lost beat used to lose the answer, and the join stuck at "Almost
    // there"). Games without acks get each answer once, as before.
    // drop: joins the host's game gave up on; those players ask again at once.
    const acks = Array.isArray(body.acks) ? body.acks.slice(0, 40).map(String) : null;
    for (const rid of acks || []) {
      const r = requests.get(rid);
      if (r && r.party === p.id && !r.done) {
        r.done = true; // kept a little while (for moderation), then tidied up
        r.seen = now + 60 * 60 * 1000;
      }
    }
    for (const rid of Array.isArray(body.drop) ? body.drop.slice(0, 40).map(String) : []) {
      const r = requests.get(rid);
      if (r && r.party === p.id && !r.done) r.dropped = true;
    }
    const out = { requests: [], answers: [], kicks: p.kicks.splice(0), live: [] };
    for (const r of requests.values()) {
      if (r.party !== p.id || r.done || r.dropped) continue;
      if (!r.admin && isBanned(r.ip, r.dev)) continue;
      if (now - r.seen < LIVE_MS || (r.offer && now - r.offerAt < 25000)) out.live.push(r.rid);
      if (!r.offer) out.requests.push({ rid: r.rid, name: r.name, admin: !!r.admin, same: !!r.same, rl: !!r.rl });
      else if (r.answer && (acks ? now - r.answerAt < 30000 : !r.given)) {
        out.answers.push({ rid: r.rid, code: r.answer });
        r.given = true;
        if (!acks) {
          r.done = true;
          r.seen = now + 60 * 60 * 1000;
        }
      }
    }
    return send(res, 200, out);
  }
  if (action === "offer") {
    const r = requests.get(String(body.rid || ""));
    if (!r || r.party !== p.id) return fail(res, 404, "That player stopped waiting.");
    const code = String(body.code || "");
    if (!code || code.length > MAX_CODE) return fail(res, 400, "Bad connection code.");
    r.offer = code;
    r.offerAt = Date.now();
    return send(res, 200, { ok: true });
  }
  return fail(res, 404, "Not found.");
}

// body: { key, action: "kick" | "ban" | "unban", party, name }
function adminAction(res, who, body) {
  const action = String(body.action || "");
  const target = norm(body.name);
  if (action === "unban") {
    const before = bans.length;
    bans = bans.filter((b) => norm(b.name) !== target);
    writeJson(BANS_FILE, bans);
    log("ADMIN", who.name, "unbanned", JSON.stringify(target), before - bans.length);
    return send(res, 200, { ok: true, text: before - bans.length ? "Unbanned " + target + "." : "Nobody called " + target + " is banned." });
  }
  if (action !== "kick" && action !== "ban") return fail(res, 400, "Unknown command.");
  if (!target) return fail(res, 400, "Who? Type /" + action + " and their name.");
  const p = parties.get(String(body.party || ""));
  if (!p) return fail(res, 404, "That party isn't on the server (or has closed).");
  let ipList = [], devList = [], found = null;
  // [v1.7] the developers can't be kicked or banned (from their own party, or one
  // they joined with their admin key)
  if (norm(p.host) === target && p.hostAdmin) return fail(res, 403, p.host + " is a developer and can't be removed.");
  const admEntry = p.roster.find((x) => norm(x.name) === target);
  const admReq = admEntry && requests.get(admEntry.rid);
  if (admReq && admReq.admin) return fail(res, 403, admEntry.name + " is a developer and can't be removed.");
  if (norm(p.host) === target) {
    found = { host: true, name: p.host };
    ipList = [p.hostIp];
    devList = [p.hostDev];
  } else {
    const entry = p.roster.find((x) => norm(x.name) === target);
    if (entry) {
      found = { slot: entry.slot, name: entry.name };
      const r = requests.get(entry.rid);
      if (r) {
        ipList = [r.ip];
        devList = [r.dev];
      }
      p.kicks.push(entry.slot); // the host's game removes them on its next check-in
    }
  }
  if (!found) return fail(res, 404, "No player called " + target + " in this party.");
  if (found.host) p.modClosed = true; // the host's game closes it on its next check-in
  if (action === "ban") {
    bans.push({ id: id(5), name: found.name, ips: ipList.filter(Boolean).map(ipKey), devs: devList.filter(Boolean), at: new Date().toISOString(), by: who.name });
    writeJson(BANS_FILE, bans);
    stats.bans++;
    p.hist.bans++;
  } else {
    stats.kicks++;
    p.hist.kicks++;
  }
  hEvent(p, action, found.name + " (by " + clean(who.name, 24) + ")");
  log("ADMIN", who.name, action, JSON.stringify(found.name), "in", p.id);
  return send(res, 200, { ok: true, text: (action === "ban" ? "Banned " : "Kicked ") + found.name + (action === "ban" ? " from all multiplayer games." : ".") });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((e) => {
    stats.errors++;
    console.error(new Date().toISOString(), "ERROR", e && e.stack ? e.stack : e);
    if (!res.headersSent) fail(res, 500, "Server error.");
  });
});
server.headersTimeout = 10000;
server.requestTimeout = 15000;
server.on("error", (e) => {
  console.error("Can't start the server:", e.message);
  process.exit(1);
});
server.listen(PORT, HOST, () => log(`DASH Parkour party server on http://${HOST}:${PORT}` + (SITE_DIR ? ` (website: ${SITE_DIR})` : "")));
