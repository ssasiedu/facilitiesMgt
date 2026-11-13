import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import { formatDate, formatGHS, humanize } from '@/lib/format';
import { downloadPdf, openPdf } from '@/lib/pdf/download';
import { StatementPdf } from '@/lib/pdf/StatementPdf';
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
  const rows = statement.rows ?? [];
  const customerName = statement.customer?.display_name ?? 'Customer';
  const closing = rows.length ? Number(rows[rows.length - 1].balance) : 0;
  const debits = rows.reduce((t, r) => t + Number(r.debit ?? 0), 0);
  const credits = rows.reduce((t, r) => t + Number(r.credit ?? 0), 0);
  const pdfDoc = (
    <StatementPdf
      company={company}
      customer={{ display_name: customerName, customer_code: statement.customer?.customer_code }}
      from={statement.from}
      to={statement.to}
      rows={rows}
    />
  );

  return (
    <PublicShell company={company} title="Statement of account">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">Statement of account</h1>
          <p className="mt-0.5 text-sm text-stone-600">{customerName}</p>
        </div>
        <div className="text-right">
          <p className="text-xs uppercase tracking-wide text-stone-500">Closing balance</p>
          <p className="text-2xl font-semibold text-stone-900">{formatGHS(closing)}</p>
        </div>
      </div>

      <Facts items={[
        ['From', formatDate(statement.from)],
        ['To', formatDate(statement.to)],
        ['Total invoiced', formatGHS(debits)],
        ['Total paid', formatGHS(credits)],
      ]} />

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
