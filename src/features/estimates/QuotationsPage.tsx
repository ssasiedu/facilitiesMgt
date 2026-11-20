import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Download, X } from 'lucide-react';
import { useServerTable } from '@/lib/useServerTable';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { useSettings } from '@/lib/settings';
import { friendlyError, useAction } from '@/lib/rpc';
import { formatDate, formatGHS } from '@/lib/format';
import { downloadPdf } from '@/lib/pdf/download';
import { QuotationPdf } from '@/lib/pdf/QuotationPdf';
import { loadQuotation, toQuotationDoc } from './quotationApi';
import { toast } from 'sonner';
import { companyFromSettings } from '@/lib/pdf/company';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, FilterSelect, type Column } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { setQuotationStatus } from './api';
import type { Tables } from '@/types/database';

type Row = Tables<'quotations'> & {
  customer: { display_name: string | null } | null;
  lead: { name: string } | null;
  estimate: { id: string; estimate_no: string | null; is_recurring: boolean } | null;
};

/** Quotations sent to customers. Accepting one converts the estimate to a job order or contract. */
export default function QuotationsPage() {
  const { roles } = useAuth();
  const settings = useSettings();
  const [status, setStatus] = useState('');
  const canEditQuotes = hasAny(roles, 'manager', 'ops_officer', 'sales_exec');

  const filters = useMemo(() => ({ status }), [status]);
  const table = useServerTable<Row>({
    table: 'quotations',
    select: '*, customer:customers(display_name), lead:leads(name), estimate:estimates(id, estimate_no, is_recurring)',
    searchColumns: ['quote_no', 'title'],
    filters,
    defaultSort: { column: 'created_at', ascending: false },
  });

  const mark = useAction(({ id, next }: { id: string; next: string }) => setQuotationStatus(id, next), {
    success: 'Quotation updated',
    invalidate: [['table', 'quotations']],
    onSuccess: () => void table.refetch(),
  });

  /* The lines and the tax breakdown are not on the list row, so the document is loaded in full
     before printing. That way the quotation and the invoice that follows it print identically. */
  const download = async (row: Row) => {
    if (!settings) return;
    try {
      const full = await loadQuotation(row.id);
      await downloadPdf(
        <QuotationPdf company={companyFromSettings(settings)} quote={toQuotationDoc(full, settings.invoice_terms)} />,
        `quotation-${row.quote_no ?? 'draft'}`,
      );
    } catch (e) {
      toast.error(friendlyError(e));
    }
  };

  const columns: Column<Row>[] = [
    { key: 'no', header: 'Number', sort: 'quote_no', exportValue: (r) => r.quote_no,
      render: (r) => <Link to={`/quotations/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline">{r.quote_no ?? 'Draft'}</Link> },
    { key: 'party', header: 'Customer or lead', render: (r) => r.customer?.display_name ?? r.lead?.name ?? '—', exportValue: (r) => r.customer?.display_name ?? r.lead?.name },
    { key: 'title', header: 'Title', render: (r) => r.title ?? '—', exportValue: (r) => r.title, hideOnMobile: true },
    { key: 'estimate', header: 'Estimate', render: (r) => (r.estimate ? <Link to={`/estimates/${r.estimate.id}`} className="text-brand-700 hover:underline">{r.estimate.estimate_no}</Link> : '—'),
      exportValue: (r) => r.estimate?.estimate_no, hideOnMobile: true },
    { key: 'date', header: 'Date', sort: 'quote_date', render: (r) => formatDate(r.quote_date), exportValue: (r) => formatDate(r.quote_date) },
    { key: 'valid', header: 'Valid until', sort: 'valid_until', render: (r) => formatDate(r.valid_until), exportValue: (r) => formatDate(r.valid_until), hideOnMobile: true },
    { key: 'total', header: 'Total', className: 'text-right', sort: 'total', render: (r) => <span className="tabular-nums">{formatGHS(r.total)}</span>, exportValue: (r) => r.total },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} />, exportValue: (r) => r.status },
    { key: 'actions', header: '', className: 'text-right', render: (r) => (
      <div className="flex justify-end gap-1">
        <Button variant="ghost" size="sm" aria-label="Download PDF" onClick={() => void download(r)}><Download className="h-4 w-4" /></Button>
        {canEditQuotes && ['draft', 'sent'].includes(r.status) ? <>
          {r.status === 'draft' ? (
            <Button variant="secondary" size="sm" loading={mark.isPending} onClick={() => mark.mutate({ id: r.id, next: 'sent' })}>Mark sent</Button>
          ) : null}
          <Button variant="success" size="sm" aria-label="Accepted" loading={mark.isPending} onClick={() => mark.mutate({ id: r.id, next: 'accepted' })}><Check className="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" aria-label="Declined" onClick={() => mark.mutate({ id: r.id, next: 'declined' })}><X className="h-4 w-4" /></Button>
        </> : null}
      </div>
    ) },
  ];

  return (
    <div>
      <PageHeader title="Quotations" subtitle="What the customer sees: the price, with your costs kept internal" />
      <DataTable table={table} columns={columns} exportName="quotations" searchPlaceholder="Number or title"
        toolbar={<FilterSelect label="Status" value={status} onChange={setStatus} options={[
          { value: 'draft', label: 'Draft' }, { value: 'sent', label: 'Sent' }, { value: 'accepted', label: 'Accepted' },
          { value: 'declined', label: 'Declined' }, { value: 'expired', label: 'Expired' },
        ]} />}
        empty={{ title: 'No quotations yet', message: 'Create one from an approved estimate.' }} />
      <p className="mt-3 text-xs text-stone-500">
        Accepting a quotation moves its estimate to Accepted. Open the estimate to turn it into a job order (one-off) or a contract (recurring).
      </p>
    </div>
  );
}
