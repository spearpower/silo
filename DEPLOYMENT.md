# PicknPlay — setup and deployment guide

PicknPlay is a Next.js 15 app: pages, API routes and the game engine run together (on your machine, a
Node server, or **Vercel**). All data lives in **PostgreSQL**. Live updates use **Supabase Realtime**
when configured; without it the app falls back to polling, so plain PostgreSQL works everywhere.

```
Phone / browser ──HTTPS──► Next.js (pages + /api routes + game engine)
        ▲                          │ SQL (DATABASE_URL)
        │ "game changed" ping      ▼
        └──── Supabase Realtime ◄── PostgreSQL
```

---

## 1. Local (do this first)

1. PostgreSQL database `picknplay` with the base schema `db/schema_final.sql`.
2. Run the migrations in `db/migrations/` in order (pgAdmin → Query Tool → open file → Execute, or psql).
3. `.env.local`:
   ```
   DATABASE_URL=postgres://postgres@localhost:5432/picknplay
   SESSION_SECRET=<64 random hex chars>
   ```
4. `npm install`, then `npm run dev` → http://localhost:3010
5. Optional: `db/seed_sample_users.sql` (git-ignored, local only) creates test accounts.

## 2. Hosted database

Any PostgreSQL 14+ works. With **Supabase**:
1. Create a project near your players; save the database password.
2. SQL Editor: run `db/schema_final.sql`, then each migration in `db/migrations/`.
3. **Connect → Transaction pooler** (port 6543) URI → this is the production `DATABASE_URL`.
4. Project Settings → API Keys: Project URL, anon/publishable key, service_role/secret key (for Realtime).

Every table has row-level security on with no policies: browser keys can't read anything. Only the
server (through `DATABASE_URL`) reads or writes data. Keep the service_role key server-side only.

**Create your first admin** on the hosted database (choose a strong password):
```sql
insert into users (username, password_hash, fullname, role)
values ('gero', app_hash_password('<strong password>'), 'Gerald', 'superadmin');
```

## 3. Vercel

1. Import the GitHub repo `spearpower/PicknPlay` (framework: Next.js).
2. Environment Variables (Production and Preview):

| Name | Value | Needed |
|---|---|---|
| `DATABASE_URL` | transaction pooler URI | yes |
| `SESSION_SECRET` | 64 random hex chars (not your local one) | yes |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Project URL, service_role key | for instant updates |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Project URL, anon key | for instant updates |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | `npx web-push generate-vapid-keys` | phone alerts |
| `CRON_SECRET` | random string | daily clean-up job |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | LiveKit Cloud project | voice chat (admin switch) |

Use **new** keys for PicknPlay — don't reuse another app's Supabase / LiveKit / VAPID keys.

3. Deploy. `vercel.json` pins functions to `lhr1` (London); change `regions` to the Vercel region nearest
   your database. It also schedules `/api/cron/daily` at 03:00 UTC.

## 4. Other hosts (VPS / Node)

`npm ci && npm run build && npm start` (port 3010; put it behind a TLS reverse proxy such as nginx or Caddy).
Set the same environment variables. The PWA (install, offline page, push) requires HTTPS.

## 5. Checks after deploying

- [ ] Sign in; Admin → Game rules shows the defaults.
- [ ] Host a **Classic** table on one phone, join from a second phone with the invite link / PIN.
- [ ] Moves appear on the other phone within a second (Realtime) or ~1.5 s (polling).
- [ ] Play a 2 (the next player must draw 2 or answer), an Ace (suit picker), an 8 and a Jack.
- [ ] Cut with the 7 of the cutter suit: results show every hand and the lowest wins.
- [ ] Host a **Super** table: Jokers and 3s penalise; only A♠ cancels them; a cut needs < 60 points.
- [ ] Close the app mid-game, reopen → Continue → same hand and turn.
- [ ] Practice game with Virtual Friends finishes on its own.

## 6. Migrations

Database changes live in `db/migrations/`, numbered, additive and safe to re-run.
**Run a migration on the hosted database before deploying the code that needs it.**

| File | Adds |
|---|---|
| `001_picknplay_core.sql` | variants, PIN, timer, `games.state`, play-again, early endings, `app_settings` (+ rule options), `game_points`, `game_messages`, friendships, invites, push subscriptions, Virtual Friends, RLS lock-down |

## 7. How a move works (for developers)

1. The client sends `POST /api/games/:id/move` with `{ type: 'play', card, suit?, cut? }`, `{ type: 'draw' }`,
   `{ type: 'pass' }` or `{ type: 'timeout' }`. The route checks the shape (card code format, suit).
2. The server opens a transaction, locks the game row (`SELECT … FOR UPDATE`) and applies `lib/engine.ts`,
   which checks turn, ownership and legality against the variant and the game's rule snapshot.
3. It saves `games.state`, mirrors the readable columns and hands, appends `game_events` (turn history),
   sets the turn deadline and — at the end — final places and leaderboard points.
4. It pings `game-<id>`; every client re-fetches `GET /api/games/:id`, which returns only that player's view.

**Turn timer:** the deadline is stored in `games.turn_deadline`. A device reports `timeout` at zero; the
server checks the clock before drawing for that player. If nobody reports it, the next read applies it.
No always-on server process is needed.

## 8. Sounds, phone alerts and voice chat

**Sounds** need no setup. They are original WAV files in `public/sounds/` (re-make them with
`python tools/gen_pnp_sounds.py`). Each player can switch them off or set the volume (Account → Sound, or 🔔 on the table).

**Phone alerts (Web Push)** — "your turn" (also "Draw 4 is waiting for you"), "game started", "game over — who won",
friend requests and table invites. They are only sent to players who aren't looking at the table.
1. Use PicknPlay's own VAPID keys (already generated in your local `.env.local`): copy
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (set it to `mailto:<your email>`) to Vercel. Redeploy.
2. On a phone: Account → **Turn alerts on this phone** → allow → **Send a Test Alert**.
   iPhone needs iOS 16.4+ and PicknPlay added to the Home Screen first.
3. Keep the same VAPID keys forever: changing them silently stops alerts on every phone until people switch alerts on again.

**Voice chat (LiveKit Cloud)**
1. At cloud.livekit.io create a project → **Settings → Keys** → create an API key. Copy the **WebSocket URL**
   (`wss://<project>.livekit.cloud`), the **API key** and the **secret**.
2. Vercel → Environment Variables: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`. Redeploy.
3. Sign in as an admin → Admin → switch **Voice chat at tables** on (it stays greyed out until the 3 settings exist).
4. At a table (or in the waiting room) tap 🎙, allow the microphone. The connection stays up from the waiting room to the
   table; tap "Voice · N" to see who's in, 🎙/🔇 to mute, ✕ to leave. Seats show 🎧 (in voice), 🔇 (muted) and a blue ring while talking.
Only seated players get a voice pass (3 hours, one table's room, microphone only — no camera, no data).
