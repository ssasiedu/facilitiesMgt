import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ExternalLink, MessageSquare, Pencil, Plus, Trash2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { check, rpc, useAction } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { canEdit, hasAny } from '@/lib/permissions';
import { contactSchema, type ContactForm } from '@/lib/schemas';
import { displayPhone, formatDate, formatDateTime, formatGHS, humanize } from '@/lib/format';
import { signedUrl } from '@/lib/storage';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, DetailList } from '@/components/ui/Card';
import { Tabs } from '@/components/ui/Tabs';
import { StatCard } from '@/components/ui/StatCard';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Checkbox } from '@/components/ui/Checkbox';
import { FileUpload } from '@/components/ui/FileUpload';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Timeline } from '@/components/ui/Timeline';
import { CommentsPanel } from '@/components/ui/CommentsPanel';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { StatementTab } from './StatementTab';
import { saveContact, sendCustomerBalance, sendCustomerMessage, type Contact, type Customer } from './api';

type Tab = 'overview' | 'jobs' | 'contracts' | 'estimates' | 'invoices' | 'payments' | 'statement' | 'documents' | 'surveys' | 'messages' | 'activity';

interface Overview { lifetime_value: number; outstanding: number; overdue: number; available_credit: number; last_job: { id: string; job_no: string; date: string; status: string } | null; jobs: number; active_contracts: number; avg_survey: number | null; nps: number | null }

