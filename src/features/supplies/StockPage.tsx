import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Boxes, Plus, SlidersHorizontal } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { check, rpc, useAction } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { useCostItems, useStockLocations, toOptions } from '@/lib/lookups';
import { formatDate, formatGHS, formatNumber, humanize } from '@/lib/format';
import { exportXlsx } from '@/lib/export';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Tabs } from '@/components/ui/Tabs';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { FilterSelect } from '@/components/ui/DataTable';

interface LevelRow {
  cost_item_id: string; location_id: string; quantity: number; updated_at: string;
  cost_item: { code: string; name: string; unit_of_measure: string; reorder_level: number; unit_cost: number } | null;
  location: { name: string } | null;
}

interface MovementRow {
  id: string; movement_date: string; movement_type: string; quantity: number; unit_cost: number; note: string | null;
  cost_item: { name: string; unit_of_measure: string } | null;
  location: { name: string } | null;
  contract: { id: string; contract_no: string | null } | null;
  job_order: { id: string; job_no: string | null } | null;
}

/** Simple stock for consumables (spec 4.8): receipts increase, issues decrease, low-stock alerts. */
export default function StockPage() {
  const { roles } = useAuth();
  const canAdjust = hasAny(roles, 'ops_officer', 'accountant', 'manager');
  const { data: costItems } = useCostItems();
  const { data: locations } = useStockLocations();
  const [tab, setTab] = useState<'levels' | 'movements'>('levels');
  const [location, setLocation] = useState('');
  const [open, setOpen] = useState<null | 'receive' | 'adjust'>(null);
  const [form, setForm] = useState({ cost_item_id: '', location_id: '', quantity: 0, unit_cost: 0, note: '' });

  const levels = useQuery({
    queryKey: ['stock-levels'],
    queryFn: async () => check(await supabase.from('stock_levels')
      .select('*, cost_item:cost_items(code, name, unit_of_measure, reorder_level, unit_cost), location:stock_locations(name)')
      .order('quantity')) as LevelRow[],
  });

  const movements = useQuery({
    queryKey: ['stock-movements', location],
    enabled: tab === 'movements',
    queryFn: async () => {
      let q = supabase.from('stock_movements')
        .select('id, movement_date, movement_type, quantity, unit_cost, note, cost_item:cost_items(name, unit_of_measure), location:stock_locations(name), contract:contracts(id, contract_no), job_order:job_orders(id, job_no)')
        .order('movement_date', { ascending: false }).limit(300);
      if (location) q = q.eq('location_id', location);
      return check(await q) as MovementRow[];
    },
  });

  const receive = useAction(() => rpc<string>('receive_stock', {
    p_item: form.cost_item_id, p_location: form.location_id, p_quantity: form.quantity,
    p_unit_cost: form.unit_cost, p_note: form.note || (open === 'adjust' ? 'Stock adjustment' : 'Stock received'),
    p_adjust: open === 'adjust',
  }), {
    success: open === 'adjust' ? 'Stock adjusted' : 'Stock received',
    invalidate: [['stock-levels'], ['stock-movements', location]],
    onSuccess: () => { setOpen(null); setForm({ cost_item_id: '', location_id: '', quantity: 0, unit_cost: 0, note: '' }); },
  });

  const rows = useMemo(
    () => (location ? (levels.data ?? []).filter((r) => r.location_id === location) : (levels.data ?? [])),
    [levels.data, location],
  );
  const low = rows.filter((r) => Number(r.cost_item?.reorder_level ?? 0) > 0 && Number(r.quantity) <= Number(r.cost_item?.reorder_level ?? 0));
  const value = rows.reduce((t, r) => t + Number(r.quantity) * Number(r.cost_item?.unit_cost ?? 0), 0);

  const exportLevels = () => exportXlsx(rows, [
    { header: 'Code', value: (r: LevelRow) => r.cost_item?.code ?? '' },
    { header: 'Item', value: (r: LevelRow) => r.cost_item?.name ?? '' },
    { header: 'Store', value: (r: LevelRow) => r.location?.name ?? '' },
    { header: 'Quantity', value: (r: LevelRow) => r.quantity },
    { header: 'Unit', value: (r: LevelRow) => r.cost_item?.unit_of_measure ?? '' },
    { header: 'Reorder level', value: (r: LevelRow) => r.cost_item?.reorder_level ?? 0 },
    { header: 'Unit cost', value: (r: LevelRow) => r.cost_item?.unit_cost ?? 0 },
    { header: 'Value', value: (r: LevelRow) => Number(r.quantity) * Number(r.cost_item?.unit_cost ?? 0) },
  ], 'stock-levels');

  const openForm = (kind: 'receive' | 'adjust') => {
    setForm({ cost_item_id: '', location_id: location || (locations ?? [])[0]?.id || '', quantity: 0, unit_cost: 0, note: '' });
    setOpen(kind);
  };

  return (
    <div>
      <PageHeader title="Stock" subtitle="Consumables in your stores, with a low-stock alert at the reorder level"
        actions={canAdjust ? <>
          <Button variant="secondary" icon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => openForm('adjust')}>Adjust</Button>
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => openForm('receive')}>Receive stock</Button>
        </> : null} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card title="Items held"><p className="text-xl font-semibold tabular-nums">{rows.length}</p></Card>
        <Card title="Stock value"><p className="text-xl font-semibold tabular-nums">{formatGHS(value)}</p></Card>
        <Card title="At or below reorder" className={low.length ? 'border-amber-300' : undefined}>
          <p className={`text-xl font-semibold tabular-nums ${low.length ? 'text-amber-700' : ''}`}>{low.length}</p>
        </Card>
        <Card title="Stores"><p className="text-xl font-semibold tabular-nums">{(locations ?? []).length}</p></Card>
      </div>

      {low.length ? (
        <Card className="mb-4 border-amber-200" title={<h2 className="flex items-center gap-2 text-sm font-semibold text-amber-900"><AlertTriangle className="h-4 w-4" />Low stock</h2>}>
          <ul className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
            {low.map((r) => (
              <li key={`${r.cost_item_id}-${r.location_id}`} className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">{r.cost_item?.name} <span className="text-stone-500">({r.location?.name})</span></span>
                <Badge tone="red">{formatNumber(r.quantity)} left · reorder at {formatNumber(r.cost_item?.reorder_level ?? 0)}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FilterSelect label="Store" value={location} onChange={setLocation} options={toOptions(locations, (l) => l.name)} />
        <Button variant="secondary" size="sm" onClick={exportLevels}>Export levels</Button>
      </div>

      <Tabs tabs={[{ value: 'levels', label: 'Levels', count: rows.length }, { value: 'movements', label: 'Movements' }]} value={tab} onChange={setTab} />

      <div className="mt-4">
        {tab === 'levels' ? (
          levels.isLoading ? <Spinner /> : rows.length ? (
            <Card bodyClassName="p-0">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Item</th>
                      <th scope="col" className="px-3 py-2 font-medium">Store</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Quantity</th>
                      <th scope="col" className="px-3 py-2 font-medium">Unit</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Reorder at</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Value</th>
                      <th scope="col" className="px-3 py-2 font-medium">Updated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {rows.map((r) => {
                      const isLow = Number(r.cost_item?.reorder_level ?? 0) > 0 && Number(r.quantity) <= Number(r.cost_item?.reorder_level ?? 0);
                      return (
                        <tr key={`${r.cost_item_id}-${r.location_id}`} className={isLow ? 'bg-amber-50' : undefined}>
                          <td className="px-3 py-2">
                            <span className="font-mono text-xs text-stone-500">{r.cost_item?.code}</span> {r.cost_item?.name}
                          </td>
                          <td className="px-3 py-2">{r.location?.name}</td>
                          <td className={`px-3 py-2 text-right tabular-nums ${isLow ? 'font-semibold text-amber-800' : ''}`}>{formatNumber(r.quantity)}</td>
                          <td className="px-3 py-2 text-stone-600">{r.cost_item?.unit_of_measure}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatNumber(r.cost_item?.reorder_level ?? 0)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatGHS(Number(r.quantity) * Number(r.cost_item?.unit_cost ?? 0))}</td>
                          <td className="px-3 py-2 text-stone-500">{formatDate(r.updated_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <EmptyState icon={<Boxes className="h-6 w-6" />} title="No stock yet"
              message="Receive stock into a store, or buy it on a supplier bill with a store chosen on the line."
              action={canAdjust ? <Button onClick={() => openForm('receive')}>Receive stock</Button> : undefined} />
          )
        ) : (
          movements.isLoading ? <Spinner /> : (movements.data ?? []).length ? (
            <Card bodyClassName="p-0">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Date</th>
                      <th scope="col" className="px-3 py-2 font-medium">Type</th>
                      <th scope="col" className="px-3 py-2 font-medium">Item</th>
                      <th scope="col" className="px-3 py-2 font-medium">Store</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Quantity</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Unit cost</th>
                      <th scope="col" className="px-3 py-2 font-medium">Against</th>
                      <th scope="col" className="px-3 py-2 font-medium">Note</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {(movements.data ?? []).map((m) => (
                      <tr key={m.id}>
                        <td className="whitespace-nowrap px-3 py-2">{formatDate(m.movement_date)}</td>
                        <td className="px-3 py-2">
                          <Badge tone={m.movement_type === 'receipt' ? 'green' : m.movement_type === 'issue' ? 'blue' : 'amber'}>{humanize(m.movement_type)}</Badge>
                        </td>
                        <td className="px-3 py-2">{m.cost_item?.name}</td>
                        <td className="px-3 py-2">{m.location?.name}</td>
                        <td className={`px-3 py-2 text-right tabular-nums ${Number(m.quantity) < 0 ? 'text-red-700' : ''}`}>{formatNumber(m.quantity)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatGHS(m.unit_cost)}</td>
                        <td className="px-3 py-2">
                          {m.contract ? <Link to={`/contracts/${m.contract.id}`} className="text-brand-700 hover:underline">{m.contract.contract_no}</Link>
                            : m.job_order ? <Link to={`/jobs/${m.job_order.id}`} className="text-brand-700 hover:underline">{m.job_order.job_no}</Link>
                              : '—'}
                        </td>
                        <td className="px-3 py-2 text-stone-600">{m.note ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : <EmptyState title="No movements yet" />
        )}
      </div>

      <Modal open={open !== null} onClose={() => setOpen(null)} title={open === 'adjust' ? 'Adjust stock' : 'Receive stock'} size="md"
        footer={<><Button variant="secondary" onClick={() => setOpen(null)}>Cancel</Button>
          <Button loading={receive.isPending} onClick={() => receive.mutate()}>Save</Button></>}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label="Item" required options={toOptions((costItems ?? []).filter((c) => c.track_stock), (c) => `${c.code} · ${c.name}`)}
            placeholder="Choose…" value={form.cost_item_id}
            onChange={(e) => {
              const item = (costItems ?? []).find((c) => c.id === e.target.value);
              setForm({ ...form, cost_item_id: e.target.value, unit_cost: item ? Number(item.unit_cost) : form.unit_cost });
            }}
            hint="Only items marked as stock-tracked in the cost catalogue" />
          <Select label="Store" required options={toOptions(locations, (l) => l.name)} placeholder="Choose…"
            value={form.location_id} onChange={(e) => setForm({ ...form, location_id: e.target.value })} />
          <Input label="Quantity" type="number" step="0.001" required value={form.quantity}
            onChange={(e) => setForm({ ...form, quantity: Number(e.target.value) })}
            hint={open === 'adjust' ? 'Negative to reduce, positive to increase' : 'How much came in'} />
          <Input label="Unit cost (GH₵)" type="number" step="0.01" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: Number(e.target.value) })} />
          <Textarea className="sm:col-span-2" label={open === 'adjust' ? 'Reason for the adjustment' : 'Note'} value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            placeholder={open === 'adjust' ? 'e.g. stock count correction, damage' : 'e.g. delivery from supplier'} />
        </div>
        <p className="mt-3 rounded-lg bg-stone-50 p-3 text-xs text-stone-600">
          Stock levels are kept by the database from these movements. Issuing supplies to a contract or job from a store
          reduces the level automatically and posts Dr Consumables / Cr Consumables inventory.
        </p>
      </Modal>
    </div>
  );
}
