import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Undo2 } from 'lucide-react';
import { useServerTable } from '@/lib/useServerTable';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { rpc, useAction } from '@/lib/rpc';
import { formatDate, formatGHS, humanize, isoDate } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { DataTable, FilterSelect, type Column } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { DateRange } from '@/components/ui/DateRange';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import type { Tables } from '@/types/database';

type Row = Tables<'journal_entries'> & { poster: { full_name: string } | null };

/** General ledger journals (spec 4.10). Most are posted automatically by events. */
export default function JournalsPage() {
  const { roles } = useAuth();
  const isAccountant = hasAny(roles, 'accountant');
  const [event, setEvent] = useState('');
  const [source, setSource] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reverse, setReverse] = useState<{ entry: Row; date: string; reason: string } | null>(null);

  const filters = useMemo(() => ({
    event_code: event, source_type: source, '>=entry_date': from || undefined, '<=entry_date': to || undefined,
  }), [event, source, from, to]);

  const table = useServerTable<Row>({
    table: 'journal_entries',
    select: '*, poster:profiles!journal_entries_posted_by_fkey(full_name)',
    searchColumns: ['entry_no', 'description'],
    filters,
    defaultSort: { column: 'entry_date', ascending: false },
  });

  const doReverse = useAction(() => rpc('reverse_journal', {
    p_entry_id: reverse?.entry.id as string,
    p_date: reverse?.date as string,
    p_reason: reverse?.reason as string,
  }), {
    success: 'Journal reversed',
    invalidate: [['table', 'journal_entries']],
    onSuccess: () => { setReverse(null); void table.refetch(); },
  });

  const columns: Column<Row>[] = [
    { key: 'no', header: 'Number', sort: 'entry_no', render: (r) => (
      <Link to={`/finance/journals/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline">{r.entry_no ?? 'Draft'}</Link>
    ), exportValue: (r) => r.entry_no },
    { key: 'date', header: 'Date', sort: 'entry_date', render: (r) => formatDate(r.entry_date), exportValue: (r) => formatDate(r.entry_date) },
    { key: 'description', header: 'Description', render: (r) => <span className="font-medium">{r.description}</span>, exportValue: (r) => r.description },
    { key: 'event', header: 'Event', render: (r) => (r.event_code ? <Badge tone="brand">{humanize(r.event_code)}</Badge> : <Badge tone="grey">Manual</Badge>),
      exportValue: (r) => r.event_code, hideOnMobile: true },
    { key: 'source', header: 'Source', render: (r) => humanize(r.source_type), exportValue: (r) => r.source_type, hideOnMobile: true },
    { key: 'debit', header: 'Debit', className: 'text-right', sort: 'total_debit', render: (r) => <span className="tabular-nums">{formatGHS(r.total_debit)}</span>, exportValue: (r) => r.total_debit },
    { key: 'credit', header: 'Credit', className: 'text-right', render: (r) => <span className="tabular-nums">{formatGHS(r.total_credit)}</span>, exportValue: (r) => r.total_credit },
    { key: 'status', header: 'Status', render: (r) => (
      <span className="flex flex-wrap items-center gap-1">
        <StatusBadge status={r.status === 'posted' ? 'completed' : r.status} />
        {r.reversal_of ? <Badge tone="grey">Reversal</Badge> : null}
        {r.reversed_by ? <Badge tone="red">Reversed</Badge> : null}
        {r.recur_frequency !== 'none' ? <Badge tone="purple">Recurs {humanize(r.recur_frequency)}</Badge> : null}
      </span>
    ), exportValue: (r) => r.status },
    { key: 'actions', header: '', className: 'text-right', render: (r) => (
      isAccountant && r.status === 'posted' && !r.reversed_by && !r.reversal_of ? (
        <Button variant="ghost" size="sm" aria-label="Reverse" icon={<Undo2 className="h-4 w-4" />}
          onClick={() => setReverse({ entry: r, date: isoDate(), reason: '' })}>Reverse</Button>
      ) : null
    ) },
  ];

  const pageDebit = table.rows.reduce((t, r) => t + Number(r.total_debit), 0);

  return (
    <div>
      <PageHeader title="Journals" subtitle="Every financial event writes a balanced journal; manual ones must balance too"
        actions={isAccountant ? <Link to="/finance/journals/new"><Button icon={<Plus className="h-4 w-4" />}>New journal</Button></Link> : null} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card title="Entries on this page"><p className="text-xl font-semibold tabular-nums">{table.count}</p></Card>
        <Card title="Debits on this page"><p className="text-xl font-semibold tabular-nums">{formatGHS(pageDebit)}</p></Card>
        <Card title="Balance check"><p className="text-xl font-semibold text-emerald-700">Always equal</p>
          <p className="text-xs text-stone-500">The database refuses an unbalanced journal</p></Card>
      </div>

      <DataTable table={table} columns={columns} rowLink={(r) => `/finance/journals/${r.id}`} exportName="journals"
        searchPlaceholder="Journal number or description"
        toolbar={<>
          <FilterSelect label="Source" value={source} onChange={setSource} options={[
            { value: 'job_order', label: 'Job order' }, { value: 'invoice', label: 'Invoice' }, { value: 'payment', label: 'Payment' },
            { value: 'contract', label: 'Contract' }, { value: 'bill', label: 'Bill' }, { value: 'expense', label: 'Expense' },
            { value: 'stock', label: 'Stock' }, { value: 'fleet', label: 'Fleet' }, { value: 'manual', label: 'Manual' },
          ]} />
          <FilterSelect label="Event" value={event} onChange={setEvent} options={[
            { value: 'job_approved', label: 'Job approved' }, { value: 'job_completed', label: 'Job completed' },
            { value: 'contract_invoice', label: 'Contract invoice' }, { value: 'payment_received', label: 'Payment received' },
            { value: 'credit_note', label: 'Credit note' }, { value: 'stock_issue', label: 'Stock issued' },
            { value: 'fuel_purchase', label: 'Fuel' }, { value: 'maintenance', label: 'Maintenance' }, { value: 'manual', label: 'Manual' },
          ]} />
          <DateRange presets={false} from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        </>}
        empty={{ title: 'No journals yet', message: 'Approve a job order or record a payment and the postings appear here.' }} />

      <Modal open={reverse !== null} onClose={() => setReverse(null)} title="Reverse this journal" size="sm"
        footer={<><Button variant="secondary" onClick={() => setReverse(null)}>Cancel</Button>
          <Button variant="danger" loading={doReverse.isPending} disabled={!reverse?.reason.trim()}
            onClick={() => doReverse.mutate()}>Reverse</Button></>}>
        {reverse ? (
          <div className="space-y-3">
            <p className="text-sm text-stone-600">
              Posted entries are never edited or deleted. Reversing writes an opposite entry dated as you choose, so both
              sides stay on the record.
            </p>
            <p className="rounded-lg bg-stone-50 p-2.5 text-sm">
              {reverse.entry.entry_no} · {reverse.entry.description} · {formatGHS(reverse.entry.total_debit)}
            </p>
            <Input label="Reversal date" type="date" required value={reverse.date} onChange={(e) => setReverse({ ...reverse, date: e.target.value })} />
            <Textarea label="Reason" required value={reverse.reason} onChange={(e) => setReverse({ ...reverse, reason: e.target.value })} />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
