-- Silo 3/4: privileges and Row Level Security.
-- Supabase grants ALL on new public tables/functions to anon and authenticated by default. We take that back
-- and grant only what the app needs: browsers read through RLS; every write goes through a narrow
-- column grant + policy, or through a security-definer RPC that checks the caller.

-- ---------- privileges ----------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant select on public.profiles, public.user_presence, public.user_settings, public.friendships, public.user_blocks,
	public.conversations, public.conversation_participants, public.conversation_reads, public.messages,
	public.user_reports, public.call_sessions, public.call_participants, public.push_subscriptions
	to authenticated;

grant update (username, display_name, avatar_url, bio) on public.profiles to authenticated;
grant update (show_online, show_last_seen, read_receipts, push_previews, allow_messages_from) on public.user_settings to authenticated;
grant update (muted_until) on public.conversation_participants to authenticated;
grant insert (conversation_id, sender_id, body, client_id) on public.messages to authenticated;
grant insert (user_id, endpoint, p256dh, auth, user_agent), delete on public.push_subscriptions to authenticated;

-- RPCs the app may call as the signed-in person
grant execute on function
	public.is_active_user(), public.is_admin(), public.is_member(uuid), public.member_since(uuid), public.member_role(uuid),
	public.is_blocked_pair(uuid, uuid), public.are_friends(uuid, uuid), public.has_blocked_me(uuid), public.can_post(uuid),
	public.can_see_presence(uuid), public.require_active(), public.rate_limit(text, integer, integer),
	public.username_available(text), public.heartbeat(), public.mark_read(uuid),
	public.friend_request(uuid), public.accept_friend(uuid), public.remove_friend(uuid),
	public.block_user(uuid), public.unblock_user(uuid), public.report_user(uuid, text, uuid, uuid),
	public.start_direct(uuid), public.create_group(text, uuid[]), public.add_group_members(uuid, uuid[]),
	public.remove_group_member(uuid, uuid), public.set_member_role(uuid, uuid, text), public.update_group(uuid, text, text),
	public.leave_group(uuid), public.send_message(uuid, text, uuid), public.my_conversations(), public.search_people(text),
	public.start_call(uuid), public.join_call(uuid), public.decline_call(uuid), public.leave_call(uuid),
	public.call_ping(uuid), public.call_access(uuid),
	public.admin_set_user_status(uuid, text), public.admin_resolve_report(uuid, text)
	to authenticated;
grant execute on function public.username_available(text) to anon;
-- server only (service role): expire_calls, finish_call, system_message, handle_new_user, trigger functions

-- ---------- RLS ----------
alter table public.profiles                  enable row level security;
alter table public.user_presence             enable row level security;
alter table public.user_settings             enable row level security;
alter table public.friendships               enable row level security;
alter table public.user_blocks               enable row level security;
alter table public.conversations             enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.conversation_reads        enable row level security;
alter table public.messages                  enable row level security;
alter table public.user_reports              enable row level security;
alter table public.call_sessions             enable row level security;
alter table public.call_participants         enable row level security;
alter table public.push_subscriptions        enable row level security;
alter table public.rate_limits               enable row level security; -- no policies: nobody but the service role

-- People: signed-in people can see basic profiles (name, username, picture, bio) so names stay readable in
-- existing chats. Blocking is enforced where it matters: no messages or calls either way (can_post), and
-- people who blocked you never appear in your search (search_people).
create policy profiles_select on public.profiles for select to authenticated using (true);
create policy profiles_update_own on public.profiles for update to authenticated
	using (id = auth.uid()) with check (id = auth.uid() and public.is_active_user());

create policy presence_select on public.user_presence for select to authenticated
	using (public.can_see_presence(user_id));

create policy settings_select_own on public.user_settings for select to authenticated using (user_id = auth.uid());
create policy settings_update_own on public.user_settings for update to authenticated
	using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy friendships_select_own on public.friendships for select to authenticated
	using (requester_id = auth.uid() or addressee_id = auth.uid());

create policy blocks_select_own on public.user_blocks for select to authenticated using (blocker_id = auth.uid());

-- Conversations: members only.
create policy conversations_select_member on public.conversations for select to authenticated
	using (public.is_member(id));

create policy participants_select_member on public.conversation_participants for select to authenticated
	using (public.is_member(conversation_id));
create policy participants_update_own on public.conversation_participants for update to authenticated
	using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy reads_select_own on public.conversation_reads for select to authenticated using (user_id = auth.uid());

-- Messages: members read what was sent since they joined; they post only as themselves.
create policy messages_select_member on public.messages for select to authenticated
	using (public.is_member(conversation_id) and created_at >= public.member_since(conversation_id));
create policy messages_insert_self on public.messages for insert to authenticated
	with check (sender_id = auth.uid() and kind = 'text' and public.can_post(conversation_id));

create policy reports_select on public.user_reports for select to authenticated
	using (reporter_id = auth.uid() or public.is_admin());

-- Calls: members of the conversation only.
create policy calls_select_member on public.call_sessions for select to authenticated
	using (public.is_member(conversation_id));
create policy call_participants_select_member on public.call_participants for select to authenticated
	using (exists (select 1 from public.call_sessions s where s.id = call_id and public.is_member(s.conversation_id)));

-- Push subscriptions: strictly your own.
create policy push_select_own on public.push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy push_insert_own on public.push_subscriptions for insert to authenticated with check (user_id = auth.uid());
create policy push_delete_own on public.push_subscriptions for delete to authenticated using (user_id = auth.uid());
