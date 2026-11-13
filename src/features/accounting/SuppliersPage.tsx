import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { displayPhone } from '@/lib/format';
import { supplierSchema } from '@/lib/schemas';
import { CrudPage, type CrudField } from '@/components/ui/CrudPage';
import { Button } from '@/components/ui/Button';
import type { Column } from '@/components/ui/DataTable';
import type { Tables } from '@/types/database';

type Supplier = Tables<'suppliers'>;

/** Suppliers you buy from (spec 4.10). Bills and expenses link to them. */
export default function SuppliersPage() {
  const { roles } = useAuth();
  const canEdit = hasAny(roles, 'accountant', 'fleet_manager', 'manager');

  const fields: CrudField[] = [
    { name: 'name', label: 'Name', required: true },
    { name: 'phone', label: 'Phone', type: 'tel', placeholder: '024 412 3456' },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'tin', label: 'TIN' },
    { name: 'address', label: 'Address' },
    { name: 'payment_terms_days', label: 'Payment terms (days)', type: 'number', required: true, hint: 'Used to work out a bill due date' },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];

  const columns: Column<Supplier>[] = [
    { key: 'code', header: 'Code', sort: 'supplier_code', render: (r) => <span className="font-mono text-xs">{r.supplier_code}</span>, exportValue: (r) => r.supplier_code },
    { key: 'name', header: 'Supplier', sort: 'name', render: (r) => <span className="font-medium">{r.name}</span>, exportValue: (r) => r.name },
    { key: 'phone', header: 'Phone', render: (r) => displayPhone(r.phone), exportValue: (r) => r.phone },
    { key: 'email', header: 'Email', render: (r) => r.email ?? '—', exportValue: (r) => r.email, hideOnMobile: true },
    { key: 'tin', header: 'TIN', render: (r) => r.tin ?? '—', exportValue: (r) => r.tin, hideOnMobile: true },
    { key: 'terms', header: 'Terms', className: 'text-right', render: (r) => `${r.payment_terms_days} days`, exportValue: (r) => r.payment_terms_days, hideOnMobile: true },
    { key: 'address', header: 'Address', render: (r) => r.address ?? '—', exportValue: (r) => r.address, hideOnMobile: true },
  ];

  return (
    <>
      <CrudPage<Supplier>
        title="Suppliers"
        subtitle="Who you buy consumables, fuel, parts and subcontract work from"
        table="suppliers"
        schema={supplierSchema}
        fields={fields}
        columns={columns}
        searchColumns={['name', 'supplier_code', 'phone', 'email', 'tin']}
        defaultSort={{ column: 'name', ascending: true }}
        canEdit={canEdit}
        archivable
        exportName="suppliers"
        extraActions={(row) => (
          <Link to={`/finance/bills?supplier=${row.id}`}>
            <Button variant="ghost" size="sm">Bills</Button>
          </Link>
        )}
        defaultValues={{ name: '', phone: '', email: '', tin: '', address: '', payment_terms_days: 0, notes: '' }}
      />
      <p className="mt-3 text-xs text-stone-500">
        The cost catalogue also records a preferred supplier per item as free text, which is handy when reordering.
        {!canEdit ? ' Only an Accountant, Fleet Manager or Manager can add suppliers.' : ''}
      </p>
    </>
  );
}
