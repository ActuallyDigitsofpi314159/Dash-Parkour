# DASH Parkour server (Raspberry Pi)

This sets up your Raspberry Pi as:

* **the party server**: players find public and private parties in a list
  and press JOIN, with no codes to send. It's at `https://party.digitsandkineto.com`.
* **your website** (optional): `https://digitsandkineto.com` serves the games
  from your GitHub repo and updates itself when you change them.

It uses a **permanent Cloudflare Tunnel**, not the temporary `trycloudflare`
address that stopped working after a few minutes. It starts by itself when the
Pi turns on, so it comes back on its own after power cuts, internet outages or
moving the Pi. A watchdog checks everything every 2 minutes and fixes what it
can.

> **What the Pi does and doesn't do.** The Pi only keeps the party list and
> passes each player's connection code along: a few small messages per player.
> The game itself runs directly between the players (WebRTC). So even a Pi 3
> barely notices, and its fast Wi-Fi is plenty.

---

## Step 1 (once, in a browser): put your domain on Cloudflare

The permanent address needs `digitsandkineto.com` to use Cloudflare's free plan.

1. Make a free account at **dash.cloudflare.com** and choose **Add a domain**.
   Enter `digitsandkineto.com` and pick the **Free** plan.
2. Cloudflare shows two **nameservers** (like `ana.ns.cloudflare.com`). Go to
   where you bought the domain (GoDaddy, Namecheap, Squarespace...) and replace
   its nameservers with those two.
3. Wait until Cloudflare says the domain is **Active**. That's usually minutes,
   sometimes a few hours, and Cloudflare emails you.

If the domain already has email set up, check in Cloudflare's **DNS** page that
the `MX` records were copied over (Cloudflare copies them by itself).

## Step 2: put the files on GitHub

Upload everything from this delivery to your repo
(`ActuallyDigitsofpi314159/Dash-Parkour`), keeping the `dash-server` folder as
a folder. None of these files contain passwords or keys (see **Safety** below).

## Step 3: one command on the Pi

Open a terminal on the Pi (or SSH in) and run:

```bash
curl -fsSL https://raw.githubusercontent.com/ActuallyDigitsofpi314159/Dash-Parkour/main/dash-server/setup.sh | bash
```

All the questions come first, so you only need to be there for the first
minute or two:

