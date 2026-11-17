-- LOCAL TESTING ONLY. Never run this on a Supabase project (it refuses to).
-- Emulates the small part of Supabase that Silo's migrations and RLS policies rely on, so they can be
-- applied and tested on a plain local PostgreSQL database:
--   roles anon / authenticated / service_role, auth.users + auth.uid()/auth.jwt(),
--   realtime.messages + realtime.topic(), storage.buckets/objects + storage.foldername(),
--   the supabase_realtime publication, and Supabase's default grants on schema public.
-- Usage: psql -d silo -f supabase/local/supabase_shim.sql   (then apply supabase/migrations/*.sql in order)

do $$
begin
	if exists (select 1 from pg_roles where rolname in ('supabase_admin', 'supabase_auth_admin')) then
		raise exception 'This looks like a real Supabase database. The local shim must not run here.';
	end if;
end $$;

do $$
begin
	if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin noinherit; end if;
	if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin noinherit; end if;
	if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin noinherit bypassrls; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- ---------- auth ----------
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create table if not exists auth.users (
	id uuid primary key default gen_random_uuid(),
	email text unique,
	raw_user_meta_data jsonb not null default '{}'::jsonb,
	created_at timestamptz not null default now()
);

create or replace function auth.uid() returns uuid language sql stable as $$
	select coalesce(
		nullif(current_setting('request.jwt.claim.sub', true), ''),
		(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
	)::uuid
$$;

create or replace function auth.role() returns text language sql stable as $$
	select coalesce(
		nullif(current_setting('request.jwt.claim.role', true), ''),
		(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
	)::text
$$;

create or replace function auth.jwt() returns jsonb language sql stable as $$
	select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

grant execute on function auth.uid(), auth.role(), auth.jwt() to anon, authenticated, service_role;

-- ---------- realtime ----------
create schema if not exists realtime;
grant usage on schema realtime to anon, authenticated, service_role;

create table if not exists realtime.messages (
	id uuid primary key default gen_random_uuid(),
	topic text not null,
	extension text not null default 'broadcast',
	event text,
	payload jsonb,
	private boolean default true,
	inserted_at timestamptz not null default now(),
	updated_at timestamptz not null default now()
);
alter table realtime.messages enable row level security;
grant select, insert on realtime.messages to anon, authenticated, service_role;

create or replace function realtime.topic() returns text language sql stable as $$
	select nullif(current_setting('realtime.topic', true), '')::text
$$;
grant execute on function realtime.topic() to anon, authenticated, service_role;

do $$
begin
	if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
		create publication supabase_realtime;
	end if;
end $$;

-- ---------- storage ----------
create schema if not exists storage;
grant usage on schema storage to anon, authenticated, service_role;

create table if not exists storage.buckets (
	id text primary key,
	name text not null unique,
	public boolean default false,
	file_size_limit bigint,
	allowed_mime_types text[],
	created_at timestamptz default now()
);

create table if not exists storage.objects (
	id uuid primary key default gen_random_uuid(),
	bucket_id text references storage.buckets(id),
	name text,
	owner uuid,
	metadata jsonb,
	created_at timestamptz default now(),
	updated_at timestamptz default now()
);
alter table storage.objects enable row level security;
grant all on storage.objects to anon, authenticated, service_role;
grant select on storage.buckets to anon, authenticated, service_role;

create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
	select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)]
$$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
