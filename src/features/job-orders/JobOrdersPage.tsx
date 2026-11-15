import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarDays, ClipboardCheck, Plus } from 'lucide-react';
import { useServerTable } from '@/lib/useServerTable';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { useRealtimeInvalidate } from '@/lib/realtime';
import { useServices, toOptions } from '@/lib/lookups';
import { formatDate, formatGHS, humanize } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, FilterSelect, type Column } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { DateRange } from '@/components/ui/DateRange';
import { JOB_STATUSES } from './api';
import type { Tables } from '@/types/database';

type Row = Tables<'job_orders'> & {
  job_order_lines: { service: { name: string } | null }[];
  officer: { full_name: string } | null;
  invoice: { invoice_no: string | null; status: string; balance: number } | null;
};

/** Job order list with status filters (spec 4.4). */
export default function JobOrdersPage() {
  const [params, setParams] = useSearchParams();
  const { roles } = useAuth();
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [service, setService] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { data: services } = useServices(true);
  const canCreate = hasAny(roles, 'manager', 'ops_officer', 'sales_exec');

  const filters = useMemo(() => ({
    status,
    '>=execution_date': from || undefined,
    '<=execution_date': to || undefined,
    'is:archived_at': 'null',
  }), [status, from, to]);

  const table = useServerTable<Row>({
    table: 'job_orders',
    select: '*, job_order_lines(service:services(name)), officer:profiles!job_orders_officer_id_fkey(full_name), invoice:invoices!job_orders_invoice_fk(invoice_no, status, balance)',
    searchColumns: ['job_no', 'customer_name', 'site_address'],
    filters,
    defaultSort: { column: 'execution_date', ascending: false },
  });
  useRealtimeInvalidate(['job_orders'], [['table', 'job_orders']]);

  // Rows are filtered by service in the browser because the filter is on a joined table.
  const rows = useMemo(
    () => (service ? table.rows.filter((r) => r.job_order_lines.some((l) => l.service?.name === (services ?? []).find((s) => s.id === service)?.name)) : table.rows),
    [table.rows, service, services],
  );
  const view = { ...table, rows };

  const columns: Column<Row>[] = [
    { key: 'no', header: 'Number', sort: 'job_no', render: (r) => <span className="font-mono text-xs">{r.job_no ?? 'Draft'}</span>, exportValue: (r) => r.job_no },
    { key: 'customer', header: 'Customer', sort: 'customer_name', render: (r) => <span className="font-medium">{r.customer_name}</span>, exportValue: (r) => r.customer_name },
    { key: 'services', header: 'Services', render: (r) => r.job_order_lines.map((l) => l.service?.name).filter(Boolean).join(', ') || '—',
      exportValue: (r) => r.job_order_lines.map((l) => l.service?.name).join(', '), hideOnMobile: true },
    { key: 'date', header: 'Execution', sort: 'execution_date',
      render: (r) => <>{formatDate(r.execution_date)}{r.time_window ? <span className="block text-xs text-stone-500">{r.time_window}</span> : null}</>,
      exportValue: (r) => formatDate(r.execution_date) },
    { key: 'officer', header: 'Officer', render: (r) => r.officer?.full_name ?? '—', exportValue: (r) => r.officer?.full_name, hideOnMobile: true },
    { key: 'amount', header: 'Agreed', className: 'text-right', sort: 'agreed_amount',
      render: (r) => <span className="tabular-nums">{formatGHS(r.agreed_amount)}</span>, exportValue: (r) => r.agreed_amount },
    { key: 'invoice', header: 'Invoice', render: (r) => (r.invoice ? <StatusBadge status={r.invoice.status} /> : <span className="text-stone-400">—</span>),
      exportValue: (r) => r.invoice?.invoice_no, hideOnMobile: true },
    { key: 'priority', header: 'Priority', render: (r) => (r.priority === 'normal' ? <span className="text-stone-400">Normal</span>
      : <Badge tone={r.priority === 'urgent' ? 'red' : r.priority === 'high' ? 'amber' : 'grey'}>{humanize(r.priority)}</Badge>),
      exportValue: (r) => r.priority, hideOnMobile: true },
    { key: 'status', header: 'Status', sort: 'status', render: (r) => (
      <span className="flex flex-wrap items-center gap-1">
        <StatusBadge status={r.status} />
        {r.needs_reassignment ? <Badge tone="red">Truck</Badge> : null}
      </span>
    ), exportValue: (r) => r.status },
  ];

  const setStatusFilter = (next: string) => {
    setStatus(next);
    const p = new URLSearchParams(params);
    if (next) p.set('status', next); else p.delete('status');
    setParams(p, { replace: true });
  };

  return (
    <div>
      <PageHeader title="Job orders" subtitle="Every job from order to payment"
        actions={<>
          <Link to="/jobs/today"><Button variant="secondary" icon={<ClipboardCheck className="h-4 w-4" />}>Today</Button></Link>
          <Link to="/jobs/calendar"><Button variant="secondary" icon={<CalendarDays className="h-4 w-4" />}>Calendar</Button></Link>
          {canCreate ? <Link to="/jobs/new"><Button icon={<Plus className="h-4 w-4" />}>New job order</Button></Link> : null}
        </>} />
      <DataTable table={view} columns={columns} rowLink={(r) => `/jobs/${r.id}`} exportName="job-orders" selectable
        searchPlaceholder="Number, customer or site"
        toolbar={<>
          <FilterSelect label="Status" value={status} onChange={setStatusFilter} options={JOB_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
          <FilterSelect label="Service" value={service} onChange={setService} options={toOptions(services, (s) => s.name)} />
          <DateRange presets={false} from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        </>}
        empty={{ title: 'No job orders yet', message: 'Raise one when a customer calls, walks in, or a sales executive wins the work.',
          action: canCreate ? <Link to="/jobs/new"><Button>New job order</Button></Link> : undefined }} />
    </div>
  );
}
