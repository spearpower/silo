-- =====================================================================
-- PicknPlay migration 001 — game engine state, variants, multiplayer extras
-- Runs on top of db/schema_final.sql (users, games, game_players, game_events, card_values).
-- Additive only and safe to run more than once: existing tables, columns and rows are kept.
-- Run it in pgAdmin / psql on every database (local first, then the hosted one).
-- =====================================================================

begin;

-- ---------- users ----------
-- Admin password reset: the player must choose a new password at next sign-in
alter table public.users add column if not exists must_change_password boolean not null default false;
-- When each player was last active anywhere in the app (friends list "online now / last seen")
alter table public.users add column if not exists last_seen_at timestamptz;
create index if not exists users_is_bot_idx on public.users (is_bot) where is_bot;

-- ---------- games ----------
-- Variant: PicknPlay Classic (52 cards) or PicknPlay Super (54 cards with 2 Jokers)
alter table public.games add column if not exists variant text not null default 'classic';
alter table public.games drop constraint if exists games_variant_check;
alter table public.games add constraint games_variant_check check (variant in ('classic', 'super'));
-- Private tables need a 4-digit PIN; turn timer in seconds (0 = no timer)
alter table public.games add column if not exists pin text;
alter table public.games drop constraint if exists games_pin_check;
alter table public.games add constraint games_pin_check check (pin ~ '^[0-9]{4}$');
alter table public.games add column if not exists timer_sec smallint not null default 30;
alter table public.games drop constraint if exists games_timer_check;
alter table public.games add constraint games_timer_check check (timer_sec in (0, 15, 20, 30, 40, 60));
-- The server-authoritative game state (deck, hands, discard, turn, penalty…). Never sent to browsers as-is:
-- each player only receives their own view of it. The readable columns below are mirrored from it.
alter table public.games add column if not exists state jsonb;
-- "Play again" links a finished game to the next one; early endings keep a reason
alter table public.games add column if not exists next_game_id bigint references public.games(id);
alter table public.games add column if not exists end_reason text;
alter table public.games add column if not exists ended_by bigint references public.users(id);
-- Lobbies can be abandoned and games ended early, besides lobby / playing / finished
alter table public.games drop constraint if exists games_status_check;
alter table public.games add constraint games_status_check check (status in ('lobby', 'playing', 'finished', 'abandoned', 'ended'));
create index if not exists games_turn_user_idx on public.games (turn_user_id) where status = 'playing';

-- ---------- game_players ----------
-- (left_at / left_reason / left_by already exist in schema_final.sql; kept here for older copies)
alter table public.game_players add column if not exists left_at timestamptz;
alter table public.game_players add column if not exists left_reason text;
alter table public.game_players add column if not exists left_by bigint references public.users(id);
-- A player waiting in the lobby holds no cards yet
alter table public.game_players alter column card_count set default 0;
comment on column public.game_players.points is 'Hand-point total when the game ended (lowest wins a cut)';
comment on column public.game_players.has_cut_card is 'True for the player who ended the game with the cut 7';

-- ---------- game_events: turn history ----------
create index if not exists game_events_type_idx on public.game_events (event_type);
comment on table public.game_events is 'Turn history: start, play, draw, pass, penalty, cancel, skip, reverse, again, reshuffle, timeout, left, finish, ended';

-- ---------- card_values: reference only ----------
-- The engine (lib/card-codes.ts) is authoritative for scoring. In PicknPlay Super the Black Spade Ace
-- counts 60, other Aces 15; Jokers count the admin rule option "Joker points" (default 50).
comment on table public.card_values is 'Reference card values (Classic). Scoring is computed by the game engine.';

-- ---------- app settings (feature switches + game-rule options) ----------
create table if not exists public.app_settings (
	key         text        primary key,
	value       jsonb       not null,
	updated_at  timestamptz not null default now(),
	updated_by  bigint      references public.users(id)
);
insert into public.app_settings (key, value) values
	('virtual_friends', '{"enabled": true}'),
	('voice_chat', '{"enabled": false}'),
	('rules', '{"superCutBelow": 60, "classicCutBelow": null, "penaltyResponse": "draw", "emptyDeck": "reshuffle", "startDiscard": "nonSpecial", "cutTie": "share", "jokerPoints": 50, "jokerOnAnything": true}')
on conflict (key) do nothing;

