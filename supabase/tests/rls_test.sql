-- Silo RLS / authorisation tests.
-- Runs on a LOCAL database prepared with supabase/local/supabase_shim.sql + supabase/migrations/*.sql
-- (the shim provides auth.uid() from request.jwt.claims, exactly like Supabase/PostgREST).
-- Everything happens inside one transaction that is rolled back: no test data is left behind.
--   psql -d silo -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql
-- Any failed check raises an exception and stops the run; a clean run ends with "ALL RLS TESTS PASSED".

\set QUIET on
begin;

create schema silo_test;
grant usage on schema silo_test to authenticated, anon;

create table silo_test.ids (name text primary key, id uuid);
grant select on silo_test.ids to authenticated, anon;

create function silo_test.uid(p_name text) returns uuid language sql stable as $$ select id from silo_test.ids where name = p_name $$;
grant execute on function silo_test.uid(text) to authenticated, anon;

create function silo_test.login(p_name text) returns void language plpgsql as $$
begin
	execute 'reset role';
	perform set_config('request.jwt.claims', json_build_object('sub', silo_test.uid(p_name), 'role', 'authenticated')::text, true);
	execute 'set local role authenticated';
end $$;
create function silo_test.anon() returns void language plpgsql as $$
begin
	execute 'reset role';
	perform set_config('request.jwt.claims', '{"role":"anon"}', true);
	execute 'set local role anon';
end $$;
grant execute on function silo_test.login(text), silo_test.anon() to authenticated, anon;

create function silo_test.ok(p_cond boolean, p_name text) returns void language plpgsql as $$
begin
	if p_cond is distinct from true then raise exception 'FAILED: %', p_name; end if;
	raise notice 'ok  %', p_name;
end $$;

create function silo_test.fails(p_sql text, p_name text) returns void language plpgsql as $$
begin
	begin
		execute p_sql;
	exception when others then
		raise notice 'ok  % (refused: %)', p_name, sqlerrm;
		return;
	end;
	raise exception 'FAILED (was allowed): %', p_name;
end $$;

create function silo_test.count(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
	execute 'select count(*) from (' || p_sql || ') q' into n;
	return n;
end $$;
grant execute on all functions in schema silo_test to authenticated, anon;

\set QUIET off
\echo '--- sign-up trigger'
insert into auth.users (email, raw_user_meta_data) values
	('alice@test.local', '{"username":"alice","display_name":"Alice"}'),
	('bob@test.local',   '{"username":"bob","display_name":"Bob"}'),
	('carol@test.local', '{"username":"carol","display_name":"Carol"}'),
	('dave@test.local',  '{"username":"dave","display_name":"Dave"}'),
	('odd@test.local',   '{"username":"Not Valid!"}');
insert into silo_test.ids select p.username, p.id from public.profiles p;
insert into silo_test.ids select 'odd', id from auth.users where email = 'odd@test.local';
select silo_test.ok((select count(*) from public.profiles) = 5, 'every auth user gets a profile');
select silo_test.ok((select count(*) from public.user_settings) = 5 and (select count(*) from public.user_presence) = 5, 'settings + presence rows created');
select silo_test.ok((select username from public.profiles where id = silo_test.uid('odd')) like 'user\_%', 'invalid username falls back to user_xxx');
select silo_test.ok((select push_previews from public.user_settings where user_id = silo_test.uid('alice')) = false, 'message previews in notifications are off by default');

\echo '--- anonymous visitors'
select silo_test.anon();
select silo_test.ok(public.username_available('newname') and not public.username_available('alice'), 'anon can check a username');
select silo_test.fails('select * from public.profiles', 'anon cannot read profiles');
select silo_test.fails('select * from public.messages', 'anon cannot read messages');
select silo_test.fails('select public.start_direct(silo_test.uid(''bob''))', 'anon cannot call chat RPCs');

\echo '--- friends'
select silo_test.login('alice');
select silo_test.ok(public.friend_request(silo_test.uid('bob')) = 'requested', 'alice asks bob');
select silo_test.ok(public.friend_request(silo_test.uid('dave')) = 'requested', 'alice asks dave');
select silo_test.fails('insert into public.friendships (requester_id, addressee_id, status) values (silo_test.uid(''carol''), silo_test.uid(''bob''), ''accepted'')', 'nobody can write friendships directly');
select silo_test.login('bob');
select public.accept_friend(silo_test.uid('alice'));
select silo_test.login('dave');
select silo_test.ok(public.friend_request(silo_test.uid('alice')) = 'friends', 'a request back accepts the pending one');
select silo_test.login('carol');
select silo_test.ok(silo_test.count('select * from public.friendships') = 0, 'carol sees none of the others'' friendships');
select silo_test.fails('select public.accept_friend(silo_test.uid(''alice''))', 'carol cannot accept a request that is not to her');

\echo '--- direct chats'
select silo_test.login('alice');
create temp table t (k text primary key, id uuid);
grant all on t to authenticated;
insert into t values ('ab', public.start_direct(silo_test.uid('bob')));
select silo_test.ok(public.start_direct(silo_test.uid('bob')) = (select id from t where k = 'ab'), 'one chat per pair');
select silo_test.fails('select public.start_direct(silo_test.uid(''carol''))', 'carol (default: friends only) cannot be messaged by a stranger');
select (public.send_message((select id from t where k = 'ab'), 'hello bob', '00000000-0000-0000-0000-000000000001')).id is not null;
select silo_test.ok((public.send_message((select id from t where k = 'ab'), 'hello bob', '00000000-0000-0000-0000-000000000001')).body = 'hello bob'
	and silo_test.count('select * from public.messages') = 1, 'a retried send (same client_id) is not duplicated');
select silo_test.fails('insert into public.messages (conversation_id, sender_id, body) values ((select id from t where k = ''ab''), silo_test.uid(''bob''), ''spoof'')', 'alice cannot post as bob');
select silo_test.fails('insert into public.messages (conversation_id, sender_id, body, kind) values ((select id from t where k = ''ab''), silo_test.uid(''alice''), ''x'', ''system'')', 'alice cannot post system messages');
select silo_test.fails('insert into public.messages (conversation_id, sender_id, body, created_at) values ((select id from t where k = ''ab''), silo_test.uid(''alice''), ''x'', now() - interval ''1 year'')', 'alice cannot backdate a message');
select silo_test.fails('update public.messages set body = ''edited''', 'messages cannot be edited directly');
select silo_test.fails('delete from public.messages', 'messages cannot be deleted directly');

select silo_test.login('bob');
select silo_test.ok(silo_test.count('select * from public.messages') = 1, 'bob reads the message');
select silo_test.ok((select unread from public.my_conversations() where id = (select id from t where k = 'ab')) = 1, 'bob has 1 unread');
select public.mark_read((select id from t where k = 'ab'));
select silo_test.ok((select unread from public.my_conversations() where id = (select id from t where k = 'ab')) = 0, 'mark_read clears unread');
select silo_test.ok((select receipt_read_at from public.conversation_participants where user_id = silo_test.uid('bob') and conversation_id = (select id from t where k = 'ab')) is not null, 'read receipt shared');

select silo_test.login('carol');
select silo_test.ok(silo_test.count('select * from public.messages') = 0, 'carol cannot read alice<->bob messages');
select silo_test.ok(silo_test.count('select * from public.conversations') = 0, 'carol cannot see the conversation');
select silo_test.ok(silo_test.count('select * from public.conversation_participants') = 0, 'carol cannot see who is in it');
select silo_test.fails('select public.send_message((select id from t where k = ''ab''), ''intrude'')', 'carol cannot send into it (RPC)');
select silo_test.fails('insert into public.messages (conversation_id, sender_id, body) values ((select id from t where k = ''ab''), silo_test.uid(''carol''), ''intrude'')', 'carol cannot send into it (insert)');
select silo_test.fails('insert into public.conversation_participants (conversation_id, user_id) values ((select id from t where k = ''ab''), silo_test.uid(''carol''))', 'carol cannot add herself to it');
select silo_test.ok(silo_test.count('select * from public.conversation_reads') = 0, 'carol cannot see read markers');

\echo '--- privacy setting: messages from everyone'
update public.user_settings set allow_messages_from = 'everyone' where user_id = silo_test.uid('carol');
select silo_test.login('alice');
insert into t values ('ac', public.start_direct(silo_test.uid('carol')));
select silo_test.ok((select id from t where k = 'ac') is not null, 'after carol opens up, alice can message her');
update public.user_settings set allow_messages_from = 'friends' where user_id = silo_test.uid('carol');
reset role;
select silo_test.ok((select allow_messages_from from public.user_settings where user_id = silo_test.uid('carol')) = 'everyone', 'alice''s update of carol''s settings changed nothing');

\echo '--- profiles'
select silo_test.login('alice');
select silo_test.fails('update public.profiles set role = ''admin'' where id = silo_test.uid(''alice'')', 'alice cannot make herself admin');
select silo_test.fails('update public.profiles set status = ''active'' where id = silo_test.uid(''alice'')', 'alice cannot change her own status');
update public.profiles set display_name = 'Hacked' where id = silo_test.uid('bob');
update public.profiles set display_name = 'Alice A.' where id = silo_test.uid('alice');
reset role;
select silo_test.ok((select display_name from public.profiles where id = silo_test.uid('bob')) = 'Bob', 'alice cannot rename bob');
select silo_test.ok((select display_name from public.profiles where id = silo_test.uid('alice')) = 'Alice A.', 'alice can rename herself');

\echo '--- presence privacy'
select silo_test.login('bob');
select silo_test.ok(silo_test.count('select * from public.user_presence where user_id = silo_test.uid(''alice'')') = 1, 'bob (friend) sees alice''s last seen');
select silo_test.login('carol');
select silo_test.ok(silo_test.count('select * from public.user_presence where user_id = silo_test.uid(''dave'')') = 0, 'carol (no relation) cannot see dave''s last seen');
select silo_test.login('alice');
update public.user_settings set show_last_seen = false where user_id = silo_test.uid('alice');
select silo_test.login('bob');
select silo_test.ok(silo_test.count('select * from public.user_presence where user_id = silo_test.uid(''alice'')') = 0, 'hidden last seen is hidden even from friends');

\echo '--- groups'
select silo_test.login('alice');
select silo_test.fails('select public.create_group(''Mixed'', array[silo_test.uid(''bob''), silo_test.uid(''carol'')])', 'only friends can be put in a group');
insert into t values ('g', public.create_group('Weekend', array[silo_test.uid('bob')]));
select public.send_message((select id from t where k = 'g'), 'first group message');
select silo_test.login('bob');
select silo_test.ok(silo_test.count('select * from public.messages where conversation_id = (select id from t where k = ''g'') and kind = ''text''') = 1, 'bob reads the group');
select silo_test.fails('select public.add_group_members((select id from t where k = ''g''), array[silo_test.uid(''alice'')])', 'a plain member cannot add people');
select silo_test.fails('select public.remove_group_member((select id from t where k = ''g''), silo_test.uid(''alice''))', 'a member cannot remove the owner');
select silo_test.fails('select public.update_group((select id from t where k = ''g''), ''Renamed'', null)', 'a member cannot rename the group');
select silo_test.fails('update public.conversation_participants set role = ''owner'' where user_id = silo_test.uid(''bob'')', 'bob cannot promote himself');
select silo_test.login('carol');
select silo_test.ok(silo_test.count('select * from public.messages where conversation_id = (select id from t where k = ''g'')') = 0, 'carol cannot read the group');
select silo_test.fails('select public.join_call(gen_random_uuid())', 'carol cannot join a call she cannot see');

select silo_test.login('alice');
select public.add_group_members((select id from t where k = 'g'), array[silo_test.uid('dave')]);
select silo_test.login('dave');
select silo_test.ok(silo_test.count('select * from public.messages where conversation_id = (select id from t where k = ''g'') and kind = ''text''') = 0, 'a new member does not see messages from before they joined');
select public.send_message((select id from t where k = 'g'), 'hi all');
select silo_test.login('alice');
select public.set_member_role((select id from t where k = 'g'), silo_test.uid('bob'), 'admin');
select silo_test.login('bob');
select silo_test.fails('select public.set_member_role((select id from t where k = ''g''), silo_test.uid(''dave''), ''admin'')', 'only the owner changes roles');
select public.remove_group_member((select id from t where k = 'g'), silo_test.uid('dave'));
select silo_test.login('dave');
select silo_test.ok(silo_test.count('select * from public.messages where conversation_id = (select id from t where k = ''g'')') = 0, 'a removed member loses access');
select silo_test.fails('select public.send_message((select id from t where k = ''g''), ''still here?'')', 'a removed member cannot post');
select silo_test.login('alice');
select public.leave_group((select id from t where k = 'g'));
reset role;
select silo_test.ok((select role from public.conversation_participants where conversation_id = (select id from t where k = 'g') and user_id = silo_test.uid('bob')) = 'owner', 'when the owner leaves, an admin takes over');

\echo '--- voice calls'
select silo_test.login('alice');
insert into t select 'call', call_id from public.start_call((select id from t where k = 'ab'));
select silo_test.ok(silo_test.count('select * from public.call_access((select id from t where k = ''call''))') = 1, 'caller may get a room token');
select silo_test.login('carol');
select silo_test.ok(silo_test.count('select * from public.call_sessions') = 0, 'carol cannot see the call');
select silo_test.ok(silo_test.count('select * from public.call_access((select id from t where k = ''call''))') = 0, 'carol gets no room token');
select silo_test.fails('select public.join_call((select id from t where k = ''call''))', 'carol cannot join the call');
select silo_test.login('bob');
select silo_test.ok(silo_test.count('select * from public.call_access((select id from t where k = ''call''))') = 0, 'bob gets no token before answering');
select public.join_call((select id from t where k = 'call'));
select silo_test.ok(silo_test.count('select * from public.call_access((select id from t where k = ''call''))') = 1, 'bob gets a token after answering');
select silo_test.ok((select status from public.call_sessions where id = (select id from t where k = 'call')) = 'active', 'answered call is active');
select public.leave_call((select id from t where k = 'call'));
select silo_test.ok((select status from public.call_sessions where id = (select id from t where k = 'call')) = 'ended', 'hanging up ends a direct call');
select silo_test.ok(silo_test.count('select * from public.messages where kind = ''call''') = 1, 'the call is logged in the chat');
select silo_test.login('alice');
select silo_test.ok(silo_test.count('select * from public.call_access((select id from t where k = ''call''))') = 0, 'no token for an ended call');

-- unanswered call -> missed after 45 s
select silo_test.login('alice');
insert into t select 'call2', call_id from public.start_call((select id from t where k = 'ab'));
reset role;
update public.call_sessions set created_at = now() - interval '50 seconds' where id = (select id from t where k = 'call2');
select silo_test.ok((select count(*) from public.expire_calls() where user_id = silo_test.uid('bob')) = 1, 'unanswered call: bob is reported as missed');
select silo_test.ok((select status from public.call_sessions where id = (select id from t where k = 'call2')) = 'missed', 'call marked missed');
select silo_test.login('alice');
select silo_test.fails('select * from public.expire_calls()', 'the call sweeper is server-only');

-- declined
insert into t select 'call3', call_id from public.start_call((select id from t where k = 'ab'));
select silo_test.login('bob');
select public.decline_call((select id from t where k = 'call3'));
select silo_test.ok((select status from public.call_sessions where id = (select id from t where k = 'call3')) = 'declined', 'declined call');

\echo '--- blocking'
select silo_test.login('bob');
select public.block_user(silo_test.uid('alice'));
select silo_test.login('alice');
select silo_test.fails('select public.send_message((select id from t where k = ''ab''), ''are you there?'')', 'blocked: alice cannot message bob');
select silo_test.fails('select public.start_call((select id from t where k = ''ab''))', 'blocked: alice cannot call bob');
select silo_test.ok(silo_test.count('select * from public.search_people(''bob'')') = 0, 'blocked: bob is not in alice''s search');
select silo_test.ok(not public.are_friends(silo_test.uid('alice'), silo_test.uid('bob')), 'blocking ends the friendship');
select silo_test.login('bob');
select public.unblock_user(silo_test.uid('alice'));

\echo '--- reports'
select silo_test.login('carol');
select public.report_user(silo_test.uid('alice'), 'spam messages', (select id from t where k = 'ab'), null);
reset role;
select silo_test.ok((select conversation_id from public.user_reports where reporter_id = silo_test.uid('carol')) is null, 'a report cannot point at a chat the reporter is not in');
select silo_test.login('alice');
select silo_test.ok(silo_test.count('select * from public.user_reports') = 0, 'the reported person cannot read reports');
select silo_test.fails('select public.admin_set_user_status(silo_test.uid(''carol''), ''suspended'')', 'non-admins cannot suspend');
reset role;
update public.profiles set role = 'admin' where id = silo_test.uid('dave');
select silo_test.login('dave');
select silo_test.ok(silo_test.count('select * from public.user_reports') = 1, 'admins can read reports');
select public.admin_set_user_status(silo_test.uid('carol'), 'suspended');
select silo_test.login('carol');
select silo_test.fails('select public.send_message((select id from t where k = ''ac''), ''hi'')', 'a suspended account cannot post');
select silo_test.fails('select public.friend_request(silo_test.uid(''bob''))', 'a suspended account cannot add friends');

\echo '--- push subscriptions'
select silo_test.login('alice');
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (silo_test.uid('alice'), 'https://push.example/alice', 'k', 'a');
select silo_test.fails('insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (silo_test.uid(''bob''), ''https://push.example/x'', ''k'', ''a'')', 'alice cannot subscribe bob''s alerts');
select silo_test.login('bob');
select silo_test.ok(silo_test.count('select * from public.push_subscriptions') = 0, 'bob cannot see alice''s subscription');
delete from public.push_subscriptions;
reset role;
select silo_test.ok((select count(*) from public.push_subscriptions) = 1, 'bob cannot delete alice''s subscription');
select silo_test.login('alice');
select silo_test.fails('select * from public.rate_limits', 'rate limit table is server-only');

\echo '--- realtime channels'
select silo_test.login('alice');
select set_config('realtime.topic', 'conv:' || (select id from t where k = 'ab'), true);
insert into realtime.messages (topic, event, payload) values ('conv:' || (select id from t where k = 'ab'), 'typing', '{}');
select silo_test.ok(silo_test.count('select * from realtime.messages') = 1, 'member can use the chat channel');
select silo_test.login('dave');
select silo_test.ok(silo_test.count('select * from realtime.messages') = 0, 'non-member cannot listen on the chat channel');
select silo_test.fails('insert into realtime.messages (topic, event, payload) values (''conv:'' || (select id from t where k = ''ab''), ''typing'', ''{}'')', 'non-member cannot send on the chat channel');
select set_config('realtime.topic', 'conv:not-a-uuid', true);
select silo_test.ok(silo_test.count('select * from realtime.messages') = 0, 'garbage topic is refused, not an error');

\echo '--- storage'
select silo_test.login('alice');
insert into storage.objects (bucket_id, name, owner) values ('avatars', silo_test.uid('alice') || '/me.webp', silo_test.uid('alice'));
select silo_test.fails('insert into storage.objects (bucket_id, name) values (''avatars'', silo_test.uid(''bob'') || ''/me.webp'')', 'alice cannot write bob''s avatar folder');
select silo_test.fails('insert into storage.objects (bucket_id, name) values (''group-photos'', (select id from t where k = ''g'') || ''/p.webp'')', 'alice (left the group) cannot change its picture');
select silo_test.login('bob');
insert into storage.objects (bucket_id, name) values ('group-photos', (select id from t where k = 'g') || '/p.webp');
select silo_test.ok(true, 'group owner can upload the group picture');

reset role;
\echo ''
\echo 'ALL RLS TESTS PASSED'
rollback;
