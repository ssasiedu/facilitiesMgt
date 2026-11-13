import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { check } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { formatDate, formatGHS, formatNumber, humanize } from '@/lib/format';
import { costItemSchema, TRUCK_TYPES } from '@/lib/schemas';
import { CATEGORIES } from '@/lib/calc';
import { CrudPage, type CrudField } from '@/components/ui/CrudPage';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { enumOptions } from '@/components/ui/Select';
import type { Column } from '@/components/ui/DataTable';
import type { Tables } from '@/types/database';

type CostItem = Tables<'cost_items'>;

/** Price history for one item. Estimates keep a snapshot, so old estimates never change. */
function PriceHistory({ item, onClose }: { item: CostItem; onClose: () => void }) {
  const { data = [], isLoading } = useQuery({
    queryKey: ['cost-item-prices', item.id],
    queryFn: async () => check(await supabase.from('cost_item_prices').select('*').eq('cost_item_id', item.id).order('effective_date', { ascending: false })) as Tables<'cost_item_prices'>[],
  });
  return (
    <Modal open onClose={onClose} title={`Price history — ${item.name}`} size="lg">
      {isLoading ? <p className="text-sm text-stone-500">Loading…</p> : data.length ? (
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Effective from</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Unit cost</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Per trip</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Per km</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Per day</th>
              <th scope="col" className="px-3 py-2 font-medium">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {data.map((p) => (
              <tr key={p.id}>
                <td className="px-3 py-2">{formatDate(p.effective_date)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatGHS(p.unit_cost)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatGHS(p.cost_per_trip)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatGHS(p.cost_per_km)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatGHS(p.cost_per_day)}</td>
                <td className="px-3 py-2 text-stone-500">{p.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="text-sm text-stone-500">No price changes recorded yet. A row is written here whenever a price is edited.</p>}
    </Modal>
  );
}

/** Cost item catalogue (spec 4.6): what things cost us, by category, with price history. */
export default function CostItemsPage() {
  const { roles } = useAuth();
  const editable = hasAny(roles, 'manager', 'accountant');
  const [history, setHistory] = useState<CostItem | null>(null);

  const fields: CrudField[] = [
    { name: 'code', label: 'Code', required: true },
    { name: 'name', label: 'Name', required: true },
    { name: 'category', label: 'Category', type: 'select', required: true, options: enumOptions(CATEGORIES) },
    { name: 'unit_of_measure', label: 'Unit', required: true, placeholder: 'gallon, pack, person-day, trip…' },
    { name: 'unit_cost', label: 'Unit cost (GH₵)', type: 'number', step: '0.01', required: true, hint: 'Labour: the rate per person per day or hour' },
    { name: 'rate_basis', label: 'Labour rate basis', type: 'select', options: enumOptions(['day', 'hour']), hint: 'Only used for labour items' },
    { name: 'cost_per_trip', label: 'Cost per trip (GH₵)', type: 'number', step: '0.01', hint: 'Vehicle items only' },
    { name: 'cost_per_km', label: 'Cost per km (GH₵)', type: 'number', step: '0.01', hint: 'Vehicle items only' },
    { name: 'cost_per_day', label: 'Cost per day (GH₵)', type: 'number', step: '0.01', hint: 'Vehicle or equipment per-day cost' },
    { name: 'truck_type', label: 'Truck type', type: 'select', options: enumOptions(TRUCK_TYPES) },
    { name: 'preferred_supplier', label: 'Preferred supplier' },
    { name: 'reorder_level', label: 'Reorder level', type: 'number', step: '0.001', hint: 'Raise a low-stock alert at or below this quantity' },
    { name: 'track_stock', label: 'Keep stock levels for this item', type: 'checkbox' },
    { name: 'active', label: 'Active', type: 'checkbox' },
  ];

  const columns: Column<CostItem>[] = [
    { key: 'code', header: 'Code', sort: 'code', render: (r) => <span className="font-mono text-xs">{r.code}</span>, exportValue: (r) => r.code },
    { key: 'name', header: 'Item', sort: 'name', render: (r) => <span className="font-medium">{r.name}</span>, exportValue: (r) => r.name },
    { key: 'category', header: 'Category', sort: 'category', render: (r) => <Badge tone="brand">{humanize(r.category)}</Badge>, exportValue: (r) => r.category },
    { key: 'unit', header: 'Unit', render: (r) => r.unit_of_measure, exportValue: (r) => r.unit_of_measure, hideOnMobile: true },
    { key: 'cost', header: 'Unit cost', className: 'text-right', sort: 'unit_cost',
      render: (r) => <span className="tabular-nums">{r.category === 'vehicle' ? `${formatGHS(r.cost_per_trip)} / trip` : formatGHS(r.unit_cost)}</span>,
      exportValue: (r) => (r.category === 'vehicle' ? r.cost_per_trip : r.unit_cost) },
    { key: 'km', header: 'Per km', className: 'text-right', render: (r) => (Number(r.cost_per_km) ? formatGHS(r.cost_per_km) : '—'), exportValue: (r) => r.cost_per_km, hideOnMobile: true },
    { key: 'supplier', header: 'Supplier', render: (r) => r.preferred_supplier ?? '—', exportValue: (r) => r.preferred_supplier, hideOnMobile: true },
    { key: 'stock', header: 'Stock', render: (r) => (r.track_stock ? <Badge tone="blue">Tracked · reorder {formatNumber(r.reorder_level)}</Badge> : <span className="text-stone-400">Not tracked</span>),
      exportValue: (r) => (r.track_stock ? `tracked (reorder ${r.reorder_level})` : 'not tracked'), hideOnMobile: true },
    { key: 'updated', header: 'Price updated', render: (r) => formatDate(r.last_updated), exportValue: (r) => formatDate(r.last_updated), hideOnMobile: true },
  ];

  return (
    <>
      <CrudPage<CostItem>
        title="Cost catalogue"
        subtitle="What each consumable, labour role, vehicle trip and piece of equipment costs you"
        table="cost_items"
        schema={costItemSchema}
        fields={fields}
        columns={columns}
        searchColumns={['name', 'code', 'preferred_supplier']}
        defaultSort={{ column: 'code', ascending: true }}
        canEdit={editable}
        archivable
        exportName="cost-items"
        extraActions={(row) => (
          <Button variant="ghost" size="sm" aria-label="Price history" onClick={() => setHistory(row)}><History className="h-4 w-4" /></Button>
        )}
        defaultValues={{
          code: '', name: '', category: 'consumable', unit_of_measure: 'each', unit_cost: 0, rate_basis: 'day',
          cost_per_trip: 0, cost_per_km: 0, cost_per_day: 0, truck_type: '', preferred_supplier: '', track_stock: false, reorder_level: 0, active: true,
        }}
      />
      {history ? <PriceHistory item={history} onClose={() => setHistory(null)} /> : null}
    </>
  );
}
