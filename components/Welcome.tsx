import Icon from './Icon';

/** Right-hand pane on desktop when no chat is open. (Phones show the list instead.) */
export default function Welcome({ kind }: { kind: 'direct' | 'group' }) {
	return (
		<div className="empty" style={{ height: '100%' }}>
			<div className="art"><Icon name={kind === 'group' ? 'groups' : 'chats'} /></div>
			<h2>{kind === 'group' ? 'Your groups' : 'Your private space'}</h2>
			<p>{kind === 'group'
				? 'Pick a group to catch up, or start a voice call with everyone in it.'
				: 'Choose a chat to continue. Only the people in a conversation can read it.'}</p>
			<p className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Icon name="lock" className="icon sm" /> Private by design</p>
		</div>
	);
}