-- ---------- monthly leaderboard points ----------
-- 1st place earns one point per player at the table, last place earns 1 (games with Virtual Friends earn none)
create table if not exists public.game_points (
	id          bigint      generated by default as identity primary key,
	user_id     bigint      not null references public.users(id),
	game_id     bigint      not null references public.games(id) on delete cascade,
	points      smallint    not null check (points > 0),
	created_at  timestamptz not null default now(),
	unique (game_id, user_id)
);
create index if not exists game_points_created_idx on public.game_points (created_at);

-- ---------- table chat (public messages + emoji reactions) ----------
create table if not exists public.game_messages (
	id          bigint      generated by default as identity primary key,
	game_id     bigint      not null references public.games(id) on delete cascade,
	user_id     bigint      not null references public.users(id),
	body        text        not null check (char_length(body) between 1 and 200),
	created_at  timestamptz not null default now()
);
create index if not exists game_messages_game_idx on public.game_messages (game_id, id);

-- ---------- friends and invites ----------
create table if not exists public.friendships (
	requester_id  bigint      not null references public.users(id) on delete cascade,
	addressee_id  bigint      not null references public.users(id) on delete cascade,
	status        text        not null default 'pending' check (status in ('pending', 'accepted')),
	created_at    timestamptz not null default now(),
	accepted_at   timestamptz,
	primary key (requester_id, addressee_id),
	check (requester_id <> addressee_id)
);
create index if not exists friendships_addressee_idx on public.friendships (addressee_id, status);
create unique index if not exists friendships_pair_idx on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));

create table if not exists public.game_invites (
	id          bigint      generated by default as identity primary key,
	game_id     bigint      not null references public.games(id) on delete cascade,
	from_id     bigint      not null references public.users(id) on delete cascade,
	to_id       bigint      not null references public.users(id) on delete cascade,
	status      text        not null default 'sent' check (status in ('sent', 'accepted', 'declined')),
	created_at  timestamptz not null default now(),
	unique (game_id, to_id)
);
create index if not exists game_invites_to_idx on public.game_invites (to_id, status, created_at desc);

-- ---------- phone alerts (Web Push) ----------
create table if not exists public.push_subscriptions (
	endpoint    text        primary key,
	user_id     bigint      not null references public.users(id) on delete cascade,
	p256dh      text        not null,
	auth        text        not null,
	created_at  timestamptz not null default now(),
	last_ok_at  timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- ---------- Virtual Friends (computer players; they can never sign in) ----------
insert into public.users (username, password_hash, fullname, photo, role, status, is_bot)
select v.username, '!locked', v.fullname, v.photo, 'player', 'active', true
from (values
	('Amara',  'Amara (Virtual Friend)',  'f03.svg'),
	('Kato',   'Kato (Virtual Friend)',   'f06.svg'),
	('Zawadi', 'Zawadi (Virtual Friend)', 'f09.svg'),
	('Tendo',  'Tendo (Virtual Friend)',  'f12.svg'),
	('Nia',    'Nia (Virtual Friend)',    'f15.svg'),
	('Jabari', 'Jabari (Virtual Friend)', 'f18.svg')
) as v(username, fullname, photo)
where not exists (select 1 from public.users u where lower(u.username) = lower(v.username));

-- ---------- keep updated_at fresh (schema_final.sql defines the function) ----------
drop trigger if exists games_touch on public.games;
create trigger games_touch before update on public.games
	for each row execute function public.app_touch_updated_at();

-- ---------- lock the tables away from browser clients ----------
-- The app server is the only client. On Supabase, the anon/authenticated roles get no table access.
alter table public.users              enable row level security;
alter table public.games              enable row level security;
alter table public.game_players       enable row level security;
alter table public.game_events        enable row level security;
alter table public.card_values        enable row level security;
alter table public.app_settings       enable row level security;
alter table public.game_points        enable row level security;
alter table public.game_messages      enable row level security;
alter table public.friendships        enable row level security;
alter table public.game_invites       enable row level security;
alter table public.push_subscriptions enable row level security;
do $$
begin
	if exists (select 1 from pg_roles where rolname = 'anon') then
		revoke all on all tables in schema public from anon;
		revoke execute on function public.app_hash_password(text), public.app_check_password(text, text) from anon;
	end if;
	if exists (select 1 from pg_roles where rolname = 'authenticated') then
		revoke all on all tables in schema public from authenticated;
		revoke execute on function public.app_hash_password(text), public.app_check_password(text, text) from authenticated;
	end if;
end $$;
revoke execute on function public.app_hash_password(text), public.app_check_password(text, text) from public;

commit;
