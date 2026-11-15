import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Wrench } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { check, friendlyError } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { daysFrom, formatDate, formatGHS, formatNumber, humanize } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, DetailList } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Tabs } from '@/components/ui/Tabs';
import { Timeline } from '@/components/ui/Timeline';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { FileUpload } from '@/components/ui/FileUpload';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/ErrorState';
import { CommentsPanel } from '@/components/ui/CommentsPanel';
import { TruckStatusModal } from './TruckStatusModal';
import type { Tables } from '@/types/database';

type Tab = 'overview' | 'documents' | 'maintenance' | 'fuel' | 'jobs' | 'history' | 'comments';

interface TruckFull extends Tables<'trucks'> {
  driver: { id: string; full_name: string; phone: string | null; licence_no: string | null; licence_expiry: string | null } | null;
  truck_documents: Tables<'truck_documents'>[];
  truck_status_history: (Tables<'truck_status_history'> & { profile: { full_name: string } | null })[];
  maintenance_schedules: Tables<'maintenance_schedules'>[];
  maintenance_records: Tables<'maintenance_records'>[];
  fuel_logs: Tables<'fuel_logs'>[];
}

const DOC_TYPES = [
  { value: 'insurance', label: 'Insurance' }, { value: 'roadworthy', label: 'DVLA roadworthy' },
  { value: 'permit', label: 'Permit' }, { value: 'registration', label: 'Registration' }, { value: 'other', label: 'Other' },
];

function expiryTone(expiry: string): 'red' | 'amber' | 'green' {
  const days = daysFrom(expiry);
  if (days === null) return 'green';
  // daysFrom returns how many days ago; a future date gives a negative number.
  if (days >= 0) return 'red';
  if (days > -30) return 'amber';
  return 'green';
}

