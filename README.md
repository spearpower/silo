# PicknPlay

**PicknPlay** is a real-time multiplayer shedding card game for 2 to 6 players. Match the top card of the
discard pile by **suit or rank**, attack with draw penalties, change the play with 8s, Jacks and Aces,
and win by **emptying your hand**, or end the game with a **cut** while your hand is low.

It runs in any browser and installs to the home screen as a PWA. Games can be played with friends
(private tables with a PIN, invite links, Quick Game) or against **Virtual Friends** (computer players).

The game rules are specified in **[rules/rules.MD](rules/rules.MD)**, the authoritative rule document.

## Game variants

| | PicknPlay Classic | PicknPlay Super |
|---|---|---|
| Deck | 52 cards, no Jokers | 54 cards (two Jokers) |
| Cards dealt | 7 each | 7 each |
| Penalty cards | 2 (draw 2) | 2 (draw 2), 3 (draw 3), Joker (draw 5) |
| Stacking | each 2 adds 2 | each matching card adds its amount |
| Cancel ("cool-off") | any Ace cancels a 2 | any Ace cancels a 2; only the **Black Spade Ace** cancels a 3 or Joker |
| 8 | 2 players: play again · 3+: next player skipped | same |
| Jack | 2 players: play again · 3+: direction reverses | same |
| Ace | on anything but a 2; names the suit to follow | same |
| Cutting | the 7 of the cutter card's suit; lowest hand wins | same, and the cutter's hand must be below 60 |
| A♠ value | 15 | 60 |

Card points at a cut: 2 = 20, Ace = 15 (A♠ = 60 in Super), J = 11, Q = 12, K = 13, 3 to 10 face value.

### Rule decisions (rules.MD §5 "Items to agree before play")

rules.MD leaves some points open. They are implemented as **admin-configurable rule options**
(Admin → Game rules, stored in `app_settings.rules`). Every game keeps a snapshot of the options it
started with, so changing them never affects a game in progress. Defaults:

| Open point | Default | Alternative |
|---|---|---|
| Super cut threshold ("below 60") | the player cutting must hold **< 60 points after playing the 7** | no limit |
| Penalty response | stack a matching penalty card, cancel with an allowed Ace, or **draw the full amount; the turn ends** | draw, then play on |
| Empty draw pile | **reshuffle the discard pile**, keeping its top card | end the game and count hands |
| Opening discard | top card of the draw pile; **special cards are re-buried** | any card (a special opening card has no effect) |
| Tie for lowest at a cut | **tied players share the win** | the cutter wins the tie |
| Joker points (not in rules.MD) | **50** | 0 / 20 / 60 |
| What a Joker may be played on (not in rules.MD) | **any card**; it keeps the suit being followed | only on a Joker |

Other implementation choices (documented, not configurable):
- The cutter card is turned up after dealing and placed **face up at the bottom of the draw pile**
  (rules.MD §2.1.5); its suit stays shown on the table all game, even after it has been drawn.
- The first player is chosen at random; play starts clockwise (seat order).
- After drawing a card that fits, the player may play **that card** or keep it (pass). An unplayable
  drawn card ends the turn.
- An Ace may be played on a 2 only to cancel a pending 2 penalty. A cancelling Ace also names a suit.
- Going out with any card (even a 2 or a cut 7) wins outright.
- If nobody can play or draw for a whole round (all cards in hands), hands are counted ("blocked").
- Playing the cut 7 is optional: the player chooses **Cut** or **Just play it**.

## Technology stack

- **Next.js 15** (App Router) + **React 19** + TypeScript: pages, API routes and the game engine in one app
- **PostgreSQL** via `postgres` (postgres.js), using the existing `picknplay` database
- **jose** for the signed session cookie; passwords are bcrypt-hashed in Postgres (`pgcrypto`)
- Optional: **Supabase Realtime** (instant updates; otherwise polling), **LiveKit** (voice chat),
  **Web Push** (turn alerts)
- **Vitest** for the engine tests

## Architecture

```
Browser (PWA) ──HTTPS──► Next.js: pages + /api routes
                                │  lib/games.ts  (transactions, SELECT … FOR UPDATE)
                                │  lib/engine.ts (pure rules engine)  lib/bot.ts (Virtual Friends)
                                ▼
                           PostgreSQL (games.state = authoritative game state)
        ▲                                │
        └──── "game changed" ping (Supabase Realtime, optional; else 1.5 s polling)
```

| Path | What |
|---|---|
| `lib/card-codes.ts` | card codes (`AS`, `10H`, `XR`…), deck per variant, point values (browser-safe) |
| `lib/rules.ts` | variants, rule options + defaults, matching/penalty logic shared by server, bots and UI |
| `lib/engine.ts` | the game engine: deal, cutter, turns, effects, penalties, drawing, cutting, scoring, per-player views |
| `lib/bot.ts` | Virtual Friends (easy / normal / smart) |
| `lib/games.ts` | game service: lobby, start, moves, timers, leave/kick/end, persistence, turn history |
| `app/game/[id]/page.tsx` | the playing table |
| `app/api/games/[id]/move` | the only way to change a game; validates input, then the engine validates the move |
| `db/schema_final.sql` | base schema (users, games, game_players, game_events, card_values) |
| `db/migrations/` | additive migrations on top of the base schema |

