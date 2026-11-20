import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import { formatDate, formatGHS, humanize } from '@/lib/format';
import { downloadPdf, openPdf } from '@/lib/pdf/download';
import { StatementPdf } from '@/lib/pdf/StatementPdf';
import { StatementByInvoicePdf, type StatementByInvoiceRow } from '@/lib/pdf/StatementByInvoicePdf';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Facts, PublicError, PublicLoading, PublicShell } from './PublicShell';
import { ensureSignedOut, getPublicStatement } from './publicApi';

/** Statement of account opened from an emailed link. The link expires (set in Settings). */
export default function PublicStatement() {
  const { token = '' } = useParams<{ token: string }>();
  useEffect(() => { void ensureSignedOut(); }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: ['public-statement', token],
    queryFn: () => getPublicStatement(token),
    retry: 0,
  });

  if (isLoading) return <PublicLoading />;
  if (error || !data) return <PublicError message={(error as Error)?.message ?? 'Statement not found.'} />;

  const { company, statement } = data;
  const customerName = statement.customer?.display_name ?? 'Customer';
  const who = { display_name: customerName, customer_code: statement.customer?.customer_code };
  /* The link records which format it was sent as. One created before that was stored reads as
     the account statement, which is what it was sent as. */
  const byInvoice = statement.format === 'by_invoice';

  const rows = byInvoice ? [] : (statement.rows ?? []);
  const invoiceRows = byInvoice ? ((statement.rows ?? []) as unknown as StatementByInvoiceRow[]) : [];

  const groups: { key: string; header: StatementByInvoiceRow; movements: StatementByInvoiceRow[] }[] = [];
  for (const r of invoiceRows) {
    let g = groups.find((x) => x.key === r.invoice_id);
    if (!g) { g = { key: r.invoice_id, header: r, movements: [] }; groups.push(g); }
    if (r.line_type === 'invoice') g.header = r;
    else g.movements.push(r);
  }

  const closing = byInvoice
    ? groups.reduce((t, g) => t + Number(g.header.invoice_balance), 0)
    : rows.length ? Number(rows[rows.length - 1].balance) : 0;
  const debits = byInvoice
    ? groups.reduce((t, g) => t + Number(g.header.invoice_total), 0)
    : rows.reduce((t, r) => t + Number(r.debit ?? 0), 0);
  const credits = byInvoice ? debits - closing : rows.reduce((t, r) => t + Number(r.credit ?? 0), 0);

  const pdfDoc = byInvoice ? (
    <StatementByInvoicePdf company={company} customer={who} from={statement.from} to={statement.to} rows={invoiceRows} />
  ) : (
    <StatementPdf company={company} customer={who} from={statement.from} to={statement.to} rows={rows} />
  );

  return (
    <PublicShell company={company} title="Statement of account">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">{byInvoice ? 'Statement by invoice' : 'Statement of account'}</h1>
          <p className="mt-0.5 text-sm text-stone-600">{customerName}</p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-stone-500">{byInvoice ? 'Still owing' : 'Closing balance'}</p>
          <p className="text-2xl font-semibold text-stone-900">{formatGHS(closing)}</p>
        </div>
      </div>

      <Facts items={[
        ['From', formatDate(statement.from)],
        ['To', formatDate(statement.to)],
        ['Total invoiced', formatGHS(debits)],
        ['Total paid', formatGHS(credits)],
      ]} />

      {byInvoice ? (
        <div className="mt-5 space-y-4">
          {groups.map((g) => {
            const settled = Number(g.header.invoice_balance) <= 0;
            return (
              <div key={g.key} className="overflow-hidden rounded-xl border border-stone-200">
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
                <div className="-mx-0 overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-stone-500">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-medium">Date</th>
                        <th scope="col" className="px-3 py-2 font-medium">Entry</th>
                        <th scope="col" className="px-3 py-2 font-medium">Document</th>
                        <th scope="col" className="px-3 py-2 font-medium">Detail</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Left owing</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {[g.header, ...g.movements].map((r, i) => (
                        <tr key={i} className={r.line_type === 'invoice' ? 'font-medium' : undefined}>
                          <td className="whitespace-nowrap px-3 py-2.5">{formatDate(r.line_date)}</td>
                          <td className="px-3 py-2.5">{r.line_type === 'invoice' ? 'Invoice' : r.line_type === 'payment' ? 'Payment' : 'Credit note'}</td>
                          <td className="px-3 py-2.5 font-mono text-xs">{r.line_doc_no ?? '—'}</td>
                          <td className="px-3 py-2.5">{r.line_description}</td>
                          <td className="px-3 py-2.5 text-right tabular-nums">{formatGHS(r.line_amount)}</td>
                          <td className="px-3 py-2.5 text-right font-medium tabular-nums">{formatGHS(r.balance_after)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
          {!groups.length ? <p className="px-3 py-6 text-center text-sm text-stone-500">No invoices in this period.</p> : null}
        </div>
      ) : (
        <div className="mt-5 -mx-4 overflow-x-auto sm:mx-0">
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Date</th>
                <th scope="col" className="px-3 py-2 font-medium">Document</th>
                <th scope="col" className="px-3 py-2 font-medium">Description</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Debit</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Credit</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((r, i) => (
                <tr key={i} className={r.doc_type === 'opening' ? 'bg-stone-50' : undefined}>
                  <td className="whitespace-nowrap px-3 py-2.5">{formatDate(r.txn_date)}</td>
                  <td className="px-3 py-2.5">{r.doc_no ?? humanize(r.doc_type)}</td>
                  <td className="px-3 py-2.5">{r.description}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.debit ? formatGHS(r.debit) : ''}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{r.credit ? formatGHS(r.credit) : ''}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-medium">{formatGHS(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length ? <p className="px-3 py-6 text-center text-sm text-stone-500">No movements in this period.</p> : null}
        </div>
      )}

      {company.bank_details || company.momo_details ? (
        <section className="mt-6 rounded-xl border border-stone-200 bg-stone-50 p-4 text-sm">
          <h2 className="mb-1 font-semibold text-stone-800">How to pay</h2>
          {company.bank_details ? <p className="text-stone-700">{company.bank_details}</p> : null}
          {company.momo_details ? <p className="text-stone-700">{company.momo_details}</p> : null}
        </section>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        <Button variant="secondary" size="lg" icon={<Download className="h-4 w-4" />} onClick={() => void downloadPdf(pdfDoc, `statement-${statement.customer?.customer_code ?? 'account'}-${statement.to}`)}>Download PDF</Button>
        <Button variant="secondary" size="lg" icon={<Printer className="h-4 w-4" />} onClick={() => void openPdf(pdfDoc)}>Print</Button>
      </div>
    </PublicShell>
  );
}
