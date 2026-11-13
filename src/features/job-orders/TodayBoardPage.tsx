import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, ClipboardCheck, Play, Truck as TruckIcon } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { check, useAction } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { useRealtimeInvalidate } from '@/lib/realtime';
import { displayPhone, formatDate, formatGHS, humanize, isoDate } from '@/lib/format';
import { getPosition } from '@/lib/geo';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { startJob } from './api';
import type { Tables } from '@/types/database';

type Row = Tables<'job_orders'> & {
  job_order_lines: { service: { name: string } | null }[];
  job_order_assignments: { kind: string; truck: { registration_no: string } | null; employee: { full_name: string; phone: string | null } | null }[];
  customer: { display_name: string | null; phone: string | null; company_phone: string | null } | null;
  contact: { name: string; phone: string | null } | null;
};

/** The "Today" board an operations officer works from, with large Start buttons. */
export default function TodayBoardPage() {
  const { roles } = useAuth();
  const canOperate = hasAny(roles, 'manager', 'ops_officer');
  const today = isoDate();

  const { data = [], isLoading, error, refetch } = useQuery({
    queryKey: ['today-board', today],
    queryFn: async () => check(await supabase.from('job_orders')
      .select(`*, job_order_lines(service:services(name)),
               job_order_assignments(kind, truck:trucks(registration_no), employee:employees(full_name, phone)),
               customer:customers(display_name, phone, company_phone), contact:customer_contacts(name, phone)`)
      .in('status', ['approved', 'in_progress', 'completed', 'on_hold'])
      .lte('execution_date', today)
      .or(`end_date.gte.${today},and(end_date.is.null,execution_date.eq.${today})`)
      .order('time_window', { nullsFirst: false })) as Row[],
  });
  useRealtimeInvalidate(['job_orders'], [['today-board', today]]);

  const start = useAction(async (jobId: string) => {
    try {
      const p = await getPosition();
      return startJob(jobId, p.lat, p.lng);
    } catch {
      return startJob(jobId);
    }
  }, { success: 'Job started', invalidate: [['today-board', today]] });

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const groups: { label: string; status: string[]; tone: 'amber' | 'blue' | 'green' | 'grey' }[] = [
    { label: 'To start', status: ['approved'], tone: 'amber' },
    { label: 'In progress', status: ['in_progress'], tone: 'blue' },
    { label: 'Completed today', status: ['completed'], tone: 'green' },
    { label: 'On hold', status: ['on_hold'], tone: 'grey' },
  ];

  return (
    <div>
      <PageHeader title="Today" subtitle={`Jobs running on ${formatDate(today)}`}
        actions={<Link to="/jobs"><Button variant="secondary">All job orders</Button></Link>} />

      {!data.length ? (
        <EmptyState icon={<ClipboardCheck className="h-6 w-6" />} title="Nothing scheduled for today"
          message="Approved jobs appear here on their execution date."
          action={<Link to="/jobs/calendar"><Button variant="secondary">Open the dispatch calendar</Button></Link>} />
      ) : (
        <div className="space-y-5">
          {groups.map((g) => {
            const jobs = data.filter((j) => g.status.includes(j.status));
            if (!jobs.length) return null;
            return (
              <section key={g.label}>
                <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-800">
                  {g.label}<Badge tone={g.tone}>{jobs.length}</Badge>
                </h2>
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {jobs.map((j) => {
                    const driver = j.job_order_assignments.find((a) => a.kind === 'driver');
                    const trucks = j.job_order_assignments.filter((a) => a.kind === 'truck');
                    return (
                      <Card key={j.id}>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div className="min-w-0">
                            <Link to={`/jobs/${j.id}`} className="font-medium text-brand-700 hover:underline">{j.job_no}</Link>
                            <p className="truncate text-sm text-stone-800">{j.customer?.display_name}</p>
                            <p className="text-xs text-stone-500">
                              {j.job_order_lines.map((l) => l.service?.name).filter(Boolean).join(', ')}
                            </p>
                          </div>
                          <div className="text-right">
                            <StatusBadge status={j.status} />
                            {j.time_window ? <p className="mt-1 text-xs text-stone-500">{j.time_window}</p> : null}
                          </div>
                        </div>

                        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                          <div><dt className="text-stone-500">Site</dt><dd className="text-stone-800">{j.site_address ?? '—'}</dd></div>
                          <div><dt className="text-stone-500">Contact</dt><dd className="text-stone-800">
                            {j.contact?.name ?? j.customer?.display_name} · {displayPhone(j.contact?.phone ?? j.customer?.phone ?? j.customer?.company_phone)}
                          </dd></div>
                          <div><dt className="text-stone-500">Truck</dt><dd className="flex items-center gap-1 text-stone-800">
                            <TruckIcon className="h-3.5 w-3.5 text-stone-400" />{trucks.map((t) => t.truck?.registration_no).filter(Boolean).join(', ') || 'none'}
                          </dd></div>
                          <div><dt className="text-stone-500">Driver</dt><dd className="text-stone-800">{driver?.employee?.full_name ?? 'none'}</dd></div>
                          <div><dt className="text-stone-500">Amount</dt><dd className="tabular-nums text-stone-800">{formatGHS(j.agreed_amount)}</dd></div>
                          <div><dt className="text-stone-500">Priority</dt><dd className="text-stone-800">{humanize(j.priority)}</dd></div>
                        </dl>

                        {j.instructions ? <p className="mt-2 rounded-lg bg-stone-50 p-2 text-xs text-stone-700">{j.instructions}</p> : null}

                        {canOperate ? (
                          <div className="mt-3 flex gap-2">
                            {j.status === 'approved' ? (
                              <Button size="lg" className="flex-1" icon={<Play className="h-5 w-5" />}
                                loading={start.isPending} onClick={() => start.mutate(j.id)}>Start job</Button>
                            ) : null}
                            {j.status === 'in_progress' ? (
                              <Link to={`/jobs/${j.id}`} className="flex-1">
                                <Button variant="success" size="lg" className="w-full" icon={<Check className="h-5 w-5" />}>Mark completed</Button>
                              </Link>
                            ) : null}
                          </div>
                        ) : null}
                      </Card>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
