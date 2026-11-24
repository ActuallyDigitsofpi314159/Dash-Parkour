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
| `dash-party setkey NAME` | choose your own admin key instead of the long random one (`NAME` is `digitsofpi` or `kineto`; 8 characters or more, spaces are ignored). Works within a few seconds; the game asks for the new key the next time the old one is refused |
| `dash-party history` | the last 50 parties: who made them, how long they were up, who joined and left, wrong passcodes, kicks and bans |
| `dash-party history N` | the full timeline of party number N from that list |
| `dash-party stats` | how the game is doing: players online now, the most at once, players and new players per day, multiplayer use, parties and joins, and the busiest hours. Every game on the website checks in (not only multiplayer); only a random device id is kept, never names or addresses |
| `dash-party bans` / `dash-party unban NAME` | see bans, let someone back in |
| `dash-party notify on` | a phone notice (ntfy app) whenever someone makes a party; it prints the topic to subscribe to. `notify test` sends one, `notify off` stops them |
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

> **Note:** the developers' names in the game (Digitsofpi and Kineto, and
> look-alikes such as "K1neto" or "Digits of Pi") are locked behind the admin
> keys above. Typing one asks for an admin key, which this server checks; there
> is no passcode in the game's code. Without a key the name can't be used: the
> server refuses to make or join a party with it, removes a player in a party who
> uses one, and closes a party whose host does. The admin tools in the game (fly,
> strikes...) come with the name, so they need the key too.

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
| `/var/lib/dash-party/` | admin key hashes, bans, status, party history, watchdog log |
| `/etc/dash-party/` | tunnel settings and credentials, admin keys copy |
| `/etc/systemd/system/dash-party.service`, `dash-tunnel.service`, `dash-watchdog.timer` | what starts at boot |

</details>

## Relay for players who can't link directly (TURN)

Games link to each other directly. Some networks (phone data, school and work
Wi-Fi, strict routers) block that, and those joins stop at "Almost there". With a
relay the server hands games short-lived relay logins (`GET /api/ice`); they still
link directly when they can and only go through the relay when that fails
(the browser always prefers a direct path, and moves off the relay if one opens
up). Games on a relayed link also send less: 15 updates a second instead of 30,
and world updates 10 a second instead of 20. Every game also sends only what
changed in each update (a full one every 3 s), which is about a tenth of the data
the full updates used. On a relayed link, games that both have it also put every
player's update and the world in one packet each time (each packet carries about
90 bytes of wrapping), skip updates of a Dash standing still (3 a second keep it
from looking paused), and send them as bytes instead of text: together about 60%
less through the relay (about 12 MB an hour for one relayed player, measured; the
free 500 MB is then about 40 hours of relayed play a month, more when players stand
still). Add `?relaytest` to the game's address to make that copy link only through
the relay: it says on screen when it did. Three free options:

### Metered's free plan (`dash-party turn metered`): can never charge

Sign up at metered.ca for the free plan **with no card** (email only). With no card
on the account it can't charge you: past its free amount each month it just stops
until the next month, and games link directly only. The command asks for the app
name (`NAME.metered.live`) and the API key of a TURN credential, checks them with
Metered, and saves them in `/var/lib/dash-party/turn.json`. The server hands out
one relay by UDP and one by TCP on port 443 (which gets through strict networks).
The free amount is small (Metered lists 500 MB a month), which is why games only
use it when they must and send as little as possible through it.

### Cloudflare's relay (`dash-party turn set`)

Free for 1,000 GB a month, then $0.05/GB, and Cloudflare has no spending cap of
its own, so the server guards it:

- Every 10 minutes it reads this month's relay traffic from Cloudflare's own
  usage meter (the number Cloudflare bills on) and switches the relay off at your
  budget (500 GB by default, at most 950), cancelling every login it gave out.
- If the meter can't be read for 30 minutes, or no analytics token is set, the
  relay is off. It never runs unwatched.
- Logins only go to a game hosting a party (with its party token) or asking to
  join one (with its join request), each its own 3-hour login, at most 12 a day
  per address and 400 a day overall. A login that moves over 1 GB (a whole
  evening of DASH is a few MB) is cancelled.

You need, from the Cloudflare dashboard:

