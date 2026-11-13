import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, HandCoins, Plus, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { check, rpc, useAction } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { useServerTable } from '@/lib/useServerTable';
import { useAccounts, useBankAccounts, useSuppliers, useTrucks, toOptions } from '@/lib/lookups';
import { formatDate, formatGHS, isoDate } from '@/lib/format';
import { searchContracts, searchJobOrders } from '@/features/job-orders/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { DataTable, FilterSelect, type Column } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { AsyncPicker } from '@/components/ui/AsyncPicker';
import { FileUpload } from '@/components/ui/FileUpload';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DateRange } from '@/components/ui/DateRange';
import type { Tables } from '@/types/database';

type Row = Tables<'expenses'> & {
  account: { code: string; name: string } | null;
  supplier: { name: string } | null;
  job_order: { id: string; job_no: string | null } | null;
  contract: { id: string; contract_no: string | null } | null;
  truck: { id: string; registration_no: string } | null;
  approver: { full_name: string } | null;
};

/** Expenses (spec 4.10): raised, approved by a Manager, then paid. Fleet expenses by the Fleet Manager. */
export default function ExpensesPage() {
  const [params] = useSearchParams();
  const { roles } = useAuth();
  const isManager = hasAny(roles, 'manager');
  const isAccountant = hasAny(roles, 'accountant');
  const canRaise = hasAny(roles, 'accountant', 'fleet_manager');
  const { data: accounts } = useAccounts();
  const { data: suppliers } = useSuppliers();
  const { data: trucks } = useTrucks();
  const { data: banks } = useBankAccounts();

  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [jobLabel, setJobLabel] = useState<string | null>(null);
  const [contractLabel, setContractLabel] = useState<string | null>(null);
  const [approve, setApprove] = useState<Row | null>(null);
  const [reject, setReject] = useState<Row | null>(null);
  const [pay, setPay] = useState<{ expense: Row; bank: string; reference: string } | null>(null);

  const [expense, setExpense] = useState({
    expense_date: isoDate(), account_id: '', amount: 0, supplier_id: '', payee: '', description: '',
    job_order_id: '', contract_id: '', truck_id: params.get('truck') ?? '', receipt_path: '',
  });

  const filters = useMemo(() => ({
    status, contract_id: params.get('contract') ?? undefined, truck_id: params.get('truck') ?? undefined,
    '>=expense_date': from || undefined, '<=expense_date': to || undefined,
  }), [status, params, from, to]);

  const table = useServerTable<Row>({
    table: 'expenses',
    select: `*, account:accounts(code, name), supplier:suppliers(name), job_order:job_orders(id, job_no),
             contract:contracts(id, contract_no), truck:trucks(id, registration_no), approver:profiles!expenses_approved_by_fkey(full_name)`,
    searchColumns: ['expense_no', 'description', 'payee'],
    filters,
    defaultSort: { column: 'expense_date', ascending: false },
  });

  const invalidate = [['table', 'expenses']];
  const submitOne = useAction((expenseId: string) => rpc('submit_expense', { p_expense_id: expenseId }), {
    success: 'Sent for approval', invalidate, onSuccess: () => void table.refetch(),
  });
  const doApprove = useAction(() => rpc('approve_expense', { p_expense_id: approve?.id as string }), {
    success: 'Expense approved and posted', invalidate, onSuccess: () => { setApprove(null); void table.refetch(); },
  });
  const doReject = useAction((reason: string) => rpc('reject_expense', { p_expense_id: reject?.id as string, p_reason: reason }), {
    success: 'Expense rejected', invalidate, onSuccess: () => { setReject(null); void table.refetch(); },
  });
  const doPay = useAction(() => rpc('pay_expense', {
    p_expense_id: pay?.expense.id as string, p_bank_account_id: pay?.bank as string, p_reference: pay?.reference ?? '',
  }), {
    success: 'Expense paid', invalidate, onSuccess: () => { setPay(null); void table.refetch(); },
  });

  const save = async () => {
    if (!expense.account_id || !expense.description.trim() || expense.amount <= 0) {
      toast.error('Account, description and amount are required');
      return;
    }
    setSaving(true);
    try {
      check(await supabase.from('expenses').insert({
        expense_date: expense.expense_date, account_id: expense.account_id, amount: expense.amount,
        supplier_id: expense.supplier_id || null, payee: expense.payee || null, description: expense.description,
        job_order_id: expense.job_order_id || null, contract_id: expense.contract_id || null,
        truck_id: expense.truck_id || null, receipt_path: expense.receipt_path || null,
      }));
      toast.success('Expense saved as a draft');
      setNewOpen(false);
      setExpense({ ...expense, amount: 0, description: '', payee: '', receipt_path: '' });
      setJobLabel(null); setContractLabel(null);
      await table.refetch();
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  };

  const expenseAccounts = (accounts ?? []).filter((a) => a.account_type === 'expense');

  const columns: Column<Row>[] = [
    { key: 'no', header: 'Number', sort: 'expense_no', render: (r) => <span className="font-mono text-xs">{r.expense_no ?? 'Draft'}</span>, exportValue: (r) => r.expense_no },
    { key: 'date', header: 'Date', sort: 'expense_date', render: (r) => formatDate(r.expense_date), exportValue: (r) => formatDate(r.expense_date) },
    { key: 'account', header: 'Account', render: (r) => <>{r.account?.name}<span className="block font-mono text-xs text-stone-500">{r.account?.code}</span></>,
      exportValue: (r) => r.account?.name },
    { key: 'description', header: 'Description', render: (r) => <span className="font-medium">{r.description}</span>, exportValue: (r) => r.description },
    { key: 'payee', header: 'Paid to', render: (r) => r.supplier?.name ?? r.payee ?? '—', exportValue: (r) => r.supplier?.name ?? r.payee, hideOnMobile: true },
    { key: 'against', header: 'Against', render: (r) => (
      r.job_order ? <Link to={`/jobs/${r.job_order.id}`} className="text-brand-700 hover:underline">{r.job_order.job_no}</Link>
        : r.contract ? <Link to={`/contracts/${r.contract.id}`} className="text-brand-700 hover:underline">{r.contract.contract_no}</Link>
          : r.truck ? <Link to={`/fleet/trucks/${r.truck.id}`} className="text-brand-700 hover:underline">{r.truck.registration_no}</Link>
            : '—'
    ), exportValue: (r) => r.job_order?.job_no ?? r.contract?.contract_no ?? r.truck?.registration_no, hideOnMobile: true },
    { key: 'amount', header: 'Amount', className: 'text-right', sort: 'amount', render: (r) => <span className="tabular-nums font-medium">{formatGHS(r.amount)}</span>, exportValue: (r) => r.amount },
    { key: 'status', header: 'Status', sort: 'status', render: (r) => (
      <span className="flex flex-wrap items-center gap-1">
        <StatusBadge status={r.status} />
        {r.is_fleet ? <Badge tone="blue">Fleet</Badge> : null}
      </span>
    ), exportValue: (r) => r.status },
    { key: 'actions', header: '', className: 'text-right', render: (r) => (
      <div className="flex justify-end gap-1">
        {canRaise && r.status === 'draft' ? (
          <Button variant="secondary" size="sm" aria-label="Send for approval" loading={submitOne.isPending}
            onClick={() => submitOne.mutate(r.id)}><Send className="h-4 w-4" /></Button>
        ) : null}
        {isManager && r.status === 'pending_approval' ? <>
          <Button variant="success" size="sm" aria-label="Approve" onClick={() => setApprove(r)}><Check className="h-4 w-4" /></Button>
          <Button variant="ghost" size="sm" aria-label="Reject" onClick={() => setReject(r)}><X className="h-4 w-4" /></Button>
        </> : null}
        {isAccountant && r.status === 'approved' ? (
          <Button variant="secondary" size="sm" icon={<HandCoins className="h-4 w-4" />}
            onClick={() => setPay({ expense: r, bank: banks?.[0]?.id ?? '', reference: '' })}>Pay</Button>
        ) : null}
      </div>
    ) },
  ];

  const pageTotal = table.rows.reduce((t, r) => t + Number(r.amount), 0);
  const awaiting = table.rows.filter((r) => r.status === 'pending_approval').length;

  return (
    <div>
      <PageHeader title="Expenses" subtitle="Day-to-day costs, approved before they post and paid from a chosen account"
        actions={canRaise ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setNewOpen(true)}>New expense</Button> : null} />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Card title="On this page"><p className="text-xl font-semibold tabular-nums">{table.count}</p></Card>
        <Card title="Value"><p className="text-xl font-semibold tabular-nums">{formatGHS(pageTotal)}</p></Card>
        <Card title="Waiting for approval" className={awaiting ? 'border-amber-200' : undefined}>
          <p className={`text-xl font-semibold tabular-nums ${awaiting ? 'text-amber-700' : ''}`}>{awaiting}</p>
        </Card>
      </div>

      <DataTable table={table} columns={columns} exportName="expenses" searchPlaceholder="Number, description or payee"
        toolbar={<>
          <FilterSelect label="Status" value={status} onChange={setStatus} options={[
            { value: 'draft', label: 'Draft' }, { value: 'pending_approval', label: 'Pending approval' }, { value: 'approved', label: 'Approved' },
            { value: 'paid', label: 'Paid' }, { value: 'rejected', label: 'Rejected' },
          ]} />
          <DateRange presets={false} from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        </>}
        empty={{ title: 'No expenses yet', action: canRaise ? <Button onClick={() => setNewOpen(true)}>New expense</Button> : undefined }} />

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="New expense" size="lg"
        footer={<><Button variant="secondary" onClick={() => setNewOpen(false)}>Cancel</Button>
          <Button loading={saving} onClick={() => void save()}>Save draft</Button></>}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Date" type="date" required value={expense.expense_date} onChange={(e) => setExpense({ ...expense, expense_date: e.target.value })} />
          <Select label="Expense account" required options={toOptions(expenseAccounts, (a) => `${a.code} · ${a.name}`)} placeholder="Choose…"
            value={expense.account_id} onChange={(e) => setExpense({ ...expense, account_id: e.target.value })} />
          <Input label="Amount (GH₵)" type="number" step="0.01" required value={expense.amount} onChange={(e) => setExpense({ ...expense, amount: Number(e.target.value) })} />
          <Select label="Supplier" options={toOptions(suppliers, (s) => s.name)} placeholder="Not a registered supplier"
            value={expense.supplier_id} onChange={(e) => setExpense({ ...expense, supplier_id: e.target.value })} />
          <Input label="Paid to" value={expense.payee} onChange={(e) => setExpense({ ...expense, payee: e.target.value })}
            hint="Use this when there is no supplier record" />
          <Select label="Truck" options={toOptions(trucks, (t) => t.registration_no)} placeholder="Not for one truck"
            value={expense.truck_id} onChange={(e) => setExpense({ ...expense, truck_id: e.target.value })} />
          <Textarea className="sm:col-span-2" label="Description" required value={expense.description}
            onChange={(e) => setExpense({ ...expense, description: e.target.value })} />
          <AsyncPicker label="Job order" queryKey="jobs-expense" value={expense.job_order_id || null} valueLabel={jobLabel}
            onChange={(jid, item) => { setExpense({ ...expense, job_order_id: jid ?? '' }); setJobLabel(item?.label ?? null); }}
            search={searchJobOrders} placeholder="Not for one job" />
          <AsyncPicker label="Contract" queryKey="contracts-expense" value={expense.contract_id || null} valueLabel={contractLabel}
            onChange={(cid, item) => { setExpense({ ...expense, contract_id: cid ?? '' }); setContractLabel(item?.label ?? null); }}
            search={searchContracts} placeholder="Not for one contract" />
          <div className="sm:col-span-2">
            <FileUpload bucket="expense-receipts" folder="expenses" label={expense.receipt_path ? 'Replace receipt' : 'Photo of the receipt'}
              onUploaded={(path) => setExpense((x) => ({ ...x, receipt_path: path }))} capture />
            {expense.receipt_path ? <p className="mt-1 text-xs text-stone-500">Attached.</p> : null}
          </div>
        </div>
        <p className="mt-3 rounded-lg bg-stone-50 p-3 text-xs text-stone-600">
          Nothing is posted until a Manager approves it. Approval posts Dr the expense account / Cr Accounts payable;
          paying it posts Dr Accounts payable / Cr the account you pay from.
        </p>
      </Modal>

      <ConfirmDialog open={approve !== null} onClose={() => setApprove(null)} title="Approve this expense?"
        confirmLabel="Approve" loading={doApprove.isPending} onConfirm={() => doApprove.mutate()}
        message={approve ? `${approve.description} · ${formatGHS(approve.amount)} to ${approve.account?.name}.` : ''} />

      <ConfirmDialog open={reject !== null} onClose={() => setReject(null)} title="Reject this expense" danger
        confirmLabel="Reject" reasonLabel="Reason" loading={doReject.isPending} onConfirm={(reason) => doReject.mutate(reason)} />

      <Modal open={pay !== null} onClose={() => setPay(null)} title="Pay this expense" size="sm"
        footer={<><Button variant="secondary" onClick={() => setPay(null)}>Cancel</Button>
          <Button loading={doPay.isPending} disabled={!pay?.bank} onClick={() => doPay.mutate()}>Record payment</Button></>}>
        {pay ? (
          <div className="space-y-3">
            <p className="text-sm text-stone-600">{pay.expense.description} · {formatGHS(pay.expense.amount)}</p>
            <Select label="Paid from" required options={toOptions(banks, (b) => b.name)} placeholder="Choose…"
              value={pay.bank} onChange={(e) => setPay({ ...pay, bank: e.target.value })} />
            <Input label="Reference" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
