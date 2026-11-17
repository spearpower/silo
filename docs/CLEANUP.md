# Cleanup record (2026-11-17)

Silo started as a copy of the PicknPlay card game. Every removed file is still in git history: commits up to `260978e`, before the Silo commit. Nothing was removed without first checking that Silo no longer references it.

## Removed from the repository

| Removed | Why |
|---|---|
| `lib/engine.ts`, `engine.test.ts`, `rules.ts`, `cards.ts`, `card-codes.ts`, `bot.ts`, `levels.ts`, `fame.ts`, `stats.ts`, `games.ts`, `chat.ts` (table chat), `settings.ts` (game admin switches), `admin.ts` | card-game logic, bots, scores and game administration; none of it applies to messaging |
| `lib/db.ts` (postgres.js client) | replaced by supabase-js, so data access runs under each user's RLS |
| `lib/session.ts` (jose cookie), `lib/users.ts` (bcrypt username auth), `lib/http.ts` | replaced by Supabase Auth, `lib/supabase/*` and `lib/api.ts` |
| `lib/realtime.ts`, `lib/client.ts` (broadcast pings plus polling for games) | replaced by `lib/client/store.ts` (postgres_changes, private channels, presence) |
| `lib/voice.ts`, `lib/voiceClient.ts` | rewritten as `lib/livekit.ts`, `lib/calls.ts` and `lib/client/calls.ts` (one-to-one and group calls with a state machine) |
| `lib/push.ts`, `lib/pushClient.ts`, `lib/report.ts`, `lib/sound.ts`, `lib/avatars.ts` | rewritten as `lib/push.ts`, `lib/client/push.ts`, `lib/client/report.ts` and `lib/client/sound.ts` (synthesised ring tones, no audio files); the avatar pool was replaced by photo upload and initials |
| `app/{continue,friends,game,host,how-to-play,join,lobby,new-password,practice,scores,account}` and the old `admin`, `signin`, `signup`, `privacy`, `page.tsx` | game screens, or screens rewritten for Silo |
| `app/api/{games,history,invites,scores,settings,stats,friends,auth,account/*}` and the old `admin`, `push`, `cron` routes | game APIs or the old auth; Silo's routes replace them |
| `components/*` (18 files: board, table chat, voice chat, how-to-play, pins, celebrations…) | game UI |
| `public/cards/` (55 SVGs), `public/sounds/` (18 WAVs), `public/avatars/` (35 images), old `public/icons/` | card art, game sounds, avatar pool and PicknPlay branding |
| `public/sw.js`, `manifest.webmanifest`, `offline.html` | rewritten with Silo branding and behaviour |
| `tools/fetch_cards.js`, `gen_cards.js`, `gen_avatars.js`, `gen_ding.py`, `gen_sounds.py`, `gen_pnp_sounds.py`, old `gen_icon.js`, `__pycache__/` | generators for removed assets; replaced by a new `tools/gen_icon.js` for the Silo icon |
| `db/schema_final.sql`, `db/migrations/001_picknplay_core.sql` | PicknPlay schema, superseded by `supabase/migrations/` |
| `rules/rules.MD` | PicknPlay game rules (already emptied by Gerald before the refactor) |
| `tsconfig.tsbuildinfo`, `.next/` | generated build output (git-ignored, recreated on build) |

## Dependencies

| Change | Why |
|---|---|
| removed `postgres` | no direct database connections any more (serverless-friendly, RLS everywhere) |
| removed `jose` | sessions come from Supabase Auth |
| added `@supabase/ssr` 0.12.7 | Supabase Auth cookies for Next.js (middleware, route handlers) |
| added `server-only` 0.0.1 | build-time guard so secret-holding modules can never reach the browser bundle |
| kept `@supabase/supabase-js`, `livekit-client`, `livekit-server-sdk`, `web-push`, `next`, `react`, `vitest`, `typescript` | still used |

## Local database (`silo` on localhost)

These were dropped with Gerald's approval. He keeps his own backup. The database held 0 games and 3 local test users (gero, Glosh, jane) plus 6 bots:
- the tables `users`, `games`, `game_players`, `game_events`, `card_values`, `app_settings`, `game_points`, `game_messages`, `game_invites`, `friendships`, `push_subscriptions`
- the functions `app_check_password`, `app_hash_password`, `app_touch_updated_at`
- the `pgcrypto` extension

The local database now holds the Supabase shim plus the Silo migrations, and is used for the RLS tests.

## Kept on disk but not in git (local only, git-ignored)

These are local files from Gerald's earlier projects, and their credentials belong to older projects. They were left untouched:
- `db/connect.txt`
- `db/live_kit_keys.txt`
- `db/seed_sample_users.sql`
- `rules/PicknPlay_Refactoring_Prompt.md`
- `.env.local.picknplay-old`: PicknPlay's `.env.local`, renamed so the old keys can't leak into Silo builds

## Git remotes

- `origin` now points to `https://github.com/spearpower/silo.git`.
- The old PicknPlay origin was kept as `picknplay-upstream`, fetch-only. Its push URL is disabled, so Silo can never be pushed to PicknPlay.
- `rummy10-upstream` stays fetch-only, as before.
- No branches were deleted, and no history was rewritten.
