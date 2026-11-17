# Testing Silo

## Automated tests

### 1. Unit tests (Vitest)

```bash
npm test
```

There are 26 tests:
- input validation and redirect safety
- notification wording, including that previews stay hidden by default
- read and delivery receipts, including the mixed timestamp formats
- date and duration formatting
- the CSRF guard
- database error mapping (no internal details leak)
- LiveKit token grants: 10 minutes, one room, microphone only, no data or admin rights, still audio-only when `video` is requested

### 2. Database and RLS tests (PostgreSQL)

These run the real migrations on a **local** PostgreSQL. A small shim emulates the parts of Supabase the policies use: `auth.uid()` from JWT claims, the `anon` / `authenticated` / `service_role` roles, `realtime.messages` and `storage.objects`.

```bash
createdb silo_test                                   # or reuse a scratch database
psql -d silo_test -v ON_ERROR_STOP=1 -f supabase/local/supabase_shim.sql
for f in supabase/migrations/*.sql; do psql -d silo_test -v ON_ERROR_STOP=1 -1 -f "$f"; done
psql -d silo_test -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql
```

The suite has **90 checks**. They run inside one transaction that is rolled back at the end, so no test data is left behind. A clean run ends with `ALL RLS TESTS PASSED`.

The tests act as alice, bob, carol, dave and an anonymous visitor, and prove that:
- anonymous visitors can't read profiles or messages, or call RPCs (only the username check)
- non-members can't read, list or join a conversation, see its members or read markers, post into it, or add themselves to it
- nobody can post as someone else, post system messages, backdate, edit or delete messages, or write friendships directly
- "friends only" chat privacy holds, last-seen privacy holds, and a hidden last seen is hidden even from friends
- groups only ever contain friends; plain members can't add, remove, rename or promote; only the owner changes roles
- a new member doesn't see older messages, a removed member loses access, and ownership passes on when the owner leaves
- calls: non-members can't see or join a call or get a token, and a callee gets a token only after answering
- calls: ended calls give no token, and the no-answer, declined and missed states work and are logged in the chat
- blocking stops messages and calls both ways, removes the person from search and ends the friendship
- reports can't point at someone else's chat, reported people can't read reports, only admins can suspend, and suspended accounts can't post
- one user can't create, read or delete another user's push subscriptions, and the rate-limit table is server-only
- private Realtime channels admit only members, and a garbage topic is refused
- users can't write into another user's avatar folder, and non-admins can't change a group's picture

### 3. Build and types

```bash
npm run typecheck
npm run build
```

## Results on 2026-11-17

| Check | Result |
|---|---|
| `npm test` | 26/26 passed |
| RLS suite on local PostgreSQL 17 | 90/90 checks passed (`ALL RLS TESTS PASSED`) |
| `tsc --noEmit` | clean |
| `next build` (production) | passed: 24 routes plus middleware |
| Visual check (headless Chrome, 390 px and 1366 px, light and dark) | sign-in, sign-up and privacy screens render with no console errors; signed-out visitors are sent to `/signin?next=…` |

## Not yet verified: needs the real Supabase and LiveKit projects

The Silo Supabase and LiveKit projects didn't exist yet, so these were **not** run end to end. They are not presented as working until someone tests them:
- the real sign-up and sign-in flow
- Realtime message delivery between two browsers
- calls with real audio
- push delivery to a real phone

Run this checklist after deploying, with **two accounts on two devices** (or two browsers, one of them in a private window):

| # | Scenario | Expected result |
|---|---|---|
| 1 | Sign up A and B (confirm the emails) | Both reach the Chats screen; usernames are unique |
| 2 | Close and reopen the browser; leave a tab idle for over an hour | Still signed in (refresh works) |
| 3 | A searches for B → Add; B accepts in Contacts; A → Message | Chat opens on both sides |
| 4 | A sends a message; reload both | B gets it instantly (no refresh); it's still there after reloading; ticks go from sent to delivered to read |
| 5 | B types | A sees "typing…" |
| 6 | A calls B; B answers | Both hear each other; the timer runs; mute works both ways |
| 7 | Either side hangs up | The call ends for both; "Voice call · m:ss" appears in the chat |
| 8 | A calls and B ignores it (45 s), or B declines | A sees "No answer" or "Call declined"; B gets a missed-call alert |
| 9 | A creates a group with B and C (friends); renames it; removes C | Members update; C loses the chat |
| 10 | Group messages | Everyone gets them live, with unread badges |
| 11 | A starts a group call; B joins from the banner | Participant tiles, speaking rings, mute icons |
| 12 | Deny the microphone in the browser, then call | A clear explanation; no stuck call |
| 13 | Settings → Notifications on (Android Chrome, or an iPhone with Silo added to the Home Screen) → Send test alert; then message that device while Silo is closed | A notification arrives; tapping it opens the chat; a call notification opens the ringing sheet |
| 14 | Phone (390 px) and desktop (1280 px+) | Phone: bottom tabs, full-screen chat. Desktop: navigation rail, list and chat side by side |
| 15 | Vercel production deploy | Build passes; `/api/cron/daily` returns 401 without the secret |

**Network interruption:** in a call, turn Wi-Fi off for about 10 s and back on.
- **Expected:** "Reconnecting…", then the call resumes.
- **Over 60 s offline:** the server marks the device as having left the call.

## Known limitations

- **Not end-to-end encrypted** (documented in the app and README).
- **No attachments.** Images and files in chats are out of scope for this MVP; profile and group pictures are supported.
- **No editing, deleting or replying to messages**, and no message reactions.
- **Presence:** online status comes from a single global presence channel. Everyone signed in can see who is online, unless a person switches "Show when I'm online" off. Last seen is restricted to friends and people you share a chat with.
- **Incoming-call ringing in the background** depends on Web Push. iOS needs Silo installed to the Home Screen (iOS 16.4+). Browsers may delay pushes on battery saver.
- **One device per call:** if the same account answers on two devices, the second one replaces the first in the LiveKit room.
- **Realtime DELETE events** for messages and calls (these happen only when a whole conversation is deleted) can't be RLS-filtered by Supabase. They expose only row IDs.
