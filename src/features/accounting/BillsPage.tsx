import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, HandCoins, Plus, X } from 'lucide-react';
import { useServerTable } from '@/lib/useServerTable';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { rpc, useAction } from '@/lib/rpc';
import { useBankAccounts, useSuppliers, toOptions } from '@/lib/lookups';
import { daysFrom, formatDate, formatGHS, humanize, isoDate } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { DataTable, FilterSelect, type Column } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DateRange } from '@/components/ui/DateRange';
import type { Tables } from '@/types/database';

type Row = Tables<'bills'> & {
  supplier: { id: string; name: string } | null;
  job_order: { id: string; job_no: string | null } | null;
  contract: { id: string; contract_no: string | null } | null;
  truck: { id: string; registration_no: string } | null;
};

/** Supplier bills (spec 4.10): entered, approved by a Manager, then paid. */
export default function BillsPage() {
  const [params] = useSearchParams();
  const { roles } = useAuth();
  const isManager = hasAny(roles, 'manager');
  const canEnter = hasAny(roles, 'accountant', 'fleet_manager');
  const { data: suppliers } = useSuppliers();
  const { data: banks } = useBankAccounts();

  const [status, setStatus] = useState('');
  const [supplier, setSupplier] = useState(params.get('supplier') ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reject, setReject] = useState<Row | null>(null);
  const [approve, setApprove] = useState<Row | null>(null);
  const [pay, setPay] = useState<{ bill: Row; amount: string; bank: string; date: string; reference: string } | null>(null);

  const filters = useMemo(() => ({
    status, supplier_id: supplier, contract_id: params.get('contract') ?? undefined,
    '>=bill_date': from || undefined, '<=bill_date': to || undefined,
  }), [status, supplier, params, from, to]);

  const table = useServerTable<Row>({
    table: 'bills',
    select: '*, supplier:suppliers(id, name), job_order:job_orders(id, job_no), contract:contracts(id, contract_no), truck:trucks(id, registration_no)',
    searchColumns: ['bill_no', 'supplier_ref', 'notes'],
    filters,
    defaultSort: { column: 'bill_date', ascending: false },
  });

  const invalidate = [['table', 'bills']];
  const doApprove = useAction(() => rpc('approve_bill', { p_bill_id: approve?.id as string }), {
    success: 'Bill approved and posted', invalidate, onSuccess: () => { setApprove(null); void table.refetch(); },
  });
  const doReject = useAction((reason: string) => rpc('reject_bill', { p_bill_id: reject?.id as string, p_reason: reason }), {
    success: 'Bill rejected', invalidate, onSuccess: () => { setReject(null); void table.refetch(); },
  });
  const doPay = useAction(() => rpc('pay_bill', {
    p_bill_id: pay?.bill.id as string, p_amount: Number(pay?.amount), p_bank_account_id: pay?.bank as string,
    p_date: pay?.date as string, p_reference: pay?.reference ?? '',
  }), {
    success: 'Payment recorded', invalidate, onSuccess: () => { setPay(null); void table.refetch(); },
  });

  const columns: Column<Row>[] = [
    { key: 'no', header: 'Bill', sort: 'bill_no', render: (r) => (
      <Link to={`/finance/bills/${r.id}`} className="font-mono text-xs text-brand-700 hover:underline">{r.bill_no ?? 'Draft'}</Link>
    ), exportValue: (r) => r.bill_no },
    { key: 'supplier', header: 'Supplier', render: (r) => r.supplier?.name ?? '—', exportValue: (r) => r.supplier?.name },
    { key: 'ref', header: 'Their ref', render: (r) => r.supplier_ref ?? '—', exportValue: (r) => r.supplier_ref, hideOnMobile: true },
    { key: 'date', header: 'Date', sort: 'bill_date', render: (r) => formatDate(r.bill_date), exportValue: (r) => formatDate(r.bill_date) },
    { key: 'due', header: 'Due', sort: 'due_date', render: (r) => {
      if (!r.due_date) return '—';
      const days = daysFrom(r.due_date) ?? 0;
      const late = days > 0 && Number(r.balance) > 0;
      return <span className={late ? 'text-red-700' : ''}>{formatDate(r.due_date)}{late ? <span className="block text-xs">{days} day(s) late</span> : null}</span>;
    }, exportValue: (r) => r.due_date },
    { key: 'against', header: 'Against', render: (r) => (
      r.job_order ? <Link to={`/jobs/${r.job_order.id}`} className="text-brand-700 hover:underline">{r.job_order.job_no}</Link>
        : r.contract ? <Link to={`/contracts/${r.contract.id}`} className="text-brand-700 hover:underline">{r.contract.contract_no}</Link>
          : r.truck ? <Link to={`/fleet/trucks/${r.truck.id}`} className="text-brand-700 hover:underline">{r.truck.registration_no}</Link>
            : '—'
    ), exportValue: (r) => r.job_order?.job_no ?? r.contract?.contract_no ?? r.truck?.registration_no, hideOnMobile: true },
    { key: 'total', header: 'Total', className: 'text-right', sort: 'total', render: (r) => <span className="tabular-nums">{formatGHS(r.total)}</span>, exportValue: (r) => r.total },
    { key: 'balance', header: 'Balance', className: 'text-right', render: (r) => <span className={`tabular-nums ${Number(r.balance) > 0 ? 'font-medium' : 'text-stone-400'}`}>{formatGHS(r.balance)}</span>,
      exportValue: (r) => r.balance },
    { key: 'status', header: 'Status', sort: 'status', render: (r) => (
      <span className="flex flex-wrap items-center gap-1">
        <StatusBadge status={r.status} />
        {r.is_fleet ? <Badge tone="blue">Fleet</Badge> : null}
      </span>
    ), exportValue: (r) => r.status },
    { key: 'actions', header: '', className: 'text-right', render: (r) => (
      <div className="flex justify-end gap-1">
        {isManager && r.status === 'pending_approval' ? <>
          <Button variant="success" size="sm" aria-label="Approve" onClick={() => setApprove(r)}><Check className="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" aria-label="Reject" onClick={() => setReject(r)}><X className="h-4 w-4" /></Button>
        </> : null}
        {hasAny(roles, 'accountant') && ['approved', 'partially_paid'].includes(r.status) && Number(r.balance) > 0 ? (
          <Button variant="secondary" size="sm" icon={<HandCoins className="h-4 w-4" />}
            onClick={() => setPay({ bill: r, amount: String(r.balance), bank: banks?.[0]?.id ?? '', date: isoDate(), reference: '' })}>Pay</Button>
        ) : null}
      </div>
    ) },
  ];

  const pageTotal = table.rows.reduce((t, r) => t + Number(r.total), 0);
  const pageBalance = table.rows.reduce((t, r) => t + Number(r.balance), 0);

  return (
    <div>
      <PageHeader title="Supplier bills" subtitle="What you owe suppliers, approved before it is paid"
        actions={canEnter ? <Link to="/finance/bills/new"><Button icon={<Plus className="h-4 w-4" />}>New bill</Button></Link> : null} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card title="Bills on this page"><p className="text-xl font-semibold tabular-nums">{table.count}</p></Card>
        <Card title="Total"><p className="text-xl font-semibold tabular-nums">{formatGHS(pageTotal)}</p></Card>
        <Card title="Unpaid"><p className="text-xl font-semibold tabular-nums">{formatGHS(pageBalance)}</p></Card>
      </div>

      <DataTable table={table} columns={columns} exportName="bills" searchPlaceholder="Bill number, supplier reference or notes"
        toolbar={<>
          <FilterSelect label="Status" value={status} onChange={setStatus} options={[
            { value: 'draft', label: 'Draft' }, { value: 'pending_approval', label: 'Pending approval' }, { value: 'approved', label: 'Approved' },
            { value: 'partially_paid', label: 'Partially paid' }, { value: 'paid', label: 'Paid' }, { value: 'rejected', label: 'Rejected' },
          ]} />
          <FilterSelect label="Supplier" value={supplier} onChange={setSupplier} options={toOptions(suppliers, (s) => s.name)} />
          <DateRange presets={false} from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        </>}
        empty={{ title: 'No bills yet', message: 'Enter a supplier bill to record what you owe and what it was for.',
          action: canEnter ? <Link to="/finance/bills/new"><Button>New bill</Button></Link> : undefined }} />

      <ConfirmDialog open={approve !== null} onClose={() => setApprove(null)} title="Approve this bill?"
        confirmLabel="Approve" loading={doApprove.isPending} onConfirm={() => doApprove.mutate()}
        message={approve ? `Posts each line to its expense account (or Consumables inventory for stocked items) and Cr Accounts payable, ${formatGHS(approve.total)} in total.` : ''} />

      <ConfirmDialog open={reject !== null} onClose={() => setReject(null)} title="Reject this bill" danger
        confirmLabel="Reject" reasonLabel="Reason" loading={doReject.isPending} onConfirm={(reason) => doReject.mutate(reason)} />

      <Modal open={pay !== null} onClose={() => setPay(null)} title="Pay a supplier bill" size="sm"
        footer={<><Button variant="secondary" onClick={() => setPay(null)}>Cancel</Button>
          <Button loading={doPay.isPending} disabled={!pay?.bank || !Number(pay?.amount)}
            onClick={() => doPay.mutate()}>Record payment</Button></>}>
        {pay ? (
          <div className="space-y-3">
            <p className="text-sm text-stone-600">
              {pay.bill.supplier?.name} · bill {pay.bill.bill_no} · outstanding {formatGHS(pay.bill.balance)}
            </p>
            <Input label="Amount (GH₵)" type="number" step="0.01" required value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} />
            <Select label="Paid from" required options={toOptions(banks, (b) => b.name)} placeholder="Choose…"
              value={pay.bank} onChange={(e) => setPay({ ...pay, bank: e.target.value })} />
            <Input label="Date" type="date" required value={pay.date} onChange={(e) => setPay({ ...pay, date: e.target.value })} />
            <Input label="Reference" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
            <p className="rounded-lg bg-stone-50 p-2.5 text-xs text-stone-600">Posts Dr Accounts payable / Cr the account it is paid from.</p>
          </div>
        ) : null}
      </Modal>

      <p className="mt-3 text-xs text-stone-500">
        A bill line with a store chosen receives stock into that store when the bill is approved, so buying and stock
        stay in step. {humanize('fleet')} bills can also be entered by the Fleet Manager.
      </p>
    </div>
  );
}
