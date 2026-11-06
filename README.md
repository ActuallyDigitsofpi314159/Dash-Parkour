# DASH Parkour party server (beta)

This small server lets players find each other in a **party list** instead of
sending invite and reply codes back and forth. A host makes a party (public, or
private with a passcode, with a name and a player limit), and anyone can search
the list and press JOIN.

**What the server does — and doesn't do.** It only keeps the party list and
passes each player's connection code to the host and back. That takes a few
small messages per player. After that the game runs **peer to peer (WebRTC)**,
exactly like it does now: positions, bosses, chat and everything else go
straight between the players and never touch the server. That's why a
Raspberry Pi 3B is more than enough (it uses about 30 MB of memory and almost
no CPU, even with hundreds of parties).

> **Not for Khan Academy.** Khan Academy programs can't talk to outside
> servers, so server mode is for a copy of the game you host yourself (for
> example on GitHub Pages or itch.io, or just the `dash-parkour.html` file
> opened on your computer). The Khan Academy version keeps using codes.

Files:

| File | What it is |
|---|---|
| `server.js` | the whole server: plain Node.js, nothing to install with npm |
| `dash-party.service` | makes the server start by itself when the Pi turns on |

---

## 1. Put Node.js on the Pi

On Raspberry Pi OS (Bookworm or newer):

```bash
sudo apt update
sudo apt install -y nodejs
node --version        # anything from v14 up works
```

## 2. Copy the server over and try it

Copy the `dash-server` folder to the Pi's home folder (`/home/pi/dash-server`),
for example with a USB stick, or from your computer:

```bash
scp -r dash-server pi@raspberrypi.local:~/
```

Then on the Pi:

```bash
cd ~/dash-server
node server.js
```

It prints `DASH Parkour party server on http://0.0.0.0:8787`. From another
computer on the same Wi-Fi, open **http://raspberrypi.local:8787** in a
browser. You should see something like
`{"ok":true,"game":"DASH Parkour party server","parties":0,...}`.
Press Ctrl+C to stop it.

(If `raspberrypi.local` doesn't work, use the Pi's IP address instead. Run
`hostname -I` on the Pi to see it.)

## 3. Start it automatically

```bash
sudo cp ~/dash-server/dash-party.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now dash-party
systemctl status dash-party      # should say "active (running)"
journalctl -u dash-party -f      # live log (parties made and closed)
```

If your Pi user isn't called `pi`, change `User=` and the two paths in
`dash-party.service` first.

## 4. Let players outside your home reach it

Choose one of these:

**A. Same Wi-Fi only (simplest).** Players on your home network can use
`http://raspberrypi.local:8787`. This works when the game file is opened from
the computer (`file://`). A game page on an `https://` website can't use a
plain `http://` server, so use B for a hosted game.

**B. Cloudflare Tunnel (recommended for the internet).** It's free and gives you
an `https://` address with no router setup and no open ports. Install it on the
Pi (64-bit Raspberry Pi OS; on 32-bit use `cloudflared-linux-arm.deb`):

```bash
curl -fsSL -o /tmp/cloudflared.deb \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
sudo dpkg -i /tmp/cloudflared.deb
```

*Quick test* (the address changes every time it restarts):

```bash
cloudflared tunnel --url http://localhost:8787
```

It prints an address like `https://something-random.trycloudflare.com`. Use
that as the server address below.

*Permanent address* (needs a free Cloudflare account and a domain on it):

```bash
cloudflared tunnel login
cloudflared tunnel create dash-party
cloudflared tunnel route dns dash-party party.yourdomain.com
```

Then create `~/.cloudflared/config.yml`:

```yaml
tunnel: dash-party
credentials-file: /home/pi/.cloudflared/<the-tunnel-id>.json
ingress:
  - hostname: party.yourdomain.com
    service: http://localhost:8787
  - service: http_status:404
```

Then install it as a service with
`sudo cloudflared --config /home/pi/.cloudflared/config.yml service install`.
Your server is now at `https://party.yourdomain.com`.

**C. Port forwarding.** Forward a port on your router to the Pi's port 8787.
This only gives you `http://`, which hosted (`https://`) game pages can't use,
and it opens your home network to the internet. B is safer and easier.

## 5. Turn on server mode in the game

At the top of `dash-parkour.html`, under **SERVER MODE**, change:

```js
var dashServerMode = window.dashServerMode || { on: false, url: "http://raspberrypi.local:8787" };
```

to

```js
var dashServerMode = window.dashServerMode || { on: true, url: "https://party.yourdomain.com" };
```

Open the game and go to **Multiplayer**. You'll now see **CREATE PARTY** and
**FIND A PARTY**. **USE INVITE CODES** still offers the old way. If you want the
small compressed file, run `python3 compress.py dash-parkour.html` as usual; the
setting at the top is kept.

---

## How it works

```
 host game ──make party──▶  Pi  ◀──list / search── joiner game
 host game ◀─join request─  Pi  ◀──JOIN (+passcode)─ joiner game
 host game ──conn. code──▶  Pi  ──conn. code──────▶ joiner game
 host game ◀─answer code──  Pi  ◀──answer code──── joiner game
 host game ◀═════════ peer to peer (WebRTC): the actual game ═════════▶ joiner game
```

* The host's game checks in every 2.5 seconds (every second while someone is
  joining). A party disappears 15 seconds after its host stops checking in, for
  example when they close the tab.
* New players are let in while the host is on the menus or the map, not in the
  middle of a level. Joiners are told to wait until then.
* Private passcodes are stored only as salted hashes, and the list never shows
  them. Only the host's game (with its secret token) can update or close its
  party.
* Each address gets about 150 requests per 10 seconds. Connection codes are
  size-limited, and the server holds at most 300 parties (`MAX_PARTIES=`).
* Everything is in memory. Restarting the Pi clears the list; hosts just make a
  new party.

### The API (for the curious)

| Method and path | Who | What |
|---|---|---|
| `GET /api/parties?q=name` | anyone | the list (search by name) |
| `POST /api/parties` `{name, priv, pass, max, host}` | host | make a party → `{id, token}` |
| `POST /api/parties/:id/beat` `{token, n, playing}` | host | check in → join requests and answers |
| `POST /api/parties/:id/offer` `{token, rid, code}` | host | the connection code for one joiner |
| `POST /api/parties/:id/close` `{token}` | host | remove the party |
| `POST /api/parties/:id/join` `{name, pass}` | joiner | ask to join → `{rid}` |
| `GET /api/join/:rid` | joiner | waiting, or the host's connection code |
| `POST /api/join/:rid/answer` `{code}` | joiner | the answer code |
