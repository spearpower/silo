-- Silo 6: notification tokens for the Silo Android app (Firebase Cloud Messaging).
-- Browsers keep using push_subscriptions (Web Push); the app registers an FCM token per phone here.

create table public.device_tokens (
	id           uuid primary key default gen_random_uuid(),
	user_id      uuid not null references public.profiles (id) on delete cascade,
	token        text not null,
	platform     text not null default 'android',
	app_version  text,
	created_at   timestamptz not null default now(),
	last_used_at timestamptz,
	constraint device_tokens_token_len check (char_length(token) between 20 and 4096),
	constraint device_tokens_platform_check check (platform in ('android')),
	constraint device_tokens_version_len check (app_version is null or char_length(app_version) <= 40)
);
create unique index device_tokens_token_key on public.device_tokens (token);
create index device_tokens_user_idx on public.device_tokens (user_id);

-- Supabase's default privileges grant everything on new tables to anon/authenticated: take that back.
revoke all on public.device_tokens from anon, authenticated;
grant select, delete on public.device_tokens to authenticated;
grant insert (user_id, token, platform, app_version) on public.device_tokens to authenticated;

alter table public.device_tokens enable row level security;
create policy device_tokens_select_own on public.device_tokens for select to authenticated using (user_id = auth.uid());
create policy device_tokens_insert_own on public.device_tokens for insert to authenticated with check (user_id = auth.uid());
create policy device_tokens_delete_own on public.device_tokens for delete to authenticated using (user_id = auth.uid());
