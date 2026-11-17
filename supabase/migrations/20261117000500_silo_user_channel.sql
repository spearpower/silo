-- Silo 5: per-user private Realtime channel for database changes.
-- With Realtime "Allow public access" switched off, every channel must be private, including the one that
-- carries postgres_changes (new messages, call updates). Each person may join only 'user:<their own id>'.
-- Row-level filtering of the changes themselves is unchanged (RLS SELECT policies on each table).

drop policy if exists silo_channels_receive on realtime.messages;
drop policy if exists silo_channels_send on realtime.messages;

create policy silo_channels_receive on realtime.messages for select to authenticated
	using (
		(realtime.topic() = 'online' and public.is_active_user())
		or realtime.topic() = 'user:' || auth.uid()::text
		or public.is_member(public.topic_uuid(realtime.topic(), 'conv:'))
	);

-- Sending (broadcast/presence) stays limited to the shared channels; nobody sends on a user channel.
create policy silo_channels_send on realtime.messages for insert to authenticated
	with check (
		(realtime.topic() = 'online' and public.is_active_user())
		or (public.is_active_user() and public.is_member(public.topic_uuid(realtime.topic(), 'conv:')))
	);
