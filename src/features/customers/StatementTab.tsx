import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Link2, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { rpc } from '@/lib/rpc';
import { useSettings } from '@/lib/settings';
import { formatDate, formatGHS, humanize, isoDate } from '@/lib/format';
import { downloadPdf } from '@/lib/pdf/download';
import { StatementPdf, type StatementRow } from '@/lib/pdf/StatementPdf';
import { StatementByInvoicePdf, type StatementByInvoiceRow } from '@/lib/pdf/StatementByInvoicePdf';
import { companyFromSettings } from '@/lib/pdf/company';
import { DateRange } from '@/components/ui/DateRange';
import { Button } from '@/components/ui/Button';
import { Tabs } from '@/components/ui/Tabs';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/lib/auth';

type Format = 'account' | 'by_invoice';

const LINE_LABEL: Record<string, string> = { invoice: 'Invoice', payment: 'Payment', credit: 'Credit note' };

/**
 * Two ways of reading the same history.
 *
 * The account statement is a running balance — what an accountant reconciles against. It cannot
 * answer "how much is left on invoice 42?", because a payment line there only moves the account
 * total. The by-invoice statement keeps each invoice with the payments and credits applied to it
 * and carries that invoice's own balance down the lines, which is what a customer asks about.
 */
export function StatementTab({ customer }: {
  customer: { id: string; display_name: string | null; customer_code: string | null; email: string | null; company_email: string | null };
}) {
  const customerName = customer.display_name ?? customer.customer_code ?? 'Customer';
  const settings = useSettings();
  const { is } = useAuth();
  const [format, setFormat] = useState<Format>('account');
  const [from, setFrom] = useState(isoDate(new Date(new Date().getFullYear(), 0, 1)));
  const [to, setTo] = useState(isoDate());

  const account = useQuery({
    queryKey: ['statement', customer.id, from, to],
    enabled: format === 'account',
    queryFn: () => rpc<StatementRow[]>('rpt_customer_statement', { p_customer_id: customer.id, p_from: from, p_to: to }),
  });

  const byInvoice = useQuery({
    queryKey: ['statement-by-invoice', customer.id, from, to],
    enabled: format === 'by_invoice',
    queryFn: () => rpc<StatementByInvoiceRow[]>('rpt_customer_statement_by_invoice', { p_customer_id: customer.id, p_from: from, p_to: to }),
  });

  const rows = account.data ?? [];
  const closing = rows.length ? rows[rows.length - 1].balance : 0;

  // Grouped for display, keeping the order the database returned.
  const groups = useMemo(() => {
    const out: { key: string; header: StatementByInvoiceRow; movements: StatementByInvoiceRow[] }[] = [];
    for (const r of byInvoice.data ?? []) {
      let g = out.find((x) => x.key === r.invoice_id);
      if (!g) { g = { key: r.invoice_id, header: r, movements: [] }; out.push(g); }
      if (r.line_type === 'invoice') g.header = r;
      else g.movements.push(r);
    }
    return out;
  }, [byInvoice.data]);

  const owing = groups.reduce((t, g) => t + Number(g.header.invoice_balance), 0);
  const loading = format === 'account' ? account.isLoading : byInvoice.isLoading;

  /* The link is created for whichever format is on screen, so the customer opens the statement
     the sender was looking at. */
  const link = async () => rpc<string>('create_statement_link', {
    p_customer_id: customer.id, p_from: from, p_to: to, p_format: format,
  });

  const pdf = () => {
    if (!settings) return;
    const company = companyFromSettings(settings);
    const who = { display_name: customerName, customer_code: customer.customer_code };
    if (format === 'by_invoice') {
      void downloadPdf(
        <StatementByInvoicePdf company={company} customer={who} from={from} to={to} rows={byInvoice.data ?? []} />,
        `statement-by-invoice-${customer.customer_code}-${to}`,
      );
    } else {
      void downloadPdf(
        <StatementPdf company={company} customer={who} from={from} to={to} rows={rows} />,
        `statement-${customer.customer_code}-${to}`,
      );
    }
  };

  return (
    <div className="space-y-3">
      <Tabs<Format> value={format} onChange={setFormat} tabs={[
        { value: 'account', label: 'Account statement' },
        { value: 'by_invoice', label: 'By invoice' },
      ]} />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <DateRange from={from} to={to} presets={false} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={pdf}>PDF</Button>
          {is('accountant', 'manager', 'sales_exec') ? <>
            <Button variant="secondary" size="sm" icon={<Link2 className="h-4 w-4" />} onClick={async () => {
              try { const url = await link(); await navigator.clipboard.writeText(url); toast.success('Statement link copied'); }
              catch (e) { toast.error((e as Error).message); }
            }}>Copy link</Button>
            <Button variant="secondary" size="sm" icon={<Mail className="h-4 w-4" />} disabled={!customer.email && !customer.company_email} onClick={async () => {
              try {
                const url = await link();
                window.location.href = `mailto:${customer.email ?? customer.company_email}?subject=${encodeURIComponent(`Statement of account ${formatDate(from)} – ${formatDate(to)}`)}&body=${encodeURIComponent(`Dear ${customerName},\n\nYour statement of account is available here: ${url}\n\n${format === 'by_invoice' ? 'Still owing' : 'Closing balance'}: ${formatGHS(format === 'by_invoice' ? owing : closing)}\n\n${settings?.company_name ?? ''}`)}`;
              } catch (e) { toast.error((e as Error).message); }
            }}>Email</Button>
          </> : null}
        </div>
      </div>

      {loading ? <Spinner /> : format === 'account' ? (
        <div className="overflow-x-auto rounded-lg border border-stone-200">
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Document</th><th className="px-3 py-2">Description</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th><th className="px-3 py-2 text-right">Balance</th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r, i) => (
                <tr key={i} className={r.doc_type === 'opening' ? 'bg-stone-50 font-medium' : ''}>
                  <td className="px-3 py-2">{formatDate(r.txn_date)}</td><td className="px-3 py-2">{humanize(r.doc_type)}</td><td className="px-3 py-2">{r.doc_no}</td>
                  <td className="px-3 py-2">{r.description}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.debit ? formatGHS(r.debit) : ''}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.credit ? formatGHS(r.credit) : ''}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{formatGHS(r.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 border-stone-200 font-semibold"><td colSpan={6} className="px-3 py-2 text-right">Closing balance</td><td className="px-3 py-2 text-right tabular-nums">{formatGHS(closing)}</td></tr></tfoot>
          </table>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => {
            const settled = Number(g.header.invoice_balance) <= 0;
            return (
              <div key={g.key} className="overflow-hidden rounded-lg border border-stone-200">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 bg-stone-50 px-3 py-2">
                  <div className="text-sm">
                    <span className="font-mono text-xs">{g.header.invoice_no}</span>
                    <span className="ml-2 text-stone-600">{formatDate(g.header.invoice_date)}</span>
                    {g.header.due_date ? <span className="ml-2 text-stone-500">due {formatDate(g.header.due_date)}</span> : null}
                  </div>
                  <Badge tone={settled ? 'green' : 'amber'}>
                    {settled ? 'Settled' : `${formatGHS(g.header.invoice_balance)} still owing`}
                  </Badge>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-white text-left text-xs uppercase text-stone-500">
                      <tr>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2">Entry</th>
                        <th className="px-3 py-2">Document</th>
                        <th className="px-3 py-2">Detail</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                        <th className="px-3 py-2 text-right">Left owing</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {[g.header, ...g.movements].map((r, i) => (
                        <tr key={i} className={r.line_type === 'invoice' ? 'font-medium' : undefined}>
                          <td className="whitespace-nowrap px-3 py-2">{formatDate(r.line_date)}</td>
                          <td className="px-3 py-2">{LINE_LABEL[r.line_type] ?? humanize(r.line_type)}</td>
                          <td className="px-3 py-2 font-mono text-xs">{r.line_doc_no ?? '—'}</td>
                          <td className="px-3 py-2">{r.line_description}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatGHS(r.line_amount)}</td>
                          <td className="px-3 py-2 text-right font-medium tabular-nums">{formatGHS(r.balance_after)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}

          {groups.length ? (
            <div className="flex justify-end">
              <div className="rounded-lg border border-stone-200 bg-stone-50 px-4 py-2 text-sm">
                <span className="text-stone-600">Still owing across {groups.length} invoice{groups.length === 1 ? '' : 's'}</span>
                <span className="ml-3 font-semibold tabular-nums">{formatGHS(owing)}</span>
              </div>
            </div>
          ) : (
            <p className="rounded-lg border border-stone-200 p-4 text-sm text-stone-600">
              No invoices in this period. An invoice raised earlier still appears here while anything is owed on it.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
