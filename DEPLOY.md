# Deployment notes (Vercel / Netlify + game server)

## What goes where

| Piece | Host |
| --- | --- |
| Static files (`public/`, including `/admin`) | Optional CDN: **Vercel** or **Netlify** |
| Node game API + **Socket.io** + **SQLite** | **Always-on** host: Railway, Render, Fly.io, VPS, etc. |

Do **not** run this FPS multiplayer server on Vercel/Netlify serverless functions. They have no durable process for Socket.io and no persistent local disk for `data/game.db`.

## Render (required for keeping members)

Without a **persistent disk**, every deploy / restart **wipes** SQLite → all signups disappear and players cannot log back in.

### One-time setup in Render Dashboard

1. Open your **Web Service** → **Disks** → **Add disk**
2. Mount path: `/var/data` · size: `1 GB` (enough)
3. **Environment** → add:
   - `DATA_DIR` = `/var/data`
   - `NODE_VERSION` = `22`
   - `JWT_SECRET` = long random string (Generate, then leave it forever)
   - `ADMIN_USER` / `ADMIN_PASS` = your staff login
4. **Manual Deploy** → Deploy latest commit
5. Check `https://YOUR-SERVICE.onrender.com/api/health`  
   - `persistentDisk: true` and `users` should grow after each signup

Or use the repo `render.yaml` Blueprint (Starter plan — disks are not available on Free).

Signups are flushed to disk immediately (`PRAGMA synchronous=FULL` + WAL checkpoint).

## Recommended production layout

1. Run `npm start` on a persistent Node host with a mounted volume for `DATA_DIR` (default `./data`).
2. Point players at that host’s URL (HTTP + WebSocket).
3. If you want the admin UI on a CDN later, build/copy `public/` there and set API/WebSocket base URL to the Node host (today the admin assumes same origin).

## Environment

- `PORT`, `HOST`, `ADMIN_USER`, `ADMIN_PASS`, `JWT_SECRET`, `DATA_DIR`
- Payment display numbers: `PAY_FIB_PHONE`, `PAY_NBI_PHONE`, …

## Database

This project uses **SQLite** (`node:sqlite`). Keep it for gameplay stability. If you later need managed SQL (e.g. Supabase Postgres), swap only the DB adapter — keep `server/admin/*` route modules as-is.

## Admin roles

- **super** — full Command Center
- **mod** — players, flags, bans, kick, announce
- **accountant** — dashboard, economy prices, gifts, coin orders
