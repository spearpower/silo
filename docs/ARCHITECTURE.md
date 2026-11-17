# Silo architecture

## 1. Where Silo came from (audit of the original app)

`C:\xampp\htdocs\silo` started as a copy of **PicknPlay**, a real-time multiplayer card game. PicknPlay itself was derived from Rummy10.

| Original piece | What it was | Fate in Silo |
|---|---|---|
| Next.js 15.5 App Router, React 19, TypeScript, Vercel config | app framework | **kept** |
| `postgres.js` direct SQL from API routes (`lib/db.ts`) | data access through one DB role, no RLS policies | **replaced** by supabase-js with per-user RLS |
| Custom auth: username + bcrypt in Postgres, `jose` signed cookie (`lib/session.ts`) | sign-in | **replaced** by Supabase Auth (email, confirmation, reset, refresh) |
| Supabase Realtime *broadcast pings* + polling | "game changed" signal | **reworked**: postgres_changes (RLS-filtered), private broadcast channels, Presence |
| LiveKit voice at a game table (`lib/voice.ts`, `voiceClient.ts`) | server-issued tokens | **kept and extended**: one-to-one and group calls with a real call state machine |
| Web Push with VAPID (`lib/push.ts`, `pushClient.ts`, `sw.js`) | turn alerts | **kept and extended**: message, incoming and missed-call alerts with privacy settings |
| Friends, presence (`friendships`, `last_seen_at`) | social layer | **kept as a concept**, re-modelled on UUID auth identities |
| PWA (manifest, service worker, offline page), error reporting | app shell | **kept**, rebranded |
| Card engine, rules, bots, scores, Hall of Fame, lobbies, card art, sounds | the game | **removed** (see CLEANUP.md) |
| DB tables `users, games, game_players, game_events, card_values, app_settings, game_points, game_messages, game_invites, friendships, push_subscriptions` | game schema | **dropped** from the local `silo` DB (no games existed, Gerald kept his own backup); Silo schema in `supabase/migrations` |

## 2. Shape of the system

```
Browser (React)
  ├─ supabase-js (publishable key + user session)
  │    ├─ reads: profiles, conversations, messages, calls ...   (RLS decides)
  │    ├─ RPCs:  start_direct, create_group, mark_read, friend_request ...  (security-definer, re-check auth.uid())
  │    └─ Realtime: postgres_changes(messages, call_sessions, call_participants)  (RLS-filtered)
  │                 private broadcast "conv:<id>" (typing, read pings)   (realtime.messages policies)
  │                 presence "online"
  ├─ /api/* (Next.js route handlers on Vercel)
  │    ├─ messages:  validate, rate-limit, insert AS THE USER (RLS), then push fan-out
  │    ├─ calls:     start / join / decline / leave / ping  -> DB state machine -> LiveKit token
  │    ├─ push:      save / remove this device's subscription
  │    └─ account delete, admin suspend, daily cron, client-error log
  └─ livekit-client  ──WSS/WebRTC──>  LiveKit Cloud (audio only)

Server-only secrets: Supabase secret key (push fan-out, call sweeper, deletion, bans), LiveKit API secret, VAPID private key.
```

**Why some writes go through `/api` and others are direct.**
- **Through `/api`:** sending messages, all call actions and push subscriptions. These need validation, rate limiting, push alerts or LiveKit tokens. The insert itself still runs with the user's own token (`send_message` is `security invoker`), so RLS stays the gatekeeper.
- **Direct from the browser:** simple, policy-checked writes such as profile edits, settings and mute.
- **RPCs:** multi-step changes such as groups and friends, each running in a single transaction.

## 3. Data model (Supabase PostgreSQL)

All keys are UUIDs tied to `auth.users`, and all times are `timestamptz`.