1. **Realtime** > **TURN Server** > **Create**: the **Turn Token ID** and **API Token**.
2. Your **Account ID** (Account home, the ... menu > Copy account ID).
3. An analytics token: **My Profile** > **API Tokens** > **Create Token** > custom,
   permission **Account / Account Analytics / Read** only.

Then `dash-party turn set` and paste them. They are kept in
`/var/lib/dash-party/turn.json` (only the server can read it), so running setup.sh
again keeps them. `dash-party turn` shows the month's usage against the budget.

### A relay on the Pi (`dash-party turn pi`)

Installs coturn on the Pi and sets it all up with no questions (`dash-relay`).
Free with no meter, but it uses your home connection, and the router has to
forward **UDP+TCP 3478** and **UDP 49160-49200** to the Pi (Cloudflare's tunnel
can't carry it). The Pi asks the router to open those by itself (UPnP), and the
watchdog keeps them open and follows your home IP (and the Pi's home address) when
they change. If the router won't let it, `dash-party turn guide` walks through
forwarding them by hand. If your provider shares one address between homes
(carrier NAT), `dash-party turn` says so: use Cloudflare's relay then. Players
linking through it can see your home IP. It is limited to about 0.25 MB/s per
player (a game needs well under 0.1), never relays into your home network, and
logins are shared-secret ones from the server with the same bot protection as
above. `dash-party turn pi NAME` uses a DNS-only name instead of the IP.

`dash-party turn off` removes either. Relay addresses are only sent to games that
can read them (older versions reject a code that has them), so mixed versions keep
working without the relay.

## Bot protection

- **A puzzle before making or joining a party.** The game asks `GET /api/pow`,
  finds a number whose hash with the puzzle starts with 17 (making) or 15 (joining)
  zero bits (a few hundredths of a second in a browser), and sends it with the
  request. Puzzles are signed by the server, work once and expire after 3 minutes,
  so a script making thousands of parties or joins has to do that work every time.
  A game too old to solve them is told to refresh the page.
- **Limits per home connection** (IPv4 address or IPv6 /64): 3 parties open at
  once, 12 made an hour, 12 join requests a minute, 4 joins waiting at once. Plus
  the general limit on requests (150 every 10 s) and bans.
- **In the game**, the host drops a player whose game floods it (far more messages
  than a game sends), passes on at most 5 chat lines every 8 s from one player, and
  cuts chat lines to 200 characters.
- **Relay logins** only go to a game hosting a party or asking to join one, with a
  daily cap overall and per address.

## Joins that don't link up

`dash-party stats` ends with **Joins that never linked up (last 7 days), and why**.
A joiner whose link doesn't open reports it (no addresses: just which kinds of
address each side had and how far the link got), e.g.
`no link ice:checking/checking me:pub host:pub`. Each heartbeat also tells the
server which answers the host got (`acks`; an answer is sent again until then)
and which joins it gave up on (`drop`; the joiner then asks again at once).

## Player invites

Everyone in a party has an **INVITE PLAYERS** button on the Multiplayer screen.
It lists the players online right now (with a search bar); each has its own
INVITE button, usable once every 15 seconds per player (at most 12 invites a
minute). The invited player gets a notice within about 10 seconds:
"(name) invited you to their party!" with JOIN. The invite lasts 2 minutes and
lets them in without the passcode of a private party (someone in the party
invited them). Players who turn off **Settings > General > Receive Invites**
aren't listed and don't get player invites; developer invites still reach them.
The list shows names only, by a random id, never the device id.

| | |
|---|---|
| `POST /api/online` `{dev, q}` | who is online (named, taking invites), up to 60 |
| `POST /api/pinvite` `{dev, party, to, from}` | invite one player (`key` = admin key: ignores Receive Invites) |
| `POST /api/hello` | now also sends `name` and `inv`; answers with `pinvites` |

## Developer invites

Digitsofpi and Kineto (with their admin key) see an **INVITE EVERYONE** button
inside INVITE PLAYERS while they are in a party. Every player on the
website (in multiplayer or not) gets a notice within about 15 seconds:
"Kineto, a developer of this game, invited you to play with him!", with JOIN
and a close button. The invite lasts 2 minutes and lets players into the party
even if it is private.

