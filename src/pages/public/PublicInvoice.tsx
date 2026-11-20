import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Download, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { formatDate, formatGHS, formatNumber, humanize } from '@/lib/format';
import { downloadPdf, openPdf } from '@/lib/pdf/download';
import { InvoicePdf } from '@/lib/pdf/InvoicePdf';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Facts, PublicError, PublicLoading, PublicShell } from './PublicShell';
import { ensureSignedOut, getPublicInvoice, startInvoicePayment } from './publicApi';

/** The invoice a customer opens from the SMS or email link. No login, token in the URL. */
export default function PublicInvoice() {
  const { token = '' } = useParams<{ token: string }>();
  const [params] = useSearchParams();
  const justPaid = params.get('paid') === '1';
  const [paying, setPaying] = useState(false);
  const [payChoice, setPayChoice] = useState<'full' | 'part'>('full');
  const [partAmount, setPartAmount] = useState('');

  useEffect(() => { void ensureSignedOut(); }, []);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['public-invoice', token],
    queryFn: () => getPublicInvoice(token),
    retry: 0,
  });

  // After returning from the payment gateway the webhook may still be in flight.
  useEffect(() => {
    if (!justPaid) return;
    const timer = setTimeout(() => { void refetch(); }, 4000);
    return () => clearTimeout(timer);
  }, [justPaid, refetch]);

  if (isLoading) return <PublicLoading />;
  if (error || !data) return <PublicError message={(error as Error)?.message ?? 'Invoice not found.'} />;

  const { company, invoice, pay_enabled: payEnabled } = data;
  const customerName = invoice.customer?.display_name ?? 'Customer';
  const pdfDoc = <InvoicePdf company={company} invoice={{ ...invoice, customer: invoice.customer ? { ...invoice.customer, display_name: customerName } : null }} />;
  const fileName = `invoice-${invoice.invoice_no ?? 'draft'}`;
  const settled = Number(invoice.balance) <= 0;

  /* A customer can pay all of it or part of it. The field starts at the full balance, because
     that is what most people pay; the amount is still checked on the server, since anyone with
     the link can post to that endpoint. */
  const payAmount = payChoice === 'part' ? Number(partAmount) : Number(invoice.balance);
  const amountProblem = payChoice !== 'part' ? null
    : !Number.isFinite(payAmount) || payAmount <= 0 ? 'Enter the amount you want to pay'
    : payAmount < 1 ? 'The smallest payment is GH₵ 1.00'
    : payAmount > Number(invoice.balance) ? `The most you can pay on this invoice is ${formatGHS(invoice.balance)}`
    : null;

  const pay = async () => {
    if (amountProblem) { toast.error(amountProblem); return; }
    setPaying(true);
    try {
      const { url } = await startInvoicePayment(token, payChoice === 'part' ? payAmount : undefined);
      window.location.href = url;
    } catch (e) {
      toast.error((e as Error).message);
      setPaying(false);
    }
  };

  return (
    <PublicShell company={company} title={`Invoice ${invoice.invoice_no ?? ''}`}>
      {justPaid ? (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <p>Thank you. If your payment went through, the balance below updates within a minute — this page refreshes itself.</p>
        </div>
      ) : null}

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Invoice {invoice.invoice_no}</h1>
          <p className="mt-0.5 text-sm text-stone-600">{customerName}</p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-stone-500">{settled ? 'Amount paid' : 'Amount due'}</p>
          <p className="text-2xl font-semibold text-stone-900">{formatGHS(settled ? invoice.total : invoice.balance)}</p>
          <StatusBadge status={invoice.status} />
        </div>
      </div>

      <Facts items={[
        ['Issued', formatDate(invoice.issue_date)],
        ['Due', invoice.due_date ? formatDate(invoice.due_date) : 'On completion'],
        ...(invoice.period_start ? [['Period', `${formatDate(invoice.period_start)} – ${formatDate(invoice.period_end)}`] as [string, string]] : []),
        ['Status', humanize(invoice.status)],
      ]} />

      <div className="mt-5 -mx-4 overflow-x-auto sm:mx-0">
        <table className="min-w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Description</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Qty</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Unit price</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {invoice.lines.map((l, i) => (
              <tr key={i}>
                <td className="px-3 py-2.5">{l.description}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatNumber(l.quantity)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatGHS(l.unit_price)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{formatGHS(l.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="mt-4 ml-auto w-full max-w-xs space-y-1.5 text-sm">
        <div className="flex justify-between"><dt className="text-stone-600">Subtotal</dt><dd className="tabular-nums">{formatGHS(invoice.subtotal)}</dd></div>
        {Number(invoice.discount_total) ? <div className="flex justify-between"><dt className="text-stone-600">Discount</dt><dd className="tabular-nums">-{formatGHS(invoice.discount_total)}</dd></div> : null}
        {invoice.taxes.map((t) => (
          <div key={t.name} className="flex justify-between"><dt className="text-stone-600">{t.name} ({Number(t.rate)}%)</dt><dd className="tabular-nums">{formatGHS(t.amount)}</dd></div>
        ))}
        <div className="flex justify-between border-t border-stone-200 pt-1.5 font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatGHS(invoice.total)}</dd></div>
        {Number(invoice.amount_paid) ? <div className="flex justify-between"><dt className="text-stone-600">Paid</dt><dd className="tabular-nums">-{formatGHS(invoice.amount_paid)}</dd></div> : null}
        {Number(invoice.amount_credited) ? <div className="flex justify-between"><dt className="text-stone-600">Credited</dt><dd className="tabular-nums">-{formatGHS(invoice.amount_credited)}</dd></div> : null}
        <div className="flex justify-between border-t border-stone-200 pt-1.5 text-base font-semibold"><dt>Balance due</dt><dd className="tabular-nums">{formatGHS(invoice.balance)}</dd></div>
      </dl>

      {company.bank_details || company.momo_details ? (
        <section className="mt-6 rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm">
          <h2 className="mb-1 font-semibold text-stone-800">How to pay</h2>
          {company.bank_details ? <p className="text-stone-700">{company.bank_details}</p> : null}
          {company.momo_details ? <p className="text-stone-700">{company.momo_details}</p> : null}
          <p className="mt-1 text-xs text-stone-500">Please quote invoice {invoice.invoice_no} with your payment.</p>
        </section>
      ) : null}

      {invoice.terms || company.invoice_terms ? <p className="mt-4 text-xs text-stone-500">{invoice.terms || company.invoice_terms}</p> : null}
      {invoice.notes ? <p className="mt-2 text-sm text-stone-700">{invoice.notes}</p> : null}

      {payEnabled && !settled ? (
        <section className="mt-6 rounded-xl border border-stone-200 p-4">
          <h2 className="font-semibold text-stone-800">Pay online</h2>
          <fieldset className="mt-3">
            <legend className="sr-only">How much would you like to pay?</legend>
            <label className="flex items-center gap-2 text-sm">
              <input type="radio" name="payChoice" value="full" checked={payChoice === 'full'}
                onChange={() => setPayChoice('full')} className="h-4 w-4" />
              <span>Pay the full balance — <strong>{formatGHS(invoice.balance)}</strong></span>
            </label>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input type="radio" name="payChoice" value="part" checked={payChoice === 'part'}
                onChange={() => setPayChoice('part')} className="h-4 w-4" />
              <span>Pay part of it</span>
            </label>
          </fieldset>

          {payChoice === 'part' ? (
            <div className="mt-3">
              <label htmlFor="part-amount" className="block text-sm font-medium text-stone-700">Amount to pay (GH₵)</label>
              <input id="part-amount" type="number" inputMode="decimal" step="0.01" min="1" max={Number(invoice.balance)}
                value={partAmount} onChange={(e) => setPartAmount(e.target.value)}
                placeholder={Number(invoice.balance).toFixed(2)}
                aria-invalid={!!amountProblem} aria-describedby={amountProblem ? 'part-amount-error' : 'part-amount-hint'}
                className="mt-1 w-40 rounded-lg border border-stone-300 px-3 py-2 text-sm tabular-nums focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
              {amountProblem ? (
                <p id="part-amount-error" role="alert" className="mt-1 text-xs text-red-700">{amountProblem}</p>
              ) : (
                <p id="part-amount-hint" className="mt-1 text-xs text-stone-500">
                  The rest stays on the invoice and you can pay it later from this same link.
                </p>
              )}
            </div>
          ) : null}

          <div className="mt-4">
            <Button size="lg" loading={paying} disabled={!!amountProblem} onClick={() => void pay()}>
              {payChoice === 'part' && !amountProblem && payAmount > 0 ? `Pay ${formatGHS(payAmount)}` : 'Pay now'}
            </Button>
          </div>
        </section>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        <Button variant="secondary" size="lg" icon={<Download className="h-4 w-4" />} onClick={() => void downloadPdf(pdfDoc, fileName)}>Download PDF</Button>
        <Button variant="secondary" size="lg" icon={<Printer className="h-4 w-4" />} onClick={() => void openPdf(pdfDoc)}>Print</Button>
      </div>
    </PublicShell>
  );
}
