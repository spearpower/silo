// Database types for supabase-js, matching supabase/migrations.
// Written in the shape `supabase gen types typescript` produces; regenerate once the Supabase project exists:
//   npx supabase gen types typescript --project-id <project-ref> --schema public > lib/database.types.ts
// (then re-export the helper aliases at the bottom).

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = { Row: Row; Insert: Insert; Update: Update; Relationships: [] };

export type ProfileRow = {
	id: string; username: string; display_name: string; avatar_url: string | null; bio: string;
	role: 'member' | 'admin'; status: 'active' | 'suspended'; created_at: string; updated_at: string;
}
export type SettingsRow = {
	user_id: string; show_online: boolean; show_last_seen: boolean; read_receipts: boolean; push_previews: boolean;
	allow_messages_from: 'friends' | 'everyone'; updated_at: string;
}
export type FriendshipRow = { id: string; requester_id: string; addressee_id: string; status: 'pending' | 'accepted'; created_at: string; responded_at: string | null }
export type ConversationRow = {
	id: string; kind: 'direct' | 'group'; title: string | null; photo_url: string | null; direct_key: string | null;
	created_by: string | null; created_at: string; updated_at: string; last_message_at: string | null;
}
export type ParticipantRow = {
	conversation_id: string; user_id: string; role: 'owner' | 'admin' | 'member'; joined_at: string;
	last_delivered_at: string | null; receipt_read_at: string | null; muted_until: string | null;
}
export type MessageRow = {
	id: string; conversation_id: string; sender_id: string | null; kind: 'text' | 'system' | 'call'; body: string;
	client_id: string | null; meta: Json | null; created_at: string;
}
export type ReportRow = {
	id: string; reporter_id: string | null; reported_id: string; conversation_id: string | null; message_id: string | null;
	reason: string; status: 'open' | 'actioned' | 'dismissed'; created_at: string; reviewed_by: string | null; reviewed_at: string | null;
}
export type CallStatus = 'ringing' | 'active' | 'ended' | 'missed' | 'declined' | 'cancelled';
export type CallRow = {
	id: string; conversation_id: string; kind: 'direct' | 'group'; media: 'audio' | 'video'; started_by: string | null;
	status: CallStatus; room_name: string; created_at: string; answered_at: string | null; ended_at: string | null;
}
export type CallParticipantRow = {
	call_id: string; user_id: string; state: 'invited' | 'joined' | 'left' | 'declined' | 'missed';
	invited_at: string; joined_at: string | null; left_at: string | null; last_ping_at: string | null;
}
export type PushSubscriptionRow = {
	id: string; user_id: string; endpoint: string; p256dh: string; auth: string; user_agent: string | null; created_at: string; last_used_at: string | null;
}
export type ConversationListRow = {
	id: string; kind: 'direct' | 'group'; title: string | null; photo_url: string | null; created_at: string; last_message_at: string | null;
	my_role: 'owner' | 'admin' | 'member'; muted_until: string | null; member_count: number;
	other_id: string | null; other_username: string | null; other_display_name: string | null; other_avatar_url: string | null;
	last_message_id: string | null; last_body: string | null; last_kind: MessageRow['kind'] | null; last_sender_id: string | null;
	last_sender_name: string | null; last_created_at: string | null; unread: number;
}
export type PersonSearchRow = { id: string; username: string; display_name: string; avatar_url: string | null; relation: 'friend' | 'incoming' | 'outgoing' | 'none' | 'blocked' }
export type MissedRow = { call_id: string; conversation_id: string; user_id: string }

type Fn<Args, Returns> = { Args: Args; Returns: Returns };

export type Database = {
	public: {
		Tables: {
			profiles: Table<ProfileRow, Pick<ProfileRow, 'id' | 'username' | 'display_name'> & Partial<ProfileRow>>;
			user_presence: Table<{ user_id: string; last_seen_at: string }>;
			user_settings: Table<SettingsRow>;
			friendships: Table<FriendshipRow>;
			user_blocks: Table<{ blocker_id: string; blocked_id: string; created_at: string }>;
			conversations: Table<ConversationRow>;
			conversation_participants: Table<ParticipantRow>;
			conversation_reads: Table<{ conversation_id: string; user_id: string; last_read_at: string }>;
			messages: Table<MessageRow, Pick<MessageRow, 'conversation_id' | 'body'> & Partial<MessageRow>>;
			user_reports: Table<ReportRow>;
			call_sessions: Table<CallRow>;
			call_participants: Table<CallParticipantRow>;
			push_subscriptions: Table<PushSubscriptionRow, Pick<PushSubscriptionRow, 'user_id' | 'endpoint' | 'p256dh' | 'auth'> & Partial<PushSubscriptionRow>>;
		};
		Views: { [_ in never]: never };
		Functions: {
			username_available: Fn<{ p_username: string }, boolean>;
			rate_limit: Fn<{ p_action: string; p_max: number; p_window_seconds: number }, boolean>;
			heartbeat: Fn<Record<PropertyKey, never>, undefined>;
			mark_read: Fn<{ p_conv: string }, undefined>;
			friend_request: Fn<{ p_user: string }, string>;
			accept_friend: Fn<{ p_user: string }, undefined>;
			remove_friend: Fn<{ p_user: string }, undefined>;
			block_user: Fn<{ p_user: string }, undefined>;
			unblock_user: Fn<{ p_user: string }, undefined>;
			report_user: Fn<{ p_user: string; p_reason: string; p_conversation?: string | null; p_message?: string | null }, string>;
			start_direct: Fn<{ p_user: string }, string>;
			create_group: Fn<{ p_title: string; p_members: string[] }, string>;
			add_group_members: Fn<{ p_conv: string; p_members: string[] }, number>;
			remove_group_member: Fn<{ p_conv: string; p_user: string }, undefined>;
			set_member_role: Fn<{ p_conv: string; p_user: string; p_role: 'admin' | 'member' }, undefined>;
			update_group: Fn<{ p_conv: string; p_title: string; p_photo_url: string | null }, undefined>;
			leave_group: Fn<{ p_conv: string }, undefined>;
			send_message: Fn<{ p_conv: string; p_body: string; p_client_id?: string | null }, MessageRow>;
			my_conversations: Fn<Record<PropertyKey, never>, ConversationListRow[]>;
			search_people: Fn<{ p_query: string }, PersonSearchRow[]>;
			start_call: Fn<{ p_conv: string }, { call_id: string; room_name: string; status: string; created: boolean; kind: 'direct' | 'group' }[]>;
			join_call: Fn<{ p_call: string }, { call_id: string; room_name: string; status: string; kind: 'direct' | 'group' }[]>;
			decline_call: Fn<{ p_call: string }, undefined>;
			leave_call: Fn<{ p_call: string }, MissedRow[]>;
			call_ping: Fn<{ p_call: string }, string | null>;
			call_access: Fn<{ p_call: string }, { room_name: string; media: 'audio' | 'video'; kind: 'direct' | 'group'; conversation_id: string }[]>;
			expire_calls: Fn<{ p_conv?: string | null }, MissedRow[]>;
			admin_set_user_status: Fn<{ p_user: string; p_status: 'active' | 'suspended' }, undefined>;
			admin_resolve_report: Fn<{ p_report: string; p_status: 'actioned' | 'dismissed' | 'open' }, undefined>;
		};
		Enums: { [_ in never]: never };
		CompositeTypes: { [_ in never]: never };
	};
}
