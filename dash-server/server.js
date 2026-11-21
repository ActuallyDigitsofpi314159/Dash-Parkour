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

// ---------------- [v1.3] phone notice when a party is made (ntfy) ----------------
// DATA_DIR/notify.json: { "topic": "...", "server": "https://ntfy.sh" } (made by
// "dash-party notify on"). Subscribe to the same topic in the ntfy app.
const NOTIFY_FILE = path.join(DATA_DIR, "notify.json");
let notifyConf = readJson(NOTIFY_FILE, null);
fs.watchFile(NOTIFY_FILE, { interval: 5000 }, () => {
  notifyConf = readJson(NOTIFY_FILE, null);
  log("notify settings reloaded:", notifyConf && notifyConf.topic ? "on" : "off");
});
const notified = new Map(); // host+party name -> time (a party listed again after a restart isn't news)
function notifyParty(p) {
  const c = notifyConf;
  if (!c || !c.topic || !/^[\w-]{8,64}$/.test(c.topic)) return;
  const now = Date.now();
  for (const [k, t] of notified) if (now - t > 10 * 60 * 1000) notified.delete(k);
  const k = ipKey(p.hostIp) + "\u0000" + p.name.toLowerCase();
  if (notified.has(k)) return;
  notified.set(k, now);
  let u;
  try {
    u = new URL("/" + c.topic, c.server || "https://ntfy.sh");
  } catch (e) {
    return;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return;
  const ascii = (s) => s.replace(/[\u2018\u2019]/g, "'").replace(/[^\x20-\x7e]/g, "?"); // headers must be plain text
  const body = p.host + " made \"" + p.name + "\" (" + (p.priv ? "private" : "public") + ", up to " + p.max + " players). Open DASH Parkour > Multiplayer to join.";
  const req = require(u.protocol === "https:" ? "https" : "http").request(u, {
    method: "POST",
    timeout: 8000,
    headers: { Title: ascii("DASH party: " + p.name), Tags: "video_game", Click: "https://" + SITE_DOMAIN + GAME_PATH, "Content-Type": "text/plain; charset=utf-8", "Content-Length": Buffer.byteLength(body) },
  });
  req.on("response", (res) => {
    if (res.statusCode >= 300) log("notify: ntfy said", res.statusCode);
    res.resume();
  });
  req.on("timeout", () => req.destroy(new Error("timed out")));
  req.on("error", (e) => log("notify: couldn't reach ntfy:", e.message));
  req.end(body);
}

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

// ---------------- tidy up ----------------
setInterval(() => {
  const now = Date.now();
  for (const [pid, p] of parties) if (now - p.beat > PARTY_TTL) dropParty(pid, "host stopped answering");
  for (const [rid, r] of requests) if (now - r.seen > REQUEST_TTL || !parties.has(r.party)) requests.delete(rid);
  for (const [ip, h] of hits) if (now - h.t > 60000) hits.delete(ip);
  for (const [ip, t] of adminTries) if (now - t.t > 60000) adminTries.delete(ip);
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
const ONLINE_MS = 45000; // seen in the last 45 s = online
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
// With a Cloudflare TURN key (dash-party turn set, kept in DATA_DIR/turn.json; or
// TURN_KEY_ID / TURN_KEY_TOKEN in the environment), games get short-lived relay
// logins from /api/ice. Players still link directly when they can; the relay is only
// used when that fails (phone data, school and work networks, strict routers).
// Without a key the games work as before. The file is read again whenever the
// logins are renewed, so a new key works without a restart.
const TURN_FILE = path.join(DATA_DIR, "turn.json");
function turnKey() {
  let id = process.env.TURN_KEY_ID || "",
    token = process.env.TURN_KEY_TOKEN || "";
  try {
    const j = JSON.parse(fs.readFileSync(TURN_FILE, "utf8"));
    if (j && j.id && j.token) {
      id = String(j.id);
      token = String(j.token);
    }
  } catch (e) {}
  return { id: id.trim(), token: token.trim() };
}
const TURN_TTL = 6 * 3600; // seconds each login works for
let iceCache = null; // { servers, until }
let iceBusy = null;
function cloudflareIce(key) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ ttl: TURN_TTL });
    const req = https.request(
      { method: "POST", host: "rtc.live.cloudflare.com", path: "/v1/turn/keys/" + encodeURIComponent(key.id) + "/credentials/generate-ice-servers", headers: { Authorization: "Bearer " + key.token, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }, timeout: 8000 },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          try {
            if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error("Cloudflare said " + res.statusCode));
            const j = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            let list = j.iceServers;
            if (list && !Array.isArray(list)) list = [list];
            // (browsers can't use port 53, and Cloudflare's own STUN is enough next to Google's)
            const servers = (list || []).map((x) => ({ urls: [].concat(x.urls || []).filter((u) => !/:53(\?|$)/.test(u)), username: x.username, credential: x.credential })).filter((x) => x.urls.length);
            if (!servers.length) return reject(new Error("no ICE servers in the answer"));
            resolve(servers);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end(body);
  });
}
function getIce() {
  if (iceCache && Date.now() < iceCache.until) return Promise.resolve(iceCache.servers);
  const key = turnKey();
  if (!key.id || !key.token) {
    iceCache = { servers: [], until: Date.now() + 60 * 1000 }; // (looked at again in a minute)
    return Promise.resolve([]);
  }
  if (!iceBusy) {
    iceBusy = cloudflareIce(key)
      .then((servers) => {
        iceCache = { servers, until: Date.now() + 60 * 60 * 1000 }; // (one login for everyone, renewed hourly)
        return servers;
      }, (e) => {
        log("TURN: couldn't get relay logins:", e.message);
        iceCache = { servers: iceCache ? iceCache.servers : [], until: Date.now() + 2 * 60 * 1000 };
        return iceCache.servers;
      })
      .then((x) => {
        iceBusy = null;
        return x;
      });
  }
  return iceBusy;
}

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
function statusPage(req, res) {
  const players = [...parties.values()].reduce((a, p) => a + p.n, 0);
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
<table>${row("Server up for", fmtUp((Date.now() - startedAt) / 1000))}${row("Raspberry Pi up for", piUp ? fmtUp(piUp) : "?")}${row("Parties open", parties.size)}${row("Parties playing", playing)}${row("Players in parties", players)}${row("Parties made since start", stats.made)}${row("Pi load (1 min)", load || "?")}${row("Server memory", mem + " MB")}</table>
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
    return getIce().then((servers) => send(res, 200, { iceServers: servers }));
  }
  if (req.method === "GET" && p0 === "/api/health") {
    return send(res, 200, { ok: true, game: "DASH Parkour party server", parties: parties.size, uptime: Math.round(process.uptime()) });
  }
  const dev = cleanDev(url.searchParams.get("dev"));

  // list (and search) parties
  if (req.method === "GET" && p0 === "/api/parties") {
    const q = clean(url.searchParams.get("q"), 24).toLowerCase();
    const list = [...parties.values()]
      .filter((p) => !p.modClosed && (!q || p.name.toLowerCase().includes(q)))
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

  // [v1.5] every game, every 15 s: counted for the stats; gets a developer's invite
  if (p0 === "/api/hello") {
    const banned = !!isBanned(ip, bdev);
    // [v1.5] name: the multiplayer name (for the invite list); inv: 0 = no invites from players
    const h = statHello(bdev, body.mp, body.game, { name: clean(body.name, 16), inv: body.inv !== 0 && body.inv !== false, banned });
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
    const v = { id: id(6), from: clean(body.from, 16) || (who ? clean(who.name, 16) : "A player"), dev: !!who, party: pp.id, name: pp.name, token, until: now + PINV_MS };
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

  // moderators: /kick and /ban (and unban) from the game
  if (p0 === "/api/admin") {
    const t = adminTries.get(ip) || { t: Date.now(), n: 0 };
    if (t.n >= 5) return fail(res, 429, "Too many wrong keys. Wait a minute.");
    const who = adminFor(body.key);
    if (!who) {
      t.n++;
      adminTries.set(ip, t);
      log("ADMIN: wrong key from", ipKey(ip).slice(0, 8));
      return fail(res, 403, "That admin key isn't right.", { badKey: true });
    }
    return adminAction(res, who, body);
  }

  // host: make a party
  if (p0 === "/api/parties") {
    if (isBanned(ip, bdev)) return fail(res, 403, "You can't host multiplayer games right now.", { banned: true });
    if (parties.size >= MAX_PARTIES) return fail(res, 503, "The party server is full. Try again in a bit.");
    const name = clean(body.name, 24);
    if (!name) return fail(res, 400, "Give your party a name.");
    const priv = !!body.priv;
    const pass = String(body.pass || "").slice(0, 24);
    if (priv && !pass) return fail(res, 400, "A private party needs a passcode.");
    const max = Math.max(2, Math.min(MAX_PLAYERS, Math.round(Number(body.max) || 4)));
    const p = { id: id(6), token: id(18), name, priv, salt: id(9), pass: "", max, n: 1, playing: false, host: clean(body.host, 16) || "Host", hostIp: ip, hostDev: bdev, roster: [], kicks: [], made: Date.now(), beat: Date.now() };
    p.pass = priv ? hashPass(p.salt, pass) : "";
    newHistory(p, ip);
    parties.set(p.id, p);
    stats.made++;
    statDay(Date.now()).parties++;
    log("party made", p.id, JSON.stringify(p.name), priv ? "(private)" : "");
    notifyParty(p);
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
    // [v1.3] moderators (Digitsofpi and Kineto) join any party at any time: private,
    // full or not. Their admin key is checked here, so nobody else can.
    if (body.key) {
      const t = adminTries.get(ip) || { t: Date.now(), n: 0 };
      if (t.n >= 5) return fail(res, 429, "Too many wrong keys. Wait a minute.");
      const who = adminFor(body.key);
      if (!who) {
        t.n++;
        adminTries.set(ip, t);
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
    // who is in the party: [{ slot, name, rid }] (rid = how they joined)
    if (Array.isArray(body.roster)) {
      p.roster = body.roster.slice(0, MAX_IN_PARTY).map((x) => ({ slot: Math.round(Number(x && x.slot)) || 0, name: clean(x && x.name, 16), rid: String((x && x.rid) || "").slice(0, 40) }));
      hRoster(p, p.roster);
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
