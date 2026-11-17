# Silo

**A private social space for people who know each other.**

Silo is a private communication app for close friends. It covers:
- one-to-one messages
- private groups
- one-to-one voice calls
- group voice calls
- push notifications

It is built as a production-oriented MVP on **Next.js (React) + Supabase + LiveKit** and deploys on **Vercel**.

| Area | What's in the MVP |
|---|---|
| Accounts | Sign up and sign in with email and password (Supabase Auth), email confirmation, password reset, change password, delete account |
| Profiles | Display name, unique @username, photo (Supabase Storage), "about" line |
| People | Search by username or name, friend requests, block, report |
| Presence | Online dot (Realtime Presence), last seen; both can be hidden |
| Direct messages | Real-time, persistent history with paging, typing indicator, delivered and read ticks, unread counts, retry-safe sending |
| Groups | Private groups of friends with owner, admin and member roles. Add, remove, rename, picture, leave (ownership hands over) |
| Voice calls | One-to-one and group audio through LiveKit. Ringing, answer, decline, mute, call timer, who's speaking, reconnecting, missed calls |
| Notifications | Web Push for new messages, incoming and missed calls. Message text is hidden by default |
| Safety | Row Level Security on every table, server-checked call tokens, rate limits, admin report queue with suspensions |

Video calling is **not** part of this release. Call records already carry a `media` field (`audio` now, `video` reserved), so video can be added later without changing the call architecture.

## Security model (accurate summary)

- Only the members of a conversation can read it. PostgreSQL Row Level Security enforces this, not only the UI.
- Traffic is encrypted in transit (TLS/WSS). Supabase encrypts stored data at rest.
- **Silo is not end-to-end encrypted.** Messages are stored on the server so they can sync across devices.
- See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and the in-app `/privacy` page.

## Quick start (local)

Requirements: Node 20+, a Supabase project (free tier is fine) and a LiveKit Cloud project (free tier is fine).

```bash
npm install
cp .env.example .env.local     # fill in your Supabase / LiveKit / VAPID values
npm run dev                    # http://localhost:3030
```

Before the first run, apply the database migrations to your Supabase project. The full step-by-step guide is in [DEPLOYMENT.md](DEPLOYMENT.md).

Until Supabase is configured, every page shows a **Setup** screen instead of failing.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server on port 3030 |
| `npm run build` / `npm start` | Production build / serve it on port 3030 |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | TypeScript check |

The database and RLS tests run with `psql` against a local PostgreSQL database. See [docs/TESTING.md](docs/TESTING.md).

## Project layout

```
app/                    Next.js App Router
  (auth)/               sign in, sign up, forgot / reset password
  (app)/                the signed-in app: chats, groups, contacts, settings, admin, chat screens
  api/                  server routes: messages, calls, push, account, admin, cron, client errors
  auth/                 email-link landing (/auth/confirm) and sign-out
components/             UI components (shell, chat list, call screens, sheets, icons)
lib/
  supabase/             browser, per-request server, service-role admin and middleware clients
  client/               browser state: chat store (Realtime), calls (LiveKit), push, sounds
  api.ts calls.ts livekit.ts push.ts notify.ts validate.ts format.ts receipts.ts
  database.types.ts     types for supabase-js (regenerate with the Supabase CLI)
supabase/
  migrations/           schema, functions/RPCs, RLS, Realtime + Storage (apply in order)
  tests/rls_test.sql    authorisation tests run as different users
  local/                local-only Supabase shim for running those tests on plain PostgreSQL
tests/unit/             Vitest unit tests
public/                 icons, manifest, service worker, offline page
tools/gen_icon.js       generates the app icon SVG
docs/                   architecture, testing, cleanup record
```

## Documentation

- [DEPLOYMENT.md](DEPLOYMENT.md): Supabase, LiveKit, Web Push and Vercel setup, plus environment variables
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how it works, the data model, RLS policies, call and notification flows, and the original app audit
- [docs/TESTING.md](docs/TESTING.md): automated tests, results, and the manual checklist for what needs real services
- [docs/CLEANUP.md](docs/CLEANUP.md): what was removed from the original codebase and why
