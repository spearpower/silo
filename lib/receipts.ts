// Delivery / read ticks for a message I sent (pure, unit-tested).
export interface ReceiptMessage { created_at: string; pending?: boolean; failed?: string }
// Timestamps come as '...Z' (device) or '...+00:00' (server): always compare parsed times, never strings.
const t = (iso: string) => Date.parse(iso);

export interface ReceiptMember { id: string; joined_at: string; last_delivered_at: string | null; receipt_read_at: string | null }

/** Delivery/read state of one of my messages, from the other members' shared markers. */
export function receiptOf(m: ReceiptMessage, members: ReceiptMember[] | undefined, meId: string | null): 'pending' | 'failed' | 'sent' | 'delivered' | 'read' {
	if (m.failed) return 'failed';
	if (m.pending) return 'pending';
	const at = t(m.created_at);
	const others = (members || []).filter(x => x.id !== meId && t(x.joined_at) <= at);
	if (!others.length) return 'sent';
	const read = (o: ReceiptMember) => !!o.receipt_read_at && t(o.receipt_read_at) >= at;
	if (others.every(read)) return 'read';
	if (others.every(o => read(o) || (!!o.last_delivered_at && t(o.last_delivered_at) >= at))) return 'delivered';
	return 'sent';
}
