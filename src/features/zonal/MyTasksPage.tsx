import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, ListTodo, Plus, WifiOff } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { check } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { useOfflineQueue } from '@/lib/offlineQueue';
import { daysFrom, displayPhone, formatDate, formatGHS, humanize, isoDate } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Tabs } from '@/components/ui/Tabs';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import type { Tables } from '@/types/database';

type Task = Tables<'tasks'> & {
  task_type: { name: string } | null;
  customer: { id: string; display_name: string | null } | null;
  lead: { id: string; name: string } | null;
  zone: { name: string } | null;
};

type View = 'today' | 'week' | 'overdue' | 'all';

/**
 * A zonal officer's own task list (spec 4.12). Mobile first: large tap targets, short pages,
 * and updates that queue on the phone when the connection drops.
 */
export default function MyTasksPage() {
  const { profile } = useAuth();
  const { pending, online } = useOfflineQueue();
  const [view, setView] = useState<View>('today');

  const today = isoDate();
  const weekEnd = isoDate(new Date(Date.now() + 6 * 86_400_000));

  const { data = [], isLoading, error, refetch } = useQuery({
    queryKey: ['my-tasks', profile?.id, view],
    enabled: !!profile?.id,
    queryFn: async () => {
      let q = supabase.from('tasks')
        .select('*, task_type:task_types(name), customer:customers!tasks_customer_id_fkey(id, display_name), lead:leads!tasks_lead_id_fkey(id, name), zone:zones(name)')
        .eq('officer_id', profile?.id as string)
        .order('planned_date')
        .order('priority', { ascending: false });
      if (view === 'today') q = q.eq('planned_date', today);
      else if (view === 'week') q = q.gte('planned_date', today).lte('planned_date', weekEnd);
      else if (view === 'overdue') q = q.lt('planned_date', today).in('status', ['planned', 'in_progress', 'pending']);
      return check(await q) as Task[];
    },
  });

  const counts = useMemo(() => ({
    done: data.filter((t) => t.status === 'completed').length,
    open: data.filter((t) => ['planned', 'in_progress', 'pending'].includes(t.status)).length,
    deals: data.filter((t) => t.deal_closed).reduce((s, t) => s + Number(t.deal_value), 0),
  }), [data]);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  return (
    <div>
      <PageHeader title="My tasks" subtitle={formatDate(today)}
        actions={<Link to="/zonal/plans/new"><Button size="lg" icon={<Plus className="h-5 w-5" />}>New plan</Button></Link>} />

      {!online || pending > 0 ? (
        <p className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0" />
          {online
            ? `${pending} update(s) waiting to send. They go out by themselves — you can keep working.`
            : 'You are offline. Updates and check-ins are saved on this phone and sent when the connection returns.'}
        </p>
      ) : null}

      <div className="mb-4 grid grid-cols-3 gap-3">
        <Card title="Still to do"><p className="text-xl font-semibold tabular-nums">{counts.open}</p></Card>
        <Card title="Completed"><p className="text-xl font-semibold tabular-nums text-emerald-700">{counts.done}</p></Card>
        <Card title="Deals closed"><p className="text-xl font-semibold tabular-nums">{formatGHS(counts.deals)}</p></Card>
      </div>

      <Tabs tabs={[
        { value: 'today', label: 'Today' },
        { value: 'week', label: 'Next 7 days' },
        { value: 'overdue', label: 'Overdue' },
        { value: 'all', label: 'All' },
      ]} value={view} onChange={setView} />

      <div className="mt-4 space-y-3">
        {!data.length ? (
          <EmptyState icon={<ListTodo className="h-6 w-6" />}
            title={view === 'today' ? 'Nothing planned for today' : view === 'overdue' ? 'Nothing overdue — well done' : 'No tasks here'}
            message="Create a plan for the day or the week, then update each task as you go."
            action={<Link to="/zonal/plans/new"><Button>New plan</Button></Link>} />
        ) : data.map((t) => {
          const late = (daysFrom(t.planned_date) ?? 0) > 0 && ['planned', 'in_progress', 'pending'].includes(t.status);
          return (
            <Link key={t.id} to={`/zonal/tasks/${t.id}`} className="block">
              <Card className={late ? 'border-red-200' : undefined}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-stone-900">{t.title}</p>
                    <p className="mt-0.5 text-sm text-stone-600">
                      {t.task_type?.name}
                      {t.target_org ? ` · ${t.target_org}` : ''}
                    </p>
                    {t.location ? <p className="text-xs text-stone-500">{t.location}</p> : null}
                    {t.contact_name || t.contact_phone ? (
                      <p className="text-xs text-stone-500">
                        {[t.contact_name, displayPhone(t.contact_phone)].filter((x) => x && x !== '—').join(' · ')}
                      </p>
                    ) : null}
                    {t.customer ? <p className="text-xs text-brand-700">{t.customer.display_name}</p> : null}
                    {t.lead ? <p className="text-xs text-brand-700">Lead: {t.lead.name}</p> : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <StatusBadge status={t.status} />
                    {t.priority !== 'normal' ? <Badge tone={t.priority === 'urgent' ? 'red' : 'amber'}>{humanize(t.priority)}</Badge> : null}
                    <span className={`flex items-center gap-1 text-xs ${late ? 'font-medium text-red-700' : 'text-stone-500'}`}>
                      <CalendarDays className="h-3.5 w-3.5" />{formatDate(t.planned_date)}
                    </span>
                    {t.deal_closed ? <Badge tone="green">{formatGHS(t.deal_value)}</Badge> : null}
                  </div>
                </div>
                {t.expected_outcome ? <p className="mt-2 rounded-lg bg-stone-50 p-2 text-xs text-stone-700">{t.expected_outcome}</p> : null}
              </Card>
            </Link>
          );
        })}
      </div>

      <p className="mt-4 text-xs text-stone-500">
        A reminder goes out at 17:00 if any of today's tasks have not been updated, and your Manager gets a summary at 18:00.
      </p>
    </div>
  );
}
