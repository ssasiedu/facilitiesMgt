import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Link2, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { rpc } from '@/lib/rpc';
import { useSettings } from '@/lib/settings';
import { formatDate, formatGHS, humanize, isoDate } from '@/lib/format';
import { downloadPdf } from '@/lib/pdf/download';
import { StatementPdf, type StatementRow } from '@/lib/pdf/StatementPdf';
import { companyFromSettings } from '@/lib/pdf/company';
import { DateRange } from '@/components/ui/DateRange';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { useAuth } from '@/lib/auth';

/** Customer statement: opening balance, debits, credits, running and closing balance; PDF, link or email. */
export function StatementTab({ customer }: { customer: { id: string; display_name: string | null; customer_code: string | null; email: string | null; company_email: string | null } }) {
  const customerName = customer.display_name ?? customer.customer_code ?? 'Customer';
  const settings = useSettings();
  const { is } = useAuth();
  const [from, setFrom] = useState(isoDate(new Date(new Date().getFullYear(), 0, 1)));
  const [to, setTo] = useState(isoDate());
  const { data = [], isLoading } = useQuery({
    queryKey: ['statement', customer.id, from, to],
    queryFn: () => rpc<StatementRow[]>('rpt_customer_statement', { p_customer_id: customer.id, p_from: from, p_to: to }),
  });
  const closing = data.length ? data[data.length - 1].balance : 0;
  const link = async () => rpc<string>('create_statement_link', { p_customer_id: customer.id, p_from: from, p_to: to });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DateRange from={from} to={to} presets={false} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={() => settings && downloadPdf(<StatementPdf company={companyFromSettings(settings)} customer={{ display_name: customerName, customer_code: customer.customer_code }} from={from} to={to} rows={data} />, `statement-${customer.customer_code}-${to}`)}>PDF</Button>
          {is('accountant', 'manager', 'sales_exec') ? <>
            <Button variant="secondary" size="sm" icon={<Link2 className="h-4 w-4" />} onClick={async () => { try { const url = await link(); await navigator.clipboard.writeText(url); toast.success('Statement link copied'); } catch (e) { toast.error((e as Error).message); } }}>Copy link</Button>
            <Button variant="secondary" size="sm" icon={<Mail className="h-4 w-4" />} disabled={!customer.email && !customer.company_email} onClick={async () => {
              try {
                const url = await link();
                window.location.href = `mailto:${customer.email ?? customer.company_email}?subject=${encodeURIComponent(`Statement of account ${formatDate(from)} – ${formatDate(to)}`)}&body=${encodeURIComponent(`Dear ${customerName},\n\nYour statement of account is available here: ${url}\n\nClosing balance: ${formatGHS(closing)}\n\n${settings?.company_name ?? ''}`)}`;
              } catch (e) { toast.error((e as Error).message); }
            }}>Email</Button>
          </> : null}
        </div>
      </div>
      {isLoading ? <Spinner /> : (
        <div className="overflow-x-auto rounded-lg border border-stone-200">
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase text-stone-500"><tr><th className="px-3 py-2">Date</th><th className="px-3 py-2">Type</th><th className="px-3 py-2">Document</th><th className="px-3 py-2">Description</th><th className="px-3 py-2 text-right">Debit</th><th className="px-3 py-2 text-right">Credit</th><th className="px-3 py-2 text-right">Balance</th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {data.map((r, i) => (
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
      )}
    </div>
  );
}
