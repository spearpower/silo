-- Silo 1/4: tables, constraints, indexes, triggers.
-- Apply in order with the other files in supabase/migrations (Supabase SQL editor, `supabase db push`, or psql).
-- Everything is keyed to Supabase Auth identities (auth.users.id, uuid).

-- ===================================================================
-- People
-- ===================================================================

create table public.profiles (
	id           uuid primary key references auth.users (id) on delete cascade,
	username     text not null,
	display_name text not null,
	avatar_url   text,
	bio          text not null default '',
	role         text not null default 'member',
	status       text not null default 'active',
	created_at   timestamptz not null default now(),
	updated_at   timestamptz not null default now(),
	constraint profiles_username_format check (username ~ '^[a-z0-9_]{3,20}$'),
	constraint profiles_display_name_len check (char_length(btrim(display_name)) between 1 and 50),
	constraint profiles_bio_len check (char_length(bio) <= 160),
	constraint profiles_avatar_len check (avatar_url is null or char_length(avatar_url) <= 500),
	constraint profiles_role_check check (role in ('member', 'admin')),
	constraint profiles_status_check check (status in ('active', 'suspended'))
);
create unique index profiles_username_key on public.profiles (username);
create index profiles_display_name_idx on public.profiles (lower(display_name) text_pattern_ops);

-- Last-seen lives apart from profiles so it can have its own (privacy-aware) read policy.
create table public.user_presence (
	user_id      uuid primary key references public.profiles (id) on delete cascade,
	last_seen_at timestamptz not null default now()
);

create table public.user_settings (
	user_id             uuid primary key references public.profiles (id) on delete cascade,
	show_online         boolean not null default true,
	show_last_seen      boolean not null default true,
	read_receipts       boolean not null default true,
	push_previews       boolean not null default false, -- message text in notifications: off by default
	allow_messages_from text not null default 'friends',
	updated_at          timestamptz not null default now(),
	constraint user_settings_allow_check check (allow_messages_from in ('friends', 'everyone'))
);

create table public.friendships (
	id           uuid primary key default gen_random_uuid(),
	requester_id uuid not null references public.profiles (id) on delete cascade,
	addressee_id uuid not null references public.profiles (id) on delete cascade,
	status       text not null default 'pending',
	created_at   timestamptz not null default now(),
	responded_at timestamptz,
	constraint friendships_status_check check (status in ('pending', 'accepted')),
	constraint friendships_not_self check (requester_id <> addressee_id)
);
create unique index friendships_pair_key on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index friendships_addressee_idx on public.friendships (addressee_id, status);
create index friendships_requester_idx on public.friendships (requester_id, status);

create table public.user_blocks (
	blocker_id uuid not null references public.profiles (id) on delete cascade,
	blocked_id uuid not null references public.profiles (id) on delete cascade,
	created_at timestamptz not null default now(),
	primary key (blocker_id, blocked_id),
	constraint user_blocks_not_self check (blocker_id <> blocked_id)
);
create index user_blocks_blocked_idx on public.user_blocks (blocked_id);

-- ===================================================================
-- Conversations (direct and group) and messages
-- ===================================================================

create table public.conversations (
	id              uuid primary key default gen_random_uuid(),
	kind            text not null,
	title           text,
	photo_url       text,
	direct_key      text,          -- 'smaller-uuid:larger-uuid' for direct chats, so each pair has one chat
	created_by      uuid references public.profiles (id) on delete set null,
	created_at      timestamptz not null default now(),
	updated_at      timestamptz not null default now(),
	last_message_at timestamptz,
	constraint conversations_kind_check check (kind in ('direct', 'group')),
	constraint conversations_direct_key_check check ((kind = 'direct') = (direct_key is not null)),
	constraint conversations_title_check check (
		(kind = 'direct' and title is null) or (kind = 'group' and char_length(btrim(title)) between 1 and 60)),
	constraint conversations_photo_len check (photo_url is null or char_length(photo_url) <= 500)
);
create unique index conversations_direct_key on public.conversations (direct_key) where direct_key is not null;

create table public.conversation_participants (
	conversation_id   uuid not null references public.conversations (id) on delete cascade,
	user_id           uuid not null references public.profiles (id) on delete cascade,
	role              text not null default 'member',
	joined_at         timestamptz not null default clock_timestamp(),
	last_delivered_at timestamptz,  -- shared with the other members (delivery ticks)
	receipt_read_at   timestamptz,  -- shared read receipt; stays null when the member turned receipts off
	muted_until       timestamptz,
	primary key (conversation_id, user_id),
	constraint conversation_participants_role_check check (role in ('owner', 'admin', 'member'))
);
create index conversation_participants_user_idx on public.conversation_participants (user_id);

-- Private "read up to" marker used for unread counts (only its owner can read it).
create table public.conversation_reads (
	conversation_id uuid not null,
	user_id         uuid not null,
	last_read_at    timestamptz not null default clock_timestamp(),
	primary key (conversation_id, user_id),
	foreign key (conversation_id, user_id) references public.conversation_participants (conversation_id, user_id) on delete cascade
);

create table public.messages (
	id              uuid primary key default gen_random_uuid(),
	conversation_id uuid not null references public.conversations (id) on delete cascade,
	sender_id       uuid references public.profiles (id) on delete set null,
	kind            text not null default 'text',
	body            text not null,
	client_id       uuid,          -- set by the sending device; makes retries safe (no duplicates)
	meta            jsonb,
	created_at      timestamptz not null default now(),
	constraint messages_kind_check check (kind in ('text', 'system', 'call')),
	constraint messages_body_len check (char_length(body) between 1 and 4000),
	constraint messages_text_has_sender check (kind <> 'text' or sender_id is not null)
);
create index messages_conversation_created_idx on public.messages (conversation_id, created_at desc, id desc);
create unique index messages_client_id_key on public.messages (sender_id, client_id) where client_id is not null;
create index messages_sender_idx on public.messages (sender_id);

