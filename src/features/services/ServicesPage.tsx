import { useAuth } from '@/lib/auth';
import { canEdit } from '@/lib/permissions';
import { useAccounts, useEstimateTemplates, toOptions } from '@/lib/lookups';
import { formatGHS, humanize } from '@/lib/format';
import { serviceSchema, UOMS, TRUCK_TYPES } from '@/lib/schemas';
import { CrudPage, type CrudField } from '@/components/ui/CrudPage';
import { Badge } from '@/components/ui/Badge';
import { enumOptions } from '@/components/ui/Select';
import type { Column } from '@/components/ui/DataTable';
import type { Tables } from '@/types/database';

type Service = Tables<'services'>;

/** The service catalogue (spec 4.3). Admins add services; the six seeded ones can be edited. */
export default function ServicesPage() {
  const { roles } = useAuth();
  const editable = canEdit(roles, 'customers') || canEdit(roles, 'estimates');
  const { data: accounts } = useAccounts();
  const { data: templates } = useEstimateTemplates();

  const fields: CrudField[] = [
    { name: 'code', label: 'Code', required: true, hint: 'Short code used on documents, e.g. CES' },
    { name: 'name', label: 'Name', required: true },
    { name: 'description', label: 'Description', type: 'textarea' },
    { name: 'unit_of_measure', label: 'Unit of measure', type: 'select', required: true, options: enumOptions(UOMS) },
    { name: 'default_price', label: 'Default price (GH₵)', type: 'number', step: '0.01', required: true },
    { name: 'required_truck_type', label: 'Required truck type', type: 'select', options: enumOptions(TRUCK_TYPES), hint: 'Only trucks of this type can be assigned' },
    { name: 'revenue_account_id', label: 'Revenue account', type: 'select',
      options: toOptions((accounts ?? []).filter((a) => a.account_type === 'income'), (a) => `${a.code} · ${a.name}`),
      hint: 'Where completed revenue is posted' },
    { name: 'default_template_id', label: 'Default estimate template', type: 'select', options: toOptions(templates, (t) => t.name) },
    { name: 'taxable', label: 'Tax applies', type: 'checkbox' },
    { name: 'requires_truck', label: 'A truck is required', type: 'checkbox' },
    { name: 'active', label: 'Active', type: 'checkbox' },
  ];

  const columns: Column<Service>[] = [
    { key: 'code', header: 'Code', sort: 'code', render: (r) => <span className="font-mono text-xs">{r.code}</span>, exportValue: (r) => r.code },
    { key: 'name', header: 'Service', sort: 'name', render: (r) => <span className="font-medium">{r.name}</span>, exportValue: (r) => r.name },
    { key: 'unit', header: 'Unit', render: (r) => humanize(r.unit_of_measure), exportValue: (r) => r.unit_of_measure },
    { key: 'price', header: 'Default price', className: 'text-right', render: (r) => <span className="tabular-nums">{formatGHS(r.default_price)}</span>, exportValue: (r) => r.default_price },
    { key: 'truck', header: 'Truck', render: (r) => (r.requires_truck ? <Badge tone="blue">{humanize(r.required_truck_type)}</Badge> : <span className="text-stone-400">Not needed</span>),
      exportValue: (r) => (r.requires_truck ? r.required_truck_type : 'not required'), hideOnMobile: true },
    { key: 'taxable', header: 'Taxable', render: (r) => (r.taxable ? 'Yes' : 'No'), exportValue: (r) => r.taxable, hideOnMobile: true },
    { key: 'active', header: 'Status', render: (r) => <Badge tone={r.active ? 'green' : 'grey'}>{r.active ? 'Active' : 'Inactive'}</Badge>, exportValue: (r) => (r.active ? 'active' : 'inactive') },
  ];

  return (
    <CrudPage<Service>
      title="Services"
      subtitle="What you sell, the unit you price it in, and the truck it needs"
      table="services"
      schema={serviceSchema}
      fields={fields}
      columns={columns}
      searchColumns={['name', 'code', 'description']}
      defaultSort={{ column: 'code', ascending: true }}
      canEdit={editable}
      archivable
      exportName="services"
      defaultValues={{
        code: '', name: '', description: '', unit_of_measure: 'per_visit', default_price: 0, taxable: true,
        requires_truck: false, required_truck_type: '', revenue_account_id: '', default_template_id: '', active: true,
      }}
      beforeSave={(v) => ({ ...v, required_truck_type: v.requires_truck ? v.required_truck_type : null })}
    />
  );
}