| Table | Purpose | Key constraints |
|---|---|---|
| `profiles` | one per auth user (trigger `handle_new_user`) | unique `username` `^[a-z0-9_]{3,20}$`; `role` member/admin; `status` active/suspended |
| `user_settings` | privacy and notification choices | `allow_messages_from` friends/everyone; `push_previews` off by default |
| `user_presence` | last seen (separate table so it can have its own privacy policy) | |
| `friendships` | requests and friends | one row per pair (unique index on least/greatest) |
| `user_blocks` | who blocked whom | PK (blocker, blocked) |
| `conversations` | `direct` or `group` | `direct_key` unique per pair; group title 1–60 |
| `conversation_participants` | membership, role, shared delivery/read markers, mute | PK (conversation, user); role owner/admin/member |
| `conversation_reads` | private "read up to" marker for unread counts | own rows only |
| `messages` | text, system and call-log messages | body 1–4000; `(sender, client_id)` unique for retry-safe sends; index (conversation, created_at desc) |
| `call_sessions` | one row per call; `media` audio (video reserved) | at most one live call per conversation (partial unique index) |
| `call_participants` | invited / joined / left / declined / missed, keep-alive ping | PK (call, user) |
| `push_subscriptions` | Web Push endpoints per device | unique endpoint |
| `user_reports` | reports for admins | status open/actioned/dismissed |
| `rate_limits` | fixed-window counters | server only (RLS on, no policies) |

**Groups are conversations of kind `group`.** One message pipeline serves both kinds of chat.

**Delivery and read receipts are watermarks, not per-message rows.**
- `last_delivered_at` is set by the app heartbeat.
- `receipt_read_at` is set by `mark_read`, and stays null when the person has turned receipts off.
- This scales with members rather than with messages.

## 4. Row Level Security

**Grants.** All tables have RLS enabled. Supabase grants `anon` and `authenticated` full privileges by default; migration 3 revokes those and grants back only:
- `SELECT` on readable tables
- column-scoped `UPDATE`/`INSERT`:
  - `profiles`: name, username, picture and bio only
  - `messages`: conversation, sender, body and client id; never `kind` or `created_at`
- `EXECUTE` on the listed RPCs

`anon` can only call `username_available`.

**Policies:**

| Table | Read | Write |
|---|---|---|
| profiles | any signed-in user (names stay readable in chats) | own row, chosen columns only, active accounts |
| user_presence | self, or friends / people you share a chat with, and only if they show last seen and nobody blocked anybody | via `heartbeat()` |
| user_settings | own | own (column list) |
| friendships, user_blocks | own | RPCs only |
| conversations, participants | members | RPCs only; own `muted_until` |
| conversation_reads | own | `mark_read()` |
| messages | members, only messages since they joined | `sender_id = auth.uid()`, kind text, `can_post()` (member, active, not blocked) |
| call_sessions, call_participants | members of the conversation | RPCs only |
| push_subscriptions | own | own insert/delete |
| user_reports | reporter or admin | `report_user()`; admins via `admin_resolve_report()` |
| realtime.messages (channels) | `online`: active users; `conv:<id>`: members | same |
| storage.objects | public-read buckets | `avatars/<own uid>/...`; `group-photos/<conv>/...` for group owners and admins |

**Blocks.** People who blocked you never appear in `search_people`. `can_post` stops messages and calls in both directions.

**Tests.** `supabase/tests/rls_test.sql` exercises all of the above (90 checks) as alice, bob, carol, dave and anon.

## 5. Messaging flow

1. The composer creates a `client_id` and shows the message straight away as *pending*.
2. `POST /api/messages` does three things:
   - validates the input
   - checks the rate limit (`rate_limit('send', 30, 10s)`)
   - calls `send_message`, running as the user under RLS
   It returns the stored row. A retry with the same `client_id` returns the original row, never a duplicate.
3. Every member's browser receives the `INSERT` through `postgres_changes`, which Realtime filters per subscriber through the `messages` SELECT policy.
4. The client store deduplicates by `id` and `client_id`.
5. Opening a chat calls `mark_read` and broadcasts a `read` ping on `conv:<id>`, and other members refresh the ticks. Typing works the same way, with throttled broadcasts.
6. **Recovery.** After a dropped Realtime connection, coming back to the foreground or the `online` event, the store re-fetches the chat list and every open thread (`resync`). History pages 40 messages at a time.
7. Push goes to members who are not muted and were not seen in the app in the last 30 s. Without previews, the alert says only who wrote.