### Server authority and privacy

- Every move is `POST /api/games/:id/move` → one transaction → `SELECT … FOR UPDATE` on the game row →
  `lib/engine.ts` checks it is your turn, the card is in **your** hand and it is legal → save → bump `version`.
  Concurrent moves are serialized by the row lock and can't corrupt the state.
- `GET /api/games/:id` returns **only that player's view**: their own hand, other players' card **counts**,
  the visible piles. The draw pile and other hands never leave the server. Admins can *watch* a table but
  never see hands. Hands are revealed to everyone only after the game ends.
- Writes require a same-origin request (CSRF check) and a signed-in, active account; moves and sign-in are rate-limited.

## PostgreSQL configuration

The app uses one connection, `DATABASE_URL`, from `.env.local` (locally) or the host's environment
variables. Nothing is hard-coded. Local default: `postgres://postgres@localhost:5432/picknplay`.

Tables: `users`, `games`, `game_players`, `game_events` (turn history), `card_values` (reference) from the
base schema, plus `app_settings`, `game_points`, `game_messages`, `friendships`, `game_invites`,
`push_subscriptions` from migration 001. `games.state` (jsonb) holds the authoritative state; the readable
columns (`top_card_*`, `current_suit`, `cutter_*`, `deck_remaining`, `discard_pile`, `direction`,
`game_players.hand_cards`, `card_count`, `points`, `final_rank`, `has_cut_card`) are mirrored from it in the
same transaction for reporting.

## Installation

```bash
npm install
copy .env.example .env.local     # set DATABASE_URL and SESSION_SECRET
```

`SESSION_SECRET`: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## Database setup and migrations

1. Create the database and run the base schema `db/schema_final.sql` (pgAdmin → Query Tool, or psql).
2. Run every file in `db/migrations/` in order (each is additive and safe to run more than once):
   ```bash
   psql -U postgres -d picknplay -f db/migrations/001_picknplay_core.sql
   ```
3. Optional, **local only**: sample accounts from a git-ignored seed file (`db/seed_sample_users.sql`).
   Never run test accounts with weak passwords on a public server.

| Migration | Adds |
|---|---|
| `001_picknplay_core.sql` | variants, PIN, timer, `games.state`, play-again link, early endings; `app_settings` (switches + rule options); leaderboard points; table chat; friends & invites; push subscriptions; 6 Virtual Friends; row-level security lock-down |

## Running the application

```bash
npm run dev        # http://localhost:3010 (development)
npm run build && npm start   # production build on :3010
```

## Running tests

```bash
npm test           # engine tests: both variants, every special card, penalties, cutting, scoring, privacy, bots
npm run typecheck
```

## Multiplayer

- **Create** a table (Host): choose Classic or Super, optional 4-digit PIN, turn timer.
- **Join** by game number / invite link / WhatsApp share (+ PIN for private tables), Quick Game, or a friend's invite.
- **Waiting room**: players and avatars, add Virtual Friends, the host starts the game.
- **Sync**: after each move the server broadcasts a version ping (Supabase Realtime) and every device
  re-fetches its own view; without Realtime, devices poll every 1.5 s. Table events (plays, draws,
  penalties, skips, reversals, cuts) are animated from the shared event list.
- **Disconnects**: the game lives on the server; reopening the app (Continue) restores your hand and turn.
  With a turn timer, an expired turn draws for the player and passes; 3 missed turns in a row remove them.
  The host can remove players or end a game, with a reason.
- **Results**: winner(s), how the game ended, every hand revealed with its points, leaderboard points.

## Sounds, alerts and voice

- **Sounds** (Web Audio): deal, play, draw, penalty (heavier when it hits you), cancel, suit call, skip, reverse, reshuffle, cut,
  last-card warning, win / lose, a tick in your last 5 seconds, and a soft “bonk” for a card that doesn't fit. On/off + volume per device.
- **Alerts**: Web Push (your turn, including a waiting draw penalty, game start, game over, invites, friend requests), an in-app
  “It’s your turn” banner on every other page, the app-icon badge, and the tab title while the table is in the background.
- **Voice chat**: LiveKit; one connection from the waiting room to the table, who’s-in list, mute, speaking rings on seats.

## Deployment

See **[DEPLOYMENT.md](DEPLOYMENT.md)** (Vercel + hosted PostgreSQL/Supabase, environment variables, checks).

## Credits

- Playing-card faces: **English pattern playing cards** from Wikimedia Commons
  ("English pattern &lt;rank&gt; of &lt;suit&gt;.svg"), released under **CC0 / public domain**.
  Re-download with `node tools/fetch_cards.js`.
- Jokers, card back, app icon, avatars and sounds: original artwork generated by the scripts in `tools/`.
