import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, ClipboardCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { check, friendlyError, rpc } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { useStaff, toOptions } from '@/lib/lookups';
import { daysFrom, formatDate, formatDateTime, humanize } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import { FilterSelect } from '@/components/ui/DataTable';
import { Tabs } from '@/components/ui/Tabs';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import type { Tables } from '@/types/database';

type FollowUp = Tables<'followup_tasks'> & {
  customer: { id: string; display_name: string | null; customer_code: string | null } | null;
  assignee: { full_name: string } | null;
  resolver: { full_name: string } | null;
};

/** Where a follow-up came from, and where to go to deal with it. */
const SOURCE_LINK: Record<string, (f: FollowUp) => string | null> = {
  survey_response: (f) => f.customer ? `/customers/${f.customer.id}?tab=surveys` : '/surveys',
  low_margin_contract: (f) => f.source_id ? `/contracts/${f.source_id}` : null,
  job_on_hold: (f) => f.source_id ? `/jobs/${f.source_id}` : null,
  overdue_invoice: (f) => f.source_id ? `/invoices/${f.source_id}` : null,
  lost_lead: (f) => f.source_id ? `/leads/${f.source_id}` : null,
  truck_off_road: (f) => f.source_id ? `/fleet/trucks/${f.source_id}` : null,
};

/**
 * Follow-ups raised automatically by the system — a low survey score, a contract month below its
 * margin, a job left on hold — so nothing quietly falls through (spec 4.13).
 */
