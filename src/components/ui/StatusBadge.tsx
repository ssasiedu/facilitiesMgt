import { Badge, type Tone } from './Badge';
import { humanize } from '@/lib/format';

// Status colours (spec section 6): green completed/paid, blue approved/scheduled, amber pending/due,
// red overdue/off-road/loss, grey draft.
const MAP: Record<string, Tone> = {
  completed: 'green', closed: 'green', paid: 'green', active: 'green', on_road: 'green', approved: 'blue', scheduled: 'blue', in_progress: 'blue',
  quoted: 'blue', sent: 'blue', accepted: 'green', converted: 'green', responded: 'green', done: 'green', won: 'green',
  pending: 'amber', pending_approval: 'amber', due: 'amber', issued: 'amber', partially_paid: 'amber', on_hold: 'amber', on_job: 'blue',
  suspended: 'amber', postponed: 'amber', planned: 'grey', queued: 'amber', sending: 'amber', open: 'amber', negotiation: 'amber',
  estimate_sent: 'blue', site_visit: 'blue', contacted: 'blue', new: 'grey',
  overdue: 'red', off_road: 'red', loss: 'red', rejected: 'red', cancelled: 'red', terminated: 'red', failed: 'red', blacklisted: 'red', lost: 'red', expired: 'red',
  draft: 'grey', void: 'grey', inactive: 'grey', superseded: 'grey', skipped: 'grey', on_leave: 'amber',
};

const LABELS: Record<string, string> = {
  issued: 'Issued – not yet due', on_road: 'On-Road', off_road: 'Off-Road', on_job: 'On Job', void: 'Credited / Void', pending_approval: 'Pending approval',
};

export function StatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  if (!status) return null;
  return <Badge tone={MAP[status] ?? 'grey'} className={className}>{LABELS[status] ?? humanize(status)}</Badge>;
}

export function statusTone(status: string): Tone {
  return MAP[status] ?? 'grey';
}
