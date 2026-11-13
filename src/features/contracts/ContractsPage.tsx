import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarRange, Plus } from 'lucide-react';
import { useServerTable } from '@/lib/useServerTable';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { useServices, toOptions } from '@/lib/lookups';
import { formatDate, formatGHS, humanize } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, FilterSelect, type Column } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { CONTRACT_STATUSES } from './api';
import type { Tables } from '@/types/database';

type Row = Tables<'contracts'> & {
  customer: { id: string; display_name: string | null } | null;
  service: { name: string } | null;
  supervisor: { full_name: string } | null;
};

/** Contracts list: one-off and recurring (spec 4.7). */
export default function ContractsPage() {
  const { roles } = useAuth();
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [service, setService] = useState('');
  const { data: services } = useServices(true);
  const canCreate = hasAny(roles, 'manager', 'ops_officer', 'sales_exec', 'accountant');

  const filters = useMemo(() => ({ status, contract_type: type, service_id: service, 'is:archived_at': 'null' }), [status, type, service]);
  const table = useServerTable<Row>({
    table: 'contracts',
    select: '*, customer:customers(id, display_name), service:services(name), supervisor:profiles!contracts_supervisor_id_fkey(full_name)',
    searchColumns: ['contract_no', 'title'],
    filters,
    defaultSort: { column: 'created_at', ascending: false },
  });

  const columns: Column<Row>[] = [
    { key: 'no', header: 'Number', sort: 'contract_no', render: (r) => <span className="font-mono text-xs">{r.contract_no ?? 'Draft'}</span>, exportValue: (r) => r.contract_no },
    { key: 'customer', header: 'Customer', render: (r) => r.customer?.display_name ?? '—', exportValue: (r) => r.customer?.display_name },
    { key: 'title', header: 'Title', sort: 'title', render: (r) => <span className="font-medium">{r.title}</span>, exportValue: (r) => r.title },
    { key: 'type', header: 'Type', render: (r) => <Badge tone={r.contract_type === 'recurring' ? 'purple' : 'grey'}>{r.contract_type === 'recurring' ? 'Recurring' : 'One-off'}</Badge>,
      exportValue: (r) => r.contract_type },
    { key: 'service', header: 'Service', render: (r) => r.service?.name ?? '—', exportValue: (r) => r.service?.name, hideOnMobile: true },
    { key: 'period', header: 'Period', sort: 'start_date', render: (r) => <>{formatDate(r.start_date)}<span className="block text-xs text-stone-500">to {formatDate(r.end_date)}</span></>,
      exportValue: (r) => `${formatDate(r.start_date)} to ${formatDate(r.end_date)}` },
    { key: 'amount', header: 'Amount', className: 'text-right', sort: 'amount_per_period',
      render: (r) => (
        <span className="tabular-nums">
          {r.contract_type === 'recurring' ? formatGHS(r.amount_per_period) : formatGHS(r.total_agreed)}
          <span className="block text-xs text-stone-500">{r.contract_type === 'recurring' ? humanize(r.billing_frequency) : 'agreed total'}</span>
        </span>
      ),
      exportValue: (r) => (r.contract_type === 'recurring' ? r.amount_per_period : r.total_agreed) },
    { key: 'next', header: 'Next bill', sort: 'next_billing_date', render: (r) => (r.next_billing_date ? formatDate(r.next_billing_date) : '—'),
      exportValue: (r) => r.next_billing_date, hideOnMobile: true },
    { key: 'supervisor', header: 'Supervisor', render: (r) => r.supervisor?.full_name ?? '—', exportValue: (r) => r.supervisor?.full_name, hideOnMobile: true },
    { key: 'status', header: 'Status', sort: 'status', render: (r) => <StatusBadge status={r.status} />, exportValue: (r) => r.status },
  ];

  return (
    <div>
      <PageHeader title="Contracts" subtitle="Recurring contracts billed every period, and one-off contracts with an agreed total"
        actions={<>
          <Link to="/contracts/upcoming"><Button variant="secondary" icon={<CalendarRange className="h-4 w-4" />}>Upcoming bills</Button></Link>
          {canCreate ? <Link to="/contracts/new"><Button icon={<Plus className="h-4 w-4" />}>New contract</Button></Link> : null}
        </>} />
      <DataTable table={table} columns={columns} rowLink={(r) => `/contracts/${r.id}`} exportName="contracts"
        searchPlaceholder="Number or title"
        toolbar={<>
          <FilterSelect label="Status" value={status} onChange={setStatus} options={CONTRACT_STATUSES.map((s) => ({ value: s, label: humanize(s) }))} />
          <FilterSelect label="Type" value={type} onChange={setType} options={[{ value: 'recurring', label: 'Recurring' }, { value: 'one_off', label: 'One-off' }]} />
          <FilterSelect label="Service" value={service} onChange={setService} options={toOptions(services, (s) => s.name)} />
        </>}
        empty={{ title: 'No contracts yet', message: 'A recurring contract bills itself every period; a one-off groups job orders under one total.',
          action: canCreate ? <Link to="/contracts/new"><Button>New contract</Button></Link> : undefined }} />
    </div>
  );
}
