# STICKMAN WARFARE

A browser-based, Call of Duty–style first-person shooter with a cinematic ink-line stickman art style.
Single-player against difficulty-scaled AI, real-time multiplayer deathmatch, a coin economy, an armory and
wardrobe shop, accounts with hashed passwords, and an admin command center.

## Requirements

- **Node.js 22.5 or newer** (uses the built-in `node:sqlite` module, so there is nothing native to compile).
  Check with `node -v`.

## Setup and launch

```powershell
cd C:\Users\Admin\Desktop\game
npm install
npm start
```

Then open:

| Page  | URL                          |
|-------|------------------------------|
| Game  | http://localhost:3000/       |
| Admin | http://localhost:3000/admin  |

### Changing the port

The server listens on **port 3000** by default. To use another port:

```powershell
$env:PORT=8080; npm start          # PowerShell
PORT=8080 npm start                # macOS / Linux
```

If the port is already taken, the server exits with a message telling you to choose a different one.

### Playing with other PCs on your network (LAN / Wi-Fi)

1. Start the server on one PC (the "host") with `npm start`. It prints the addresses to use, for example:

   ```
   This PC:   http://localhost:3000/
   Network:   http://192.168.5.198:3000/   (Wi-Fi)
   ```

2. On every other PC connected to the **same router / Wi-Fi**, open the `Network` address in Chrome, Edge or
   Firefox. Nothing needs to be installed on those PCs.
3. Everyone creates their own account, picks the **same map**, and clicks **Join Arena**. Each map has its own
   arena, so players only meet others who chose that map. The map cards show how many players are in each one.

If the other PCs can't connect:

- The first time Node.js listens on the network, Windows asks whether to allow it. Tick **Private networks** and
  click Allow.
- Or double-click `allow-lan.cmd` in this folder, which opens port 3000 in Windows Firewall. For another port,
  run `allow-lan.cmd 8080`.
- Make sure the host's Wi-Fi is set to **Private**: Settings > Network & internet > Wi-Fi > your network >
  Network profile type.
- Guest Wi-Fi networks and some office networks block PC-to-PC traffic. Use a normal home network or a phone
  hotspot instead.

To keep the server reachable only from the host PC, start it with `$env:HOST="127.0.0.1"; npm start`.

### Roles and login

Players and the admin use the same login page at http://localhost:3000/.

- **Player accounts** go straight into the game after logging in. They never see the admin panel.
- **The admin account** is sent straight to the admin panel. The server refuses to serve `/admin` to anyone
  else and redirects them to the login page.

### Admin account

On first start the server creates an admin account:

- **Username:** `admin`
- **Password:** `admin123`

Change this before exposing the server anywhere: set `ADMIN_USER` / `ADMIN_PASS` environment variables before the
**first** launch, or delete `data/game.db` and relaunch with them set.

## How to play

1. Create an account (you start with **1,000 coins** and a **Pistol**).
2. Visit the **Armory** to buy weapons and the **Wardrobe** to buy outfits.
3. On the **Play** tab pick a primary weapon and a map, then start **Single Player** (choose a difficulty) or
   **Multiplayer** (choose Free-for-all or Team Deathmatch).
4. Click the game view to lock the mouse.

| Key | Action |
|-----|--------|
| W A S D | Move |
| Mouse | Look |
| Left click | Fire |
| Right click | Aim down sights / scope |
| Shift | Sprint |
| C (toggle) / Ctrl (hold) | Crouch |
| Space | Jump / vault through windows |
| R | Reload |
| 1 / 2 / mouse wheel | Switch weapon |
| G | Throw a frag grenade (2 per life) |
| V | Knife: kills in one hit at arm's length |
| 3 | Call in a UAV (after 3 kills in a row) |
| 4 | Call in an airstrike where you are aiming (after 5 kills in a row) |
| T / Y | Multiplayer chat: everyone / your team only (Enter sends, Esc cancels) |
| Tab | Scoreboard |
| Esc | Pause, settings, release mouse |

**Economy:** 50 coins per kill (+10 for a headshot), in both single-player and multiplayer, for every weapon
including grenades, knife and airstrikes. Coins are awarded by the server, not the client.

### Equipment and killstreaks

- **Frag grenade (G):** bounces off walls and rolls, explodes 2.5 s after the throw. Up to 160 damage near the blast,
  fading to nothing at 7 m. Walls and cover block the blast, and you can hurt yourself. A red icon warns you
  when someone else's grenade is near.
- **Knife (V):** a quick slash that kills any enemy within about 2.3 m in front of you.
- **UAV (3 kills in a row, key 3):** shows every enemy on the radar for 20 seconds. In Team Deathmatch the whole team
  sees them, and the enemy team gets an "Enemy UAV" warning.
- **Airstrike (5 kills in a row, key 4):** a jet drops five bombs in a line through the spot you are aiming at, 2
  seconds after you call it. It cannot hurt you or your teammates.

A reward stays available until you use it, even if you die, but the kill counter resets when you die. Kills made by
the airstrike do not count toward the next reward. Single-player bots use the same weapons: on Medium and Hard they
throw grenades at your last known position, run from grenades, and knife you if you get too close.

### Multiplayer modes

- **Free-for-all:** everyone against everyone, continuous.
- **Team Deathmatch:** players are split evenly into red and blue teams. There is no friendly fire: bullets, knives,
  grenades and airstrikes pass through teammates harmlessly. Teammates have blue names above their heads and
  show on your radar. The first team to 50 kills, or the leading team after 10 minutes, wins the round. After an
  8-second break a new round starts with scores reset.

Every map has its own Free-for-all and Team Deathmatch arena, and the map cards show how many players are in each.