function SimpleList<T>({ rows, cols, empty }: { rows: T[] | undefined; cols: [string, (r: T) => ReactNode][]; empty: string }) {
  if (!rows?.length) return <p className="py-6 text-center text-sm text-stone-500">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="text-left text-xs uppercase text-stone-500"><tr>{cols.map(([h]) => <th key={h} className="px-2 py-2">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-stone-100">{rows.map((r, i) => <tr key={i}>{cols.map(([h, f]) => <td key={h} className="px-2 py-2">{f(r)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export default function CustomerProfilePage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const { roles, is } = useAuth();
  const [tab, setTab] = useState<Tab>('overview');
  const [contact, setContact] = useState<Contact | 'new' | null>(null);
  const [docType, setDocType] = useState('other');

  const cust = useQuery({ queryKey: ['customer', id], queryFn: async () => check(await supabase.from('customers').select('*, zone:zones(name), assigned:profiles!customers_assigned_to_fkey(full_name)').eq('id', id).single()) as Customer & { zone: { name: string } | null; assigned: { full_name: string } | null } });
  const overview = useQuery({ queryKey: ['customer-overview', id], queryFn: () => rpc<Overview>('get_customer_overview', { p_customer_id: id }) });
  const contacts = useQuery({ queryKey: ['contacts', id], queryFn: async () => check(await supabase.from('customer_contacts').select('*').eq('customer_id', id).order('is_primary', { ascending: false })) as Contact[] });
  const useCustList = (key: string, table: string, select: string, order: string, enabled: boolean) => useQuery({
    queryKey: [key, id], enabled, queryFn: async () => check(await supabase.from(table).select(select).eq('customer_id', id).order(order, { ascending: false }).limit(200)) as unknown as Record<string, any>[],
  });
  const jobs = useCustList('cust-jobs', 'job_orders', 'id, job_no, status, execution_date, agreed_amount', 'execution_date', tab === 'jobs');
  const contracts = useCustList('cust-contracts', 'contracts', 'id, contract_no, title, contract_type, status, start_date, end_date, amount_per_period', 'start_date', tab === 'contracts');
  const estimates = useCustList('cust-estimates', 'estimates', 'id, estimate_no, version, title, status, proposed_price, margin_pct', 'created_at', tab === 'estimates');
  const invoices = useCustList('cust-invoices', 'invoices', 'id, invoice_no, status, issue_date, due_date, total, balance', 'issue_date', tab === 'invoices');
  const payments = useCustList('cust-payments', 'payments', 'id, payment_no, payment_date, amount, method_code, reference, receipts(receipt_no, public_token)', 'payment_date', tab === 'payments');
  const docs = useCustList('cust-docs', 'customer_documents', '*', 'created_at', tab === 'documents');
  const surveys = useCustList('cust-surveys', 'survey_responses', 'id, submitted_at, csat, nps_score, comments, is_low', 'submitted_at', tab === 'surveys');
  const messages = useCustList('cust-messages', 'notifications', 'id, created_at, channel, event_code, body, status, recipient_phone, recipient_email, error', 'created_at', tab === 'messages');
  const timeline = useQuery({ queryKey: ['timeline', 'customer', id], enabled: tab === 'activity', queryFn: () => rpc<{ at: string; kind: string; title: string; detail: string | null; actor: string | null }[]>('get_activity_timeline', { p_entity_type: 'customer', p_entity_id: id }) });

  const [messageOpen, setMessageOpen] = useState(false);
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [msg, setMsg] = useState({ channel: 'sms' as 'sms' | 'email', subject: '', body: '' });
  const [balanceNote, setBalanceNote] = useState({ channel: 'sms' as 'sms' | 'email', note: '' });

  const sendMessage = useAction(() => sendCustomerMessage(id, msg.channel, msg.body, msg.subject), {
    success: 'Message queued — it goes out within the minute',
    invalidate: [['cust-messages', id]],
    onSuccess: () => { setMessageOpen(false); setMsg({ channel: 'sms', subject: '', body: '' }); },
  });

  const sendBalance = useAction(() => sendCustomerBalance(id, balanceNote.channel, balanceNote.note), {
    success: 'Balance queued — it goes out within the minute',
    invalidate: [['cust-messages', id]],
    onSuccess: () => { setBalanceOpen(false); setBalanceNote({ channel: 'sms', note: '' }); },
  });

  const contactForm = useForm<ContactForm>({ resolver: zodResolver(contactSchema), defaultValues: { name: '', position: '', phone: '', email: '', ghana_card_no: '', is_primary: false, receives_invoices: false } });

  if (cust.isLoading) return <PageSkeleton />;
  if (cust.error || !cust.data) return <ErrorState error={cust.error ?? new Error('Customer not found')} onRetry={() => cust.refetch()} />;
  const c = cust.data;
  const o = overview.data;
  const editable = canEdit(roles, 'customers');
  const canMessage = editable || hasAny(roles, 'accountant', 'manager', 'sales_exec', 'ops_officer');
  const hasPhone = !!(c.phone || c.company_phone);
  const hasEmail = !!(c.email || c.company_email);

  return (
    <div>
      <PageHeader back="/customers" title={<span className="flex flex-wrap items-center gap-2">{c.display_name}<StatusBadge status={c.status} /></span>}
        subtitle={<span>{c.customer_code} · {humanize(c.customer_type)} · registered {formatDate(c.registered_on)}</span>}
        actions={<>
          {is('ops_officer', 'sales_exec', 'manager') && c.status !== 'blacklisted' ? <Link to={`/jobs/new?customer=${c.id}`}><Button variant="secondary">New job order</Button></Link> : null}
          {is('ops_officer', 'sales_exec', 'manager') ? <Link to={`/estimates/new?customer=${c.id}`}><Button variant="secondary">New estimate</Button></Link> : null}
          {canMessage ? <Button variant="secondary" icon={<MessageSquare className="h-4 w-4" />} onClick={() => setMessageOpen(true)}>Send a message</Button> : null}
          {canMessage ? <Button variant="secondary" icon={<Wallet className="h-4 w-4" />} onClick={() => setBalanceOpen(true)}>Send balance</Button> : null}
          {editable ? <Link to={`/customers/${c.id}/edit`}><Button icon={<Pencil className="h-4 w-4" />}>Edit</Button></Link> : null}
        </>} />
      <Tabs<Tab> value={tab} onChange={setTab} tabs={[
        { value: 'overview', label: 'Overview' }, { value: 'jobs', label: 'Job orders' }, { value: 'contracts', label: 'Contracts' }, { value: 'estimates', label: 'Estimates' },
        { value: 'invoices', label: 'Invoices' }, { value: 'payments', label: 'Payments' }, { value: 'statement', label: 'Statement' }, { value: 'documents', label: 'Documents' },
        { value: 'surveys', label: 'Surveys' }, { value: 'messages', label: 'Messages' }, { value: 'activity', label: 'Activity' },
      ]} />
      <div className="mt-4">
        {tab === 'overview' ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="Lifetime value" value={formatGHS(o?.lifetime_value)} />
              <StatCard label="Outstanding" value={formatGHS(o?.outstanding)} tone={o && o.overdue > 0 ? 'red' : undefined} hint={o?.overdue ? `${formatGHS(o.overdue)} overdue` : undefined} />
              <StatCard label="Last job" value={o?.last_job ? <Link className="text-brand-700 hover:underline" to={`/jobs/${o.last_job.id}`}>{o.last_job.job_no}</Link> : '—'} hint={o?.last_job ? formatDate(o.last_job.date) : undefined} />
              <StatCard label="Average survey score" value={o?.avg_survey ? `${o.avg_survey} / 5` : '—'} hint={o?.available_credit ? `Credit on account ${formatGHS(o.available_credit)}` : undefined} />
            </div>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Card title="Details">
                <DetailList items={c.customer_type === 'individual' ? [
                  ['Phone', displayPhone(c.phone)], ['Alternate phone', displayPhone(c.alt_phone)], ['WhatsApp', displayPhone(c.whatsapp)], ['Email', c.email],
                  ['Ghana Card', c.ghana_card_no], ['Birthday', c.birth_day && c.birth_month ? `${c.birth_day}/${c.birth_month}` : '—'], ['Occupation', c.occupation], ['Gender', humanize(c.gender)],
                  ['Address', c.residential_address], ['Digital address', c.digital_address], ['Region / district', [c.region, c.district].filter(Boolean).join(' · ')], ['Zone', c.zone?.name],
                ] : [
                  ['Company phone', displayPhone(c.company_phone)], ['Company email', c.company_email], ['Trading name', c.trading_name], ['Registration no.', c.registration_no],
                  ['TIN', c.tin], ['Sector', c.sector], ['Address', c.residential_address], ['Digital address', c.digital_address], ['Region / district', [c.region, c.district].filter(Boolean).join(' · ')], ['Zone', c.zone?.name],
                ]} />
              </Card>
              <Card title="Account">
                <DetailList items={[
                  ['Source', humanize(c.source)], ['Assigned to', c.assigned?.full_name], ['Credit limit', Number(c.credit_limit) ? formatGHS(c.credit_limit) : 'No limit'],
                  ['Payment terms', `${c.payment_terms_days} days`], ['Preferred channel', humanize(c.preferred_channel)], ['SMS opt-in', c.sms_opt_in ? 'Yes' : 'No'],
                  ['Marketing consent', c.marketing_consent ? `Yes (${formatDateTime(c.marketing_consent_at)})` : 'No'], ['Tags', c.tags?.length ? c.tags.map((t) => <Badge key={t} className="mr-1">{t}</Badge>) : '—'],
                  ['Notes', c.notes],
                ]} />
              </Card>
            </div>
            {c.customer_type === 'company' ? (
              <Card title="Contact persons" actions={editable ? <Button size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { contactForm.reset({ name: '', position: '', phone: '', email: '', ghana_card_no: '', is_primary: false, receives_invoices: false }); setContact('new'); }}>Add contact</Button> : null}>
                <SimpleList rows={contacts.data} empty="No contact persons yet." cols={[
                  ['Name', (r) => <span className="font-medium">{r.name}{r.is_primary ? <Badge tone="brand" className="ml-2">Primary</Badge> : null}{r.receives_invoices ? <Badge tone="blue" className="ml-1">Invoices</Badge> : null}</span>],
                  ['Position', (r) => r.position ?? '—'], ['Phone', (r) => displayPhone(r.phone)], ['Email', (r) => r.email ?? '—'],
                  ['', (r) => editable ? <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" aria-label="Edit contact" onClick={() => { contactForm.reset({ name: r.name, position: r.position ?? '', phone: r.phone ? displayPhone(r.phone).replace(/\s/g, '') : '', email: r.email ?? '', ghana_card_no: r.ghana_card_no ?? '', is_primary: r.is_primary, receives_invoices: r.receives_invoices }); setContact(r); }}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="sm" aria-label="Remove contact" onClick={async () => { const { error } = await supabase.from('customer_contacts').delete().eq('id', r.id); if (error) toast.error(error.message); else void qc.invalidateQueries({ queryKey: ['contacts', id] }); }}><Trash2 className="h-4 w-4" /></Button>
                  </div> : null],
                ]} />
              </Card>
            ) : null}
          </div>
        ) : null}
        {tab === 'jobs' ? <Card><SimpleList rows={jobs.data} empty="No job orders." cols={[['Job', (r) => <Link className="text-brand-700 hover:underline" to={`/jobs/${r.id}`}>{r.job_no}</Link>], ['Date', (r) => formatDate(r.execution_date)], ['Amount', (r) => formatGHS(r.agreed_amount)], ['Status', (r) => <StatusBadge status={r.status} />]]} /></Card> : null}
        {tab === 'contracts' ? <Card><SimpleList rows={contracts.data} empty="No contracts." cols={[['Contract', (r) => <Link className="text-brand-700 hover:underline" to={`/contracts/${r.id}`}>{r.contract_no}</Link>], ['Title', (r) => r.title], ['Type', (r) => humanize(r.contract_type)], ['Period', (r) => `${formatDate(r.start_date)} – ${formatDate(r.end_date)}`], ['Per period', (r) => formatGHS(r.amount_per_period)], ['Status', (r) => <StatusBadge status={r.status} />]]} /></Card> : null}
        {tab === 'estimates' ? <Card><SimpleList rows={estimates.data} empty="No estimates." cols={[['Estimate', (r) => <Link className="text-brand-700 hover:underline" to={`/estimates/${r.id}`}>{r.estimate_no} v{r.version}</Link>], ['Title', (r) => r.title ?? '—'], ['Price', (r) => formatGHS(r.proposed_price)], ['Margin', (r) => `${Number(r.margin_pct).toFixed(1)}%`], ['Status', (r) => <StatusBadge status={r.status} />]]} /></Card> : null}
        {tab === 'invoices' ? <Card><SimpleList rows={invoices.data} empty="No invoices." cols={[['Invoice', (r) => <Link className="text-brand-700 hover:underline" to={`/finance/invoices/${r.id}`}>{r.invoice_no ?? 'Draft'}</Link>], ['Issued', (r) => formatDate(r.issue_date)], ['Due', (r) => formatDate(r.due_date)], ['Total', (r) => formatGHS(r.total)], ['Balance', (r) => formatGHS(r.balance)], ['Status', (r) => <StatusBadge status={r.status} />]]} /></Card> : null}
        {tab === 'payments' ? <Card><SimpleList rows={payments.data} empty="No payments." cols={[['Receipt', (r) => r.receipts?.[0]?.receipt_no ?? r.receipts?.receipt_no ?? r.payment_no], ['Date', (r) => formatDate(r.payment_date)], ['Method', (r) => humanize(r.method_code)], ['Reference', (r) => r.reference ?? '—'], ['Amount', (r) => formatGHS(r.amount)]]} /></Card> : null}
        {tab === 'statement' ? <Card><StatementTab customer={c} /></Card> : null}
        {tab === 'documents' ? (
          <Card title="Documents" actions={editable ? <div className="flex flex-wrap items-end gap-2">
            <Select aria-label="Document type" value={docType} onChange={(e) => setDocType(e.target.value)} options={[
              { value: 'ghana_card_front', label: 'Ghana Card – front' }, { value: 'ghana_card_back', label: 'Ghana Card – back' }, { value: 'passport_photo', label: 'Passport photo' },
              { value: 'logo', label: 'Company logo' }, { value: 'registration', label: 'Registration certificate' }, { value: 'contract', label: 'Contract' }, { value: 'other', label: 'Other' }]} />
            <FileUpload bucket="customer-documents" folder={`${c.id}/${docType}`} label="Upload" capture={docType !== 'contract' && docType !== 'registration'} onUploaded={async (path, file) => {
              check(await supabase.from('customer_documents').insert({ customer_id: c.id, doc_type: docType, file_path: path, file_name: file.name, mime_type: file.type, size_bytes: file.size }));
              const col = ({ ghana_card_front: 'ghana_card_front_path', ghana_card_back: 'ghana_card_back_path', passport_photo: 'photo_path', logo: 'logo_path' } as Record<string, string>)[docType];
              if (col) check(await supabase.from('customers').update({ [col]: path }).eq('id', c.id));
              await qc.invalidateQueries({ queryKey: ['cust-docs', id] });
            }} />
          </div> : null}>
            <SimpleList rows={docs.data} empty="No documents uploaded." cols={[['Type', (r) => humanize(r.doc_type)], ['File', (r) => r.file_name], ['Uploaded', (r) => formatDateTime(r.created_at)],
              ['', (r) => <Button variant="ghost" size="sm" icon={<ExternalLink className="h-4 w-4" />} onClick={async () => { try { window.open(await signedUrl('customer-documents', r.file_path), '_blank'); } catch (e) { toast.error((e as Error).message); } }}>Open</Button>]]} />
            <p className="mt-2 text-xs text-stone-500">JPG, PNG or PDF up to 5 MB. Photos are compressed on this device before upload and are only shown through short-lived signed links.</p>
          </Card>
        ) : null}
        {tab === 'surveys' ? <Card><SimpleList rows={surveys.data} empty="No survey responses." cols={[['Date', (r) => formatDate(r.submitted_at)], ['CSAT', (r) => r.csat ?? '—'], ['NPS', (r) => r.nps_score ?? '—'], ['Comments', (r) => r.comments ?? '—'], ['', (r) => r.is_low ? <Badge tone="red">Low score</Badge> : null]]} /></Card> : null}
        {tab === 'messages' ? <Card><SimpleList rows={messages.data} empty="No messages sent." cols={[['Date', (r) => formatDateTime(r.created_at)], ['Channel', (r) => r.channel.toUpperCase()], ['Event', (r) => humanize(r.event_code)], ['To', (r) => r.recipient_phone ?? r.recipient_email], ['Message', (r) => <span className="line-clamp-2 max-w-md">{r.body}</span>], ['Status', (r) => <StatusBadge status={r.status} />]]} /></Card> : null}
        {tab === 'activity' ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card title="Activity timeline"><Timeline items={(timeline.data ?? []).map((t) => ({ at: t.at, title: t.title, detail: t.detail, actor: t.actor }))} /></Card>
            <Card title="Comments"><CommentsPanel entityType="customer" entityId={c.id} /></Card>
          </div>
        ) : null}
      </div>
      <Modal open={!!contact} onClose={() => setContact(null)} title={contact === 'new' ? 'New contact person' : 'Edit contact person'}
        footer={<><Button variant="secondary" onClick={() => setContact(null)}>Cancel</Button><Button loading={contactForm.formState.isSubmitting} onClick={contactForm.handleSubmit(async (v) => {
          try { await saveContact(c.id, contact === 'new' ? undefined : (contact as Contact).id, v); toast.success('Contact saved'); setContact(null); await qc.invalidateQueries({ queryKey: ['contacts', id] }); }
          catch (e) { toast.error((e as Error).message); }
        })}>Save</Button></>}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input label="Name" required error={contactForm.formState.errors.name?.message} {...contactForm.register('name')} />
          <Input label="Position" {...contactForm.register('position')} />
          <Input label="Phone" error={contactForm.formState.errors.phone?.message} {...contactForm.register('phone')} />
          <Input label="Email" error={contactForm.formState.errors.email?.message} {...contactForm.register('email')} />
          <Input label="Ghana Card (optional)" error={contactForm.formState.errors.ghana_card_no?.message} {...contactForm.register('ghana_card_no')} />
          <div><Checkbox label="Primary contact" {...contactForm.register('is_primary')} /><Checkbox label="Receives invoices" hint="Gets invoice emails and SMS" {...contactForm.register('receives_invoices')} /></div>
        </div>
      </Modal>

      {/* Both of these queue through the ordinary notifications table, so they are sent by the
          same function, logged against this customer and visible on the Messages tab. */}
      <Modal open={messageOpen} onClose={() => setMessageOpen(false)} title={`Send a message to ${c.display_name}`} size="sm"
        footer={<><Button variant="secondary" onClick={() => setMessageOpen(false)}>Cancel</Button>
          <Button loading={sendMessage.isPending} disabled={!msg.body.trim()} onClick={() => sendMessage.mutate()}>Send</Button></>}>
        <div className="space-y-4">
          <Select label="Send by" value={msg.channel} onChange={(e) => setMsg({ ...msg, channel: e.target.value as 'sms' | 'email' })}
            options={[
              { value: 'sms', label: hasPhone ? `SMS to ${displayPhone(c.phone ?? c.company_phone)}` : 'SMS — no phone number on file', disabled: !hasPhone },
              { value: 'email', label: hasEmail ? `Email to ${c.email ?? c.company_email}` : 'Email — no address on file', disabled: !hasEmail },
            ]} />
          {msg.channel === 'email' ? (
            <Input label="Subject" value={msg.subject} onChange={(e) => setMsg({ ...msg, subject: e.target.value })}
              hint="Leave it blank for a standard subject" />
          ) : null}
          <Textarea label="Message" rows={5} required value={msg.body} onChange={(e) => setMsg({ ...msg, body: e.target.value })}
            hint={msg.channel === 'sms' ? `${msg.body.length} characters · about ${Math.max(1, Math.ceil(msg.body.length / 160))} SMS` : undefined} />
        </div>
      </Modal>

      <Modal open={balanceOpen} onClose={() => setBalanceOpen(false)} title="Send the current balance" size="sm"
        footer={<><Button variant="secondary" onClick={() => setBalanceOpen(false)}>Cancel</Button>
          <Button loading={sendBalance.isPending} onClick={() => sendBalance.mutate()}>Send</Button></>}>
        <div className="space-y-4">
          <p className="text-sm text-stone-700">
            The balance on their account right now is{' '}
            <strong>{overview.isPending ? 'still loading' : formatGHS(o?.outstanding ?? 0)}</strong>. The message is
            written and the figure read when you send, so it is the ledger's number rather than whatever this page last
            loaded.
          </p>
          <Select label="Send by" value={balanceNote.channel} onChange={(e) => setBalanceNote({ ...balanceNote, channel: e.target.value as 'sms' | 'email' })}
            options={[
              { value: 'sms', label: hasPhone ? `SMS to ${displayPhone(c.phone ?? c.company_phone)}` : 'SMS — no phone number on file', disabled: !hasPhone },
              { value: 'email', label: hasEmail ? `Email to ${c.email ?? c.company_email}` : 'Email — no address on file', disabled: !hasEmail },
            ]} />
          <Textarea label="Anything to add (optional)" rows={3} value={balanceNote.note}
            onChange={(e) => setBalanceNote({ ...balanceNote, note: e.target.value })}
            hint="Appended to the end of the message" />
        </div>
      </Modal>
    </div>
  );
}
