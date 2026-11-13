import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { check } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { useServerTable } from '@/lib/useServerTable';
import { useBankAccounts, useTrucks, toOptions } from '@/lib/lookups';
import { formatDate, formatGHS, formatNumber, isoDate } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { AsyncPicker } from '@/components/ui/AsyncPicker';
import { DataTable, FilterSelect, type Column } from '@/components/ui/DataTable';
import { DateRange } from '@/components/ui/DateRange';
import { searchJobOrders } from '@/features/job-orders/api';
import type { Tables } from '@/types/database';

type Row = Tables<'fuel_logs'> & { truck: { registration_no: string } | null; job: { id: string; job_no: string | null } | null };

/** Fuel log (spec 4.5). Feeds actual job cost, fuel efficiency and the Fuel expense account. */
export default function FuelLogPage() {
  const { roles } = useAuth();
  const canRecord = hasAny(roles, 'fleet_manager', 'ops_officer', 'manager', 'accountant');
  const { data: trucks } = useTrucks();
  const { data: banks } = useBankAccounts();
  const [truck, setTruck] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [jobLabel, setJobLabel] = useState<string | null>(null);
  const [entry, setEntry] = useState({
    truck_id: '', log_date: isoDate(), litres: 0, cost: 0, odometer_km: '', job_order_id: '', station: '', paid_from_bank_account_id: '',
  });

  const filters = useMemo(() => ({ truck_id: truck, '>=log_date': from || undefined, '<=log_date': to || undefined }), [truck, from, to]);
  const table = useServerTable<Row>({
    table: 'fuel_logs',
    select: '*, truck:trucks(registration_no), job:job_orders(id, job_no)',
    searchColumns: ['station'],
    filters,
    defaultSort: { column: 'log_date', ascending: false },
  });

  const save = async () => {
    if (!entry.truck_id || entry.litres <= 0) { toast.error('Truck and litres are required'); return; }
    setSaving(true);
    try {
      check(await supabase.from('fuel_logs').insert({
        truck_id: entry.truck_id,
        log_date: entry.log_date,
        litres: entry.litres,
        cost: entry.cost,
        odometer_km: entry.odometer_km === '' ? null : Number(entry.odometer_km),
        job_order_id: entry.job_order_id || null,
        station: entry.station || null,
        paid_from_bank_account_id: entry.paid_from_bank_account_id || null,
      }));
      toast.success('Fuel entry saved and posted to Fuel');
      setOpen(false);
      setEntry({ ...entry, litres: 0, cost: 0, odometer_km: '', job_order_id: '', station: '' });
      setJobLabel(null);
      await table.refetch();
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  };

  const litres = table.rows.reduce((s, r) => s + Number(r.litres), 0);
  const cost = table.rows.reduce((s, r) => s + Number(r.cost), 0);

  const columns: Column<Row>[] = [
    { key: 'date', header: 'Date', sort: 'log_date', render: (r) => formatDate(r.log_date), exportValue: (r) => formatDate(r.log_date) },
    { key: 'truck', header: 'Truck', render: (r) => r.truck?.registration_no ?? '—', exportValue: (r) => r.truck?.registration_no },
    { key: 'litres', header: 'Litres', className: 'text-right', sort: 'litres', render: (r) => <span className="tabular-nums">{formatNumber(r.litres)}</span>, exportValue: (r) => r.litres },
    { key: 'cost', header: 'Cost', className: 'text-right', sort: 'cost', render: (r) => <span className="tabular-nums">{formatGHS(r.cost)}</span>, exportValue: (r) => r.cost },
    { key: 'per_litre', header: 'Per litre', className: 'text-right',
      render: (r) => <span className="tabular-nums">{Number(r.litres) ? formatGHS(Number(r.cost) / Number(r.litres)) : '—'}</span>,
      exportValue: (r) => (Number(r.litres) ? Number(r.cost) / Number(r.litres) : null), hideOnMobile: true },
    { key: 'odo', header: 'Odometer', className: 'text-right', render: (r) => (r.odometer_km ? formatNumber(r.odometer_km) : '—'), exportValue: (r) => r.odometer_km, hideOnMobile: true },
    { key: 'job', header: 'Job order', render: (r) => (r.job?.job_no ?? <span className="text-stone-400">—</span>), exportValue: (r) => r.job?.job_no, hideOnMobile: true },
    { key: 'station', header: 'Station', render: (r) => r.station ?? '—', exportValue: (r) => r.station, hideOnMobile: true },
  ];

  return (
    <div>
      <PageHeader title="Fuel log" subtitle="Every fill-up, so you can see cost per km and cost per job"
        actions={canRecord ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>Add entry</Button> : null} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card title="Litres on this page"><p className="text-xl font-semibold tabular-nums">{formatNumber(litres)}</p></Card>
        <Card title="Cost on this page"><p className="text-xl font-semibold tabular-nums">{formatGHS(cost)}</p></Card>
        <Card title="Average per litre"><p className="text-xl font-semibold tabular-nums">{litres ? formatGHS(cost / litres) : '—'}</p></Card>
        <Card title="Entries"><p className="text-xl font-semibold tabular-nums">{table.count}</p></Card>
      </div>

      <DataTable table={table} columns={columns} exportName="fuel-log" searchPlaceholder="Station"
        toolbar={<>
          <FilterSelect label="Truck" value={truck} onChange={setTruck} options={toOptions(trucks, (t) => t.registration_no)} />
          <DateRange presets={false} from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        </>}
        empty={{ title: 'No fuel entries yet', action: canRecord ? <Button onClick={() => setOpen(true)}>Add the first entry</Button> : undefined }} />

      <Modal open={open} onClose={() => setOpen(false)} title="Add a fuel entry" size="lg"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button loading={saving} onClick={() => void save()}>Save</Button></>}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label="Truck" required options={toOptions(trucks, (t) => t.registration_no)} placeholder="Choose…"
            value={entry.truck_id} onChange={(e) => setEntry({ ...entry, truck_id: e.target.value })} />
          <Input label="Date" type="date" required value={entry.log_date} onChange={(e) => setEntry({ ...entry, log_date: e.target.value })} />
          <Input label="Litres" type="number" step="0.001" required value={entry.litres} onChange={(e) => setEntry({ ...entry, litres: Number(e.target.value) })} />
          <Input label="Cost (GH₵)" type="number" step="0.01" required value={entry.cost} onChange={(e) => setEntry({ ...entry, cost: Number(e.target.value) })} />
          <Input label="Odometer (km)" type="number" step="0.1" value={entry.odometer_km} onChange={(e) => setEntry({ ...entry, odometer_km: e.target.value })}
            hint="Needed to work out km per litre" />
          <Input label="Station" value={entry.station} onChange={(e) => setEntry({ ...entry, station: e.target.value })} />
          <AsyncPicker label="Against a job order" queryKey="jobs-fuel" value={entry.job_order_id || null} valueLabel={jobLabel}
            onChange={(jid, item) => { setEntry({ ...entry, job_order_id: jid ?? '' }); setJobLabel(item?.label ?? null); }}
            search={searchJobOrders} placeholder="Not tied to one job" />
          <Select label="Paid from" options={toOptions(banks, (b) => b.name)} placeholder="Cash on hand"
            value={entry.paid_from_bank_account_id} onChange={(e) => setEntry({ ...entry, paid_from_bank_account_id: e.target.value })} />
        </div>
        <p className="mt-3 rounded-lg bg-stone-50 p-3 text-xs text-stone-600">
          Saving posts Dr Fuel / Cr the account it was paid from, and counts towards the job's actual cost when a job order is chosen.
        </p>
        {entry.litres > 0 && entry.cost > 0 ? (
          <p className="mt-2 text-sm text-stone-700">That is <Badge tone="brand">{formatGHS(entry.cost / entry.litres)} per litre</Badge></p>
        ) : null}
      </Modal>
    </div>
  );
}
