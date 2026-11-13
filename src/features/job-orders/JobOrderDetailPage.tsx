import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Ban, Check, LocateFixed, Pause, Pencil, Play, Printer, Send, Truck as TruckIcon, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { useAction } from '@/lib/rpc';
import { useRealtimeInvalidate } from '@/lib/realtime';
import { useSettings } from '@/lib/settings';
import { displayPhone, formatDate, formatDateTime, formatGHS, formatNumber, humanize, isoDate } from '@/lib/format';
import { getPosition } from '@/lib/geo';
import { useSignedUrl } from '@/lib/storage';
import { downloadPdf, openPdf } from '@/lib/pdf/download';
import { JobSheetPdf } from '@/lib/pdf/JobSheetPdf';
import { companyFromSettings } from '@/lib/pdf/company';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, DetailList } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Tabs } from '@/components/ui/Tabs';
import { Timeline } from '@/components/ui/Timeline';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { CommentsPanel } from '@/components/ui/CommentsPanel';
import { AttachmentsPanel } from '@/components/ui/AttachmentsPanel';
import { FileUpload } from '@/components/ui/FileUpload';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/ErrorState';
import { CompleteJobModal } from './CompleteJobModal';
import { addJobPhoto, approveJob, cancelJob, holdJob, loadJobOrder, rejectJob, resumeJob, startJob, submitJob, type JobOrderFull } from './api';

type Tab = 'overview' | 'resources' | 'costs' | 'photos' | 'timeline' | 'comments' | 'files';

function PhotoThumb({ path, caption }: { path: string; caption: string | null }) {
  const { data: url } = useSignedUrl('job-photos', path);
  return (
    <figure className="overflow-hidden rounded-lg border border-stone-200">
      {url ? <img src={url} alt={caption ?? 'Job photo'} className="h-32 w-full object-cover" loading="lazy" /> : <div className="h-32 w-full animate-pulse bg-stone-100" />}
      {caption ? <figcaption className="p-1.5 text-xs text-stone-600">{caption}</figcaption> : null}
    </figure>
  );
}

