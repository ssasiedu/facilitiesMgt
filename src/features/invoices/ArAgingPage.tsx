import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, Mail } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { check } from '@/lib/rpc';
import { useSettings } from '@/lib/settings';
import { daysFrom, formatDate, formatGHS, humanize, isoDate } from '@/lib/format';
import { exportXlsx } from '@/lib/export';
import { downloadPdf } from '@/lib/pdf/download';
import { ReportPdf } from '@/lib/pdf/ReportPdf';
import { companyFromSettings } from '@/lib/pdf/company';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Tabs } from '@/components/ui/Tabs';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/ErrorState';
import { EmptyState } from '@/components/ui/EmptyState';
import { agingReport, type AgingRow } from './api';
import type { Views } from '@/types/database';

type InvoiceRow = Views<'v_ar_aging'>;

const BUCKETS: { key: keyof AgingRow; label: string; colour: string }[] = [
  { key: 'current_amt', label: 'Current', colour: '#059669' },
  { key: 'd1_30', label: '1–30 days', colour: '#65a30d' },
  { key: 'd31_60', label: '31–60 days', colour: '#d97706' },
  { key: 'd61_90', label: '61–90 days', colour: '#ea580c' },
  { key: 'd90_plus', label: '90+ days', colour: '#dc2626' },
];

