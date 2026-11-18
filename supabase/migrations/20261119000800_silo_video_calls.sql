-- Silo 8: video calls.
-- call_sessions.media ('audio' | 'video', reserved since migration 1) now records how a call was started, so
-- ringing screens, notifications and the chat log can say "video call". Any call can turn cameras on or off
-- later; that needs no database change (LiveKit tokens allow camera + microphone).

drop function public.start_call(uuid);

/** Start a voice or video call in a chat (or join the one already running there). The caller is in it straight away. */
create function public.start_call(p_conv uuid, p_media text default 'audio')
returns table (call_id uuid, room_name text, status text, created boolean, kind text, media text)
language plpgsql security definer set search_path = '' as $$
declare
	v_me uuid := public.require_active();
	v_kind text;
	v_live public.call_sessions;
	v_id uuid := gen_random_uuid();
begin
	if p_media not in ('audio', 'video') then raise exception 'Unknown call type'; end if;
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
		return query select v_live.id, v_live.room_name, 'active'::text, false, v_kind, v_live.media;
		return;
	end if;
	if not public.rate_limit('start_call', 12, 600) then raise exception 'Too many calls. Wait a few minutes.'; end if;
	insert into public.call_sessions (id, conversation_id, kind, media, started_by, status, room_name)
	values (v_id, p_conv, v_kind, p_media, v_me, 'ringing', 'silo-call-' || v_id::text);
	insert into public.call_participants (call_id, user_id, state, joined_at, last_ping_at) values (v_id, v_me, 'joined', now(), now());
	insert into public.call_participants (call_id, user_id)
	select v_id, p.user_id from public.conversation_participants p where p.conversation_id = p_conv and p.user_id <> v_me;
	return query select v_id, 'silo-call-' || v_id::text, 'ringing'::text, true, v_kind, p_media;
end $$;

revoke execute on function public.start_call(uuid, text) from public, anon;
grant execute on function public.start_call(uuid, text) to authenticated;

/** Close a call: set its final status, settle participants, and log it in the chat ("Video call · 3:12"). */
create or replace function public.finish_call(p_call uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
declare
	v_call public.call_sessions;
	v_secs integer;
	v_what text;
	v_body text;
begin
	update public.call_sessions set status = p_status, ended_at = now()
	where id = p_call and status in ('ringing', 'active')
	returning * into v_call;
	if not found then return; end if;
	update public.call_participants set state = 'left', left_at = now() where call_id = p_call and state = 'joined';
	update public.call_participants set state = 'missed' where call_id = p_call and state = 'invited';
	v_secs := case when v_call.answered_at is null then 0 else greatest(0, extract(epoch from (now() - v_call.answered_at))::int) end;
	v_what := case when v_call.media = 'video' then 'video call' else 'voice call' end;
	v_body := case p_status
		when 'ended' then initcap(left(v_what, 1)) || substr(v_what, 2) || ' · ' || (v_secs / 60) || ':' || lpad((v_secs % 60)::text, 2, '0')
		when 'missed' then 'Missed ' || v_what
		when 'declined' then 'Declined ' || v_what
		else 'Cancelled ' || v_what end;
	insert into public.messages (conversation_id, sender_id, kind, body, meta)
	values (v_call.conversation_id, v_call.started_by, 'call', v_body,
	        jsonb_build_object('call_id', p_call, 'status', p_status, 'seconds', v_secs, 'media', v_call.media));
end $$;

revoke execute on function public.finish_call(uuid, text) from public, anon, authenticated;