create table public.user_reports (
	id              uuid primary key default gen_random_uuid(),
	reporter_id     uuid references public.profiles (id) on delete set null,
	reported_id     uuid not null references public.profiles (id) on delete cascade,
	conversation_id uuid references public.conversations (id) on delete set null,
	message_id      uuid references public.messages (id) on delete set null,
	reason          text not null,
	status          text not null default 'open',
	created_at      timestamptz not null default now(),
	reviewed_by     uuid references public.profiles (id) on delete set null,
	reviewed_at     timestamptz,
	constraint user_reports_reason_len check (char_length(btrim(reason)) between 3 and 1000),
	constraint user_reports_status_check check (status in ('open', 'actioned', 'dismissed')),
	constraint user_reports_not_self check (reporter_id is null or reporter_id <> reported_id)
);
create index user_reports_status_idx on public.user_reports (status, created_at desc);

-- ===================================================================
-- Voice calls (LiveKit). media is 'audio' now; 'video' is reserved for a later release.
-- ===================================================================

create table public.call_sessions (
	id              uuid primary key default gen_random_uuid(),
	conversation_id uuid not null references public.conversations (id) on delete cascade,
	kind            text not null,
	media           text not null default 'audio',
	started_by      uuid references public.profiles (id) on delete set null,
	status          text not null default 'ringing',
	room_name       text not null,
	created_at      timestamptz not null default now(),
	answered_at     timestamptz,
	ended_at        timestamptz,
	constraint call_sessions_kind_check check (kind in ('direct', 'group')),
	constraint call_sessions_media_check check (media in ('audio', 'video')),
	constraint call_sessions_status_check check (status in ('ringing', 'active', 'ended', 'missed', 'declined', 'cancelled'))
);
create unique index call_sessions_room_key on public.call_sessions (room_name);
-- at most one live call per conversation
create unique index call_sessions_live_key on public.call_sessions (conversation_id) where status in ('ringing', 'active');
create index call_sessions_conversation_idx on public.call_sessions (conversation_id, created_at desc);

create table public.call_participants (
	call_id      uuid not null references public.call_sessions (id) on delete cascade,
	user_id      uuid not null references public.profiles (id) on delete cascade,
	state        text not null default 'invited',
	invited_at   timestamptz not null default now(),
	joined_at    timestamptz,
	left_at      timestamptz,
	last_ping_at timestamptz,
	primary key (call_id, user_id),
	constraint call_participants_state_check check (state in ('invited', 'joined', 'left', 'declined', 'missed'))
);
create index call_participants_user_idx on public.call_participants (user_id, state);

-- ===================================================================
-- Push notifications and rate limits
-- ===================================================================

create table public.push_subscriptions (
	id           uuid primary key default gen_random_uuid(),
	user_id      uuid not null references public.profiles (id) on delete cascade,
	endpoint     text not null,
	p256dh       text not null,
	auth         text not null,
	user_agent   text,
	created_at   timestamptz not null default now(),
	last_used_at timestamptz,
	constraint push_subscriptions_endpoint_check check (endpoint ~ '^https://' and char_length(endpoint) <= 1000),
	constraint push_subscriptions_keys_len check (char_length(p256dh) <= 200 and char_length(auth) <= 100)
);
create unique index push_subscriptions_endpoint_key on public.push_subscriptions (endpoint);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table public.rate_limits (
	key          text not null,
	window_start timestamptz not null,
	hits         integer not null default 0,
	primary key (key, window_start)
);

-- ===================================================================
-- Triggers
-- ===================================================================

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
	new.updated_at := now();
	return new;
end $$;

create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger conversations_touch before update on public.conversations for each row execute function public.touch_updated_at();
create trigger user_settings_touch before update on public.user_settings for each row execute function public.touch_updated_at();

-- New Supabase Auth user -> profile + settings + presence. Username/display name come from sign-up metadata.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
	v_username text := lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')));
	v_name     text := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
begin
	if v_username !~ '^[a-z0-9_]{3,20}$' then
		-- fallback for accounts made outside the sign-up form (dashboard, invites)
		v_username := 'user_' || substr(replace(new.id::text, '-', ''), 1, 12);
	end if;
	if v_name = '' then v_name := v_username; end if;
	insert into public.profiles (id, username, display_name, avatar_url)
	values (new.id, v_username, left(v_name, 50), new.raw_user_meta_data ->> 'avatar_url');
	insert into public.user_settings (user_id) values (new.id);
	insert into public.user_presence (user_id) values (new.id);
	return new;
end $$;

create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Messages: server-controlled timestamp, keep the conversation's ordering field current.
create function public.on_message_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
	update public.conversations set last_message_at = new.created_at where id = new.conversation_id;
	return new;
end $$;

create trigger messages_after_insert after insert on public.messages for each row execute function public.on_message_insert();

create function public.force_message_defaults() returns trigger
language plpgsql set search_path = '' as $$
begin
	new.created_at := clock_timestamp(); -- server time; clock_timestamp keeps order inside one transaction
	new.body := btrim(new.body);
	return new;
end $$;

create trigger messages_before_insert before insert on public.messages for each row execute function public.force_message_defaults();
