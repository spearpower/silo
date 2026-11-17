-- Silo 2/4: helper functions and RPCs.
-- Security-definer functions run with fixed search_path = '' and re-check the caller (auth.uid()) themselves.
-- Errors meant for people use plain RAISE EXCEPTION (SQLSTATE P0001); the app shows those messages as-is.

-- ===================================================================
-- Helpers (used by RLS policies; security definer so policies don't recurse)
-- ===================================================================

create function public.is_active_user() returns boolean
language sql stable security definer set search_path = '' as $$
	select exists (select 1 from public.profiles where id = auth.uid() and status = 'active')
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
	select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and status = 'active')
$$;

create function public.is_member(p_conv uuid) returns boolean
language sql stable security definer set search_path = '' as $$
	select exists (select 1 from public.conversation_participants where conversation_id = p_conv and user_id = auth.uid())
$$;

create function public.member_since(p_conv uuid) returns timestamptz
language sql stable security definer set search_path = '' as $$
	select joined_at from public.conversation_participants where conversation_id = p_conv and user_id = auth.uid()
$$;

create function public.member_role(p_conv uuid) returns text
language sql stable security definer set search_path = '' as $$
	select role from public.conversation_participants where conversation_id = p_conv and user_id = auth.uid()
$$;

create function public.is_blocked_pair(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
	select exists (select 1 from public.user_blocks
	               where (blocker_id = p_a and blocked_id = p_b) or (blocker_id = p_b and blocked_id = p_a))
$$;

create function public.are_friends(p_a uuid, p_b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
	select exists (select 1 from public.friendships
	               where status = 'accepted'
	                 and least(requester_id, addressee_id) = least(p_a, p_b)
	                 and greatest(requester_id, addressee_id) = greatest(p_a, p_b))
$$;

create function public.has_blocked_me(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
	select exists (select 1 from public.user_blocks where blocker_id = p_user and blocked_id = auth.uid())
$$;

/** May the caller post in this conversation? Member, active, and (for direct chats) nobody blocked anybody. */
create function public.can_post(p_conv uuid) returns boolean
language sql stable security definer set search_path = '' as $$
	select public.is_active_user()
	   and exists (select 1 from public.conversation_participants where conversation_id = p_conv and user_id = auth.uid())
	   and not exists (
		select 1 from public.conversations c
		join public.conversation_participants o on o.conversation_id = c.id and o.user_id <> auth.uid()
		where c.id = p_conv and c.kind = 'direct' and public.is_blocked_pair(auth.uid(), o.user_id))
$$;

/** Last seen of someone else, if their privacy settings allow the caller to see it. */
create function public.can_see_presence(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
	select p_user = auth.uid() or (
		exists (select 1 from public.user_settings s where s.user_id = p_user and s.show_last_seen)
		and not public.is_blocked_pair(auth.uid(), p_user)
		and (public.are_friends(auth.uid(), p_user) or exists (
			select 1 from public.conversation_participants a
			join public.conversation_participants b on b.conversation_id = a.conversation_id
			where a.user_id = auth.uid() and b.user_id = p_user)))
$$;

create function public.require_active() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_me uuid := auth.uid();
begin
	if v_me is null then raise exception 'Please sign in again' using errcode = '28000'; end if;
	if not exists (select 1 from public.profiles where id = v_me and status = 'active') then
		raise exception 'This account is suspended';
	end if;
	return v_me;
end $$;

/** Fixed-window rate limit for the caller. Returns true when the action is allowed. */
create function public.rate_limit(p_action text, p_max integer, p_window_seconds integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
	v_me uuid := auth.uid();
	v_window timestamptz;
	v_hits integer;
begin
	if v_me is null then return false; end if;
	if p_window_seconds < 1 or p_window_seconds > 3600 or p_max < 1 then raise exception 'bad rate limit'; end if;
	v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
	insert into public.rate_limits (key, window_start, hits) values (v_me::text || ':' || left(p_action, 40), v_window, 1)
	on conflict (key, window_start) do update set hits = public.rate_limits.hits + 1
	returning hits into v_hits;
	-- tidy old windows now and then
	if random() < 0.01 then delete from public.rate_limits where window_start < now() - interval '2 hours'; end if;
	return v_hits <= p_max;
end $$;

-- ===================================================================
-- Profiles, presence, friends, blocks, reports
-- ===================================================================

create function public.username_available(p_username text) returns boolean
language sql stable security definer set search_path = '' as $$
	select lower(btrim(p_username)) ~ '^[a-z0-9_]{3,20}$'
	   and not exists (select 1 from public.profiles where username = lower(btrim(p_username)))
$$;

/** App heartbeat while open: last seen + "delivered" for everything received so far. */
create function public.heartbeat() returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid();
begin
	if v_me is null then return; end if;
	update public.user_presence set last_seen_at = clock_timestamp() where user_id = v_me;
	update public.conversation_participants set last_delivered_at = clock_timestamp() where user_id = v_me;
end $$;

create function public.mark_read(p_conv uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid();
begin
	if v_me is null or not public.is_member(p_conv) then return; end if;
	insert into public.conversation_reads (conversation_id, user_id, last_read_at) values (p_conv, v_me, clock_timestamp())
	on conflict (conversation_id, user_id) do update set last_read_at = excluded.last_read_at;
	update public.conversation_participants p
	set last_delivered_at = clock_timestamp(),
	    receipt_read_at = case when s.read_receipts then clock_timestamp() else null end
	from public.user_settings s
	where p.conversation_id = p_conv and p.user_id = v_me and s.user_id = v_me;
end $$;

create function public.friend_request(p_user uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
	v_me uuid := public.require_active();
	v_row public.friendships;
begin
	if p_user = v_me then raise exception 'You can’t add yourself'; end if;
	if not exists (select 1 from public.profiles where id = p_user and status = 'active') then raise exception 'That person isn’t on Silo'; end if;
	if public.is_blocked_pair(v_me, p_user) then raise exception 'You can’t add this person'; end if;
	select * into v_row from public.friendships
	where least(requester_id, addressee_id) = least(v_me, p_user) and greatest(requester_id, addressee_id) = greatest(v_me, p_user)
	for update;
	if not found then
		insert into public.friendships (requester_id, addressee_id) values (v_me, p_user);
		return 'requested';
	elsif v_row.status = 'accepted' then
		return 'friends';
	elsif v_row.addressee_id = v_me then
		update public.friendships set status = 'accepted', responded_at = now() where id = v_row.id;
		return 'friends';
	end if;
	return 'requested';
end $$;

create function public.accept_friend(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public.require_active();
begin
	update public.friendships set status = 'accepted', responded_at = now()
	where requester_id = p_user and addressee_id = v_me and status = 'pending';
	if not found then raise exception 'That request is no longer there'; end if;
end $$;

/** Cancel an outgoing request, decline an incoming one, or unfriend. */
create function public.remove_friend(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid();
begin
	if v_me is null then raise exception 'Please sign in again' using errcode = '28000'; end if;
	delete from public.friendships
	where least(requester_id, addressee_id) = least(v_me, p_user) and greatest(requester_id, addressee_id) = greatest(v_me, p_user);
end $$;

create function public.block_user(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := auth.uid();
begin
	if v_me is null then raise exception 'Please sign in again' using errcode = '28000'; end if;
	if p_user = v_me then raise exception 'You can’t block yourself'; end if;
	insert into public.user_blocks (blocker_id, blocked_id) values (v_me, p_user) on conflict do nothing;
	delete from public.friendships
	where least(requester_id, addressee_id) = least(v_me, p_user) and greatest(requester_id, addressee_id) = greatest(v_me, p_user);
end $$;

create function public.unblock_user(p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
	delete from public.user_blocks where blocker_id = auth.uid() and blocked_id = p_user;
end $$;

create function public.report_user(p_user uuid, p_reason text, p_conversation uuid default null, p_message uuid default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
	v_me uuid := public.require_active();
	v_id uuid;
begin
	if p_user = v_me then raise exception 'You can’t report yourself'; end if;
	if not exists (select 1 from public.profiles where id = p_user) then raise exception 'That person isn’t on Silo'; end if;
	if char_length(btrim(coalesce(p_reason, ''))) < 3 then raise exception 'Tell us briefly what happened'; end if;
	if not public.rate_limit('report', 10, 3600) then raise exception 'Too many reports. Try again later.'; end if;
	-- only attach a conversation/message the reporter can actually see
	if p_conversation is not null and not public.is_member(p_conversation) then p_conversation := null; end if;
	if p_message is not null and not exists (
		select 1 from public.messages m where m.id = p_message and m.sender_id = p_user and public.is_member(m.conversation_id)) then
		p_message := null;
	end if;
	insert into public.user_reports (reporter_id, reported_id, conversation_id, message_id, reason)
	values (v_me, p_user, p_conversation, p_message, left(btrim(p_reason), 1000))
	returning id into v_id;
	return v_id;
end $$;

-- ===================================================================
-- Conversations
-- ===================================================================

create function public.system_message(p_conv uuid, p_body text, p_meta jsonb default null) returns void
language sql security definer set search_path = '' as $$
	insert into public.messages (conversation_id, sender_id, kind, body, meta) values (p_conv, null, 'system', left(p_body, 4000), p_meta)
$$;

/** Open (or create) the one-to-one chat with another person. */
create function public.start_direct(p_user uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
	v_me uuid := public.require_active();
	v_key text;
	v_id uuid;
	v_allow text;
begin
	if p_user = v_me then raise exception 'You can’t message yourself'; end if;
	if not exists (select 1 from public.profiles where id = p_user and status = 'active') then raise exception 'That person isn’t on Silo'; end if;
	if public.is_blocked_pair(v_me, p_user) then raise exception 'You can’t message this person'; end if;
	v_key := least(v_me, p_user)::text || ':' || greatest(v_me, p_user)::text;
	select id into v_id from public.conversations where direct_key = v_key;
	if v_id is not null then return v_id; end if;
	select allow_messages_from into v_allow from public.user_settings where user_id = p_user;
	if coalesce(v_allow, 'friends') = 'friends' and not public.are_friends(v_me, p_user) then
		raise exception 'This person only accepts messages from friends. Send a friend request first.';
	end if;
	insert into public.conversations (kind, direct_key, created_by) values ('direct', v_key, v_me)
	on conflict (direct_key) where direct_key is not null do nothing
	returning id into v_id;
	if v_id is null then -- created at the same moment by the other person
		select id into v_id from public.conversations where direct_key = v_key;
		return v_id;
	end if;
	insert into public.conversation_participants (conversation_id, user_id, role)
	values (v_id, v_me, 'member'), (v_id, p_user, 'member');
	return v_id;
end $$;

/** New private group. Members must be the creator's friends (nobody can be added by strangers). */
create function public.create_group(p_title text, p_members uuid[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
	v_me uuid := public.require_active();
	v_id uuid;
	v_user uuid;
	v_name text;
begin
	if char_length(btrim(coalesce(p_title, ''))) not between 1 and 60 then raise exception 'Give the group a name (up to 60 characters)'; end if;
	if coalesce(array_length(p_members, 1), 0) > 49 then raise exception 'Groups can have up to 50 members'; end if;
	if not public.rate_limit('create_group', 10, 3600) then raise exception 'Too many new groups. Try again later.'; end if;
	insert into public.conversations (kind, title, created_by) values ('group', btrim(p_title), v_me) returning id into v_id;
	insert into public.conversation_participants (conversation_id, user_id, role) values (v_id, v_me, 'owner');
	foreach v_user in array coalesce(p_members, '{}') loop
		continue when v_user = v_me;
		if not public.are_friends(v_me, v_user) or public.is_blocked_pair(v_me, v_user) then
			raise exception 'You can only add your friends to a group';
		end if;
		insert into public.conversation_participants (conversation_id, user_id) values (v_id, v_user) on conflict do nothing;
	end loop;
	select display_name into v_name from public.profiles where id = v_me;
	perform public.system_message(v_id, v_name || ' created the group', jsonb_build_object('event', 'created', 'by', v_me));
	return v_id;
end $$;

create function public.add_group_members(p_conv uuid, p_members uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
	v_me uuid := public.require_active();
	v_user uuid;
	v_added integer := 0;
	v_names text[] := '{}';
	v_name text;
begin
	if not exists (select 1 from public.conversations where id = p_conv and kind = 'group') then raise exception 'Group not found'; end if;
	if coalesce(public.member_role(p_conv), '') not in ('owner', 'admin') then raise exception 'Only group admins can add people'; end if;
	if (select count(*) from public.conversation_participants where conversation_id = p_conv) + coalesce(array_length(p_members, 1), 0) > 50 then
		raise exception 'Groups can have up to 50 members';
	end if;
	foreach v_user in array coalesce(p_members, '{}') loop
		continue when v_user = v_me;
		if not public.are_friends(v_me, v_user) or public.is_blocked_pair(v_me, v_user) then
			raise exception 'You can only add your friends to a group';
		end if;
		insert into public.conversation_participants (conversation_id, user_id) values (p_conv, v_user) on conflict do nothing;
		if found then
			v_added := v_added + 1;
			select display_name into v_name from public.profiles where id = v_user;
			v_names := v_names || v_name;
		end if;
	end loop;
	if v_added > 0 then
		select display_name into v_name from public.profiles where id = v_me;
		perform public.system_message(p_conv, v_name || ' added ' || array_to_string(v_names, ', '), jsonb_build_object('event', 'added', 'by', v_me));
	end if;
	return v_added;
end $$;

create function public.remove_group_member(p_conv uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
	v_me uuid := public.require_active();
	v_my_role text := public.member_role(p_conv);
	v_their_role text;
	v_name text; v_their text;
begin
	if p_user = v_me then raise exception 'Use Leave group instead'; end if;
	if not exists (select 1 from public.conversations where id = p_conv and kind = 'group') then raise exception 'Group not found'; end if;
	select role into v_their_role from public.conversation_participants where conversation_id = p_conv and user_id = p_user;
	if v_their_role is null then return; end if;
	if coalesce(v_my_role, '') not in ('owner', 'admin')
	   or v_their_role = 'owner'
	   or (v_their_role = 'admin' and v_my_role <> 'owner') then
		raise exception 'You can’t remove this member';
	end if;
	delete from public.conversation_participants where conversation_id = p_conv and user_id = p_user;
	select display_name into v_name from public.profiles where id = v_me;
	select display_name into v_their from public.profiles where id = p_user;
	perform public.system_message(p_conv, v_name || ' removed ' || v_their, jsonb_build_object('event', 'removed', 'by', v_me, 'user', p_user));
end $$;

create function public.set_member_role(p_conv uuid, p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_me uuid := public.require_active();
begin
	if p_role not in ('admin', 'member') then raise exception 'Unknown role'; end if;
	if public.member_role(p_conv) is distinct from 'owner' then raise exception 'Only the group owner can change roles'; end if;
	if p_user = v_me then raise exception 'You are the owner'; end if;
	update public.conversation_participants set role = p_role where conversation_id = p_conv and user_id = p_user and role <> 'owner';
	if not found then raise exception 'That person isn’t in this group'; end if;
end $$;

create function public.update_group(p_conv uuid, p_title text, p_photo_url text) returns void
language plpgsql security definer set search_path = '' as $$
declare
	v_me uuid := public.require_active();
	v_old text;
	v_name text;
begin
	if coalesce(public.member_role(p_conv), '') not in ('owner', 'admin') then raise exception 'Only group admins can change the group'; end if;
	if char_length(btrim(coalesce(p_title, ''))) not between 1 and 60 then raise exception 'Give the group a name (up to 60 characters)'; end if;
	if p_photo_url is not null and (char_length(p_photo_url) > 500 or p_photo_url !~ '^(https://|/)') then raise exception 'That picture link isn’t allowed'; end if;
	select title into v_old from public.conversations where id = p_conv and kind = 'group' for update;
	if not found then raise exception 'Group not found'; end if;
	update public.conversations set title = btrim(p_title), photo_url = p_photo_url where id = p_conv;
	if v_old is distinct from btrim(p_title) then
		select display_name into v_name from public.profiles where id = v_me;
		perform public.system_message(p_conv, v_name || ' renamed the group to “' || btrim(p_title) || '”', jsonb_build_object('event', 'renamed', 'by', v_me));
	end if;
end $$;

/** Leave a group. The owner hands over to the longest-standing admin (or member); the last one out deletes it. */
create function public.leave_group(p_conv uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
	v_me uuid := auth.uid();
	v_role text;
	v_next uuid;
	v_name text;
begin
	if v_me is null then raise exception 'Please sign in again' using errcode = '28000'; end if;
	if not exists (select 1 from public.conversations where id = p_conv and kind = 'group') then raise exception 'Group not found'; end if;
	select role into v_role from public.conversation_participants where conversation_id = p_conv and user_id = v_me for update;
	if v_role is null then return; end if;
	delete from public.conversation_participants where conversation_id = p_conv and user_id = v_me;
	if not exists (select 1 from public.conversation_participants where conversation_id = p_conv) then
		delete from public.conversations where id = p_conv;
		return;
	end if;
	if v_role = 'owner' then
		select user_id into v_next from public.conversation_participants where conversation_id = p_conv
		order by (role = 'admin') desc, joined_at limit 1;
		update public.conversation_participants set role = 'owner' where conversation_id = p_conv and user_id = v_next;
	end if;
	select display_name into v_name from public.profiles where id = v_me;
	perform public.system_message(p_conv, v_name || ' left', jsonb_build_object('event', 'left', 'user', v_me));
end $$;

/** Send a text message (RLS applies: security invoker). Retries with the same client_id return the original. */
create function public.send_message(p_conv uuid, p_body text, p_client_id uuid default null) returns public.messages
language plpgsql security invoker set search_path = '' as $$
declare v_row public.messages;
begin
	if char_length(btrim(coalesce(p_body, ''))) = 0 then raise exception 'Type a message first'; end if;
	if char_length(p_body) > 4000 then raise exception 'Messages can be up to 4000 characters'; end if;
	if p_client_id is not null then
		select * into v_row from public.messages where sender_id = auth.uid() and client_id = p_client_id;
		if found then return v_row; end if;
	end if;
	if not public.can_post(p_conv) then raise exception 'You can’t send messages in this chat'; end if;
	insert into public.messages (conversation_id, sender_id, body, client_id) -- kind defaults to 'text'
	values (p_conv, auth.uid(), p_body, p_client_id)
	returning * into v_row;
	return v_row;
end $$;

/** The signed-in person's chats with preview, unread count and (for direct chats) the other person. RLS applies. */
create function public.my_conversations() returns table (
	id uuid, kind text, title text, photo_url text, created_at timestamptz, last_message_at timestamptz,
	my_role text, muted_until timestamptz, member_count integer,
	other_id uuid, other_username text, other_display_name text, other_avatar_url text,
	last_message_id uuid, last_body text, last_kind text, last_sender_id uuid, last_sender_name text, last_created_at timestamptz,
	unread integer
)
language sql stable security invoker set search_path = '' as $$
	select c.id, c.kind, c.title, c.photo_url, c.created_at, c.last_message_at,
	       me.role, me.muted_until,
	       (select count(*)::int from public.conversation_participants x where x.conversation_id = c.id),
	       o.id, o.username, o.display_name, o.avatar_url,
	       lm.id, lm.body, lm.kind, lm.sender_id, ls.display_name, lm.created_at,
	       (select count(*)::int from (
		       select 1 from public.messages m
		       where m.conversation_id = c.id
		         and m.created_at > greatest(me.joined_at, coalesce(r.last_read_at, me.joined_at))
		         and m.sender_id is distinct from auth.uid()
		       limit 100) u)
	from public.conversation_participants me
	join public.conversations c on c.id = me.conversation_id
	left join public.conversation_reads r on r.conversation_id = c.id and r.user_id = me.user_id
	left join lateral (
		select p.id, p.username, p.display_name, p.avatar_url
		from public.conversation_participants op join public.profiles p on p.id = op.user_id
		where c.kind = 'direct' and op.conversation_id = c.id and op.user_id <> me.user_id
		limit 1) o on true
	left join lateral (
		select m.id, m.body, m.kind, m.sender_id, m.created_at from public.messages m
		where m.conversation_id = c.id and m.created_at >= me.joined_at
		order by m.created_at desc, m.id desc limit 1) lm on true
	left join public.profiles ls on ls.id = lm.sender_id
	where me.user_id = auth.uid()
	order by coalesce(c.last_message_at, c.created_at) desc
$$;

/** Find people by username or name. People who blocked the caller are never listed. */
create function public.search_people(p_query text) returns table (
	id uuid, username text, display_name text, avatar_url text, relation text
)
language sql stable security invoker set search_path = '' as $$
	select p.id, p.username, p.display_name, p.avatar_url,
	       case
		       when exists (select 1 from public.user_blocks b where b.blocker_id = auth.uid() and b.blocked_id = p.id) then 'blocked'
		       when f.status = 'accepted' then 'friend'
		       when f.requester_id = auth.uid() then 'outgoing'
		       when f.addressee_id = auth.uid() then 'incoming'
		       else 'none'
	       end
	from public.profiles p
	left join public.friendships f
	  on least(f.requester_id, f.addressee_id) = least(p.id, auth.uid())
	 and greatest(f.requester_id, f.addressee_id) = greatest(p.id, auth.uid())
	where p.id <> auth.uid() and p.status = 'active'
	  and not public.has_blocked_me(p.id)
	  and char_length(btrim(p_query)) >= 2
	  and (p.username like lower(btrim(p_query)) || '%' or lower(p.display_name) like '%' || lower(btrim(p_query)) || '%')
	order by (p.username = lower(btrim(p_query))) desc, p.username
	limit 20
$$;

-- ===================================================================
-- Voice calls
-- ===================================================================

/** Close a call: set its final status, settle participants, and log it in the chat. */
create function public.finish_call(p_call uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
	v_call public.call_sessions;
	v_secs integer;
	v_body text;
begin
	update public.call_sessions set status = p_status, ended_at = now()
	where id = p_call and status in ('ringing', 'active')
	returning * into v_call;
	if not found then return; end if;
	update public.call_participants set state = 'left', left_at = now() where call_id = p_call and state = 'joined';
	update public.call_participants set state = 'missed' where call_id = p_call and state = 'invited';
	v_secs := case when v_call.answered_at is null then 0 else greatest(0, extract(epoch from (now() - v_call.answered_at))::int) end;
	v_body := case p_status
		when 'ended' then 'Voice call · ' || (v_secs / 60) || ':' || lpad((v_secs % 60)::text, 2, '0')
		when 'missed' then 'Missed voice call'
		when 'declined' then 'Declined voice call'
		else 'Cancelled voice call' end;
	insert into public.messages (conversation_id, sender_id, kind, body, meta)
	values (v_call.conversation_id, v_call.started_by, 'call', v_body,
	        jsonb_build_object('call_id', p_call, 'status', p_status, 'seconds', v_secs, 'media', v_call.media));
end $$;

/**
 * Time rules for calls (serverless-safe: no in-memory timers).
 *  - joined but silent for 60 s (no ping) -> left
 *  - ringing for 45 s with nobody answering -> missed
 *  - live with nobody left in it -> ended (or cancelled if never answered)
 * Returns the people who just missed a call (for "missed call" notifications).
 */
create function public.expire_calls(p_conv uuid default null) returns table (call_id uuid, conversation_id uuid, user_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
	v_call record;
begin
	update public.call_participants cp set state = 'left', left_at = now()
	from public.call_sessions s
	where s.id = cp.call_id and s.status in ('ringing', 'active') and (p_conv is null or s.conversation_id = p_conv)
	  and cp.state = 'joined' and coalesce(cp.last_ping_at, cp.joined_at) < now() - interval '60 seconds';

	for v_call in
		select s.id, s.status, s.answered_at, s.created_at,
		       (select count(*) from public.call_participants j where j.call_id = s.id and j.state = 'joined') as joined
		from public.call_sessions s
		where s.status in ('ringing', 'active') and (p_conv is null or s.conversation_id = p_conv)
		for update of s
	loop
		if v_call.status = 'ringing' and v_call.created_at < now() - interval '45 seconds' then
			return query select cp.call_id, s.conversation_id, cp.user_id
			from public.call_participants cp join public.call_sessions s on s.id = cp.call_id
			where cp.call_id = v_call.id and cp.state = 'invited';
			perform public.finish_call(v_call.id, case when v_call.joined > 0 then 'missed' else 'cancelled' end);
		elsif v_call.joined = 0 then
			perform public.finish_call(v_call.id, case when v_call.answered_at is null then 'cancelled' else 'ended' end);
		end if;
	end loop;
end $$;

/** Start a voice call in a chat (or join the one already running there). The caller is in it straight away. */
create function public.start_call(p_conv uuid) returns table (call_id uuid, room_name text, status text, created boolean, kind text)
language plpgsql security definer set search_path = '' as $$
declare
	v_me uuid := public.require_active();
	v_kind text;
	v_live public.call_sessions;
	v_id uuid := gen_random_uuid();
begin
	if not public.is_member(p_conv) then raise exception 'You’re not in this chat'; end if;
	if not public.can_post(p_conv) then raise exception 'You can’t call this person'; end if;
	select c.kind into v_kind from public.conversations c where c.id = p_conv;
	perform public.expire_calls(p_conv);
	select * into v_live from public.call_sessions s where s.conversation_id = p_conv and s.status in ('ringing', 'active');
	if found then
		insert into public.call_participants (call_id, user_id, state, joined_at, last_ping_at)
		values (v_live.id, v_me, 'joined', now(), now())
		on conflict on constraint call_participants_pkey do update set state = 'joined', joined_at = now(), left_at = null, last_ping_at = now();
		if v_live.status = 'ringing' and v_live.started_by <> v_me then
			update public.call_sessions set status = 'active', answered_at = now() where id = v_live.id;
		end if;
		return query select v_live.id, v_live.room_name, 'active'::text, false, v_kind;
		return;
	end if;
	if not public.rate_limit('start_call', 12, 600) then raise exception 'Too many calls. Wait a few minutes.'; end if;
	insert into public.call_sessions (id, conversation_id, kind, media, started_by, status, room_name)
	values (v_id, p_conv, v_kind, 'audio', v_me, 'ringing', 'silo-call-' || v_id::text);
	insert into public.call_participants (call_id, user_id, state, joined_at, last_ping_at) values (v_id, v_me, 'joined', now(), now());
	insert into public.call_participants (call_id, user_id)
	select v_id, p.user_id from public.conversation_participants p where p.conversation_id = p_conv and p.user_id <> v_me;
	return query select v_id, 'silo-call-' || v_id::text, 'ringing'::text, true, v_kind;
end $$;

/** Answer a ringing call, or (group) join a running one. */
create function public.join_call(p_call uuid) returns table (call_id uuid, room_name text, status text, kind text)
language plpgsql security definer set search_path = '' as $$
declare
	v_me uuid := public.require_active();
	v_call public.call_sessions;
begin
	select * into v_call from public.call_sessions s where s.id = p_call for update;
	if not found or not public.is_member(v_call.conversation_id) then raise exception 'Call not found'; end if;
	if not public.can_post(v_call.conversation_id) then raise exception 'You can’t join this call'; end if;
	if v_call.status not in ('ringing', 'active') then raise exception 'This call has ended'; end if;
	if v_call.kind = 'direct' and not exists (select 1 from public.call_participants cp where cp.call_id = p_call and cp.user_id = v_me) then
		raise exception 'Call not found';
	end if;
	insert into public.call_participants (call_id, user_id, state, joined_at, last_ping_at)
	values (p_call, v_me, 'joined', now(), now())
	on conflict on constraint call_participants_pkey do update set state = 'joined', joined_at = now(), left_at = null, last_ping_at = now();
	if v_call.status = 'ringing' then
		update public.call_sessions set status = 'active', answered_at = now() where id = p_call;
	end if;
	return query select v_call.id, v_call.room_name, 'active'::text, v_call.kind;
end $$;

create function public.decline_call(p_call uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
	v_me uuid := auth.uid();
	v_call public.call_sessions;
begin
	select * into v_call from public.call_sessions s where s.id = p_call for update;
	if not found or not public.is_member(v_call.conversation_id) then raise exception 'Call not found'; end if;
	update public.call_participants set state = 'declined' where call_id = p_call and user_id = v_me and state = 'invited';
	if v_call.status = 'ringing' and not exists (
		select 1 from public.call_participants cp where cp.call_id = p_call and cp.state = 'invited') and not exists (
		select 1 from public.call_participants cp where cp.call_id = p_call and cp.state = 'joined' and cp.user_id <> v_call.started_by) then
		perform public.finish_call(p_call, 'declined');
	end if;
end $$;

/** Hang up. A direct call ends for both; a group call ends when the last person leaves. */
create function public.leave_call(p_call uuid) returns table (call_id uuid, conversation_id uuid, user_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
	v_me uuid := auth.uid();
	v_call public.call_sessions;
	v_joined integer;
begin
	select * into v_call from public.call_sessions s where s.id = p_call for update;
	if not found or not public.is_member(v_call.conversation_id) then raise exception 'Call not found'; end if;
	if v_call.status not in ('ringing', 'active') then return; end if;
	update public.call_participants cp set state = 'left', left_at = now() where cp.call_id = p_call and cp.user_id = v_me and cp.state = 'joined';
	select count(*) into v_joined from public.call_participants cp where cp.call_id = p_call and cp.state = 'joined';
	if v_call.status = 'ringing' and v_call.started_by = v_me and v_joined = 0 then
		-- caller hung up before anyone answered: the others missed it
		return query select cp.call_id, v_call.conversation_id, cp.user_id from public.call_participants cp where cp.call_id = p_call and cp.state = 'invited';
		perform public.finish_call(p_call, 'missed');
	elsif v_call.kind = 'direct' or v_joined = 0 then
		perform public.finish_call(p_call, case when v_call.answered_at is null then 'cancelled' else 'ended' end);
	end if;
end $$;

/** Keep-alive from a device that is in the call (every ~20 s). Returns the call status.
    (The server runs expire_calls right after, which is what turns silence/no-answer into left/missed.) */
create function public.call_ping(p_call uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare v_status text;
begin
	update public.call_participants set last_ping_at = now() where call_id = p_call and user_id = auth.uid() and state = 'joined';
	select s.status into v_status from public.call_sessions s where s.id = p_call and public.is_member(s.conversation_id);
	return v_status;
end $$;

/** For the token endpoint: the room the caller may enter, only while they are joined to a live call. */
create function public.call_access(p_call uuid) returns table (room_name text, media text, kind text, conversation_id uuid)
language sql stable security definer set search_path = '' as $$
	select s.room_name, s.media, s.kind, s.conversation_id
	from public.call_sessions s
	join public.call_participants cp on cp.call_id = s.id and cp.user_id = auth.uid() and cp.state = 'joined'
	where s.id = p_call and s.status in ('ringing', 'active')
	  and public.is_member(s.conversation_id) and public.is_active_user()
$$;

-- ===================================================================
-- Admin
-- ===================================================================

create function public.admin_set_user_status(p_user uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
	if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
	if p_status not in ('active', 'suspended') then raise exception 'Unknown status'; end if;
	if p_user = auth.uid() then raise exception 'You can’t change your own status'; end if;
	update public.profiles set status = p_status where id = p_user;
end $$;

create function public.admin_resolve_report(p_report uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
	if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
	if p_status not in ('actioned', 'dismissed', 'open') then raise exception 'Unknown status'; end if;
	update public.user_reports set status = p_status, reviewed_by = auth.uid(), reviewed_at = now() where id = p_report;
end $$;