export default function TruckDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { roles } = useAuth();
  const canManage = hasAny(roles, 'fleet_manager');
  const [tab, setTab] = useState<Tab>('overview');
  const [statusOpen, setStatusOpen] = useState(false);
  const [docOpen, setDocOpen] = useState(false);
  const [doc, setDoc] = useState({ doc_type: 'insurance', doc_number: '', issue_date: '', expiry_date: '', notes: '', file_path: '' });
  const [saving, setSaving] = useState(false);

  const query = useQuery({
    queryKey: ['truck', id],
    queryFn: async () => check(await supabase.from('trucks')
      .select(`*, driver:employees(id, full_name, phone, licence_no, licence_expiry),
               truck_documents(*), truck_status_history(*, profile:profiles(full_name)),
               maintenance_schedules(*), maintenance_records(*), fuel_logs(*)`)
      .eq('id', id).single()) as TruckFull,
  });

  const { data: jobs = [] } = useQuery({
    queryKey: ['truck-jobs', id],
    enabled: tab === 'jobs',
    queryFn: async () => check(await supabase.from('job_order_assignments')
      .select('job_order_id, job:job_orders(id, job_no, customer_name, execution_date, status, agreed_amount)')
      .eq('truck_id', id).eq('kind', 'truck').order('created_at', { ascending: false }).limit(100)) as unknown as
      { job_order_id: string; job: { id: string; job_no: string | null; customer_name: string | null; execution_date: string; status: string; agreed_amount: number } | null }[],
  });

  const saveDoc = async () => {
    if (!doc.expiry_date) { toast.error('Expiry date is required'); return; }
    setSaving(true);
    try {
      check(await supabase.from('truck_documents').insert({
        truck_id: id, doc_type: doc.doc_type, doc_number: doc.doc_number || null,
        issue_date: doc.issue_date || null, expiry_date: doc.expiry_date, notes: doc.notes || null, file_path: doc.file_path || null,
      }));
      toast.success('Document saved');
      setDocOpen(false);
      setDoc({ doc_type: 'insurance', doc_number: '', issue_date: '', expiry_date: '', notes: '', file_path: '' });
      await query.refetch();
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  };

  const removeDoc = async (docId: string) => {
    const { error } = await supabase.from('truck_documents').delete().eq('id', docId);
    if (error) toast.error(friendlyError(error)); else await query.refetch();
  };

  if (query.isLoading) return <Spinner />;
  if (query.error || !query.data) return <ErrorState error={query.error ?? new Error('Not found')} onRetry={() => void query.refetch()} />;

  const t = query.data;
  const maintenanceCost = t.maintenance_records.reduce((s, m) => s + Number(m.cost), 0);
  const fuelCost = t.fuel_logs.reduce((s, f) => s + Number(f.cost), 0);
  const fuelLitres = t.fuel_logs.reduce((s, f) => s + Number(f.litres), 0);

  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'documents', label: 'Documents', count: t.truck_documents.length },
    { value: 'maintenance', label: 'Maintenance', count: t.maintenance_records.length },
    { value: 'fuel', label: 'Fuel', count: t.fuel_logs.length },
    { value: 'jobs', label: 'Jobs' },
    { value: 'history', label: 'Status history', count: t.truck_status_history.length },
    { value: 'comments', label: 'Comments' },
  ];

  return (
    <div>
      <PageHeader back="/fleet/trucks" title={t.registration_no}
        subtitle={<span className="flex flex-wrap items-center gap-2">
          <StatusBadge status={t.status} />
          <Badge tone="grey">{humanize(t.truck_type)}</Badge>
          {t.fleet_code ? <span className="text-stone-500">{t.fleet_code}</span> : null}
          {t.status === 'off_road' ? <span className="text-red-700">{humanize(t.off_road_reason)} · back {formatDate(t.expected_return_date)}</span> : null}
        </span>}
        actions={canManage ? <Button icon={<Wrench className="h-4 w-4" />} onClick={() => setStatusOpen(true)}>Change status</Button> : null} />

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      <div className="mt-4 space-y-4">
        {tab === 'overview' ? (
          <>
            <Card title="Truck">
              <DetailList items={[
                ['Registration', t.registration_no],
                ['Fleet code', t.fleet_code ?? '—'],
                ['Type', humanize(t.truck_type)],
                ['Make and model', [t.make, t.model, t.year].filter(Boolean).join(' ') || '—'],
                ['Capacity', t.capacity_litres ? `${formatNumber(t.capacity_litres)} litres` : t.capacity_cabins ? `${t.capacity_cabins} cabins` : '—'],
                ['Chassis number', t.chassis_no ?? '—'],
                ['Fuel', humanize(t.fuel_type)],
                ['Odometer', `${formatNumber(t.odometer_km)} km`],
                ['Assigned driver', t.driver ? <Link to="/fleet/employees" className="text-brand-700 hover:underline">{t.driver.full_name}</Link> : '—'],
                ['Driver licence', t.driver?.licence_no ? `${t.driver.licence_no} · expires ${formatDate(t.driver.licence_expiry)}` : '—'],
              ]} />
            </Card>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Card title="Maintenance cost"><p className="text-xl font-semibold tabular-nums">{formatGHS(maintenanceCost)}</p><p className="text-xs text-stone-500">{t.maintenance_records.length} record(s)</p></Card>
              <Card title="Fuel cost"><p className="text-xl font-semibold tabular-nums">{formatGHS(fuelCost)}</p><p className="text-xs text-stone-500">{formatNumber(fuelLitres)} litres</p></Card>
              <Card title="Next service"><p className="text-xl font-semibold">{t.maintenance_schedules.length ? formatDate(t.maintenance_schedules[0].next_due_date) : '—'}</p>
                <p className="text-xs text-stone-500">{t.maintenance_schedules[0]?.next_due_km ? `or at ${formatNumber(t.maintenance_schedules[0].next_due_km)} km` : 'No schedule set'}</p></Card>
            </div>
          </>
        ) : null}

        {tab === 'documents' ? (
          <Card title="Insurance, roadworthy and permits"
            actions={canManage ? <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setDocOpen(true)}>Add document</Button> : null}>
            {t.truck_documents.length ? (
              <table className="min-w-full text-sm">
                <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Type</th>
                    <th scope="col" className="px-3 py-2 font-medium">Number</th>
                    <th scope="col" className="px-3 py-2 font-medium">Issued</th>
                    <th scope="col" className="px-3 py-2 font-medium">Expires</th>
                    <th scope="col" className="px-3 py-2 font-medium">Notes</th>
                    {canManage ? <th scope="col" className="w-8 px-3 py-2" /> : null}
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {[...t.truck_documents].sort((a, b) => a.expiry_date.localeCompare(b.expiry_date)).map((d) => (
                    <tr key={d.id}>
                      <td className="px-3 py-2">{humanize(d.doc_type)}</td>
                      <td className="px-3 py-2">{d.doc_number ?? '—'}</td>
                      <td className="px-3 py-2">{formatDate(d.issue_date)}</td>
                      <td className="px-3 py-2">
                        <Badge tone={expiryTone(d.expiry_date)}>{formatDate(d.expiry_date)}</Badge>
                      </td>
                      <td className="px-3 py-2 text-stone-600">{d.notes ?? '—'}</td>
                      {canManage ? (
                        <td className="px-3 py-2">
                          <Button variant="ghost" size="sm" aria-label="Remove" onClick={() => void removeDoc(d.id)}><Trash2 className="h-4 w-4" /></Button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="text-sm text-stone-500">No documents on file. Reminders go out 30 and 7 days before an expiry date.</p>}
          </Card>
        ) : null}

        {tab === 'maintenance' ? (
          <>
            <Card title="Schedules" actions={<Link to="/fleet/maintenance"><Button size="sm" variant="secondary">Manage</Button></Link>}>
              {t.maintenance_schedules.length ? (
                <ul className="divide-y divide-stone-100 text-sm">
                  {t.maintenance_schedules.map((s) => (
                    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="font-medium">{s.title}</span>
                      <span className="text-stone-600">
                        {s.interval_days ? `every ${s.interval_days} days` : ''}{s.interval_days && s.interval_km ? ' or ' : ''}{s.interval_km ? `every ${formatNumber(s.interval_km)} km` : ''}
                      </span>
                      <span className="flex items-center gap-2">
                        {s.next_due_date ? <Badge tone={expiryTone(s.next_due_date)}>due {formatDate(s.next_due_date)}</Badge> : null}
                        {s.next_due_km ? <Badge tone="grey">at {formatNumber(s.next_due_km)} km</Badge> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-stone-500">No schedule yet.</p>}
            </Card>
            <Card title="Service records">
              {t.maintenance_records.length ? (
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Date</th>
                      <th scope="col" className="px-3 py-2 font-medium">Workshop</th>
                      <th scope="col" className="px-3 py-2 font-medium">Work done</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Odometer</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {[...t.maintenance_records].sort((a, b) => b.service_date.localeCompare(a.service_date)).map((m) => (
                      <tr key={m.id}>
                        <td className="px-3 py-2">{formatDate(m.service_date)}</td>
                        <td className="px-3 py-2">{m.workshop ?? '—'}</td>
                        <td className="px-3 py-2">{m.work_done}{m.parts ? <span className="block text-xs text-stone-500">Parts: {m.parts}</span> : null}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{m.odometer_km ? formatNumber(m.odometer_km) : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatGHS(m.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="text-sm text-stone-500">No service records yet.</p>}
            </Card>
          </>
        ) : null}

        {tab === 'fuel' ? (
          <Card title="Fuel log" actions={<Link to="/fleet/fuel"><Button size="sm" variant="secondary">Add entry</Button></Link>}>
            {t.fuel_logs.length ? (
              <table className="min-w-full text-sm">
                <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Date</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Litres</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Cost</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Odometer</th>
                    <th scope="col" className="px-3 py-2 font-medium">Station</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {[...t.fuel_logs].sort((a, b) => b.log_date.localeCompare(a.log_date)).map((f) => (
                    <tr key={f.id}>
                      <td className="px-3 py-2">{formatDate(f.log_date)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(f.litres)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatGHS(f.cost)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{f.odometer_km ? formatNumber(f.odometer_km) : '—'}</td>
                      <td className="px-3 py-2">{f.station ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="text-sm text-stone-500">No fuel entries yet.</p>}
          </Card>
        ) : null}

        {tab === 'jobs' ? (
          <Card title="Jobs this truck has worked">
            {jobs.length ? (
              <ul className="divide-y divide-stone-100 text-sm">
                {jobs.map((a) => a.job ? (
                  <li key={a.job_order_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link to={`/jobs/${a.job.id}`} className="font-medium text-brand-700 hover:underline">{a.job.job_no}</Link>
                    <span className="min-w-0 flex-1 truncate text-stone-700">{a.job.customer_name}</span>
                    <span className="text-stone-500">{formatDate(a.job.execution_date)}</span>
                    <span className="tabular-nums">{formatGHS(a.job.agreed_amount)}</span>
                    <StatusBadge status={a.job.status} />
                  </li>
                ) : null)}
              </ul>
            ) : <p className="text-sm text-stone-500">No jobs yet.</p>}
          </Card>
        ) : null}

        {tab === 'history' ? (
          <Card title="Status history">
            <Timeline items={[...t.truck_status_history]
              .sort((a, b) => b.changed_at.localeCompare(a.changed_at))
              .map((h) => ({
                at: h.changed_at,
                title: `${humanize(h.from_status) !== '—' ? `${humanize(h.from_status)} → ` : ''}${humanize(h.to_status)}`,
                detail: [h.reason ? humanize(h.reason) : null, h.note, h.expected_return_date ? `back ${formatDate(h.expected_return_date)}` : null].filter(Boolean).join(' · '),
                actor: h.profile?.full_name ?? 'System',
              }))} />
          </Card>
        ) : null}

        {tab === 'comments' ? <Card title="Comments"><CommentsPanel entityType="truck" entityId={t.id} /></Card> : null}
      </div>

      {statusOpen ? <TruckStatusModal truck={t} onClose={() => { setStatusOpen(false); void query.refetch(); }} /> : null}

      <Modal open={docOpen} onClose={() => setDocOpen(false)} title="Add a truck document" size="md"
        footer={<><Button variant="secondary" onClick={() => setDocOpen(false)}>Cancel</Button>
          <Button loading={saving} onClick={() => void saveDoc()}>Save</Button></>}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Select label="Type" required options={DOC_TYPES} value={doc.doc_type} onChange={(e) => setDoc({ ...doc, doc_type: e.target.value })} />
          <Input label="Document number" value={doc.doc_number} onChange={(e) => setDoc({ ...doc, doc_number: e.target.value })} />
          <Input label="Issue date" type="date" value={doc.issue_date} onChange={(e) => setDoc({ ...doc, issue_date: e.target.value })} />
          <Input label="Expiry date" type="date" required value={doc.expiry_date} onChange={(e) => setDoc({ ...doc, expiry_date: e.target.value })} />
          <Textarea className="sm:col-span-2" label="Notes" value={doc.notes} onChange={(e) => setDoc({ ...doc, notes: e.target.value })} />
          <div className="sm:col-span-2">
            <FileUpload bucket="fleet-documents" folder={`${id}/${doc.doc_type}`} label={doc.file_path ? 'Replace scan' : 'Attach a scan'}
              onUploaded={(path) => setDoc((d) => ({ ...d, file_path: path }))} />
            {doc.file_path ? <p className="mt-1 text-xs text-stone-500">Attached.</p> : null}
          </div>
        </div>
      </Modal>
    </div>
  );
}
