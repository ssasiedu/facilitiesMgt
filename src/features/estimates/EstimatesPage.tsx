import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useServerTable } from '@/lib/useServerTable';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { useServices, toOptions } from '@/lib/lookups';
import { formatDate, formatGHS, formatPct } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, FilterSelect, type Column } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { Tables } from '@/types/database';

type Row = Tables<'estimates'> & {
  customer: { display_name: string | null } | null;
  lead: { name: string } | null;
  service: { name: string } | null;
};

/** All estimates, with the margin visible so loss-making work stands out before it is sold. */
export default function EstimatesPage() {
  const { roles } = useAuth();
  const [status, setStatus] = useState('');
  const [service, setService] = useState('');
  const [warning, setWarning] = useState('');
  const { data: services } = useServices(true);
  const canCreate = hasAny(roles, 'manager', 'ops_officer', 'sales_exec');

  const filters = useMemo(() => ({ status, service_id: service, price_warning: warning, 'is:archived_at': 'null' }), [status, service, warning]);
  const table = useServerTable<Row>({
    table: 'estimates',
    select: '*, customer:customers(display_name), lead:leads(name), service:services(name)',
    searchColumns: ['estimate_no', 'title', 'site'],
    filters,
    defaultSort: { column: 'created_at', ascending: false },
  });

  const columns: Column<Row>[] = [
    { key: 'no', header: 'Number', sort: 'estimate_no',
      render: (r) => <Link to={`/estimates/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline">{r.estimate_no ?? 'Draft'} v{r.version}</Link>,
      exportValue: (r) => `${r.estimate_no ?? 'draft'} v${r.version}` },
    { key: 'party', header: 'Customer or lead', render: (r) => r.customer?.display_name ?? r.lead?.name ?? '—',
      exportValue: (r) => r.customer?.display_name ?? r.lead?.name },
    { key: 'service', header: 'Service', render: (r) => r.service?.name ?? '—', exportValue: (r) => r.service?.name, hideOnMobile: true },
    { key: 'title', header: 'Title', render: (r) => r.title ?? '—', exportValue: (r) => r.title, hideOnMobile: true },
    { key: 'kind', header: 'Type', render: (r) => <Badge tone={r.is_recurring ? 'purple' : 'grey'}>{r.is_recurring ? 'Recurring' : 'One-off'}</Badge>,
      exportValue: (r) => (r.is_recurring ? 'recurring' : 'one-off'), hideOnMobile: true },
    { key: 'cost', header: 'Total cost', className: 'text-right', sort: 'total_cost',
      render: (r) => <span className="tabular-nums">{formatGHS(r.total_cost)}</span>, exportValue: (r) => r.total_cost },
    { key: 'price', header: 'Price', className: 'text-right', sort: 'proposed_price',
      render: (r) => <span className="tabular-nums">{formatGHS(r.proposed_price)}</span>, exportValue: (r) => r.proposed_price },
    { key: 'margin', header: 'Margin', className: 'text-right', sort: 'margin_pct',
      render: (r) => (
        <span className={`tabular-nums ${Number(r.margin_pct) < 0 ? 'font-semibold text-red-700' : ''}`}>
          {Number(r.proposed_price) > 0 ? formatPct(r.margin_pct) : '—'}
        </span>
      ),
      exportValue: (r) => r.margin_pct },
    { key: 'warning', header: 'Price check', render: (r) => (
      r.price_warning === 'below_cost' ? <Badge tone="red">Below cost</Badge>
        : r.price_warning === 'below_margin' ? <Badge tone="amber">Below target</Badge>
          : <Badge tone="green">OK</Badge>
    ), exportValue: (r) => r.price_warning },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} />, exportValue: (r) => r.status },
    { key: 'created', header: 'Created', sort: 'created_at', render: (r) => formatDate(r.created_at), exportValue: (r) => formatDate(r.created_at), hideOnMobile: true },
  ];

  return (
    <div>
      <PageHeader title="Estimates" subtitle="True cost, break-even price and margin before you quote"
        actions={canCreate ? <Link to="/estimates/new"><Button icon={<Plus className="h-4 w-4" />}>New estimate</Button></Link> : null} />
      <DataTable table={table} columns={columns} rowLink={(r) => `/estimates/${r.id}`} exportName="estimates"
        searchPlaceholder="Number, title or site"
        toolbar={<>
          <FilterSelect label="Status" value={status} onChange={setStatus} options={[
            { value: 'draft', label: 'Draft' }, { value: 'pending_approval', label: 'Pending approval' }, { value: 'approved', label: 'Approved' },
            { value: 'quoted', label: 'Quoted' }, { value: 'accepted', label: 'Accepted' }, { value: 'converted', label: 'Converted' },
            { value: 'rejected', label: 'Rejected' }, { value: 'superseded', label: 'Superseded' },
          ]} />
          <FilterSelect label="Service" value={service} onChange={setService} options={toOptions(services, (s) => s.name)} />
          <FilterSelect label="Price check" value={warning} onChange={setWarning} options={[
            { value: 'below_cost', label: 'Below cost' }, { value: 'below_margin', label: 'Below target margin' }, { value: 'none', label: 'OK' },
          ]} />
        </>}
        empty={{ title: 'No estimates yet', message: 'Build an estimate to see the true cost of a job before you price it.',
          action: canCreate ? <Link to="/estimates/new"><Button>New estimate</Button></Link> : undefined }} />
    </div>
  );
}
