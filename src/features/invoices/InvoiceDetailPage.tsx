import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Copy, Download, HandCoins, Pencil, Printer, Send, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { useAction } from '@/lib/rpc';
import { useSettings } from '@/lib/settings';
import { publicAppUrl } from '@/lib/supabaseClient';
import { daysFrom, displayPhone, formatDate, formatDateTime, formatGHS, formatNumber, humanize } from '@/lib/format';
import { downloadPdf, openPdf } from '@/lib/pdf/download';
import { InvoicePdf } from '@/lib/pdf/InvoicePdf';
import { companyFromSettings } from '@/lib/pdf/company';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, DetailList } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/ErrorState';
import { PaymentModal } from '@/features/payments/PaymentModal';
import { issueCreditNote, issueInvoice, loadInvoice } from './api';

/** One invoice, with payments, credit notes and the public link (spec 4.9). */
export default function InvoiceDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { roles } = useAuth();
  const settings = useSettings();
  const [payOpen, setPayOpen] = useState(false);
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditAmount, setCreditAmount] = useState('');
  const [creditReason, setCreditReason] = useState('');
  const [issueOpen, setIssueOpen] = useState(false);

  const isAccountant = hasAny(roles, 'accountant');
  const query = useQuery({ queryKey: ['invoice', id], queryFn: () => loadInvoice(id) });

  const invalidate = [['invoice', id], ['table', 'invoices']];
  const issue = useAction(() => issueInvoice(id), { success: 'Invoice issued', invalidate, onSuccess: () => setIssueOpen(false) });
  const credit = useAction(() => issueCreditNote(id, Number(creditAmount), creditReason), {
    success: 'Credit note issued',
    invalidate,
    onSuccess: () => { setCreditOpen(false); setCreditAmount(''); setCreditReason(''); },
  });

  if (query.isLoading) return <Spinner />;
  if (query.error || !query.data) return <ErrorState error={query.error ?? new Error('Not found')} onRetry={() => void query.refetch()} />;

  const inv = query.data;
  const c = inv.customer;
  const publicLink = `${publicAppUrl}/p/invoice/${inv.public_token}`;
  const overdueDays = inv.due_date && Number(inv.balance) > 0 ? (daysFrom(inv.due_date) ?? 0) : 0;

  const pdfDoc = settings ? (
    <InvoicePdf
      company={companyFromSettings(settings)}
      link={publicLink}
      invoice={{
        invoice_no: inv.invoice_no, status: inv.status, issue_date: inv.issue_date, due_date: inv.due_date,
        period_start: inv.period_start, period_end: inv.period_end,
        subtotal: Number(inv.subtotal), discount_total: Number(inv.discount_total), tax_total: Number(inv.tax_total),
        total: Number(inv.total), amount_paid: Number(inv.amount_paid), amount_credited: Number(inv.amount_credited),
        balance: Number(inv.balance), notes: inv.notes, terms: inv.terms, payment_terms: inv.payment_terms,
        lines: inv.invoice_lines.map((l) => ({
          description: l.description, quantity: Number(l.quantity), unit_price: Number(l.unit_price),
          discount: Number(l.discount), line_total: Number(l.line_total),
        })),
        taxes: inv.invoice_taxes.map((t) => ({ name: t.name, rate: Number(t.rate), amount: Number(t.amount) })),
        customer: c ? { ...c, display_name: c.display_name ?? 'Customer' } : null,
      }}
    />
  ) : null;

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(publicLink); toast.success('Link copied — safe to send to the customer'); }
    catch { toast.info(publicLink); }
  };

  return (
    <div>
      <PageHeader back="/finance/invoices" title={`Invoice ${inv.invoice_no ?? 'draft'}`}
        subtitle={<span className="flex flex-wrap items-center gap-2">
          <StatusBadge status={inv.status} />
          {overdueDays > 0 ? <Badge tone="red">{overdueDays} day(s) overdue</Badge> : null}
          {inv.revenue_deferred ? <Badge tone="amber">Revenue still deferred</Badge> : null}
          <span className="text-stone-500">{c?.display_name}</span>
        </span>}
        actions={<>
          {inv.status === 'draft' && isAccountant ? <>
            <Link to={`/finance/invoices/${inv.id}/edit`}><Button variant="secondary" icon={<Pencil className="h-4 w-4" />}>Edit</Button></Link>
            <Button icon={<Send className="h-4 w-4" />} onClick={() => setIssueOpen(true)}>Issue</Button>
          </> : null}
          {isAccountant && Number(inv.balance) > 0 && inv.status !== 'draft' ? (
            <Button icon={<HandCoins className="h-4 w-4" />} onClick={() => setPayOpen(true)}>Record payment</Button>
          ) : null}
          {isAccountant && inv.status !== 'draft' && Number(inv.total) > Number(inv.amount_credited) ? (
            <Button variant="secondary" icon={<Undo2 className="h-4 w-4" />} onClick={() => setCreditOpen(true)}>Credit note</Button>
          ) : null}
          {pdfDoc ? <>
            <Button variant="secondary" icon={<Download className="h-4 w-4" />} onClick={() => void downloadPdf(pdfDoc, `invoice-${inv.invoice_no ?? 'draft'}`)}>PDF</Button>
            <Button variant="secondary" icon={<Printer className="h-4 w-4" />} onClick={() => void openPdf(pdfDoc)}>Print</Button>
          </> : null}
          {inv.status !== 'draft' ? <Button variant="secondary" icon={<Copy className="h-4 w-4" />} onClick={() => void copyLink()}>Copy link</Button> : null}
        </>} />

      {inv.status === 'draft' ? (
        <p className="mb-4 rounded-lg bg-stone-100 p-3 text-sm text-stone-700">
          This invoice is still a draft: it has no number, nothing is posted to the ledger and the customer cannot see it.
          Issuing it gives it a number and posts Dr Accounts receivable / Cr revenue.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Lines">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Description</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Qty</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Unit price</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Discount</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {inv.invoice_lines.map((l) => (
                    <tr key={l.id}>
                      <td className="px-3 py-2">{l.description}{l.service ? <span className="block text-xs text-stone-500">{l.service.name}</span> : null}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatNumber(l.quantity)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatGHS(l.unit_price)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(l.discount) ? formatGHS(l.discount) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatGHS(l.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <dl className="mt-4 ml-auto w-full max-w-xs space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-stone-600">Subtotal</dt><dd className="tabular-nums">{formatGHS(inv.subtotal)}</dd></div>
              {Number(inv.discount_total) ? <div className="flex justify-between"><dt className="text-stone-600">Discount</dt><dd className="tabular-nums">-{formatGHS(inv.discount_total)}</dd></div> : null}
              {inv.invoice_taxes.map((t) => (
                <div key={t.id} className="flex justify-between"><dt className="text-stone-600">{t.name} ({formatNumber(t.rate)}%)</dt><dd className="tabular-nums">{formatGHS(t.amount)}</dd></div>
              ))}
              <div className="flex justify-between border-t border-stone-200 pt-1.5 font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatGHS(inv.total)}</dd></div>
              {Number(inv.amount_paid) ? <div className="flex justify-between"><dt className="text-stone-600">Paid</dt><dd className="tabular-nums">-{formatGHS(inv.amount_paid)}</dd></div> : null}
              {Number(inv.amount_credited) ? <div className="flex justify-between"><dt className="text-stone-600">Credited</dt><dd className="tabular-nums">-{formatGHS(inv.amount_credited)}</dd></div> : null}
              <div className="flex justify-between border-t border-stone-200 pt-1.5 text-base font-semibold"><dt>Balance</dt><dd className="tabular-nums">{formatGHS(inv.balance)}</dd></div>
            </dl>
          </Card>

          <Card title="Payments received">
            {inv.payment_allocations.length ? (
              <table className="min-w-full text-sm">
                <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Date</th>
                    <th scope="col" className="px-3 py-2 font-medium">Payment</th>
                    <th scope="col" className="px-3 py-2 font-medium">Method</th>
                    <th scope="col" className="px-3 py-2 font-medium">Reference</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Applied</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {inv.payment_allocations.map((a) => (
                    <tr key={a.id}>
                      <td className="px-3 py-2">{formatDate(a.payment?.payment_date)}</td>
                      <td className="px-3 py-2"><Link to="/finance/payments" className="text-brand-700 hover:underline">{a.payment?.payment_no}</Link></td>
                      <td className="px-3 py-2">{humanize(a.payment?.method_code)}</td>
                      <td className="px-3 py-2 text-stone-600">{a.payment?.reference ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatGHS(a.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="text-sm text-stone-500">No payments yet.</p>}
          </Card>

          {inv.credit_notes.length ? (
            <Card title="Credit notes">
              <table className="min-w-full text-sm">
                <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Number</th>
                    <th scope="col" className="px-3 py-2 font-medium">Date</th>
                    <th scope="col" className="px-3 py-2 font-medium">Reason</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {inv.credit_notes.map((cn) => (
                    <tr key={cn.id}>
                      <td className="px-3 py-2 font-mono text-xs">{cn.credit_note_no}</td>
                      <td className="px-3 py-2">{formatDate(cn.issue_date)}</td>
                      <td className="px-3 py-2">{cn.reason}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatGHS(cn.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card title="Details">
            <DetailList items={[
              ['Customer', c ? <Link to={`/customers/${c.id}`} className="text-brand-700 hover:underline">{c.display_name}</Link> : '—'],
              ['Customer code', c?.customer_code ?? '—'],
              ['Phone', displayPhone(c?.phone ?? c?.company_phone)],
              ['Email', c?.email ?? c?.company_email ?? '—'],
              ['Issued', formatDate(inv.issue_date)],
              ['Due', inv.due_date ? formatDate(inv.due_date) : 'Set when the job completes'],
              ['Payment terms', `${c?.payment_terms_days ?? 0} days`],
              ['Source', inv.job_order ? <Link to={`/jobs/${inv.job_order.id}`} className="text-brand-700 hover:underline">Job {inv.job_order.job_no}</Link>
                : inv.contract ? <Link to={`/contracts/${inv.contract.id}`} className="text-brand-700 hover:underline">Contract {inv.contract.contract_no}</Link>
                  : 'Manual'],
              ['Period', inv.period_start ? `${formatDate(inv.period_start)} – ${formatDate(inv.period_end)}` : '—'],
              ['Issued by', inv.issuer?.full_name ? `${inv.issuer.full_name} · ${formatDateTime(inv.issued_at)}` : '—'],
              ['Revenue recognised', inv.revenue_recognised_at ? formatDateTime(inv.revenue_recognised_at) : inv.revenue_deferred ? 'Not yet (deferred)' : '—'],
            ]} />
          </Card>

          {inv.status !== 'draft' ? (
            <Card title="Customer link">
              <p className="text-sm text-stone-600">
                Anyone with this link can view and download the invoice without signing in. It is sent in the
                "job completed" and reminder messages.
              </p>
              <p className="mt-2 break-all rounded-lg bg-stone-50 p-2 font-mono text-xs text-stone-700">{publicLink}</p>
              <Button variant="secondary" size="sm" className="mt-2" icon={<Copy className="h-4 w-4" />} onClick={() => void copyLink()}>Copy</Button>
            </Card>
          ) : null}

          {inv.notes || inv.terms ? (
            <Card title="Notes and terms">
              {inv.notes ? <p className="text-sm text-stone-700">{inv.notes}</p> : null}
              {inv.terms ? <p className="mt-2 text-xs text-stone-500">{inv.terms}</p> : null}
            </Card>
          ) : null}

          {Number(inv.overdue_reminders_sent?.length ?? 0) > 0 ? (
            <Card title="Reminders sent">
              <p className="text-sm text-stone-600">
                At {inv.overdue_reminders_sent.join(', ')} day(s) overdue. Reminders stop as soon as the invoice is paid.
              </p>
            </Card>
          ) : null}
        </div>
      </div>

      <PaymentModal open={payOpen} onClose={() => setPayOpen(false)}
        customerId={inv.customer_id} customerName={c?.display_name ?? 'Customer'}
        preselectInvoiceId={inv.id} onDone={() => void query.refetch()} />

      <ConfirmDialog open={issueOpen} onClose={() => setIssueOpen(false)} title="Issue this invoice?"
        confirmLabel="Issue" loading={issue.isPending} onConfirm={() => issue.mutate()}
        message="The invoice gets its number, the ledger is posted and the customer link becomes live." />

      <Modal open={creditOpen} onClose={() => setCreditOpen(false)} title="Issue a credit note" size="sm"
        footer={<><Button variant="secondary" onClick={() => setCreditOpen(false)}>Cancel</Button>
          <Button variant="danger" loading={credit.isPending} disabled={!creditAmount || !creditReason.trim()}
            onClick={() => credit.mutate()}>Issue credit note</Button></>}>
        <p className="mb-3 text-sm text-stone-600">
          Posted invoices are never edited. A credit note reverses part or all of this invoice and leaves a clear trail.
        </p>
        <div className="space-y-3">
          <Input label="Amount to credit (GH₵)" type="number" step="0.01" required value={creditAmount}
            onChange={(e) => setCreditAmount(e.target.value)}
            hint={`Up to ${formatGHS(Number(inv.total) - Number(inv.amount_credited))}`} />
          <Textarea label="Reason" required value={creditReason} onChange={(e) => setCreditReason(e.target.value)} />
        </div>
      </Modal>
    </div>
  );
}