## 6. Voice calls (LiveKit)

**States.**
- `call_sessions.status`: `ringing → active → ended`, or `missed`, `declined` or `cancelled`.
- `call_participants.state`: `invited`, `joined`, `left`, `declined` or `missed`.

**Flow.**
1. **Start** (`POST /api/calls`): `start_call` checks membership and blocks, then creates the session (`room_name = silo-call-<uuid>`) and invites the other members. The caller is joined.
   - The server then calls `call_access`, which returns a room only to a *joined* participant of a *live* call in a conversation they belong to. Only then does it mint a LiveKit token:
     - valid for 10 minutes
     - identity = user id
     - limited to that room
     - microphone only, no data channel, no admin
   - Room names are never treated as credentials.
2. **Ringing.** Callees learn about the call through Realtime (an `INSERT` into `call_participants` for them) and a high-urgency push with a 45 s TTL. They answer with `join_call` or decline with `decline_call`. In a group, members can join a running call from the banner in the chat.
3. **Keep-alive.** Every device in a call pings every 20 s. The ping route runs `expire_calls`:
   - no answer after 45 s → **missed**, and a missed-call alert is sent
   - a device silent for 60 s → **left**
   - nobody left in the call → **ended** or **cancelled**

   A daily cron catches anything left over, so nothing depends on in-memory timers or webhooks.
4. **End.** A one-to-one call ends when either person hangs up. A group call ends when the last person leaves. Every call leaves a log line in the chat ("Voice call · 3:12", "Missed voice call").
5. **Client.** One LiveKit room per device (`lib/client/calls.ts`) that survives page changes. It handles:
   - mute
   - active-speaker rings
   - reconnecting state
   - microphone permission errors explained in plain language
   - autoplay unlock on tap
6. **Video later:**
   - add `TrackSource.CAMERA` to the grant when `media = 'video'`
   - add a camera toggle in the call screen
   - allow `camera=(self)` in `Permissions-Policy`

   The tables, state machine and token endpoint stay as they are.

## 7. Push notifications

- Device subscriptions are saved by `POST /api/push`. The server, not the browser, takes over an endpoint that a previous account used on the same device.
- Sending (`lib/push.ts`) uses the service role, but only after a user action authorised by RLS (send message, start call).
- Dead endpoints (404/410) are deleted.
- The service worker skips message alerts while a Silo window is focused, because the app shows its own toast and sound.
- Call alerts use `requireInteraction` and a vibration pattern.

## 8. Security checklist (where each item lives)

| Requirement | Implementation |
|---|---|
| Authentication, sessions, refresh | Supabase Auth plus `@supabase/ssr`. The middleware refreshes cookies (`getClaims`), and API routes verify with `getUser()` |
| Server-side authorisation | RLS on every table, security-definer RPCs that re-check `auth.uid()`, membership checks before tokens |
| Short-lived call tokens | 10-minute LiveKit JWTs, minted only after `call_access` |
| Rate limiting | Postgres `rate_limit()`: send 30/10 s, start call 12/10 min, groups 10/h, reports 10/h, push subscribe 10/h, test push 5/10 min |
| Input validation | client and server (`lib/validate.ts`), plus DB check constraints |
| SQL injection | no string-built SQL. supabase-js parameterises everything; RPCs use typed parameters |
| XSS | React escapes all message text (no `dangerouslySetInnerHTML` on user content), plus a strict CSP |
| CSRF | write routes require a same-site `Origin` and a JSON body. Auth cookies are SameSite=Lax |
| CORS | none configured: API routes are same-origin only |
| Error leakage | only our own `P0001` messages reach people. Everything else becomes a generic error, with details in the server log |
| Secrets | server-only env vars. `server-only` import guards on admin/LiveKit/push modules. Nothing secret starts with `NEXT_PUBLIC_` |
| Headers | CSP, HSTS, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy (microphone self only) |
