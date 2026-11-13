import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabaseClient';
import { check, rpc, useAction } from '@/lib/rpc';
import { useBankAccounts, usePaymentMethods, toOptions } from '@/lib/lookups';
import { formatDate, formatGHS, isoDate, round2 } from '@/lib/format';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Badge } from '@/components/ui/Badge';

interface OpenInvoice { id: string; invoice_no: string | null; issue_date: string; due_date: string | null; total: number; balance: number }

/**
 * Record a payment (spec 4.9). Allocation is oldest invoice first by default and editable.
 * The database creates the receipt, posts the ledger entry and queues the receipt and survey messages.
 */
export function PaymentModal({ open, onClose, customerId, customerName, preselectInvoiceId, onDone }: {
  open: boolean; onClose: () => void; customerId: string; customerName: string; preselectInvoiceId?: string; onDone?: () => void;
}) {
  const { data: methods } = usePaymentMethods();
  const { data: banks } = useBankAccounts();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('');
  const [date, setDate] = useState(isoDate());
  const [reference, setReference] = useState('');
  const [bankAccountId, setBankAccountId] = useState('');
  const [notes, setNotes] = useState('');
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [autoAllocate, setAutoAllocate] = useState(true);

  const { data: invoices = [] } = useQuery({
    queryKey: ['open-invoices', customerId],
    enabled: open && !!customerId,
    queryFn: async () => check(await supabase.from('invoices')
      .select('id, invoice_no, issue_date, due_date, total, balance')
      .eq('customer_id', customerId).gt('balance', 0).neq('status', 'draft')
      .order('issue_date')) as OpenInvoice[],
  });

  const selectedMethod = (methods ?? []).find((m) => m.code === method);

  // Default the method and the account it lands in.
  useEffect(() => {
    if (!open) return;
    if (!method && (methods ?? []).length) setMethod((methods ?? [])[0].code);
  }, [open, methods, method]);

  useEffect(() => {
    if (selectedMethod?.default_bank_account_id) setBankAccountId(selectedMethod.default_bank_account_id);
  }, [selectedMethod?.default_bank_account_id]);

  // Oldest first, up to the amount entered.
  useEffect(() => {
    if (!autoAllocate) return;
    let left = Number(amount) || 0;
    const next: Record<string, string> = {};
    const ordered = preselectInvoiceId
      ? [...invoices].sort((a, b) => (a.id === preselectInvoiceId ? -1 : b.id === preselectInvoiceId ? 1 : a.issue_date.localeCompare(b.issue_date)))
      : invoices;
    for (const inv of ordered) {
      if (left <= 0) break;
      const take = Math.min(left, Number(inv.balance));
      if (take > 0) { next[inv.id] = String(round2(take)); left = round2(left - take); }
    }
    setAllocations(next);
  }, [amount, invoices, autoAllocate, preselectInvoiceId]);

  const allocated = useMemo(
    () => Object.values(allocations).reduce((t, v) => t + (Number(v) || 0), 0),
    [allocations],
  );
  const unallocated = round2((Number(amount) || 0) - allocated);
  const needsReference = selectedMethod?.requires_reference ?? false;

  const record = useAction(() => rpc<Record<string, unknown>>('record_payment', {
    p_customer_id: customerId,
    p_amount: Number(amount),
    p_method: method,
    p_date: date,
    p_reference: reference || undefined,
    p_bank_account_id: bankAccountId || undefined,
    p_allocations: Object.entries(allocations)
      .filter(([, v]) => Number(v) > 0)
      .map(([invoice_id, v]) => ({ invoice_id, amount: Number(v) })),
    p_notes: notes || undefined,
  }), {
    success: 'Payment recorded. Receipt created and sent with the survey link.',
    invalidate: [['table', 'invoices'], ['table', 'payments'], ['open-invoices', customerId], ['invoice'], ['customer-overview', customerId]],
    onSuccess: () => {
      setAmount(''); setReference(''); setNotes(''); setAllocations({});
      onDone?.();
      onClose();
    },
  });

  const canSave = Number(amount) > 0 && !!method && (!needsReference || reference.trim().length > 0) && allocated <= (Number(amount) || 0) + 0.001;

  return (
    <Modal open={open} onClose={onClose} title={`Record a payment — ${customerName}`} size="lg"
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button loading={record.isPending} disabled={!canSave} onClick={() => record.mutate()}>Record payment</Button>
      </>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="Amount received (GH₵)" type="number" step="0.01" required value={amount}
          onChange={(e) => { setAmount(e.target.value); setAutoAllocate(true); }} />
        <Input label="Payment date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        <Select label="Method" required options={toOptions((methods ?? []).map((m) => ({ id: m.code, name: m.name })), (m) => m.name)}
          value={method} onChange={(e) => setMethod(e.target.value)} />
        <Input label="Transaction reference" required={needsReference} value={reference} onChange={(e) => setReference(e.target.value)}
          hint={needsReference ? 'Required for this method' : 'Optional for cash'} />
        <Select label="Received into" options={toOptions(banks, (b) => b.name)} placeholder="Use the method's default"
          value={bankAccountId} onChange={(e) => setBankAccountId(e.target.value)} />
        <Textarea className="sm:col-span-2" label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-stone-800">Apply to invoices</h3>
          <label className="flex items-center gap-2 text-xs text-stone-600">
            <input type="checkbox" className="h-4 w-4" checked={autoAllocate} onChange={(e) => setAutoAllocate(e.target.checked)} />
            Oldest first automatically
          </label>
        </div>

        {invoices.length ? (
          <div className="overflow-x-auto rounded-lg border border-stone-200">
            <table className="min-w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Invoice</th>
                  <th scope="col" className="px-3 py-2 font-medium">Issued</th>
                  <th scope="col" className="px-3 py-2 font-medium">Due</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Balance</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Apply</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {invoices.map((inv) => (
                  <tr key={inv.id} className={inv.id === preselectInvoiceId ? 'bg-brand-50' : undefined}>
                    <td className="px-3 py-2 font-mono text-xs">{inv.invoice_no}</td>
                    <td className="px-3 py-2">{formatDate(inv.issue_date)}</td>
                    <td className="px-3 py-2">{inv.due_date ? formatDate(inv.due_date) : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatGHS(inv.balance)}</td>
                    <td className="px-3 py-2 text-right">
                      <input aria-label={`Apply to ${inv.invoice_no}`} type="number" step="0.01" min="0" max={Number(inv.balance)}
                        className="w-28 rounded border-stone-300 text-right text-sm"
                        value={allocations[inv.id] ?? ''}
                        onChange={(e) => { setAutoAllocate(false); setAllocations({ ...allocations, [inv.id]: e.target.value }); }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-lg bg-stone-50 p-3 text-sm text-stone-600">
            This customer has no unpaid invoices. The whole payment will be held as a credit on their account.
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-end gap-3 text-sm">
          <span className="text-stone-600">Allocated <span className="font-medium tabular-nums">{formatGHS(allocated)}</span></span>
          {unallocated > 0 ? <Badge tone="amber">{formatGHS(unallocated)} will become a customer credit</Badge> : null}
          {unallocated < 0 ? <Badge tone="red">Allocations exceed the amount by {formatGHS(Math.abs(unallocated))}</Badge> : null}
        </div>
      </div>

      <p className="mt-4 rounded-lg bg-stone-50 p-3 text-xs text-stone-600">
        Saving posts Dr {banks?.find((b) => b.id === bankAccountId)?.name ?? 'the receiving account'} / Cr Accounts receivable,
        creates the receipt, and sends it to the customer by email and SMS with the satisfaction survey link.
      </p>
    </Modal>
  );
}
