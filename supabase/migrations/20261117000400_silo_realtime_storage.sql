-- Silo 4/4: Realtime and Storage.

-- ---------- Realtime: database changes ----------
-- postgres_changes events are filtered by each subscriber's RLS SELECT policies.
-- (conversation_participants and friendships are deliberately NOT published: Realtime can't apply RLS to
--  DELETE events, which would reveal who left which group to other subscribers. Clients refetch those.)
alter publication supabase_realtime add table public.messages, public.call_sessions, public.call_participants;

-- ---------- Realtime: private broadcast/presence channels ----------
-- Topics:  'conv:<conversation uuid>'  typing + read-receipt pings, members only
--          'online'                    who's online (people who switched "show online" off don't join it)
create function public.topic_uuid(p_topic text, p_prefix text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
	if left(p_topic, length(p_prefix)) <> p_prefix then return null; end if;
	return substr(p_topic, length(p_prefix) + 1)::uuid;
exception when others then
	return null;
end $$;
grant execute on function public.topic_uuid(text, text) to authenticated;

create policy silo_channels_receive on realtime.messages for select to authenticated
	using (
		(realtime.topic() = 'online' and public.is_active_user())
		or public.is_member(public.topic_uuid(realtime.topic(), 'conv:'))
	);

create policy silo_channels_send on realtime.messages for insert to authenticated
	with check (
		(realtime.topic() = 'online' and public.is_active_user())
		or (public.is_active_user() and public.is_member(public.topic_uuid(realtime.topic(), 'conv:')))
	);

-- ---------- Storage: profile pictures and group pictures ----------
-- Public-read buckets (pictures are shown to other signed-in people anyway; object names are random).
-- Only the owner can write their own folder; only group owners/admins can write a group's folder.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp']),
       ('group-photos', 'group-photos', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

create policy avatars_insert_own on storage.objects for insert to authenticated
	with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_update_own on storage.objects for update to authenticated
	using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy avatars_delete_own on storage.objects for delete to authenticated
	using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy group_photos_insert_admin on storage.objects for insert to authenticated
	with check (bucket_id = 'group-photos'
		and public.member_role(public.topic_uuid((storage.foldername(name))[1], '')) in ('owner', 'admin'));
create policy group_photos_update_admin on storage.objects for update to authenticated
	using (bucket_id = 'group-photos'
		and public.member_role(public.topic_uuid((storage.foldername(name))[1], '')) in ('owner', 'admin'));
create policy group_photos_delete_admin on storage.objects for delete to authenticated
	using (bucket_id = 'group-photos'
		and public.member_role(public.topic_uuid((storage.foldername(name))[1], '')) in ('owner', 'admin'));
