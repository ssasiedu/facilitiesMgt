import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Download, Printer } from 'lucide-react';
import { displayPhone, formatDate, formatGHS, humanize } from '@/lib/format';
import { downloadPdf, openPdf } from '@/lib/pdf/download';
import { ReceiptPdf } from '@/lib/pdf/ReceiptPdf';
import { Button } from '@/components/ui/Button';
import { Facts, PublicError, PublicLoading, PublicShell } from './PublicShell';
import { ensureSignedOut, getPublicReceipt } from './publicApi';

/** The receipt a customer opens from the payment confirmation SMS or email. */
export default function PublicReceipt() {
  const { token = '' } = useParams<{ token: string }>();
  useEffect(() => { void ensureSignedOut(); }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: ['public-receipt', token],
    queryFn: () => getPublicReceipt(token),
    retry: 0,
  });

  if (isLoading) return <PublicLoading />;
  if (error || !data) return <PublicError message={(error as Error)?.message ?? 'Receipt not found.'} />;

  const { company, receipt } = data;
  const customerName = receipt.customer?.display_name ?? 'Customer';
  const pdfDoc = (
    <ReceiptPdf
      company={company}
      receipt={{
        ...receipt,
        customer: receipt.customer ? { ...receipt.customer, display_name: customerName } : null,
        allocations: receipt.allocations.map((a) => ({ amount: a.amount, invoices: a.invoices ? { invoice_no: a.invoices.invoice_no ?? '', balance: a.invoices.balance } : null })),
      }}
    />
  );
  const credit = Number(receipt.payment?.unallocated_amount ?? 0);

  return (
    <PublicShell company={company} title={`Receipt ${receipt.receipt_no}`}>
      <div className="mb-5 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
        <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-700" />
        <div>
          <p className="font-semibold text-emerald-900">Payment received — thank you</p>
          <p className="text-2xl font-semibold text-emerald-900">{formatGHS(receipt.amount)}</p>
          <p className="text-sm text-emerald-800">Receipt {receipt.receipt_no} · {customerName}</p>
        </div>
      </div>

      <Facts items={[
        ['Date', formatDate(receipt.payment?.payment_date ?? receipt.issued_at)],
        ['Method', receipt.payment?.payment_methods?.name ?? humanize(receipt.payment?.method_code)],
        ['Reference', receipt.payment?.reference ?? '—'],
        ['Phone', displayPhone(receipt.customer?.phone ?? receipt.customer?.company_phone)],
      ]} />

      {receipt.allocations.length ? (
        <div className="mt-5 -mx-4 overflow-x-auto sm:mx-0">
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Applied to invoice</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Amount applied</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Balance left</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {receipt.allocations.map((a, i) => (
                <tr key={i}>
                  <td className="px-3 py-2.5">{a.invoices?.invoice_no ?? '—'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatGHS(a.amount)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatGHS(a.invoices?.balance ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {credit > 0 ? (
        <p className="mt-4 rounded-lg bg-stone-50 p-3 text-sm text-stone-700">
          {formatGHS(credit)} is held as a credit on your account and will be applied to your next invoice.
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        <Button variant="secondary" size="lg" icon={<Download className="h-4 w-4" />} onClick={() => void downloadPdf(pdfDoc, `receipt-${receipt.receipt_no}`)}>Download PDF</Button>
        <Button variant="secondary" size="lg" icon={<Printer className="h-4 w-4" />} onClick={() => void openPdf(pdfDoc)}>Print</Button>
      </div>
    </PublicShell>
  );
}