/** Accounts receivable aging (spec 4.9), by customer and by invoice. */
export default function ArAgingPage() {
  const settings = useSettings();
  const [asOf, setAsOf] = useState(isoDate());
  const [tab, setTab] = useState<'customers' | 'invoices'>('customers');

  const byCustomer = useQuery({
    queryKey: ['ar-aging', asOf],
    queryFn: () => agingReport(asOf),
  });

  const byInvoice = useQuery({
    queryKey: ['ar-aging-invoices'],
    enabled: tab === 'invoices',
    queryFn: async () => check(await supabase.from('v_ar_aging').select('*').order('days_overdue', { ascending: false })) as InvoiceRow[],
  });

  const rows = byCustomer.data ?? [];
  const totals = useMemo(() => BUCKETS.reduce((acc, b) => {
    acc[b.key as string] = rows.reduce((t, r) => t + Number(r[b.key] ?? 0), 0);
    return acc;
  }, {} as Record<string, number>), [rows]);
  const grandTotal = rows.reduce((t, r) => t + Number(r.total), 0);
  const overdue = grandTotal - (totals.current_amt ?? 0);

  const exportExcel = () => exportXlsx(rows, [
    { header: 'Customer', value: (r: AgingRow) => r.customer_name ?? '' },
    { header: 'Current', value: (r: AgingRow) => r.current_amt },
    { header: '1-30', value: (r: AgingRow) => r.d1_30 },
    { header: '31-60', value: (r: AgingRow) => r.d31_60 },
    { header: '61-90', value: (r: AgingRow) => r.d61_90 },
    { header: '90+', value: (r: AgingRow) => r.d90_plus },
    { header: 'Total', value: (r: AgingRow) => r.total },
  ], `ar-aging-${asOf}`);

  const exportPdf = () => {
    if (!settings) return;
    void downloadPdf(
      <ReportPdf company={companyFromSettings(settings)} title="Accounts receivable aging"
        subtitle={`As at ${formatDate(asOf)}`}
        summary={[
          ['Total outstanding', formatGHS(grandTotal)],
          ['Overdue', formatGHS(overdue)],
          ['Current', formatGHS(totals.current_amt ?? 0)],
          ['90+ days', formatGHS(totals.d90_plus ?? 0)],
        ]}
        sections={[{
          columns: [
            { label: 'Customer', width: '30%', key: 'customer' },
            { label: 'Current', width: '14%', align: 'right', key: 'current' },
            { label: '1–30', width: '14%', align: 'right', key: 'd1' },
            { label: '31–60', width: '14%', align: 'right', key: 'd2' },
            { label: '61–90', width: '14%', align: 'right', key: 'd3' },
            { label: '90+', width: '14%', align: 'right', key: 'd4' },
          ],
          rows: rows.map((r) => ({
            customer: r.customer_name ?? '', current: formatGHS(r.current_amt), d1: formatGHS(r.d1_30),
            d2: formatGHS(r.d31_60), d3: formatGHS(r.d61_90), d4: formatGHS(r.d90_plus),
          })),
        }]}
      />,
      `ar-aging-${asOf}`,
    );
  };

  if (byCustomer.isLoading) return <Spinner />;
  if (byCustomer.error) return <ErrorState error={byCustomer.error} onRetry={() => void byCustomer.refetch()} />;

  return (
    <div>
      <PageHeader title="Receivables aging" subtitle="Who owes you, and for how long"
        actions={<>
          <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportExcel}>Excel</Button>
          <Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} onClick={exportPdf}>PDF</Button>
        </>} />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Input label="As at" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-44" />
        <p className="text-xs text-stone-500">
          Overdue reminders go out automatically at {(settings?.overdue_reminder_days ?? [3, 7, 14]).join(', ')} day(s)
          overdue and stop as soon as an invoice is paid.
        </p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-6">
        <Card title="Total outstanding"><p className="text-xl font-semibold tabular-nums">{formatGHS(grandTotal)}</p></Card>
        <Card title="Overdue" className={overdue > 0 ? 'border-red-200' : undefined}>
          <p className={`text-xl font-semibold tabular-nums ${overdue > 0 ? 'text-red-700' : ''}`}>{formatGHS(overdue)}</p>
        </Card>
        {BUCKETS.map((b) => (
          <Card key={b.key as string} title={b.label}>
            <p className="text-lg font-semibold tabular-nums">{formatGHS(totals[b.key as string] ?? 0)}</p>
          </Card>
        ))}
      </div>

      {grandTotal > 0 ? (
        <Card className="mb-4" title="By age">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={BUCKETS.map((b) => ({ bucket: b.label, amount: totals[b.key as string] ?? 0, colour: b.colour }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e5e4" />
                <XAxis dataKey="bucket" fontSize={11} />
                <YAxis fontSize={11} tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                <Tooltip formatter={(v: number) => formatGHS(v)} />
                <Bar dataKey="amount" radius={[4, 4, 0, 0]}>
                  {BUCKETS.map((b) => <Cell key={b.key as string} fill={b.colour} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      ) : null}

      <Tabs tabs={[
        { value: 'customers', label: 'By customer', count: rows.length },
        { value: 'invoices', label: 'By invoice' },
      ]} value={tab} onChange={setTab} />

      <div className="mt-4">
        {tab === 'customers' ? (
          rows.length ? (
            <Card bodyClassName="p-0">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Customer</th>
                      {BUCKETS.map((b) => <th key={b.key as string} scope="col" className="px-3 py-2 text-right font-medium">{b.label}</th>)}
                      <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
                      <th scope="col" className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {rows.map((r) => (
                      <tr key={r.customer_id}>
                        <td className="px-3 py-2">
                          <Link to={`/customers/${r.customer_id}`} className="font-medium text-brand-700 hover:underline">{r.customer_name}</Link>
                        </td>
                        {BUCKETS.map((b) => (
                          <td key={b.key as string} className={`px-3 py-2 text-right tabular-nums ${b.key === 'd90_plus' && Number(r[b.key]) > 0 ? 'font-semibold text-red-700' : ''}`}>
                            {Number(r[b.key]) ? formatGHS(r[b.key] as number) : '—'}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right tabular-nums font-semibold">{formatGHS(r.total)}</td>
                        <td className="px-3 py-2 text-right">
                          <Link to={`/customers/${r.customer_id}`}>
                            <Button variant="ghost" size="sm" aria-label="Statement" icon={<Mail className="h-4 w-4" />}>Statement</Button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-stone-50 font-semibold">
                    <tr>
                      <td className="px-3 py-2">Total</td>
                      {BUCKETS.map((b) => <td key={b.key as string} className="px-3 py-2 text-right tabular-nums">{formatGHS(totals[b.key as string] ?? 0)}</td>)}
                      <td className="px-3 py-2 text-right tabular-nums">{formatGHS(grandTotal)}</td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>
          ) : <EmptyState title="Nothing outstanding" message="Every issued invoice has been paid." />
        ) : (
          byInvoice.isLoading ? <Spinner /> : (byInvoice.data ?? []).length ? (
            <Card bodyClassName="p-0">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Invoice</th>
                      <th scope="col" className="px-3 py-2 font-medium">Customer</th>
                      <th scope="col" className="px-3 py-2 font-medium">Issued</th>
                      <th scope="col" className="px-3 py-2 font-medium">Due</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Days late</th>
                      <th scope="col" className="px-3 py-2 font-medium">Bucket</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Total</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Balance</th>
                      <th scope="col" className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {(byInvoice.data ?? []).map((r) => (
                      <tr key={r.invoice_id ?? ''}>
                        <td className="px-3 py-2">
                          <Link to={`/finance/invoices/${r.invoice_id}`} className="font-mono text-xs text-brand-700 hover:underline">{r.invoice_no}</Link>
                        </td>
                        <td className="px-3 py-2">
                          <Link to={`/customers/${r.customer_id}`} className="text-brand-700 hover:underline">{r.customer_name}</Link>
                        </td>
                        <td className="px-3 py-2">{formatDate(r.issue_date)}</td>
                        <td className="px-3 py-2">{r.due_date ? formatDate(r.due_date) : '—'}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{Number(r.days_overdue) > 0 ? r.days_overdue : '—'}</td>
                        <td className="px-3 py-2">
                          <Badge tone={r.bucket === 'current' ? 'green' : r.bucket === '90_plus' ? 'red' : 'amber'}>
                            {r.bucket === 'current' ? 'Current' : humanize(String(r.bucket).replace('_', '–'))}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatGHS(r.total)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-medium">{formatGHS(r.balance)}</td>
                        <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : <EmptyState title="Nothing outstanding" />
        )}
      </div>

      <p className="mt-3 text-xs text-stone-500">
        Aged by due date. An invoice with no due date (a job not yet completed) counts as current.
        {daysFrom(asOf) !== 0 ? ' Figures are as at the date chosen above.' : ''}
      </p>
    </div>
  );
}
