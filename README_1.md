# DASH Parkour

A parkour platformer by Digitsofpi and Kineto, with multiplayer.

| File | What it is |
|---|---|
| `dash-parkour.html` | the game, easy to edit. Open it in a browser to play |
| `compress.py` | `python3 compress.py dash-parkour.html` makes the small `dash-parkour.ka.html` |
| `dash-parkour.ka.html` | the small file for Khan Academy (and for the website) |
| `dash-parkour-save-editor.html` | see and change everything in a save code |
| `dash-server/` | the party server and website host for the Raspberry Pi. Setup: [dash-server/README.md](dash-server/README.md) |

Set up the Raspberry Pi server with one command:

```bash
curl -fsSL https://raw.githubusercontent.com/ActuallyDigitsofpi314159/Dash-Parkour/main/dash-server/setup.sh | bash
```

Nothing in this repo is secret. The admin keys and Cloudflare files stay on
the Pi; never add them here.