export default function FollowUpsPage() {
  const qc = useQueryClient();
  const { roles, profile } = useAuth();
  const canResolve = hasAny(roles, 'manager');
  const { data: staff } = useStaff();

  const [tab, setTab] = useState<'open' | 'done'>('open');
  const [source, setSource] = useState('');
  const [assignee, setAssignee] = useState('');
  const [resolving, setResolving] = useState<FollowUp | null>(null);
  const [resolution, setResolution] = useState('');

  const { data = [], isLoading } = useQuery({
    queryKey: ['followups', tab],
    queryFn: async () => check(await supabase.from('followup_tasks')
      .select(`*, customer:customers(id, display_name, customer_code),
               assignee:profiles!followup_tasks_assigned_to_fkey(full_name),
               resolver:profiles!followup_tasks_resolved_by_fkey(full_name)`)
      .in('status', tab === 'open' ? ['open', 'in_progress'] : ['done'])
      .order('due_date')) as FollowUp[],
  });

  const rows = useMemo(() => data.filter((f) =>
    (!source || f.source_type === source) && (!assignee || f.assigned_to === assignee)), [data, source, assignee]);

  const sources = useMemo(() => [...new Set(data.map((f) => f.source_type))].sort(), [data]);

  const resolve = useMutation({
    mutationFn: async () => {
      if (!resolving) return;
      if (!resolution.trim()) throw new Error('Say what was done, so the next person knows');
      await rpc('resolve_followup', { p_id: resolving.id, p_resolution: resolution.trim() });
    },
    onSuccess: async () => {
      toast.success('Follow-up closed');
      setResolving(null);
      setResolution('');
      await qc.invalidateQueries({ queryKey: ['followups'] });
    },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const assign = useMutation({
    mutationFn: async ({ id, to }: { id: string; to: string }) =>
      check(await supabase.from('followup_tasks').update({ assigned_to: to || null, status: to ? 'in_progress' : 'open' }).eq('id', id)),
    onSuccess: async () => { toast.success('Assigned'); await qc.invalidateQueries({ queryKey: ['followups'] }); },
    onError: (e) => toast.error(friendlyError(e)),
  });

  if (isLoading) return <Spinner />;

  const overdue = rows.filter((f) => (daysFrom(f.due_date) ?? 0) > 0).length;

  return (
    <div>
      <PageHeader title="Follow-ups" subtitle="Raised automatically when something needs a person to look at it" />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Tabs tabs={[{ value: 'open', label: 'Open' }, { value: 'done', label: 'Closed' }]} value={tab} onChange={setTab} />
        <FilterSelect label="Reason" value={source} onChange={setSource} options={sources.map((s) => ({ value: s, label: humanize(s) }))} />
        <FilterSelect label="Assigned to" value={assignee} onChange={setAssignee} options={toOptions(staff, (s) => s.full_name)} />
        {overdue ? <Badge tone="red">{overdue} past due</Badge> : null}
      </div>

      {!rows.length ? (
        <EmptyState icon={<ClipboardCheck className="h-6 w-6" />}
          title={tab === 'open' ? 'Nothing waiting' : 'Nothing closed yet'}
          message={tab === 'open'
            ? 'Follow-ups appear here when a customer rates a job poorly, a contract month falls below its margin, a job is left on hold or an invoice goes well past due.'
            : 'Closed follow-ups are kept with the note of what was done.'} />
      ) : (
        <div className="space-y-3">
          {rows.map((f) => {
            const late = (daysFrom(f.due_date) ?? 0) > 0 && f.status !== 'done';
            const href = SOURCE_LINK[f.source_type]?.(f) ?? null;
            return (
              <Card key={f.id} className={late ? 'border-red-200' : undefined}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-stone-900">{f.title}</p>
                    {f.description ? <p className="mt-1 whitespace-pre-wrap text-sm text-stone-600">{f.description}</p> : null}
                    <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-500">
                      <Badge tone="grey">{humanize(f.source_type)}</Badge>
                      {f.customer ? (
                        <Link to={`/customers/${f.customer.id}`} className="text-brand-700 hover:underline">
                          {f.customer.display_name ?? f.customer.customer_code}
                        </Link>
                      ) : null}
                      <span className={late ? 'font-medium text-red-700' : ''}>Due {formatDate(f.due_date)}</span>
                      <span>Raised {formatDateTime(f.created_at)}</span>
                      {f.status === 'done' ? (
                        <Badge tone="green">Closed by {f.resolver?.full_name ?? 'someone'} {f.resolved_at ? formatDate(f.resolved_at) : ''}</Badge>
                      ) : f.assignee ? <Badge tone="blue">{f.assignee.full_name}</Badge> : (
                        <Badge tone="amber">For the {humanize(f.assigned_role)}</Badge>
                      )}
                    </p>
                    {f.resolution ? (
                      <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-900">{f.resolution}</p>
                    ) : null}
                  </div>

                  {f.status !== 'done' ? (
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      {href ? <Link to={href}><Button variant="secondary" size="sm">Open</Button></Link> : null}
                      {canResolve ? (
                        <>
                          <Select aria-label="Assign to" className="w-44" value={f.assigned_to ?? ''}
                            placeholder="Assign to…" options={toOptions(staff, (s) => s.full_name)}
                            onChange={(e) => assign.mutate({ id: f.id, to: e.target.value })} />
                          <Button size="sm" icon={<CheckCircle2 className="h-4 w-4" />}
                            onClick={() => { setResolving(f); setResolution(''); }}>Close it</Button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {!canResolve && tab === 'open' && rows.length ? (
        <p className="mt-4 text-xs text-stone-500">
          {profile?.full_name ? `${profile.full_name}, you` : 'You'} can see these follow-ups, but only a Manager closes them.
        </p>
      ) : null}

      <Modal open={resolving !== null} onClose={() => setResolving(null)} title="Close this follow-up" size="md"
        footer={<><Button variant="secondary" onClick={() => setResolving(null)}>Cancel</Button>
          <Button loading={resolve.isPending} onClick={() => resolve.mutate()}>Close it</Button></>}>
        {resolving ? (
          <div className="space-y-3">
            <p className="text-sm font-medium text-stone-800">{resolving.title}</p>
            <Textarea label="What was done" required rows={4} value={resolution} onChange={(e) => setResolution(e.target.value)}
              placeholder="e.g. Called the customer, apologised and arranged a free re-clean on 20/11. They are satisfied." />
            <p className="text-xs text-stone-500">The note is kept with the follow-up and shows on the customer's timeline.</p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
