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
// at /dashparkour.
const SETUP_CONF = {};
try {
  for (const line of fs.readFileSync(process.env.SETUP_CONF || "/etc/dash-party/setup.conf", "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m) SETUP_CONF[m[1]] = m[2];
  }
} catch (e) {}
const SITE_DOMAIN = (process.env.SITE_DOMAIN || SETUP_CONF.DOMAIN || "digitsandkineto.com").toLowerCase();
const PARTY_HOST = (process.env.PARTY_HOST || SETUP_CONF.PARTY_HOST || "party." + SITE_DOMAIN).toLowerCase();
const GAME_PATH = "/dashparkour";
// [v1.1] the full (non-Khan-Academy) build: no size cap and one loading screen fewer
const GAME_FILES = ["dash-parkour.html", "dash-parkour.ka.html"];

const parties = new Map(); // id -> party
const requests = new Map(); // rid -> join request
const startedAt = Date.now();
const stats = { made: 0, joins: 0, kicks: 0, bans: 0, errors: 0 };

const id = (bytes) => crypto.randomBytes(bytes).toString("base64").replace(/[+/=]/g, (c) => ({ "+": "-", "/": "_", "=": "" }[c]));
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const hashPass = (salt, pass) => sha(salt + "\u0000" + pass);
const clean = (s, max) => String(s == null ? "" : s).replace(/[\u0000-\u001f<>"'\\`]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const cleanDev = (s) => String(s || "").replace(/[^\w-]/g, "").slice(0, 40);
const sameText = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const norm = (n) => clean(n, 16).toLowerCase();

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
  if (!key || String(key).length < 20) return null;
  const h = sha(String(key));
  for (const a of admins) if (a && a.hash && sameText(a.hash, h)) return a;
  return null;
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
  for (const [pid, p] of parties) if (now - p.beat > PARTY_TTL) dropParty(pid);
  for (const [rid, r] of requests) if (now - r.seen > REQUEST_TTL || !parties.has(r.party)) requests.delete(rid);
  for (const [ip, h] of hits) if (now - h.t > 60000) hits.delete(ip);
  for (const [ip, t] of adminTries) if (now - t.t > 60000) adminTries.delete(ip);
}, 5000).unref();
// a status file for the dashboard (dash-party)
setInterval(() => {
  try {
    writeJson(path.join(DATA_DIR, "status.json"), { at: Date.now(), parties: parties.size, players: [...parties.values()].reduce((a, p) => a + p.n, 0), up: Math.round((Date.now() - startedAt) / 1000), stats, bans: bans.length, admins: admins.length });
  } catch (e) {}
}, 10000).unref();

function dropParty(pid) {
  parties.delete(pid);
  for (const [rid, r] of requests) if (r.party === pid) requests.delete(rid);
}
const publicParty = (p) => ({ id: p.id, name: p.name, priv: p.priv, n: p.n, max: p.max, playing: p.playing, host: p.host });

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
    // the website: the game at /dashparkour
    if (p0.toLowerCase() === GAME_PATH) {
      const tryFile = (i) => {
        if (i >= GAME_FILES.length) return fail(res, 404, "The game isn't on the server yet.");
        const file = path.join(SITE_DIR, GAME_FILES[i]);
        fs.stat(file, (err, st) => (err || !st.isFile() ? tryFile(i + 1) : sendFile(req, res, file, st)));
      };
      return tryFile(0);
    }
    return serveSite(req, res, url.pathname);
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
    const p = parties.get(r.party);
    return send(res, 200, r.offer ? { state: "offer", offer: r.offer } : { state: "waiting", playing: p.playing });
  }

  if (req.method !== "POST") return fail(res, 404, "Not found.");
  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return fail(res, 400, "Bad request.");
  }
  const bdev = cleanDev(body.dev);

  // joiner's answer code
  m = /^\/api\/join\/([\w-]{8,40})\/answer$/.exec(p0);
  if (m) {
    const r = requests.get(m[1]);
    if (!r || !parties.has(r.party)) return fail(res, 404, "The party closed.");
    const code = String(body.code || "");
    if (!code || code.length > MAX_CODE) return fail(res, 400, "Bad connection code.");
    r.answer = code;
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
    const max = Math.max(2, Math.min(8, Math.round(Number(body.max) || 4)));
    const p = { id: id(6), token: id(18), name, priv, salt: id(9), pass: "", max, n: 1, playing: false, host: clean(body.host, 16) || "Host", hostIp: ip, hostDev: bdev, roster: [], kicks: [], made: Date.now(), beat: Date.now() };
    p.pass = priv ? hashPass(p.salt, pass) : "";
    parties.set(p.id, p);
    stats.made++;
    log("party made", p.id, JSON.stringify(p.name), priv ? "(private)" : "");
    return send(res, 200, { id: p.id, token: p.token });
  }

  m = /^\/api\/parties\/([\w-]{4,20})\/(beat|close|offer|join)$/.exec(p0);
  if (!m) return fail(res, 404, "Not found.");
  const p = parties.get(m[1]);
  const action = m[2];
  if (!p) return fail(res, 404, action === "join" ? "That party has closed." : "That party is no longer listed.");

  if (action === "join") {
    if (isBanned(ip, bdev)) return fail(res, 403, "You can't join multiplayer games right now.", { banned: true });
    if (p.priv && !sameText(hashPass(p.salt, String(body.pass || "").slice(0, 24)), p.pass)) return fail(res, 403, "Wrong passcode.");
    let waiting = 0;
    for (const r of requests.values()) if (r.party === p.id && !r.done) waiting++;
    if (p.n >= p.max) return fail(res, 409, "That party is full.");
    if (waiting >= 8) return fail(res, 429, "Lots of players are joining this party right now. Try again in a moment.");
    const rid = id(12);
    requests.set(rid, { rid, party: p.id, name: clean(body.name, 16) || "Player", ip, dev: bdev, offer: "", answer: "", given: false, done: false, seen: Date.now() });
    stats.joins++;
    return send(res, 200, { rid });
  }

  // everything below is the host's, checked by its secret token
  if (!sameText(body.token || "", p.token)) return fail(res, 403, "Not your party.");

  if (action === "close") {
    dropParty(p.id);
    log("party closed", p.id);
    return send(res, 200, { ok: true });
  }
  if (action === "beat") {
    if (p.modClosed || isBanned(p.hostIp, p.hostDev)) {
      dropParty(p.id);
      return fail(res, 403, "A moderator closed this party.", { closed: true });
    }
    p.beat = Date.now();
    p.n = Math.max(1, Math.min(p.max, Math.round(Number(body.n) || 1)));
    p.playing = !!body.playing;
    // who is in the party: [{ slot, name, rid }] (rid = how they joined)
    if (Array.isArray(body.roster)) {
      p.roster = body.roster.slice(0, 8).map((x) => ({ slot: Math.round(Number(x && x.slot)) || 0, name: clean(x && x.name, 16), rid: String((x && x.rid) || "").slice(0, 40) }));
    }
    const out = { requests: [], answers: [], kicks: p.kicks.splice(0) };
    for (const r of requests.values()) {
      if (r.party !== p.id || r.done) continue;
      if (isBanned(r.ip, r.dev)) continue;
      if (!r.offer) out.requests.push({ rid: r.rid, name: r.name });
      else if (r.answer && !r.given) {
        out.answers.push({ rid: r.rid, code: r.answer });
        r.given = true;
        r.done = true; // kept a little while (for moderation), then tidied up
        r.seen = Date.now() + 60 * 60 * 1000;
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
  } else stats.kicks++;
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
