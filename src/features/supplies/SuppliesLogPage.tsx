import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Package, Plus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { check } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { useServerTable } from '@/lib/useServerTable';
import { useCostItems, useEmployees, useStockLocations, toOptions } from '@/lib/lookups';
import { formatDate, formatGHS, formatNumber, humanize, isoDate } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Tabs } from '@/components/ui/Tabs';
import { FileUpload } from '@/components/ui/FileUpload';
import { DataTable, FilterSelect, type Column } from '@/components/ui/DataTable';
import { DateRange } from '@/components/ui/DateRange';
import type { Tables } from '@/types/database';

type SupplyRow = Tables<'contract_supplies'> & {
  contract: { id: string; contract_no: string | null; title: string } | null;
  cost_item: { name: string; unit_of_measure: string; category: string } | null;
  site: { name: string } | null;
  issuer: { full_name: string } | null;
};
type LabourRow = Tables<'contract_labour'> & {
  contract: { id: string; contract_no: string | null; title: string } | null;
  employee: { full_name: string } | null;
};
type ContractOption = { id: string; contract_no: string | null; title: string };

/** Supplies and other direct costs recorded against a contract (spec 4.8). */
export default function SuppliesLogPage() {
  const [params] = useSearchParams();
  const { roles } = useAuth();
  const canRecord = hasAny(roles, 'ops_officer', 'manager', 'accountant');
  const canEditCost = hasAny(roles, 'manager', 'accountant');
  const { data: costItems } = useCostItems();
  const { data: locations } = useStockLocations();
  const { data: employees } = useEmployees();

  const [tab, setTab] = useState<'supplies' | 'labour'>('supplies');
  const [contract, setContract] = useState(params.get('contract') ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [supplyOpen, setSupplyOpen] = useState(false);
  const [labourOpen, setLabourOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [supply, setSupply] = useState({
    contract_id: params.get('contract') ?? '', supply_date: isoDate(), cost_item_id: '', quantity: 1, unit_cost: 0,
    site_id: '', stock_location_id: '', received_by: '', notes: '', delivery_note_path: '',
  });
  const [labour, setLabour] = useState({
    contract_id: params.get('contract') ?? '', work_date: isoDate(), kind: 'labour', employee_id: '',
    role_description: '', staff_count: 1, days: 1, rate: 0, actual_wage_amount: '', notes: '',
  });

  const { data: contracts = [] } = useQuery({
    queryKey: ['contracts-for-supplies'],
    queryFn: async () => check(await supabase.from('contracts').select('id, contract_no, title')
      .in('status', ['active', 'suspended']).is('archived_at', null).order('contract_no')) as ContractOption[],
  });

  const { data: sites = [] } = useQuery({
    queryKey: ['contract-sites', supply.contract_id],
    enabled: !!supply.contract_id,
    queryFn: async () => check(await supabase.from('contract_sites').select('id, name').eq('contract_id', supply.contract_id)) as { id: string; name: string }[],
  });

  const supplyFilters = useMemo(() => ({ contract_id: contract, '>=supply_date': from || undefined, '<=supply_date': to || undefined }), [contract, from, to]);
  const labourFilters = useMemo(() => ({ contract_id: contract, '>=work_date': from || undefined, '<=work_date': to || undefined }), [contract, from, to]);

  const supplyTable = useServerTable<SupplyRow>({
    table: 'contract_supplies',
    select: '*, contract:contracts(id, contract_no, title), cost_item:cost_items(name, unit_of_measure, category), site:contract_sites(name), issuer:profiles(full_name)',
    searchColumns: ['notes', 'received_by'],
    filters: supplyFilters,
    defaultSort: { column: 'supply_date', ascending: false },
    enabled: tab === 'supplies',
  });

  const labourTable = useServerTable<LabourRow>({
    table: 'contract_labour',
    select: '*, contract:contracts(id, contract_no, title), employee:employees(full_name)',
    searchColumns: ['role_description', 'notes'],
    filters: labourFilters,
    defaultSort: { column: 'work_date', ascending: false },
    enabled: tab === 'labour',
  });

  // Picking an item fills the current catalogue cost; only Manager and Accountant may change it.
  useEffect(() => {
    const item = (costItems ?? []).find((c) => c.id === supply.cost_item_id);
    if (item) setSupply((s) => ({ ...s, unit_cost: Number(item.category === 'vehicle' ? item.cost_per_trip : item.unit_cost) }));
  }, [supply.cost_item_id, costItems]);

  const saveSupply = async () => {
    if (!supply.contract_id || !supply.cost_item_id || supply.quantity <= 0) { toast.error('Contract, item and quantity are required'); return; }
    setSaving(true);
    try {
      check(await supabase.from('contract_supplies').insert({
        contract_id: supply.contract_id, supply_date: supply.supply_date, cost_item_id: supply.cost_item_id,
        quantity: supply.quantity, unit_cost: supply.unit_cost, site_id: supply.site_id || null,
        stock_location_id: supply.stock_location_id || null, received_by: supply.received_by || null,
        notes: supply.notes || null, delivery_note_path: supply.delivery_note_path || null,
      }));
      toast.success('Supply recorded');
      setSupplyOpen(false);
      setSupply({ ...supply, cost_item_id: '', quantity: 1, unit_cost: 0, notes: '', received_by: '', delivery_note_path: '' });
      await supplyTable.refetch();
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  };

  const saveLabour = async () => {
    if (!labour.contract_id) { toast.error('Choose a contract'); return; }
    setSaving(true);
    try {
      check(await supabase.from('contract_labour').insert({
        contract_id: labour.contract_id, work_date: labour.work_date, kind: labour.kind,
        employee_id: labour.employee_id || null, role_description: labour.role_description || null,
        staff_count: labour.staff_count, days: labour.days, rate: labour.rate,
        actual_wage_amount: labour.actual_wage_amount === '' ? null : Number(labour.actual_wage_amount),
        notes: labour.notes || null,
      }));
      toast.success('Cost recorded');
      setLabourOpen(false);
      setLabour({ ...labour, role_description: '', staff_count: 1, days: 1, rate: 0, actual_wage_amount: '', notes: '' });
      await labourTable.refetch();
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  };

  const supplyColumns: Column<SupplyRow>[] = [
    { key: 'date', header: 'Date', sort: 'supply_date', render: (r) => formatDate(r.supply_date), exportValue: (r) => formatDate(r.supply_date) },
    { key: 'contract', header: 'Contract', render: (r) => (r.contract ? <Link to={`/contracts/${r.contract.id}`} className="text-brand-700 hover:underline">{r.contract.contract_no}</Link> : '—'),
      exportValue: (r) => r.contract?.contract_no },
    { key: 'item', header: 'Item', render: (r) => <>{r.cost_item?.name}<span className="block text-xs text-stone-500">{r.cost_item?.unit_of_measure}</span></>,
      exportValue: (r) => r.cost_item?.name },
    { key: 'qty', header: 'Qty', className: 'text-right', render: (r) => <span className="tabular-nums">{formatNumber(r.quantity)}</span>, exportValue: (r) => r.quantity },
    { key: 'cost', header: 'Unit cost', className: 'text-right', render: (r) => <span className="tabular-nums">{formatGHS(r.unit_cost)}</span>, exportValue: (r) => r.unit_cost },
    { key: 'amount', header: 'Amount', className: 'text-right', sort: 'amount', render: (r) => <span className="tabular-nums font-medium">{formatGHS(r.amount)}</span>, exportValue: (r) => r.amount },
    { key: 'site', header: 'Site', render: (r) => r.site?.name ?? '—', exportValue: (r) => r.site?.name, hideOnMobile: true },
    { key: 'stock', header: 'From stock', render: (r) => (r.stock_location_id ? <Badge tone="blue">Yes</Badge> : <span className="text-stone-400">No</span>),
      exportValue: (r) => (r.stock_location_id ? 'yes' : 'no'), hideOnMobile: true },
    { key: 'by', header: 'Issued by', render: (r) => r.issuer?.full_name ?? '—', exportValue: (r) => r.issuer?.full_name, hideOnMobile: true },
    { key: 'received', header: 'Received by', render: (r) => r.received_by ?? '—', exportValue: (r) => r.received_by, hideOnMobile: true },
  ];

  const labourColumns: Column<LabourRow>[] = [
    { key: 'date', header: 'Date', sort: 'work_date', render: (r) => formatDate(r.work_date), exportValue: (r) => formatDate(r.work_date) },
    { key: 'contract', header: 'Contract', render: (r) => (r.contract ? <Link to={`/contracts/${r.contract.id}`} className="text-brand-700 hover:underline">{r.contract.contract_no}</Link> : '—'),
      exportValue: (r) => r.contract?.contract_no },
    { key: 'kind', header: 'Kind', render: (r) => <Badge tone="brand">{humanize(r.kind)}</Badge>, exportValue: (r) => r.kind },
    { key: 'what', header: 'Role or description', render: (r) => r.employee?.full_name ?? r.role_description ?? '—',
      exportValue: (r) => r.employee?.full_name ?? r.role_description },
    { key: 'staff', header: 'Staff × days', className: 'text-right', render: (r) => <span className="tabular-nums">{formatNumber(r.staff_count)} × {formatNumber(r.days)}</span>,
      exportValue: (r) => `${r.staff_count} x ${r.days}` },
    { key: 'rate', header: 'Rate', className: 'text-right', render: (r) => <span className="tabular-nums">{formatGHS(r.rate)}</span>, exportValue: (r) => r.rate },
    { key: 'amount', header: 'Amount', className: 'text-right', sort: 'amount', render: (r) => <span className="tabular-nums font-medium">{formatGHS(r.amount)}</span>, exportValue: (r) => r.amount },
    { key: 'notes', header: 'Notes', render: (r) => r.notes ?? '—', exportValue: (r) => r.notes, hideOnMobile: true },
  ];

  const supplyTotal = supplyTable.rows.reduce((t, r) => t + Number(r.amount), 0);
  const labourTotal = labourTable.rows.reduce((t, r) => t + Number(r.amount), 0);

  return (
    <div>
      <PageHeader title="Supplies log" subtitle="What each contract actually consumes, so profitability is real"
        actions={canRecord ? <>
          <Button variant="secondary" icon={<Users className="h-4 w-4" />} onClick={() => setLabourOpen(true)}>Record labour or trips</Button>
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setSupplyOpen(true)}>Record supplies</Button>
        </> : null} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <FilterSelect label="Contract" value={contract} onChange={setContract}
          options={contracts.map((c) => ({ value: c.id, label: `${c.contract_no ?? 'Draft'} · ${c.title}` }))} />
        <DateRange presets={false} from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
      </div>

      <Tabs tabs={[
        { value: 'supplies', label: 'Supplies', count: supplyTable.count },
        { value: 'labour', label: 'Labour, vehicles and other', count: labourTable.count },
      ]} value={tab} onChange={setTab} />

      <div className="mt-4">
        {tab === 'supplies' ? (
          <>
            <p className="mb-2 text-sm text-stone-600">Total on this page: <span className="font-semibold tabular-nums">{formatGHS(supplyTotal)}</span></p>
            <DataTable table={supplyTable} columns={supplyColumns} exportName="contract-supplies" searchPlaceholder="Notes or received by"
              empty={{ title: 'No supplies recorded yet', message: 'Record what is issued to each contract, month by month.',
                action: canRecord ? <Button onClick={() => setSupplyOpen(true)}>Record supplies</Button> : undefined }} />
          </>
        ) : (
          <>
            <p className="mb-2 text-sm text-stone-600">Total on this page: <span className="font-semibold tabular-nums">{formatGHS(labourTotal)}</span></p>
            <DataTable table={labourTable} columns={labourColumns} exportName="contract-labour" searchPlaceholder="Role or notes"
              empty={{ title: 'No labour or trips recorded yet', action: canRecord ? <Button onClick={() => setLabourOpen(true)}>Record labour</Button> : undefined }} />
          </>
        )}
      </div>

      <Modal open={supplyOpen} onClose={() => setSupplyOpen(false)} title="Record supplies issued" size="lg"
        footer={<><Button variant="secondary" onClick={() => setSupplyOpen(false)}>Cancel</Button>
          <Button loading={saving} onClick={() => void saveSupply()}>Save</Button></>}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label="Contract" required options={contracts.map((c) => ({ value: c.id, label: `${c.contract_no ?? 'Draft'} · ${c.title}` }))}
            placeholder="Choose…" value={supply.contract_id} onChange={(e) => setSupply({ ...supply, contract_id: e.target.value, site_id: '' })} />
          <Input label="Date" type="date" required value={supply.supply_date} onChange={(e) => setSupply({ ...supply, supply_date: e.target.value })} />
          <Select label="Item" required options={toOptions(costItems, (c) => `${c.code} · ${c.name}`)} placeholder="Choose…"
            value={supply.cost_item_id} onChange={(e) => setSupply({ ...supply, cost_item_id: e.target.value })} />
          <Input label="Quantity" type="number" step="0.001" required value={supply.quantity} onChange={(e) => setSupply({ ...supply, quantity: Number(e.target.value) })} />
          <Input label="Unit cost (GH₵)" type="number" step="0.01" disabled={!canEditCost} value={supply.unit_cost}
            onChange={(e) => setSupply({ ...supply, unit_cost: Number(e.target.value) })}
            hint={canEditCost ? 'Filled from the catalogue; you may change it' : 'Filled from the catalogue price'} />
          <Select label="Site" options={sites.map((s) => ({ value: s.id, label: s.name }))} placeholder="—"
            value={supply.site_id} onChange={(e) => setSupply({ ...supply, site_id: e.target.value })} />
          <Select label="Issued from store" options={toOptions(locations, (l) => l.name)} placeholder="Not from stock"
            hint="Choosing a store reduces its stock level" value={supply.stock_location_id}
            onChange={(e) => setSupply({ ...supply, stock_location_id: e.target.value })} />
          <Input label="Received by" value={supply.received_by} onChange={(e) => setSupply({ ...supply, received_by: e.target.value })}
            hint="Who signed for it at the site" />
          <Textarea className="sm:col-span-2" label="Notes" value={supply.notes} onChange={(e) => setSupply({ ...supply, notes: e.target.value })} />
          <div className="sm:col-span-2">
            <FileUpload bucket="task-evidence" folder={`supplies/${supply.contract_id || 'unassigned'}`}
              label={supply.delivery_note_path ? 'Replace delivery note' : 'Photo of the signed delivery note'}
              onUploaded={(path) => setSupply((s) => ({ ...s, delivery_note_path: path }))} capture />
            {supply.delivery_note_path ? <p className="mt-1 text-xs text-stone-500">Attached.</p> : null}
          </div>
        </div>
        <p className="mt-3 text-right text-sm text-stone-700">
          Amount <span className="font-semibold tabular-nums">{formatGHS(supply.quantity * supply.unit_cost)}</span>
        </p>
      </Modal>

      <Modal open={labourOpen} onClose={() => setLabourOpen(false)} title="Record labour, vehicle or other cost" size="lg"
        footer={<><Button variant="secondary" onClick={() => setLabourOpen(false)}>Cancel</Button>
          <Button loading={saving} onClick={() => void saveLabour()}>Save</Button></>}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label="Contract" required options={contracts.map((c) => ({ value: c.id, label: `${c.contract_no ?? 'Draft'} · ${c.title}` }))}
            placeholder="Choose…" value={labour.contract_id} onChange={(e) => setLabour({ ...labour, contract_id: e.target.value })} />
          <Input label="Date" type="date" required value={labour.work_date} onChange={(e) => setLabour({ ...labour, work_date: e.target.value })} />
          <Select label="Kind" required options={[
            { value: 'labour', label: 'Labour' }, { value: 'vehicle', label: 'Vehicle trips' }, { value: 'other', label: 'Other direct cost' },
          ]} value={labour.kind} onChange={(e) => setLabour({ ...labour, kind: e.target.value })} />
          <Select label="Staff member" options={toOptions(employees, (e) => e.full_name)} placeholder="Not a named person"
            value={labour.employee_id} onChange={(e) => {
              const emp = (employees ?? []).find((x) => x.id === e.target.value);
              setLabour({ ...labour, employee_id: e.target.value, rate: emp ? Number(emp.daily_rate) : labour.rate });
            }} />
          <Input className="sm:col-span-2" label="Role or description" value={labour.role_description}
            onChange={(e) => setLabour({ ...labour, role_description: e.target.value })} placeholder="e.g. 2 cleaners, 26 days" />
          <Input label="Number of staff or trips" type="number" step="0.5" value={labour.staff_count} onChange={(e) => setLabour({ ...labour, staff_count: Number(e.target.value) })} />
          <Input label="Days" type="number" step="0.5" value={labour.days} onChange={(e) => setLabour({ ...labour, days: Number(e.target.value) })} />
          <Input label="Rate (GH₵)" type="number" step="0.01" value={labour.rate} onChange={(e) => setLabour({ ...labour, rate: Number(e.target.value) })} />
          <Input label="Actual wage paid (GH₵)" type="number" step="0.01" value={labour.actual_wage_amount}
            onChange={(e) => setLabour({ ...labour, actual_wage_amount: e.target.value })}
            hint="Overrides staff × days × rate when filled" />
          <Textarea className="sm:col-span-2" label="Notes" value={labour.notes} onChange={(e) => setLabour({ ...labour, notes: e.target.value })} />
        </div>
        <p className="mt-3 text-right text-sm text-stone-700">
          Amount <span className="font-semibold tabular-nums">
            {formatGHS(labour.actual_wage_amount !== '' ? Number(labour.actual_wage_amount) : labour.staff_count * labour.days * labour.rate)}
          </span>
        </p>
      </Modal>

      <Card className="mt-4" title="How this feeds profitability">
        <p className="flex items-start gap-2 text-sm text-stone-600">
          <Package className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
          Supplies, labour, vehicle trips and other direct costs recorded here are summed per contract per month and
          compared with what was billed. Open a contract's Profitability tab to see gross profit, margin and the
          variance against the estimate's budget.
        </p>
      </Card>
    </div>
  );
}