/** Job order detail with the status timeline and every workflow action (spec 4.4). */
export default function JobOrderDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { roles, profile } = useAuth();
  const settings = useSettings();
  const [tab, setTab] = useState<Tab>('overview');
  const [completeOpen, setCompleteOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | 'approve' | 'reject' | 'cancel' | 'hold' | 'start'>(null);

  const query = useQuery({ queryKey: ['job-order', id], queryFn: () => loadJobOrder(id) });
  useRealtimeInvalidate(['job_orders'], [['job-order', id]], `id=eq.${id}`);

  const invalidate = [['job-order', id], ['table', 'job_orders']];
  const submit = useAction(() => submitJob(id), { success: 'Sent for approval', invalidate });
  const approve = useAction(() => approveJob(id), { success: 'Approved. Invoice issued and messages queued.', invalidate, onSuccess: () => setConfirm(null) });
  const reject = useAction((reason: string) => rejectJob(id, reason), { success: 'Rejected and returned to draft', invalidate, onSuccess: () => setConfirm(null) });
  const start = useAction((coords: { lat?: number; lng?: number }) => startJob(id, coords.lat, coords.lng), { success: 'Job started', invalidate, onSuccess: () => setConfirm(null) });
  const cancel = useAction((reason: string) => cancelJob(id, reason), { success: 'Job cancelled', invalidate, onSuccess: () => setConfirm(null) });
  const hold = useAction((reason: string) => holdJob(id, reason), { success: 'Job put on hold', invalidate, onSuccess: () => setConfirm(null) });
  const resume = useAction(() => resumeJob(id), { success: 'Job resumed', invalidate });

  if (query.isLoading) return <Spinner />;
  if (query.error || !query.data) return <ErrorState error={query.error ?? new Error('Not found')} onRetry={() => void query.refetch()} />;

  const j: JobOrderFull = query.data;
  const isManager = hasAny(roles, 'manager');
  const canOperate = hasAny(roles, 'manager', 'ops_officer');
  const canEditDraft = hasAny(roles, 'manager', 'ops_officer', 'sales_exec');
  const raisedByMe = j.raised_by === profile?.id;
  const segregation = settings?.segregation_of_duties ?? true;
  // The database enforces this too; the UI explains why the button is missing.
  const canApprove = isManager && j.status === 'pending_approval' && !(segregation && raisedByMe);
  const canStart = canOperate && j.status === 'approved' && isoDate() >= j.execution_date;

  const trucks = j.job_order_assignments.filter((a) => a.kind === 'truck');
  const driver = j.job_order_assignments.find((a) => a.kind === 'driver');
  const crew = j.job_order_assignments.filter((a) => a.kind === 'crew');
  const actualCost = j.job_order_actual_costs.reduce((t, a) => t + Number(a.amount), 0);
  const beforePhotos = j.job_order_photos.filter((p) => p.kind === 'before');
  const afterPhotos = j.job_order_photos.filter((p) => p.kind === 'after');
  const sitePhotos = j.job_order_photos.filter((p) => p.kind === 'site');
  const signaturePhoto = j.job_order_photos.find((p) => p.kind === 'signature');

  const jobSheet = settings ? (
    <JobSheetPdf
      company={companyFromSettings(settings)}
      job={{
        job_no: j.job_no ?? 'Draft', execution_date: j.execution_date, end_date: j.end_date, time_window: j.time_window,
        priority: humanize(j.priority),
        customer_name: j.customer?.display_name ?? '—', customer_phone: j.contact?.phone ?? j.customer?.phone ?? j.customer?.company_phone ?? null,
        contact_name: j.contact?.name ?? null,
        site_address: j.site_address, digital_address: j.digital_address, instructions: j.instructions,
        officer: j.officer?.full_name ?? null,
        driver: driver?.employee?.full_name ?? null, driver_phone: driver?.employee?.phone ?? null,
        trucks: trucks.map((t) => t.truck?.registration_no ?? '').filter(Boolean),
        crew: crew.map((c) => c.employee?.full_name ?? '').filter(Boolean),
        lines: j.job_order_lines.map((l) => ({ service: l.service?.name ?? '', description: l.description, quantity: Number(l.quantity) })),
      }}
    />
  ) : null;

  const startWithGps = async () => {
    try {
      const p = await getPosition();
      start.mutate({ lat: p.lat, lng: p.lng });
    } catch {
      // Location is optional: start anyway so work is never blocked by a GPS problem.
      start.mutate({});
    }
  };

  const tabs: { value: Tab; label: string; count?: number }[] = [
    { value: 'overview', label: 'Overview' },
    { value: 'resources', label: 'Trucks and crew', count: trucks.length + crew.length + (driver ? 1 : 0) },
    { value: 'costs', label: 'Profitability', count: j.job_order_actual_costs.length },
    { value: 'photos', label: 'Photos', count: j.job_order_photos.length },
    { value: 'timeline', label: 'Timeline', count: j.job_order_status_history.length },
    { value: 'comments', label: 'Comments' },
    { value: 'files', label: 'Attachments' },
  ];

  return (
    <div>
      <PageHeader back="/jobs" title={`Job order ${j.job_no ?? 'draft'}`}
        subtitle={<span className="flex flex-wrap items-center gap-2">
          <StatusBadge status={j.status} />
          <Badge tone={j.priority === 'urgent' ? 'red' : j.priority === 'high' ? 'amber' : 'grey'}>{humanize(j.priority)} priority</Badge>
          {j.needs_reassignment ? <Badge tone="red">Needs a new truck</Badge> : null}
          {j.credit_warning ? <Badge tone="amber">Over credit limit</Badge> : null}
          <span className="text-stone-500">{formatDate(j.execution_date)}{j.end_date ? ` – ${formatDate(j.end_date)}` : ''}{j.time_window ? ` · ${j.time_window}` : ''}</span>
        </span>}
        actions={<>
          {['draft', 'rejected'].includes(j.status) && canEditDraft ? <>
            <Link to={`/jobs/${j.id}/edit`}><Button variant="secondary" icon={<Pencil className="h-4 w-4" />}>Edit</Button></Link>
            <Button icon={<Send className="h-4 w-4" />} loading={submit.isPending} onClick={() => submit.mutate()}>Send for approval</Button>
          </> : null}
          {canApprove ? <>
            <Button variant="success" icon={<Check className="h-4 w-4" />} onClick={() => setConfirm('approve')}>Approve</Button>
            <Button variant="danger" icon={<X className="h-4 w-4" />} onClick={() => setConfirm('reject')}>Reject</Button>
          </> : null}
          {canStart ? (
            <Button size="lg" icon={<Play className="h-5 w-5" />} loading={start.isPending} onClick={() => void startWithGps()}>Start job</Button>
          ) : null}
          {canOperate && j.status === 'in_progress' ? (
            <Button variant="success" size="lg" icon={<Check className="h-5 w-5" />} onClick={() => setCompleteOpen(true)}>Mark completed</Button>
          ) : null}
          {isManager && ['approved', 'in_progress'].includes(j.status) ? (
            <Button variant="secondary" icon={<Pause className="h-4 w-4" />} onClick={() => setConfirm('hold')}>Hold</Button>
          ) : null}
          {isManager && j.status === 'on_hold' ? (
            <Button variant="secondary" icon={<Undo2 className="h-4 w-4" />} loading={resume.isPending} onClick={() => resume.mutate()}>Resume</Button>
          ) : null}
          {isManager && !['completed', 'closed', 'cancelled'].includes(j.status) ? (
            <Button variant="danger" icon={<Ban className="h-4 w-4" />} onClick={() => setConfirm('cancel')}>Cancel</Button>
          ) : null}
          {jobSheet ? <>
            <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => void openPdf(jobSheet)}>Job sheet</Button>
          </> : null}
        </>} />

      {j.status === 'approved' && !canStart && canOperate ? (
        <p className="mb-4 rounded-lg bg-stone-100 p-3 text-sm text-stone-700">
          The Start button opens on {formatDate(j.execution_date)}, the execution date.
        </p>
      ) : null}
      {isManager && j.status === 'pending_approval' && segregation && raisedByMe ? (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          You raised this job order, so you cannot approve it yourself. Another Manager has to approve it.
          A Super Admin can switch this off in Settings &gt; Configuration.
        </p>
      ) : null}
      {j.needs_reassignment ? (
        <p className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          <TruckIcon className="mt-0.5 h-4 w-4 shrink-0" />
          A truck booked for this job went Off-Road{j.reassignment_note ? `: ${j.reassignment_note}` : ''}. Assign another truck from Trucks and crew.
        </p>
      ) : null}
      {j.status === 'rejected' && j.rejection_reason ? (
        <p className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">Rejected: {j.rejection_reason}</p>
      ) : null}
      {j.status === 'on_hold' && j.hold_reason ? (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">On hold: {j.hold_reason}</p>
      ) : null}
      {j.status === 'cancelled' && j.cancel_reason ? (
        <p className="mb-4 rounded-lg bg-stone-100 p-3 text-sm text-stone-700">Cancelled: {j.cancel_reason}</p>
      ) : null}

      <Tabs tabs={tabs} value={tab} onChange={setTab} />

      <div className="mt-4 space-y-4">
        {tab === 'overview' ? (
          <>
            <Card title="Job order">
              <DetailList items={[
                ['Customer', j.customer ? <Link to={`/customers/${j.customer.id}`} className="text-brand-700 hover:underline">{j.customer.display_name}</Link> : '—'],
                ['Contact', j.contact ? `${j.contact.name}${j.contact.phone ? ` · ${displayPhone(j.contact.phone)}` : ''}` : displayPhone(j.customer?.phone ?? j.customer?.company_phone)],
                ['Channel', humanize(j.channel)],
                ['Raised by', j.raiser?.full_name ?? '—'],
                ['Officer in charge', j.officer?.full_name ?? '—'],
                ['Approved by', j.approver?.full_name ? `${j.approver.full_name} · ${formatDateTime(j.approved_at)}` : '—'],
                ['Site', j.site_address ?? '—'],
                ['GhanaPost GPS', j.digital_address ?? '—'],
                ['Contract', j.contract ? <Link to={`/contracts/${j.contract.id}`} className="text-brand-700 hover:underline">{j.contract.contract_no} · {j.contract.title}</Link> : 'Not under a contract'],
                ['Estimate', j.estimate ? <Link to={`/estimates/${j.estimate.id}`} className="text-brand-700 hover:underline">{j.estimate.estimate_no}</Link> : '—'],
                ['Instructions', j.instructions ?? '—'],
                ['Signed off by', j.signoff_name ? `${j.signoff_name} · ${formatDateTime(j.completed_at)}` : '—'],
              ]} />
            </Card>

            <Card title="Service lines">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Service</th>
                      <th scope="col" className="px-3 py-2 font-medium">Description</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Qty</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Unit price</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Discount</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {j.job_order_lines.map((l) => (
                      <tr key={l.id}>
                        <td className="px-3 py-2">{l.service?.name}</td>
                        <td className="px-3 py-2 text-stone-600">{l.description ?? '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatNumber(l.quantity)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatGHS(l.unit_price)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{Number(l.discount) ? formatGHS(l.discount) : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatGHS(l.line_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <dl className="mt-3 ml-auto w-full max-w-xs space-y-1 text-sm">
                <div className="flex justify-between"><dt className="text-stone-600">Subtotal</dt><dd className="tabular-nums">{formatGHS(j.subtotal)}</dd></div>
                {Number(j.discount_total) ? <div className="flex justify-between"><dt className="text-stone-600">Discount</dt><dd className="tabular-nums">-{formatGHS(j.discount_total)}</dd></div> : null}
                {Number(j.tax_total) ? <div className="flex justify-between"><dt className="text-stone-600">Tax</dt><dd className="tabular-nums">{formatGHS(j.tax_total)}</dd></div> : null}
                <div className="flex justify-between border-t border-stone-200 pt-1 font-semibold"><dt>Agreed amount</dt><dd className="tabular-nums">{formatGHS(j.agreed_amount)}</dd></div>
              </dl>
            </Card>

            {j.invoice ? (
              <Card title="Invoice">
                <DetailList items={[
                  ['Invoice', <Link to={`/finance/invoices/${j.invoice.id}`} className="text-brand-700 hover:underline">{j.invoice.invoice_no}</Link>],
                  ['Status', <StatusBadge status={j.invoice.status} />],
                  ['Total', formatGHS(j.invoice.total)],
                  ['Balance', formatGHS(j.invoice.balance)],
                  ['Due date', j.invoice.due_date ? formatDate(j.invoice.due_date) : 'Set when the job completes'],
                ]} />
              </Card>
            ) : null}
          </>
        ) : null}

        {tab === 'resources' ? (
          <>
            <Card title="Trucks" actions={j.needs_reassignment && canOperate ? <Link to={`/jobs/${j.id}/edit`}><Button size="sm" variant="secondary">Reassign</Button></Link> : null}>
              {trucks.length ? (
                <ul className="divide-y divide-stone-100">
                  {trucks.map((a) => (
                    <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                      <Link to={`/fleet/trucks/${a.truck_id}`} className="font-medium text-brand-700 hover:underline">{a.truck?.registration_no}</Link>
                      <Badge tone="grey">{humanize(a.truck?.truck_type)}</Badge>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-stone-500">No truck assigned.</p>}
            </Card>
            <Card title="Driver and crew">
              <ul className="divide-y divide-stone-100 text-sm">
                {driver ? (
                  <li className="flex items-center justify-between py-2">
                    <span className="font-medium">{driver.employee?.full_name}</span>
                    <span className="flex items-center gap-2"><Badge tone="blue">Driver</Badge>{displayPhone(driver.employee?.phone)}</span>
                  </li>
                ) : <li className="py-2 text-stone-500">No driver assigned.</li>}
                {crew.map((c) => (
                  <li key={c.id} className="flex items-center justify-between py-2">
                    <span>{c.employee?.full_name}</span>
                    <span className="flex items-center gap-2"><Badge tone="grey">{humanize(c.employee?.role_type)}</Badge>{displayPhone(c.employee?.phone)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </>
        ) : null}

        {tab === 'costs' ? (
          <>
            <Card title="Job profitability">
              <DetailList items={[
                ['Invoice amount', formatGHS(j.agreed_amount)],
                ['Actual cost recorded', formatGHS(actualCost)],
                ['Profit', <span className={Number(j.agreed_amount) - actualCost < 0 ? 'font-semibold text-red-700' : 'font-semibold text-emerald-700'}>
                  {formatGHS(Number(j.agreed_amount) - actualCost)}
                </span>],
                ['Estimated cost', j.estimate ? formatGHS(j.estimate.total_cost) : '—'],
                ['Variance against estimate', j.estimate ? (
                  <span className={actualCost - Number(j.estimate.total_cost) > 0 ? 'text-red-700' : 'text-emerald-700'}>
                    {actualCost - Number(j.estimate.total_cost) > 0 ? '+' : ''}{formatGHS(actualCost - Number(j.estimate.total_cost))}
                  </span>
                ) : '—'],
              ]} />
            </Card>
            <Card title="Actual resources used">
              {j.job_order_actual_costs.length ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-medium">Category</th>
                        <th scope="col" className="px-3 py-2 font-medium">Description</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Qty</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Unit cost</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {j.job_order_actual_costs.map((a) => (
                        <tr key={a.id}>
                          <td className="px-3 py-2"><Badge tone="brand">{humanize(a.category)}</Badge></td>
                          <td className="px-3 py-2">{a.cost_item?.name ?? a.description}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatNumber(a.quantity)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatGHS(a.unit_cost)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatGHS(a.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-sm text-stone-500">Nothing recorded yet. Resources are captured when the job is marked completed.</p>}
            </Card>
          </>
        ) : null}

        {tab === 'photos' ? (
          <>
            {j.status === 'in_progress' || j.status === 'approved' ? (
              <Card title="Add photos">
                <div className="flex flex-wrap gap-2">
                  <FileUpload bucket="job-photos" folder={`${j.id}/before`} label="Before photo" capture accept="image/jpeg,image/png"
                    onUploaded={async (path) => { await addJobPhoto(j.id, 'before', path); toast.success('Photo added'); void query.refetch(); }} />
                  <FileUpload bucket="job-photos" folder={`${j.id}/site`} label="Site photo" capture accept="image/jpeg,image/png"
                    onUploaded={async (path) => { await addJobPhoto(j.id, 'site', path); toast.success('Photo added'); void query.refetch(); }} />
                </div>
              </Card>
            ) : null}
            {[['Before', beforePhotos], ['After', afterPhotos], ['Site', sitePhotos]].map(([label, list]) => {
              const photos = list as JobOrderFull['job_order_photos'];
              return photos.length ? (
                <Card key={label as string} title={`${label as string} photos`}>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {photos.map((p) => <PhotoThumb key={p.id} path={p.file_path} caption={p.caption} />)}
                  </div>
                </Card>
              ) : null;
            })}
            {signaturePhoto ? (
              <Card title="Customer signature">
                <div className="max-w-sm"><PhotoThumb path={signaturePhoto.file_path} caption={signaturePhoto.caption} /></div>
              </Card>
            ) : null}
            {!j.job_order_photos.length ? <Card><p className="text-sm text-stone-500">No photos yet.</p></Card> : null}
          </>
        ) : null}

        {tab === 'timeline' ? (
          <Card title="Status timeline">
            <Timeline items={[...j.job_order_status_history]
              .sort((a, b) => b.changed_at.localeCompare(a.changed_at))
              .map((h) => ({
                at: h.changed_at,
                title: `${humanize(h.from_status) !== '—' ? `${humanize(h.from_status)} → ` : ''}${humanize(h.to_status)}`,
                detail: h.note,
                actor: h.profile?.full_name ?? 'System',
              }))} />
            {j.start_lat !== null && j.start_lng !== null ? (
              <p className="mt-3 flex items-center gap-1 text-xs text-stone-500">
                <LocateFixed className="h-3.5 w-3.5" />
                Started at {j.start_lat}, {j.start_lng}
              </p>
            ) : null}
          </Card>
        ) : null}

        {tab === 'comments' ? <Card title="Comments"><CommentsPanel entityType="job_order" entityId={j.id} /></Card> : null}
        {tab === 'files' ? <Card title="Attachments"><AttachmentsPanel entityType="job_order" entityId={j.id} bucket="job-photos" folder={`${j.id}/files`} /></Card> : null}
      </div>

      <CompleteJobModal job={j} open={completeOpen} onClose={() => setCompleteOpen(false)} onDone={() => void query.refetch()} />

      <ConfirmDialog open={confirm === 'approve'} onClose={() => setConfirm(null)} title="Approve this job order?"
        confirmLabel="Approve" loading={approve.isPending} onConfirm={() => approve.mutate()}
        message={<>
          Approving will book the truck for these dates, issue invoice for {formatGHS(j.agreed_amount)},
          post Dr Accounts receivable / Cr Deferred revenue, and queue messages to the customer, the driver and the officer.
        </>} />

      <ConfirmDialog open={confirm === 'reject'} onClose={() => setConfirm(null)} title="Reject this job order" danger
        confirmLabel="Reject" reasonLabel="Reason (sent to the officer who raised it)" loading={reject.isPending}
        onConfirm={(reason) => reject.mutate(reason)} />

      <ConfirmDialog open={confirm === 'cancel'} onClose={() => setConfirm(null)} title="Cancel this job order" danger
        confirmLabel="Cancel job" reasonLabel="Reason" loading={cancel.isPending} onConfirm={(reason) => cancel.mutate(reason)}
        message={j.invoice ? 'The invoice will be reversed with a credit note and the truck booking released.' : 'The truck booking will be released.'} />

      <ConfirmDialog open={confirm === 'hold'} onClose={() => setConfirm(null)} title="Put this job on hold"
        confirmLabel="Put on hold" reasonLabel="Reason" loading={hold.isPending} onConfirm={(reason) => hold.mutate(reason)} />

      {jobSheet ? (
        <div className="mt-4">
          <Button variant="ghost" size="sm" onClick={() => void downloadPdf(jobSheet, `job-sheet-${j.job_no ?? j.id}`)}>Download job sheet PDF</Button>
        </div>
      ) : null}
    </div>
  );
}
