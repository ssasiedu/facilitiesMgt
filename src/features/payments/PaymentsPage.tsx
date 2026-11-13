import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { HandCoins, Undo2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { check, rpc, useAction } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { useServerTable } from '@/lib/useServerTable';
import { useBankAccounts, usePaymentMethods, toOptions } from '@/lib/lookups';
import { formatDate, formatGHS, humanize } from '@/lib/format';
import { searchCustomers } from '@/features/customers/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { DataTable, FilterSelect, type Column } from '@/components/ui/DataTable';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { AsyncPicker } from '@/components/ui/AsyncPicker';
import { DateRange } from '@/components/ui/DateRange';
import { Tabs } from '@/components/ui/Tabs';
import { Spinner } from '@/components/ui/Spinner';
import { PaymentModal } from './PaymentModal';
import type { Tables } from '@/types/database';

type Row = Tables<'payments'> & {
  customer: { id: string; display_name: string | null } | null;
  bank_account: { name: string } | null;
  receipts: { id: string; receipt_no: string | null }[];
  payment_allocations: { amount: number; invoice: { id: string; invoice_no: string | null } | null }[];
  recorder: { full_name: string } | null;
};

type CreditRow = Tables<'customer_credits'> & { customer: { id: string; display_name: string | null } | null };

/** Payments received, customer credits and refunds (spec 4.9). */
export default function PaymentsPage() {
  const { roles } = useAuth();
  const isAccountant = hasAny(roles, 'accountant');
  const { data: methods } = usePaymentMethods();
  const { data: banks } = useBankAccounts();

  const [tab, setTab] = useState<'payments' | 'credits'>('payments');
  const [method, setMethod] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [customerId, setCustomerId] = useState('');
  const [customerLabel, setCustomerLabel] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [refund, setRefund] = useState<{ credit: CreditRow; amount: string; method: string; bank: string; reference: string } | null>(null);

  const filters = useMemo(() => ({ method_code: method, '>=payment_date': from || undefined, '<=payment_date': to || undefined }), [method, from, to]);
  const table = useServerTable<Row>({
    table: 'payments',
    select: `*, customer:customers(id, display_name), bank_account:bank_accounts(name), receipts(id, receipt_no),
             payment_allocations(amount, invoice:invoices(id, invoice_no)), recorder:profiles(full_name)`,
    searchColumns: ['payment_no', 'reference'],
    filters,
    defaultSort: { column: 'payment_date', ascending: false },
    enabled: tab === 'payments',
  });

  const credits = useQuery({
    queryKey: ['customer-credits'],
    enabled: tab === 'credits',
    queryFn: async () => check(await supabase.from('customer_credits')
      .select('*, customer:customers(id, display_name)')
      .order('created_at', { ascending: false })) as CreditRow[],
  });

  const doRefund = useAction(() => rpc('refund_customer_credit', {
    p_credit_id: refund?.credit.id as string,
    p_amount: Number(refund?.amount),
    p_bank_account_id: refund?.bank as string,
    p_method: refund?.method as string,
    p_reference: refund?.reference ?? '',
  }), {
    success: 'Refund recorded',
    invalidate: [['customer-credits']],
    onSuccess: () => setRefund(null),
  });

  const pageTotal = table.rows.reduce((t, r) => t + Number(r.amount), 0);

  const columns: Column<Row>[] = [
    { key: 'no', header: 'Payment', sort: 'payment_no', render: (r) => <span className="font-mono text-xs">{r.payment_no}</span>, exportValue: (r) => r.payment_no },
    { key: 'date', header: 'Date', sort: 'payment_date', render: (r) => formatDate(r.payment_date), exportValue: (r) => formatDate(r.payment_date) },
    { key: 'customer', header: 'Customer',
      render: (r) => (r.customer ? <Link to={`/customers/${r.customer.id}`} className="font-medium text-brand-700 hover:underline">{r.customer.display_name}</Link> : '—'),
      exportValue: (r) => r.customer?.display_name },
    { key: 'amount', header: 'Amount', className: 'text-right', sort: 'amount', render: (r) => <span className="tabular-nums font-medium">{formatGHS(r.amount)}</span>, exportValue: (r) => r.amount },
    { key: 'method', header: 'Method', render: (r) => humanize(r.method_code), exportValue: (r) => r.method_code },
    { key: 'reference', header: 'Reference', render: (r) => r.reference ?? '—', exportValue: (r) => r.reference, hideOnMobile: true },
    { key: 'into', header: 'Into', render: (r) => r.bank_account?.name ?? '—', exportValue: (r) => r.bank_account?.name, hideOnMobile: true },
    { key: 'applied', header: 'Applied to', render: (r) => (
      r.payment_allocations.length
        ? <span className="flex flex-wrap gap-1">{r.payment_allocations.map((a, i) => (
          a.invoice ? <Link key={i} to={`/finance/invoices/${a.invoice.id}`} className="text-xs text-brand-700 hover:underline">{a.invoice.invoice_no}</Link> : null
        ))}</span>
        : <Badge tone="amber">Held as credit</Badge>
    ), exportValue: (r) => r.payment_allocations.map((a) => a.invoice?.invoice_no).join(' ') },
    { key: 'receipt', header: 'Receipt', render: (r) => (r.receipts[0]?.receipt_no ? <span className="font-mono text-xs">{r.receipts[0].receipt_no}</span> : '—'),
      exportValue: (r) => r.receipts[0]?.receipt_no, hideOnMobile: true },
    { key: 'by', header: 'Recorded by', render: (r) => r.recorder?.full_name ?? '—', exportValue: (r) => r.recorder?.full_name, hideOnMobile: true },
  ];

  return (
    <div>
      <PageHeader title="Payments" subtitle="Money received, how it was applied, and credits held on account"
        actions={isAccountant ? <Button icon={<HandCoins className="h-4 w-4" />} onClick={() => setNewOpen(true)}>Record payment</Button> : null} />

      <Tabs tabs={[{ value: 'payments', label: 'Payments', count: table.count }, { value: 'credits', label: 'Customer credits' }]} value={tab} onChange={setTab} />

      <div className="mt-4">
        {tab === 'payments' ? (
          <>
            <Card className="mb-4" title="Total on this page"><p className="text-xl font-semibold tabular-nums">{formatGHS(pageTotal)}</p></Card>
            <DataTable table={table} columns={columns} exportName="payments" searchPlaceholder="Payment number or reference"
              toolbar={<>
                <FilterSelect label="Method" value={method} onChange={setMethod}
                  options={(methods ?? []).map((m) => ({ value: m.code, label: m.name }))} />
                <DateRange presets={false} from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
              </>}
              empty={{ title: 'No payments yet', message: 'Record one from an invoice or with the button above.' }} />
          </>
        ) : (
          credits.isLoading ? <Spinner /> : (
            <Card bodyClassName="p-0">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Customer</th>
                      <th scope="col" className="px-3 py-2 font-medium">Source</th>
                      <th scope="col" className="px-3 py-2 font-medium">Created</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Used</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Available</th>
                      {isAccountant ? <th scope="col" className="px-3 py-2" /> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {(credits.data ?? []).map((cr) => {
                      const available = Number(cr.amount) - Number(cr.amount_used);
                      return (
                        <tr key={cr.id}>
                          <td className="px-3 py-2">
                            {cr.customer ? <Link to={`/customers/${cr.customer.id}`} className="text-brand-700 hover:underline">{cr.customer.display_name}</Link> : '—'}
                          </td>
                          <td className="px-3 py-2"><Badge tone="grey">{humanize(cr.source_type)}</Badge></td>
                          <td className="px-3 py-2">{formatDate(cr.created_at)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatGHS(cr.amount)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatGHS(cr.amount_used)}</td>
                          <td className={`px-3 py-2 text-right tabular-nums ${available > 0 ? 'font-medium' : 'text-stone-400'}`}>{formatGHS(available)}</td>
                          {isAccountant ? (
                            <td className="px-3 py-2 text-right">
                              {available > 0 ? (
                                <Button variant="secondary" size="sm" icon={<Undo2 className="h-4 w-4" />}
                                  onClick={() => setRefund({ credit: cr, amount: String(available), method: 'cash', bank: '', reference: '' })}>Refund</Button>
                              ) : null}
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                    {!(credits.data ?? []).length ? (
                      <tr><td colSpan={isAccountant ? 7 : 6} className="px-3 py-6 text-center text-stone-500">No customer credits. Overpayments appear here automatically.</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <p className="p-3 text-xs text-stone-500">
                A credit is created when a customer pays more than they owe, or when a credit note is issued. It can be
                applied to a later invoice from the customer's page, or refunded here.
              </p>
            </Card>
          )
        )}
      </div>

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="Which customer paid?" size="sm"
        footer={<><Button variant="secondary" onClick={() => setNewOpen(false)}>Cancel</Button>
          <Button disabled={!customerId} onClick={() => { setNewOpen(false); setPayOpen(true); }}>Continue</Button></>}>
        <AsyncPicker label="Customer" required queryKey="customers" value={customerId || null} valueLabel={customerLabel}
          onChange={(cid, item) => { setCustomerId(cid ?? ''); setCustomerLabel(item?.label ?? null); }}
          search={searchCustomers} placeholder="Search by name, code or phone…" />
      </Modal>

      {customerId ? (
        <PaymentModal open={payOpen} onClose={() => setPayOpen(false)} customerId={customerId}
          customerName={customerLabel ?? 'Customer'} onDone={() => void table.refetch()} />
      ) : null}

      <Modal open={refund !== null} onClose={() => setRefund(null)} title="Refund a customer credit" size="sm"
        footer={<><Button variant="secondary" onClick={() => setRefund(null)}>Cancel</Button>
          <Button variant="danger" loading={doRefund.isPending} disabled={!refund?.bank || !Number(refund?.amount)}
            onClick={() => doRefund.mutate()}>Record refund</Button></>}>
        {refund ? (
          <div className="space-y-3">
            <p className="text-sm text-stone-600">
              Refunding {refund.credit.customer?.display_name}. Available: {formatGHS(Number(refund.credit.amount) - Number(refund.credit.amount_used))}.
            </p>
            <Input label="Amount (GH₵)" type="number" step="0.01" required value={refund.amount}
              onChange={(e) => setRefund({ ...refund, amount: e.target.value })} />
            <Select label="Method" required options={(methods ?? []).map((m) => ({ value: m.code, label: m.name }))}
              value={refund.method} onChange={(e) => setRefund({ ...refund, method: e.target.value })} />
            <Select label="Paid from" required options={toOptions(banks, (b) => b.name)} placeholder="Choose…"
              value={refund.bank} onChange={(e) => setRefund({ ...refund, bank: e.target.value })} />
            <Input label="Reference" value={refund.reference} onChange={(e) => setRefund({ ...refund, reference: e.target.value })} />
            <p className="rounded-lg bg-stone-50 p-2.5 text-xs text-stone-600">
              Posts Dr Customer credits / Cr the account it is paid from.
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