1. **Your Pi password**, if the Pi asks for it (often it doesn't).
2. **Three questions.** Just press Enter for each to accept the default: your
   domain, the party address (`party`), and whether to host the website (`y`).
3. **One Cloudflare login.** It prints a link. Open it on any device (your
   phone is fine), log in, click `digitsandkineto.com`, then **Authorize**.

When it says **"That's everything I need from you!"** you can leave. The rest
installs by itself, which takes about 10 to 30 minutes on a Pi 3.

You can run the same command again at any time. It skips what's already done
and fixes anything missing.

## When you're back: `dash-party`

Type `dash-party` on the Pi to see a live status screen:

```
DASH PARKOUR server   Thu 20:50:47   Ctrl+C to leave

● Party server running
● Cloudflare tunnel running
● Internet
● https://party.digitsandkineto.com reachable

  2 parties now, 5 players   | since start: 14 parties, 31 joins | up 9h 12m | 0 banned
  Pi: 0.08 load, 610 MB memory free, 21000 MB SD card free, temp=48.3'C

What the watchdog did lately (checks every 2 minutes)
  ...
Recent errors
  none in the last 6 hours
```

Other commands:

| Command | What it does |
|---|---|
| `dash-party log` | everything as it happens |
| `dash-party errors` | just the problems |
| `dash-party keys` | the admin keys for /kick and /ban |
| `dash-party bans` / `dash-party unban NAME` | see bans, let someone back in |
| `dash-party restart` | restart the server and the tunnel |
| `dash-party fix` | run the watchdog's checks and fixes now |
| `dash-party update` | get the newest setup from GitHub and run it again |

The full setup log is in `~/dash-setup.log`.

### What fixes itself

| Problem | What happens |
|---|---|
| power cut, the Pi restarts, you move it | everything starts by itself at boot |
| the internet drops | it waits, then reconnects by itself when the internet is back |
| the server crashes or freezes | the watchdog restarts it within 2 minutes |
| the tunnel stops working | the watchdog restarts it. If nothing helps for an hour (with the internet working), it restarts the Pi, at most twice a day |
| the SD card is almost full | old system logs are cleared |
| you change games on GitHub | the website updates within 15 minutes |

## The game and your website

* **Server mode turns on by itself on your website.** At the top of
  `dash-parkour.html` it says `on: "auto"`, which means "on when the game is
  played on digitsandkineto.com". Khan Academy keeps using codes, because its
  programs can't reach outside servers.
* **Your games:** any `.html` file in the repo is on the website. For example,
  `dash-parkour.html` is at `https://digitsandkineto.com/dash-parkour.html`.
  Add an `index.html` for a home page; until then the Pi shows a simple list
  of the games.
* Hidden files, `.git` and the `dash-server` folder are never served.

## /kick and /ban (Digitsofpi and Kineto)

The setup makes **two admin keys**, one for you and one for Kineto. See them
with `dash-party keys` and give Kineto his in a private message.

In a server-mode game, signed in with your admin name, type in chat:

* `/kick NAME`: takes them out of that party (they can come back).
* `/ban NAME`: takes them out and stops them from hosting or joining **any**
  party. The ban covers that device and its internet address.
* `/unban NAME`: lets them back in (`dash-party unban NAME` does the same on
  the Pi).

The first time, the game asks for your admin key and remembers it on that
device. Other players who type these commands just see "Unknown command."

---

## Safety

**Safe to post on GitHub** (everything in this delivery): `setup.sh`,
`server.js`, `dash-party`, `dash-watchdog`, `README.md`, and the game files.
None of them contain a password, key or token.

**Never post these anywhere** (GitHub, Khan Academy, Discord, screenshots):

| Secret | Where it is | Why |
|---|---|---|
| your **admin keys** | `~/dash-admin-keys.txt`, `/etc/dash-party/admin-keys.txt` | anyone with one can kick and ban players |
| **Cloudflare login and tunnel files** | `~/.cloudflared/` (`cert.pem`, `*.json`), `/etc/dash-party/tunnel.json` | these control your domain's tunnel |
| your **Pi password** | | |

The setup never puts any of these inside the repo folder, so pushing the repo
can't leak them. Don't copy them into it.

> **Note:** the in-game admin passcodes in `dash-parkour.html` (typing your
> admin name asks for one) are visible to anyone who reads the game's code.
> They only unlock the fun admin tools inside the game (fly, strikes...). They
> can't kick or ban anyone on the server: that needs the admin keys above,
> which never leave the Pi and your own devices.

**How the Pi is protected:**

* **Nothing on the Pi is open to the internet.** The server only listens inside
  the Pi (`127.0.0.1`), and the tunnel is an outgoing connection to
  Cloudflare. No router port forwarding is needed, so don't add any.
* Cloudflare sits in front and blocks common attacks.
* The server runs as its own locked-down user (`dashparty`). It can't log in,
  can't read your files, can only write its own data folder, and is limited to
  200 MB of memory.
* Requests are rate-limited, sizes are capped, and passcodes and internet
  addresses are stored only as hashes. Wrong admin keys are limited to 5 tries
  a minute.
* Security updates for the Pi install by themselves.
* The website and `server.js` update by themselves from GitHub, but only run as
  the locked-down user. The setup and watchdog, which run with full rights,
  change only when **you** run the setup or `dash-party update`.

**Your part:**

1. Give the Pi a strong password. Run `passwd` to change it, especially if
   it's still the default.
2. Turn on two-factor login for your GitHub and Cloudflare accounts, since the
   website updates from GitHub.
3. If you don't use SSH, you can turn it off with `sudo raspi-config` →
   Interface Options → SSH.

---

## If something's wrong

* **Run the command from step 3 again.** It repairs most things.
* **The Cloudflare login page doesn't list digitsandkineto.com:** the domain
  isn't active on Cloudflare yet (step 1).
* **"Couldn't set up the address"**: same as above. Or, if something else
  (an old website host) uses those names, check Cloudflare's DNS page.
* **Start over with new questions:** `sudo rm /etc/dash-party/setup.conf`, then
  run the setup.
* **New admin keys:** `sudo rm /var/lib/dash-party/admins.json`, then run the
  setup.
* **Look closer:** `dash-party errors`, `~/dash-setup.log`.

<details><summary>Where everything lives</summary>

| Path | What |
|---|---|
| `/opt/dash-party/server.js` | the server |
| `/opt/dash-party/repo/` | your GitHub repo (the website) |
| `/var/lib/dash-party/` | admin key hashes, bans, status, watchdog log |
| `/etc/dash-party/` | tunnel settings and credentials, admin keys copy |
| `/etc/systemd/system/dash-party.service`, `dash-tunnel.service`, `dash-watchdog.timer` | what starts at boot |

</details>