### Leaderboard and settings

- **Leaderboard tab:** all-time rankings by kills, K/D or coins. Admin accounts are not listed.
- **Settings tab** (also in the pause menu, so you can change them mid-match): mouse sensitivity, aim-down-sights
  sensitivity, field of view, volume, graphics quality, and an FPS counter. Settings are saved in the browser, so
  each PC keeps its own. Use **Low** graphics on weaker PCs. It lowers the resolution and turns off shadows.

### Maps

Pick a battlefield on the **Play** tab. The choice applies to both single-player and multiplayer.

| Map | Setting | How it plays |
|---|---|---|
| Ashfall Ruins | Bombed crossroads town at dusk | Broken houses around two long roads, wrecks, two sniper towers |
| Iron Harbor | Overcast container port | Tight lanes between container stacks, two warehouses with racks, gantry cranes |
| Dune Outpost | Bright desert village | Walled compound in the centre, wrecked highway, rock outcrops, long sight lines |
| Frostbite Pass | Snowed-in mountain village | Log cabins, dense pine forests, concrete bunkers, heavy fog and falling snow |

All maps are 120 × 120 m with a walled boundary. Every layout is validated automatically so that each spawn
point is clear and every part of the map can be reached on foot (`node scripts/check-maps.js`).

### Weapons

| Weapon | Cost | Damage | Fire rate | Magazine | Reload | Notes |
|---|---|---|---|---|---|---|
| Pistol | Free | 28 | 5/s semi | 12 | 1.4 s | Fast handling |
| Automatic Rifle | 400 | 24 | 10/s auto | 30 | 2.1 s | Balanced |
| Machine Gun | 600 | 22 | 13/s auto | 75 | 4.2 s | Slow to move and reload |
| Sniper Rifle | 750 | 105 | 0.85/s bolt | 5 | 3.0 s | One-shot kill, inaccurate unscoped |

### Outfits

Classic Ink (free), Shadow Ops, Desert Scout, Arctic Ghost, Neon Strike, Iron Commander. Each has its own colours
and an accessory (visor, headband, scarf and goggles, hood, glowing crest, beret). Your outfit shows on your
first-person arms and to other players.

### Single-player difficulty

| | Normal | Medium | Hard |
|---|---|---|---|
| Bots | 5 | 7 | 9 |
| Reaction time | ~0.9 s | ~0.5 s | ~0.2 s |
| Aim error / tracking | loose, slow | moderate | tight, snaps on |
| Field of view / sight range | 100° / 45 m | 130° / 65 m | 160° / 90 m |
| Uses cover when hurt | rarely | often | almost always |
| Flanks lost targets | never | sometimes | often |
| Strafes in fights | little | often | constantly |
| Hunts by sound | 20 m | 40 m | 70 m |
| Arsenal | pistol, rifle | + machine gun | rifle, MG, sniper |

Matches are free-for-all: first to 30 kills, or the most kills after 8 minutes. Bots fight each other as well as you.

## Testing multiplayer alone

Open a second browser (or an incognito window), create a second account, and join the arena in both. Or run a
wandering dummy opponent:

```powershell
npm run dummy          # joins the arena for 120 seconds
```

Automated checks (server must be running):

```powershell
npm test
```

This validates every map, the accounts, shop and admin APIs, and multiplayer combat. It also runs Team Deathmatch
with four scripted players, covering teams, friendly fire, knife, grenades, chat, UAV, airstrike and leaderboard, and
a full round from win to restart on a temporary second server. Test accounts are created in the database. Delete
`data/` to start fresh.

### Server options

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Port to listen on |
| `HOST` | `0.0.0.0` | `127.0.0.1` = this PC only |
| `ADMIN_USER` / `ADMIN_PASS` | `admin` / `admin123` | Admin account created on first start |
| `JWT_SECRET` | random, saved in `data/` | Session signing key |
| `DATA_DIR` | `./data` | Where the database lives |
| `TDM_SCORE_LIMIT` | `50` | Kills needed to win a Team Deathmatch round |
| `TDM_TIME_LIMIT` | `600` | Round length in seconds |
| `TDM_INTERMISSION` | `8` | Seconds between rounds |

## Project layout

```
server/
  index.js      Express app: auth, shop, and admin REST routes, static files
  realtime.js   Socket.IO: single-player coin sessions and one arena per map and mode (20 Hz snapshots,
                lag-compensated hit detection, teams and rounds, knife, grenades, killstreaks, chat,
                anti-teleport, regen, respawns)
  db.js         SQLite storage (users, sessions, coin log); bcrypt password hashing
  auth.js       JWT in an httpOnly cookie
  catalog.js    Weapon, outfit and difficulty tuning
shared/map.js   Deterministic layouts for all four maps plus ray casting, used by both server and client
public/
  index.html, css/, js/app.js   Login, menus, shops
  js/game/      Three.js engine: world, physics, weapons, stickman rig, bot AI (A* navigation),
                effects, HUD, procedural audio, game modes
  admin.html, js/admin.js       Admin panel
data/           Created at runtime: game.db and the session signing secret
```

## Tech notes

- Rendering uses WebGL via Three.js, served locally from `node_modules` (works offline).
- The game view is locked to a **16:9 stage**, letterboxed to fit any window.
- Passwords are hashed with bcrypt. Sessions are signed JWTs, and the signing secret is generated randomly into
  `data/.jwt-secret` unless `JWT_SECRET` is set.
- Multiplayer is server-authoritative for damage, kills, health, respawns and coins. Clients send movement and
  shot rays, and the server validates weapon ownership, fire rate, shot origin and movement speed.
