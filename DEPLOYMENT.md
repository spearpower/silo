# Deploying Silo

Silo needs three services, plus a VAPID key pair for Web Push:
- **Supabase**: database, auth, realtime and storage
- **LiveKit**: voice
- **Vercel**: hosting

Set them up in the order below.

## 1. Supabase project

1. Create a project at supabase.com. Pick the region closest to your users, and match the Vercel function region to it (step 5).
2. **Apply the migrations** in `supabase/migrations/`, in filename order:
   - `20261117000100_silo_schema.sql`: tables, constraints, indexes, triggers
   - `20261117000200_silo_functions.sql`: helper functions and RPCs (chats, groups, friends, calls, admin)
   - `20261117000300_silo_rls.sql`: privileges and Row Level Security policies
   - `20261117000400_silo_realtime_storage.sql`: Realtime publication, private-channel policies, storage buckets and policies

   Either paste each file into **SQL Editor → New query → Run**, or use the CLI:

   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```

   **Never** run `supabase/local/supabase_shim.sql` on a Supabase project. It is only for local tests, and it refuses to run there anyway.
3. **Authentication → Sign In / Providers → Email**: enabled. Keep **Confirm email** on (recommended). Set the minimum password length to 8 and turn on leaked-password protection if your plan has it.
4. **Authentication → URL Configuration**:
   - Site URL: `https://<your-domain>`
   - Redirect URLs: `https://<your-domain>/auth/confirm`, `http://localhost:3030/auth/confirm`, and your Vercel preview pattern (for example `https://*-<team>.vercel.app/auth/confirm`).
5. **Authentication → Emails** (optional, recommended): use the token-hash links so confirmation works across devices:
   - Confirm signup: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/`
   - Reset password: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`

   The default `?code=` links also work, as long as the link is opened in the same browser.

   Set up custom SMTP for production. The built-in sender is heavily rate-limited.
6. **Realtime → Settings**: turn **off** "Allow public access", so channels are private and the `realtime.messages` policies from migration 4 decide who may join `conv:<id>` and `online`.
7. **Storage**: migration 4 creates the `avatars` and `group-photos` buckets (public read, 2 MB, PNG/JPEG/WebP) and their write policies. Nothing else to do.
8. **First admin**: after you sign up in the app, run this once in the SQL editor:

   ```sql
   update public.profiles set role = 'admin' where username = '<your-username>';
   ```
9. **Keys** (Project Settings → API Keys): copy the project URL, the **publishable** key and a **secret** key.
   - Older projects show the "anon" and "service_role" keys instead. Both naming schemes work.
   - The secret key must only ever go into server environment variables.

**Types:** `lib/database.types.ts` was written to match the migrations. Once the project exists, regenerate it with:

```bash
npx supabase gen types typescript --project-id <project-ref> --schema public > lib/database.types.ts
```

Then re-add the helper type exports at the bottom of the file, or keep the hand-written file if nothing changed.

## 2. LiveKit (voice)

1. Create a project at cloud.livekit.io.
2. Go to Settings → Keys, create a key and copy:
   - the WebSocket URL (`wss://...livekit.cloud`)
   - the API key
   - the API secret
3. No webhooks are required. Silo settles calls itself through keep-alive pings, a no-answer timeout and a daily sweep, so nothing depends on a long-running server.

## 3. Web Push (VAPID)

```bash
npx web-push generate-vapid-keys
```

This prints a public key and a private key. Use a `mailto:` address you control for `VAPID_SUBJECT`.

Browser support:
- Chrome, Edge and Firefox on desktop and Android work in the browser and as an installed app.
- **iPhone and iPad (iOS 16.4+) only receive notifications after Silo is added to the Home Screen and opened from there.** The Settings screen explains this to iPhone users.

Notifications need the user to tap **Settings → Notifications** and allow them in the browser prompt.

## 4. Environment variables

| Name | Where it's used | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | no |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or `NEXT_PUBLIC_SUPABASE_ANON_KEY`) | browser + server; limited by RLS | no |
| `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) | server only: push fan-out, call sweeper, account deletion, suspensions | **yes** |
| `LIVEKIT_URL` | server; also allowed in the CSP | no |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | server only: signs call tokens | **yes** (secret) |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | browser: subscribes the device | no |
| `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | server only: sends pushes | **yes** (private key) |
| `CRON_SECRET` | server: protects `/api/cron/daily` | **yes** |
| `NEXT_PUBLIC_SITE_URL` | optional | no |

Notes:
- `NEXT_PUBLIC_*` values are built into the browser bundle. **Redeploy after changing them.**
- The Content Security Policy in `next.config.mjs` is built from `NEXT_PUBLIC_SUPABASE_URL` and `LIVEKIT_URL` at build time.
- Missing server keys turn features off cleanly instead of crashing:
  - without LiveKit: "Voice calls aren't set up on this server yet"
  - without VAPID: notifications show as not configured

## 5. Vercel

1. Import `spearpower/silo`. The framework is detected as **Next.js**. Keep the default build command (`next build`) and output.
2. Under **Settings → Environment Variables**, add the variables above for **Production**, **Preview** and **Development**.
   - Use separate Supabase projects (or at least separate keys) for production and preview if you can.
3. `vercel.json` sets:
   - the function region (`lhr1`, London). Change it to the region nearest your Supabase project.
   - a daily cron (`/api/cron/daily`, 03:00 UTC) that settles stale calls and prunes rate-limit rows. Vercel sends `Authorization: Bearer $CRON_SECRET` automatically.
4. Deploy. Then open the site, sign up, confirm the email, and make yourself admin (step 1.8).

**Serverless notes:**
- Nothing is kept in server memory between requests.
- Rate limits live in Postgres (`rate_limit()`).
- Call state lives in `call_sessions` and `call_participants`.
- Realtime runs between browsers and Supabase directly.
- Server code uses supabase-js over HTTPS (PostgREST), so there are no long-lived database connections.

## 6. After deploying: smoke test

Follow the manual checklist in [docs/TESTING.md](docs/TESTING.md). It needs two accounts on two devices or browsers.
