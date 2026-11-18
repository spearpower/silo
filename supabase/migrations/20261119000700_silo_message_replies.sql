-- Silo 7: reply to a message (swipe to reply).
-- messages.reply_to_id points at an earlier message in the SAME conversation. Anything else is dropped to null
-- by the insert trigger, so a reply can never reveal a message from another chat.

alter table public.messages add column reply_to_id uuid references public.messages (id) on delete set null;
create index messages_reply_to_idx on public.messages (reply_to_id) where reply_to_id is not null;

grant insert (reply_to_id) on public.messages to authenticated;

create or replace function public.force_message_defaults() returns trigger
language plpgsql set search_path = '' as $$
begin
	new.created_at := clock_timestamp(); -- server time; clock_timestamp keeps order inside one transaction
	new.body := btrim(new.body);
	-- runs as the sender, so RLS also means they can only quote a message they can see
	if new.reply_to_id is not null and not exists (
		select 1 from public.messages m where m.id = new.reply_to_id and m.conversation_id = new.conversation_id) then
		new.reply_to_id := null;
	end if;
	return new;
end $$;

drop function public.send_message(uuid, text, uuid);

/** Send a text message (RLS applies: security invoker). Retries with the same client_id return the original. */
create function public.send_message(p_conv uuid, p_body text, p_client_id uuid default null, p_reply_to uuid default null)
returns public.messages
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
	insert into public.messages (conversation_id, sender_id, body, client_id, reply_to_id) -- kind defaults to 'text'
	values (p_conv, auth.uid(), p_body, p_client_id, p_reply_to)
	returning * into v_row;
	return v_row;
end $$;

revoke execute on function public.send_message(uuid, text, uuid, uuid) from public, anon;
grant execute on function public.send_message(uuid, text, uuid, uuid) to authenticated;
