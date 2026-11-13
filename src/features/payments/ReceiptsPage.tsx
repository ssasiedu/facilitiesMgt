import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Download, Smile } from 'lucide-react';
import { toast } from 'sonner';
import { useServerTable } from '@/lib/useServerTable';
import { useSettings } from '@/lib/settings';
import { publicAppUrl } from '@/lib/supabaseClient';
import { formatDate, formatGHS, humanize } from '@/lib/format';
import { downloadPdf } from '@/lib/pdf/download';
import { ReceiptPdf } from '@/lib/pdf/ReceiptPdf';
import { companyFromSettings } from '@/lib/pdf/company';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { DateRange } from '@/components/ui/DateRange';
import type { Tables } from '@/types/database';

type Row = Tables<'receipts'> & {
  customer: { id: string; display_name: string | null; phone: string | null; company_phone: string | null; email: string | null } | null;
  payment: {
    payment_date: string; method_code: string; reference: string | null; unallocated_amount: number;
    payment_methods: { name: string } | null;
    payment_allocations: { amount: number; invoices: { invoice_no: string | null; balance: number } | null }[];
  } | null;
  survey_invitations: { id: string; status: string; responded_at: string | null }[];
};

/** Receipts (spec 4.9). One is created automatically for every payment, with a survey link. */
export default function ReceiptsPage() {
  const settings = useSettings();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const filters = useMemo(() => ({ '>=issued_at': from || undefined, '<=issued_at': to ? `${to}T23:59:59` : undefined }), [from, to]);
  const table = useServerTable<Row>({
    table: 'receipts',
    select: `*, customer:customers(id, display_name, phone, company_phone, email),
             payment:payments(payment_date, method_code, reference, unallocated_amount, payment_methods(name),
               payment_allocations(amount, invoices(invoice_no, balance))),
             survey_invitations(id, status, responded_at)`,
    searchColumns: ['receipt_no'],
    filters,
    defaultSort: { column: 'issued_at', ascending: false },
  });

  const download = (r: Row) => {
    if (!settings) return;
    void downloadPdf(
      <ReceiptPdf
        company={companyFromSettings(settings)}
        receipt={{
          receipt_no: r.receipt_no ?? '', amount: Number(r.amount), issued_at: r.issued_at,
          payment: r.payment ? {
            payment_date: r.payment.payment_date, method_code: r.payment.method_code, reference: r.payment.reference,
            unallocated_amount: Number(r.payment.unallocated_amount), payment_methods: r.payment.payment_methods,
          } : null,
          allocations: (r.payment?.payment_allocations ?? []).map((a) => ({
            amount: Number(a.amount),
            invoices: a.invoices ? { invoice_no: a.invoices.invoice_no ?? '', balance: Number(a.invoices.balance) } : null,
          })),
          customer: r.customer ? { ...r.customer, display_name: r.customer.display_name ?? 'Customer' } : null,
        }}
      />,
      `receipt-${r.receipt_no ?? r.id}`,
    );
  };

  const copyLink = async (r: Row) => {
    const url = `${publicAppUrl}/p/receipt/${r.public_token}`;
    try { await navigator.clipboard.writeText(url); toast.success('Receipt link copied'); }
    catch { toast.info(url); }
  };

  const pageTotal = table.rows.reduce((t, r) => t + Number(r.amount), 0);
  const responded = table.rows.filter((r) => r.survey_invitations.some((s) => s.responded_at)).length;

  const columns: Column<Row>[] = [
    { key: 'no', header: 'Receipt', sort: 'receipt_no', render: (r) => <span className="font-mono text-xs">{r.receipt_no}</span>, exportValue: (r) => r.receipt_no },
    { key: 'date', header: 'Date', sort: 'issued_at', render: (r) => formatDate(r.payment?.payment_date ?? r.issued_at), exportValue: (r) => formatDate(r.issued_at) },
    { key: 'customer', header: 'Customer',
      render: (r) => (r.customer ? <Link to={`/customers/${r.customer.id}`} className="font-medium text-brand-700 hover:underline">{r.customer.display_name}</Link> : '—'),
      exportValue: (r) => r.customer?.display_name },
    { key: 'amount', header: 'Amount', className: 'text-right', sort: 'amount', render: (r) => <span className="tabular-nums font-medium">{formatGHS(r.amount)}</span>, exportValue: (r) => r.amount },
    { key: 'method', header: 'Method', render: (r) => r.payment?.payment_methods?.name ?? humanize(r.payment?.method_code), exportValue: (r) => r.payment?.method_code },
    { key: 'invoices', header: 'Invoices', render: (r) => (r.payment?.payment_allocations ?? []).map((a) => a.invoices?.invoice_no).filter(Boolean).join(', ') || '—',
      exportValue: (r) => (r.payment?.payment_allocations ?? []).map((a) => a.invoices?.invoice_no).join(' '), hideOnMobile: true },
    { key: 'survey', header: 'Survey', render: (r) => {
      const inv = r.survey_invitations[0];
      if (!inv) return <span className="text-stone-400">—</span>;
      return inv.responded_at ? <Badge tone="green">Answered</Badge> : <Badge tone="amber">Sent</Badge>;
    }, exportValue: (r) => (r.survey_invitations[0]?.responded_at ? 'answered' : r.survey_invitations[0] ? 'sent' : ''), hideOnMobile: true },
    { key: 'actions', header: '', className: 'text-right', render: (r) => (
      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="sm" aria-label="Download PDF" onClick={() => download(r)}><Download className="h-4 w-4" /></Button>
        <Button variant="ghost" size="sm" aria-label="Copy link" onClick={() => void copyLink(r)}><Copy className="h-4 w-4" /></Button>
      </div>
    ) },
  ];

  return (
    <div>
      <PageHeader title="Receipts" subtitle="Created automatically for every payment, and sent with the survey link" />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card title="Receipts on this page"><p className="text-xl font-semibold tabular-nums">{table.count}</p></Card>
        <Card title="Value on this page"><p className="text-xl font-semibold tabular-nums">{formatGHS(pageTotal)}</p></Card>
        <Card title="Surveys answered">
          <p className="flex items-center gap-2 text-xl font-semibold tabular-nums"><Smile className="h-5 w-5 text-stone-400" />{responded}</p>
          <p className="text-xs text-stone-500">of {table.rows.length} on this page</p>
        </Card>
      </div>

      <DataTable table={table} columns={columns} exportName="receipts" searchPlaceholder="Receipt number"
        toolbar={<DateRange presets={false} from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />}
        empty={{ title: 'No receipts yet', message: 'Record a payment and its receipt appears here.' }} />

      <p className="mt-3 text-xs text-stone-500">
        Each receipt has its own link that the customer can open without signing in. The receipt message also carries the
        satisfaction survey, so scores arrive while the work is fresh.
      </p>
    </div>
  );
}
