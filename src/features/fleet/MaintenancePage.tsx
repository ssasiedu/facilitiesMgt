import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CalendarClock, Plus } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { check } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { useServerTable } from '@/lib/useServerTable';
import { useBankAccounts, useTrucks, toOptions } from '@/lib/lookups';
import { daysFrom, formatDate, formatGHS, formatNumber, isoDate } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { DataTable, FilterSelect, type Column } from '@/components/ui/DataTable';
import type { Tables } from '@/types/database';

type RecordRow = Tables<'maintenance_records'> & { truck: { registration_no: string } | null };
type ScheduleRow = Tables<'maintenance_schedules'> & { truck: { id: string; registration_no: string; odometer_km: number } | null };

/** Maintenance schedules and service records (spec 4.5). Each record posts to Vehicle maintenance. */
export default function MaintenancePage() {
  const { roles } = useAuth();
  const canManage = hasAny(roles, 'fleet_manager');
  const { data: trucks } = useTrucks();
  const { data: banks } = useBankAccounts();
  const [truck, setTruck] = useState('');
  const [recordOpen, setRecordOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [record, setRecord] = useState({
    truck_id: '', schedule_id: '', service_date: isoDate(), workshop: '', work_done: '', parts: '',
    cost: 0, odometer_km: '', paid_from_bank_account_id: '',
  });
  const [schedule, setSchedule] = useState({ truck_id: '', title: 'Full service', interval_days: 90, interval_km: 10000, next_due_date: '', next_due_km: '' });

  const filters = useMemo(() => ({ truck_id: truck }), [truck]);
  const table = useServerTable<RecordRow>({
    table: 'maintenance_records',
    select: '*, truck:trucks(registration_no)',
    searchColumns: ['work_done', 'workshop', 'parts'],
    filters,
    defaultSort: { column: 'service_date', ascending: false },
  });

  const { data: schedules = [], refetch: refetchSchedules } = useQuery({
    queryKey: ['maintenance-schedules'],
    queryFn: async () => check(await supabase.from('maintenance_schedules')
      .select('*, truck:trucks(id, registration_no, odometer_km)')
      .eq('active', true).order('next_due_date', { nullsFirst: false })) as ScheduleRow[],
  });

  const saveRecord = async () => {
    if (!record.truck_id || !record.work_done.trim()) { toast.error('Truck and work done are required'); return; }
    setSaving(true);
    try {
      check(await supabase.from('maintenance_records').insert({
        truck_id: record.truck_id,
        schedule_id: record.schedule_id || null,
        service_date: record.service_date,
        workshop: record.workshop || null,
        work_done: record.work_done,
        parts: record.parts || null,
        cost: record.cost,
        odometer_km: record.odometer_km === '' ? null : Number(record.odometer_km),
        paid_from_bank_account_id: record.paid_from_bank_account_id || null,
      }));
      toast.success('Service recorded and posted to Vehicle maintenance');
      setRecordOpen(false);
      setRecord({ ...record, work_done: '', parts: '', cost: 0, odometer_km: '', schedule_id: '' });
      await table.refetch();
      await refetchSchedules();
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  };

  const saveSchedule = async () => {
    if (!schedule.truck_id || !schedule.title.trim()) { toast.error('Truck and title are required'); return; }
    if (!schedule.interval_days && !schedule.interval_km && !schedule.next_due_date && !schedule.next_due_km) {
      toast.error('Set an interval in days or kilometres, or a due date');
      return;
    }
    setSaving(true);
    try {
      check(await supabase.from('maintenance_schedules').insert({
        truck_id: schedule.truck_id,
        title: schedule.title,
        interval_days: schedule.interval_days || null,
        interval_km: schedule.interval_km || null,
        next_due_date: schedule.next_due_date || null,
        next_due_km: schedule.next_due_km === '' ? null : Number(schedule.next_due_km),
      }));
      toast.success('Schedule added');
      setScheduleOpen(false);
      await refetchSchedules();
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  };

  const columns: Column<RecordRow>[] = [
    { key: 'date', header: 'Date', sort: 'service_date', render: (r) => formatDate(r.service_date), exportValue: (r) => formatDate(r.service_date) },
    { key: 'truck', header: 'Truck', render: (r) => r.truck?.registration_no ?? '—', exportValue: (r) => r.truck?.registration_no },
    { key: 'work', header: 'Work done', render: (r) => (
      <>{r.work_done}{r.parts ? <span className="block text-xs text-stone-500">Parts: {r.parts}</span> : null}</>
    ), exportValue: (r) => r.work_done },
    { key: 'workshop', header: 'Workshop', render: (r) => r.workshop ?? '—', exportValue: (r) => r.workshop, hideOnMobile: true },
    { key: 'odo', header: 'Odometer', className: 'text-right', render: (r) => (r.odometer_km ? formatNumber(r.odometer_km) : '—'), exportValue: (r) => r.odometer_km, hideOnMobile: true },
    { key: 'cost', header: 'Cost', className: 'text-right', sort: 'cost', render: (r) => <span className="tabular-nums">{formatGHS(r.cost)}</span>, exportValue: (r) => r.cost },
    { key: 'posted', header: 'Posted', render: (r) => (r.journal_entry_id ? <Badge tone="green">Yes</Badge> : <Badge tone="grey">No</Badge>),
      exportValue: (r) => (r.journal_entry_id ? 'yes' : 'no'), hideOnMobile: true },
  ];

  const dueSoon = schedules.filter((s) => {
    const byDate = s.next_due_date ? (daysFrom(s.next_due_date) ?? -999) > -30 : false;
    const byKm = s.next_due_km && s.truck ? Number(s.truck.odometer_km) >= Number(s.next_due_km) - 1000 : false;
    return byDate || byKm;
  });

  return (
    <div>
      <PageHeader title="Maintenance" subtitle="Schedules by date or kilometre, and the service records that post to the ledger"
        actions={canManage ? <>
          <Button variant="secondary" icon={<CalendarClock className="h-4 w-4" />} onClick={() => setScheduleOpen(true)}>Add schedule</Button>
          <Button icon={<Plus className="h-4 w-4" />} onClick={() => setRecordOpen(true)}>Record a service</Button>
        </> : null} />

      {dueSoon.length ? (
        <Card className="mb-4 border-amber-200" title="Due soon">
          <ul className="space-y-1 text-sm">
            {dueSoon.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2">
                <Link to={`/fleet/trucks/${s.truck?.id}`} className="font-medium text-brand-700 hover:underline">{s.truck?.registration_no}</Link>
                <span className="min-w-0 flex-1 truncate text-stone-700">{s.title}</span>
                {s.next_due_date ? <Badge tone={(daysFrom(s.next_due_date) ?? -999) >= 0 ? 'red' : 'amber'}>due {formatDate(s.next_due_date)}</Badge> : null}
                {s.next_due_km ? <Badge tone="grey">at {formatNumber(s.next_due_km)} km · now {formatNumber(s.truck?.odometer_km ?? 0)}</Badge> : null}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-stone-500">Reminders also go to the Fleet Manager 30 and 7 days before a service or document falls due.</p>
        </Card>
      ) : null}

      <DataTable table={table} columns={columns} exportName="maintenance" searchPlaceholder="Work done, workshop or parts"
        toolbar={<FilterSelect label="Truck" value={truck} onChange={setTruck} options={toOptions(trucks, (t) => t.registration_no)} />}
        empty={{ title: 'No service records yet', action: canManage ? <Button onClick={() => setRecordOpen(true)}>Record a service</Button> : undefined }} />

      <Modal open={recordOpen} onClose={() => setRecordOpen(false)} title="Record a service" size="lg"
        footer={<><Button variant="secondary" onClick={() => setRecordOpen(false)}>Cancel</Button>
          <Button loading={saving} onClick={() => void saveRecord()}>Save</Button></>}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label="Truck" required options={toOptions(trucks, (t) => t.registration_no)} placeholder="Choose…"
            value={record.truck_id} onChange={(e) => setRecord({ ...record, truck_id: e.target.value, schedule_id: '' })} />
          <Select label="Against a schedule" options={schedules.filter((s) => s.truck_id === record.truck_id).map((s) => ({ value: s.id, label: s.title }))}
            placeholder="Not scheduled" value={record.schedule_id} onChange={(e) => setRecord({ ...record, schedule_id: e.target.value })} />
          <Input label="Service date" type="date" required value={record.service_date} onChange={(e) => setRecord({ ...record, service_date: e.target.value })} />
          <Input label="Workshop" value={record.workshop} onChange={(e) => setRecord({ ...record, workshop: e.target.value })} />
          <Textarea className="sm:col-span-2" label="Work done" required value={record.work_done} onChange={(e) => setRecord({ ...record, work_done: e.target.value })} />
          <Input label="Parts" value={record.parts} onChange={(e) => setRecord({ ...record, parts: e.target.value })} />
          <Input label="Odometer (km)" type="number" step="0.1" value={record.odometer_km} onChange={(e) => setRecord({ ...record, odometer_km: e.target.value })} />
          <Input label="Cost (GH₵)" type="number" step="0.01" required value={record.cost} onChange={(e) => setRecord({ ...record, cost: Number(e.target.value) })} />
          <Select label="Paid from" options={toOptions(banks, (b) => b.name)} placeholder="On credit (Accounts payable)"
            hint="Leave blank if the workshop invoices you" value={record.paid_from_bank_account_id}
            onChange={(e) => setRecord({ ...record, paid_from_bank_account_id: e.target.value })} />
        </div>
        <p className="mt-3 rounded-lg bg-stone-50 p-3 text-xs text-stone-600">
          Saving posts Dr Vehicle maintenance / Cr the account you paid from (or Accounts payable), and moves the
          schedule's next due date and kilometre reading forward.
        </p>
      </Modal>

      <Modal open={scheduleOpen} onClose={() => setScheduleOpen(false)} title="Add a maintenance schedule" size="md"
        footer={<><Button variant="secondary" onClick={() => setScheduleOpen(false)}>Cancel</Button>
          <Button loading={saving} onClick={() => void saveSchedule()}>Save</Button></>}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label="Truck" required options={toOptions(trucks, (t) => t.registration_no)} placeholder="Choose…"
            value={schedule.truck_id} onChange={(e) => setSchedule({ ...schedule, truck_id: e.target.value })} />
          <Input label="Title" required value={schedule.title} onChange={(e) => setSchedule({ ...schedule, title: e.target.value })} />
          <Input label="Every (days)" type="number" value={schedule.interval_days} onChange={(e) => setSchedule({ ...schedule, interval_days: Number(e.target.value) })} />
          <Input label="Every (km)" type="number" value={schedule.interval_km} onChange={(e) => setSchedule({ ...schedule, interval_km: Number(e.target.value) })} />
          <Input label="Next due date" type="date" value={schedule.next_due_date} onChange={(e) => setSchedule({ ...schedule, next_due_date: e.target.value })} />
          <Input label="Next due at (km)" type="number" value={schedule.next_due_km} onChange={(e) => setSchedule({ ...schedule, next_due_km: e.target.value })} />
        </div>
      </Modal>
    </div>
  );
}
