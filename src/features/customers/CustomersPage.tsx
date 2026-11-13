import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Upload } from 'lucide-react';
import { useServerTable } from '@/lib/useServerTable';
import { useAuth } from '@/lib/auth';
import { canEdit } from '@/lib/permissions';
import { useZones, toOptions } from '@/lib/lookups';
import { displayPhone, formatDate, humanize } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, FilterSelect, type Column } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Badge } from '@/components/ui/Badge';
import { CustomerImportModal } from './CustomerImportModal';
import type { Customer } from './api';

type Row = Customer & { zone: { name: string } | null; assigned: { full_name: string } | null };

export default function CustomersPage() {
  const { roles } = useAuth();
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [zone, setZone] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const { data: zones } = useZones();
  const filters = useMemo(() => ({ customer_type: type, status, zone_id: zone, 'is:archived_at': 'null' }), [type, status, zone]);
  const table = useServerTable<Row>({ table: 'customers', select: '*, zone:zones(name), assigned:profiles!customers_assigned_to_fkey(full_name)', searchColumns: ['display_name', 'customer_code', 'phone', 'company_phone', 'email', 'tin', 'ghana_card_no'], filters, defaultSort: { column: 'created_at', ascending: false } });
  const editable = canEdit(roles, 'customers');

  const columns: Column<Row>[] = [
    { key: 'code', header: 'Code', sort: 'customer_code', render: (r) => <span className="font-mono text-xs">{r.customer_code}</span>, exportValue: (r) => r.customer_code },
    { key: 'name', header: 'Name', sort: 'display_name', render: (r) => <Link to={`/customers/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.display_name}</Link>, exportValue: (r) => r.display_name },
    { key: 'type', header: 'Type', render: (r) => <Badge tone={r.customer_type === 'company' ? 'purple' : 'grey'}>{humanize(r.customer_type)}</Badge>, exportValue: (r) => r.customer_type, hideOnMobile: true },
    { key: 'phone', header: 'Phone', render: (r) => displayPhone(r.phone ?? r.company_phone), exportValue: (r) => r.phone ?? r.company_phone },
    { key: 'email', header: 'Email', render: (r) => r.email ?? r.company_email ?? '—', exportValue: (r) => r.email ?? r.company_email, hideOnMobile: true },
    { key: 'zone', header: 'Zone', render: (r) => r.zone?.name ?? '—', exportValue: (r) => r.zone?.name, hideOnMobile: true },
    { key: 'assigned', header: 'Assigned to', render: (r) => r.assigned?.full_name ?? '—', exportValue: (r) => r.assigned?.full_name, hideOnMobile: true },
    { key: 'source', header: 'Source', render: (r) => humanize(r.source), exportValue: (r) => r.source, hideOnMobile: true },
    { key: 'registered', header: 'Registered', sort: 'registered_on', render: (r) => formatDate(r.registered_on), exportValue: (r) => formatDate(r.registered_on), hideOnMobile: true },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} />, exportValue: (r) => r.status },
  ];

  return (
    <div>
      <PageHeader title="Customers" subtitle="Everyone you serve: individuals, companies and assemblies"
        actions={editable ? <>
          <Button variant="secondary" icon={<Upload className="h-4 w-4" />} onClick={() => setImportOpen(true)}>Import</Button>
          <Link to="/customers/new"><Button icon={<Plus className="h-4 w-4" />}>New customer</Button></Link>
        </> : null} />
      <DataTable table={table} columns={columns} rowLink={(r) => `/customers/${r.id}`} exportName="customers" selectable
        searchPlaceholder="Name, code, phone, email, TIN or Ghana Card"
        toolbar={<>
          <FilterSelect label="Type" value={type} onChange={setType} options={[{ value: 'individual', label: 'Individual' }, { value: 'company', label: 'Company' }]} />
          <FilterSelect label="Status" value={status} onChange={setStatus} options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'blacklisted', label: 'Blacklisted' }]} />
          <FilterSelect label="Zone" value={zone} onChange={setZone} options={toOptions(zones, (z) => z.name)} />
        </>}
        empty={{ title: 'No customers yet', message: 'Add your first customer or import a list.', action: editable ? <Link to="/customers/new"><Button>New customer</Button></Link> : undefined }} />
      <CustomerImportModal open={importOpen} onClose={() => { setImportOpen(false); void table.refetch(); }} />
    </div>
  );
}
