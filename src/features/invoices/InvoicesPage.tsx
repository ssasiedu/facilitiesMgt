import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Scale } from 'lucide-react';
import { useServerTable } from '@/lib/useServerTable';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { useRealtimeInvalidate } from '@/lib/realtime';
import { daysFrom, formatDate, formatGHS, humanize } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { DataTable, FilterSelect, type Column } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { DateRange } from '@/components/ui/DateRange';
import { INVOICE_STATUSES } from './api';
import type { Tables } from '@/types/database';

type Row = Tables<'invoices'> & {
  customer: { id: string; display_name: string | null } | null;
  job_order: { id: string; job_no: string | null } | null;
  contract: { id: string; contract_no: string | null } | null;
};

/** Invoices from job orders, contracts or manual entry (spec 4.9). */
export default function InvoicesPage() {
  const [params, setParams] = useSearchParams();
  const { roles } = useAuth();
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [source, setSource] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const isAccountant = hasAny(roles, 'accountant');

  const filters = useMemo(() => ({
    status, source, '>=issue_date': from || undefined, '<=issue_date': to || undefined,
  }), [status, source, from, to]);

  const table = useServerTable<Row>({
    table: 'invoices',
    select: '*, customer:customers(id, display_name), job_order:job_orders!invoices_job_order_id_fkey(id, job_no), contract:contracts(id, contract_no)',
    searchColumns: ['invoice_no', 'customer_name'],
    filters,
    defaultSort: { column: 'issue_date', ascending: false },
  });
  useRealtimeInvalidate(['payments'], [['table', 'invoices']]);

  const setStatusFilter = (next: string) => {
    setStatus(next);
    const p = new URLSearchParams(params);
    if (next) p.set('status', next); else p.delete('status');
    setParams(p, { replace: true });
  };

  const pageTotal = table.rows.reduce((t, r) => t + Number(r.total), 0);
  const pageBalance = table.rows.reduce((t, r) => t + Number(r.balance), 0);

  const columns: Column<Row>[] = [
    { key: 'no', header: 'Number', sort: 'invoice_no', render: (r) => <span className="font-mono text-xs">{r.invoice_no ?? 'Draft'}</span>, exportValue: (r) => r.invoice_no },
    { key: 'customer', header: 'Customer', sort: 'customer_name',
      render: (r) => (r.customer ? <Link to={`/customers/${r.customer.id}`} className="font-medium text-brand-700 hover:underline">{r.customer.display_name}</Link> : r.customer_name),
      exportValue: (r) => r.customer_name },
    { key: 'source', header: 'From', render: (r) => (
      r.job_order ? <Link to={`/jobs/${r.job_order.id}`} className="text-brand-700 hover:underline">{r.job_order.job_no}</Link>
        : r.contract ? <Link to={`/contracts/${r.contract.id}`} className="text-brand-700 hover:underline">{r.contract.contract_no}</Link>
          : <Badge tone="grey">Manual</Badge>
    ), exportValue: (r) => r.source, hideOnMobile: true },
    { key: 'issued', header: 'Issued', sort: 'issue_date', render: (r) => formatDate(r.issue_date), exportValue: (r) => formatDate(r.issue_date) },
    { key: 'due', header: 'Due', sort: 'due_date', render: (r) => {
      if (!r.due_date) return <span className="text-stone-400">On completion</span>;
      const days = daysFrom(r.due_date) ?? 0;
      const late = days > 0 && Number(r.balance) > 0;
      return <span className={late ? 'text-red-700' : ''}>{formatDate(r.due_date)}{late ? <span className="block text-xs">{days} day(s) late</span> : null}</span>;
    }, exportValue: (r) => r.due_date },
    { key: 'period', header: 'Period', render: (r) => (r.period_start ? `${formatDate(r.period_start)} – ${formatDate(r.period_end)}` : '—'),
      exportValue: (r) => r.period_start, hideOnMobile: true },
    { key: 'total', header: 'Total', className: 'text-right', sort: 'total', render: (r) => <span className="tabular-nums">{formatGHS(r.total)}</span>, exportValue: (r) => r.total },
    { key: 'paid', header: 'Paid', className: 'text-right', render: (r) => <span className="tabular-nums">{formatGHS(r.amount_paid)}</span>, exportValue: (r) => r.amount_paid, hideOnMobile: true },
    { key: 'balance', header: 'Balance', className: 'text-right', sort: 'balance',
      render: (r) => <span className={`tabular-nums ${Number(r.balance) > 0 ? 'font-medium' : 'text-stone-400'}`}>{formatGHS(r.balance)}</span>, exportValue: (r) => r.balance },
    { key: 'status', header: 'Status', sort: 'status', render: (r) => <StatusBadge status={r.status} />, exportValue: (r) => r.status },
  ];

  return (
    <div>
      <PageHeader title="Invoices" subtitle="Raised automatically by job orders and contracts, or entered by hand"
        actions={<>
          <Link to="/finance/aging"><Button variant="secondary" icon={<Scale className="h-4 w-4" />}>Aging</Button></Link>
          {isAccountant ? <Link to="/finance/invoices/new"><Button icon={<Plus className="h-4 w-4" />}>New invoice</Button></Link> : null}
        </>} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card title="Invoices on this page"><p className="text-xl font-semibold tabular-nums">{table.count}</p></Card>
        <Card title="Total on this page"><p className="text-xl font-semibold tabular-nums">{formatGHS(pageTotal)}</p></Card>
        <Card title="Balance on this page"><p className="text-xl font-semibold tabular-nums">{formatGHS(pageBalance)}</p></Card>
      </div>

      <DataTable table={table} columns={columns} rowLink={(r) => `/finance/invoices/${r.id}`} exportName="invoices" selectable
        searchPlaceholder="Invoice number or customer"
        toolbar={<>
          <FilterSelect label="Status" value={status} onChange={setStatusFilter} options={INVOICE_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
          <FilterSelect label="Source" value={source} onChange={setSource} options={[
            { value: 'job_order', label: 'Job order' }, { value: 'contract', label: 'Contract' }, { value: 'manual', label: 'Manual' },
          ]} />
          <DateRange presets={false} from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        </>}
        empty={{ title: 'No invoices yet', message: 'Approving a job order or billing a contract raises an invoice automatically.' }} />
    </div>
  );
}
