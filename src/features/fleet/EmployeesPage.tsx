import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { useStaff, toOptions } from '@/lib/lookups';
import { daysFrom, displayPhone, formatDate, formatGHS, humanize } from '@/lib/format';
import { employeeSchema } from '@/lib/schemas';
import { CrudPage, type CrudField } from '@/components/ui/CrudPage';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { enumOptions } from '@/components/ui/Select';
import type { Column } from '@/components/ui/DataTable';
import type { Tables } from '@/types/database';

type Row = Tables<'employees'> & { profile: { full_name: string; email: string | null } | null };

const ROLE_TYPES = ['driver', 'cleaner', 'supervisor', 'gardener', 'technician', 'loader', 'other'] as const;

/** Drivers and crew (spec 4.5). The daily rate feeds the estimator and actual labour costing. */
export default function EmployeesPage() {
  const { roles } = useAuth();
  const canManage = hasAny(roles, 'fleet_manager', 'manager');
  const { data: profiles } = useStaff();

  const fields: CrudField[] = [
    { name: 'full_name', label: 'Full name', required: true },
    { name: 'role_type', label: 'Role', type: 'select', required: true, options: enumOptions(ROLE_TYPES) },
    { name: 'phone', label: 'Phone', type: 'tel', placeholder: '024 412 3456' },
    { name: 'ghana_card_no', label: 'Ghana Card', placeholder: 'GHA-123456789-1' },
    { name: 'daily_rate', label: 'Daily rate (GH₵)', type: 'number', step: '0.01', required: true, hint: 'Used by the estimator and actual costing' },
    { name: 'status', label: 'Status', type: 'select', required: true, options: enumOptions(['active', 'on_leave', 'inactive']) },
    { name: 'hired_on', label: 'Date joined', type: 'date' },
    { name: 'licence_no', label: 'Licence number', hint: 'Drivers only' },
    { name: 'licence_class', label: 'Licence class', placeholder: 'C' },
    { name: 'licence_expiry', label: 'Licence expiry', type: 'date', hint: 'A job cannot be submitted with an expired licence' },
    { name: 'profile_id', label: 'App login', type: 'select', options: toOptions(profiles, (p) => `${p.full_name}${p.email ? ` (${p.email})` : ''}`),
      hint: 'Link to a user account so a driver sees their own jobs' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];

  const columns: Column<Row>[] = [
    { key: 'code', header: 'Code', sort: 'employee_code', render: (r) => <span className="font-mono text-xs">{r.employee_code}</span>, exportValue: (r) => r.employee_code },
    { key: 'name', header: 'Name', sort: 'full_name', render: (r) => <span className="font-medium">{r.full_name}</span>, exportValue: (r) => r.full_name },
    { key: 'role', header: 'Role', sort: 'role_type', render: (r) => <Badge tone={r.role_type === 'driver' ? 'blue' : 'grey'}>{humanize(r.role_type)}</Badge>, exportValue: (r) => r.role_type },
    { key: 'phone', header: 'Phone', render: (r) => displayPhone(r.phone), exportValue: (r) => r.phone },
    { key: 'rate', header: 'Daily rate', className: 'text-right', sort: 'daily_rate',
      render: (r) => <span className="tabular-nums">{formatGHS(r.daily_rate)}</span>, exportValue: (r) => r.daily_rate },
    { key: 'licence', header: 'Licence', render: (r) => {
      if (r.role_type !== 'driver') return <span className="text-stone-400">—</span>;
      if (!r.licence_expiry) return <Badge tone="red">Missing</Badge>;
      const days = daysFrom(r.licence_expiry);
      const tone = days !== null && days >= 0 ? 'red' : days !== null && days > -30 ? 'amber' : 'green';
      return <span className="flex flex-col gap-0.5"><span>{r.licence_no}</span><Badge tone={tone}>{formatDate(r.licence_expiry)}</Badge></span>;
    }, exportValue: (r) => r.licence_expiry, hideOnMobile: true },
    { key: 'login', header: 'App login', render: (r) => (r.profile ? <Badge tone="green">Linked</Badge> : <span className="text-stone-400">No</span>),
      exportValue: (r) => (r.profile ? 'linked' : 'no'), hideOnMobile: true },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} />, exportValue: (r) => r.status },
  ];

  return (
    <CrudPage<Row>
      title="Drivers and crew"
      subtitle="Everyone who works a job: drivers, cleaners, supervisors and gardeners"
      table="employees"
      select="*, profile:profiles(full_name, email)"
      schema={employeeSchema}
      fields={fields}
      columns={columns}
      searchColumns={['full_name', 'employee_code', 'phone', 'licence_no']}
      defaultSort={{ column: 'full_name', ascending: true }}
      canEdit={canManage}
      archivable
      exportName="employees"
      defaultValues={{
        full_name: '', role_type: 'cleaner', phone: '', ghana_card_no: '', daily_rate: 0, status: 'active',
        hired_on: '', licence_no: '', licence_class: '', licence_expiry: '', profile_id: '', notes: '',
      }}
    />
  );
}
