import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, Landmark } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { check, rpc, useAction } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { useAccounts, useBankAccounts, toOptions } from '@/lib/lookups';
import { formatDate, formatGHS, humanize, isoDate } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Tabs } from '@/components/ui/Tabs';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { CrudPage, type CrudField } from '@/components/ui/CrudPage';
import type { Column } from '@/components/ui/DataTable';
import type { Tables, Views } from '@/types/database';
import { z } from 'zod';

type BankAccount = Tables<'bank_accounts'> & { account: { code: string; name: string } | null };
type TrialRow = Views<'v_trial_balance'>;

interface LedgerLine {
  id: string; debit: number; credit: number; description: string | null; cleared: boolean;
  entry: { entry_no: string | null; entry_date: string; description: string } | null;
}

const bankSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
  kind: z.enum(['cash', 'bank', 'momo']),
  account_id: z.string().uuid('Choose the ledger account'),
  bank_name: z.string().trim().optional().or(z.literal('')),
  branch: z.string().trim().optional().or(z.literal('')),
  account_number: z.string().trim().optional().or(z.literal('')),
  momo_number: z.string().trim().optional().or(z.literal('')),
  is_active: z.boolean(),
});

/** Cash, bank and MoMo accounts, transfers between them, and a simple reconciliation (spec 4.10). */
export default function BankAccountsPage() {
  const { roles } = useAuth();
  const isAccountant = hasAny(roles, 'accountant');
  const { data: accounts } = useAccounts();
  const { data: banks } = useBankAccounts();
  const [tab, setTab] = useState<'accounts' | 'transfer' | 'reconcile'>('accounts');
  const [reconcileAccount, setReconcileAccount] = useState('');
  const [transferOpen, setTransferOpen] = useState(false);
  const [transfer, setTransfer] = useState({ from: '', to: '', amount: 0, fee: 0, date: isoDate(), reference: '' });
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const balances = useQuery({
    queryKey: ['bank-balances'],
    queryFn: async () => check(await supabase.from('v_trial_balance').select('*')) as TrialRow[],
  });

  const ledger = useQuery({
    queryKey: ['bank-ledger', reconcileAccount],
    enabled: tab === 'reconcile' && !!reconcileAccount,
    queryFn: async () => check(await supabase.from('journal_lines')
      .select('id, debit, credit, description, cleared, entry:journal_entries!inner(entry_no, entry_date, description)')
      .eq('account_id', reconcileAccount)
      .eq('entry.status', 'posted')
      .order('id', { ascending: false })
      .limit(300)) as LedgerLine[],
  });

  const doTransfer = useAction(() => rpc('record_bank_transfer', {
    p_from: transfer.from, p_to: transfer.to, p_amount: transfer.amount, p_fee: transfer.fee,
    p_date: transfer.date, p_reference: transfer.reference,
  }), {
    success: 'Transfer recorded',
    invalidate: [['bank-balances'], ['table', 'bank_transfers']],
    onSuccess: () => { setTransferOpen(false); setTransfer({ ...transfer, amount: 0, fee: 0, reference: '' }); },
  });

  const markCleared = useAction((clearedState: boolean) => rpc('mark_lines_cleared', {
    p_line_ids: [...selected], p_cleared: clearedState,
  }), {
    success: 'Updated',
    invalidate: [['bank-ledger', reconcileAccount]],
    onSuccess: () => setSelected(new Set()),
  });

  const transfers = useQuery({
    queryKey: ['bank-transfers'],
    enabled: tab === 'transfer',
    queryFn: async () => check(await supabase.from('bank_transfers')
      .select('*, from_account:bank_accounts!bank_transfers_from_bank_account_id_fkey(name), to_account:bank_accounts!bank_transfers_to_bank_account_id_fkey(name)')
      .order('transfer_date', { ascending: false }).limit(100)) as (Tables<'bank_transfers'> & {
        from_account: { name: string } | null; to_account: { name: string } | null;
      })[],
  });

  const balanceFor = (ledgerAccountId: string) => {
    const row = (balances.data ?? []).find((b) => b.account_id === ledgerAccountId);
    return Number(row?.debit_balance ?? 0) - Number(row?.credit_balance ?? 0);
  };

  const fields: CrudField[] = [
    { name: 'name', label: 'Name', required: true, placeholder: 'Main bank account' },
    { name: 'kind', label: 'Kind', type: 'select', required: true, options: [
      { value: 'cash', label: 'Cash on hand' }, { value: 'bank', label: 'Bank account' }, { value: 'momo', label: 'Mobile Money wallet' },
    ] },
    { name: 'account_id', label: 'Ledger account', type: 'select', required: true,
      options: toOptions((accounts ?? []).filter((a) => a.account_type === 'asset'), (a) => `${a.code} · ${a.name}`) },
    { name: 'bank_name', label: 'Bank name' },
    { name: 'branch', label: 'Branch' },
    { name: 'account_number', label: 'Account number' },
    { name: 'momo_number', label: 'MoMo number' },
    { name: 'is_active', label: 'Active', type: 'checkbox' },
  ];

  const columns: Column<BankAccount>[] = [
    { key: 'name', header: 'Account', sort: 'name', render: (r) => <span className="font-medium">{r.name}</span>, exportValue: (r) => r.name },
    { key: 'kind', header: 'Kind', render: (r) => <Badge tone={r.kind === 'cash' ? 'amber' : r.kind === 'momo' ? 'purple' : 'blue'}>{humanize(r.kind)}</Badge>, exportValue: (r) => r.kind },
    { key: 'details', header: 'Details', render: (r) => [r.bank_name, r.branch, r.account_number, r.momo_number].filter(Boolean).join(' · ') || '—',
      exportValue: (r) => r.account_number ?? r.momo_number, hideOnMobile: true },
    { key: 'ledger', header: 'Ledger account', render: (r) => (r.account ? `${r.account.code} · ${r.account.name}` : '—'), exportValue: (r) => r.account?.code, hideOnMobile: true },
    { key: 'balance', header: 'Balance', className: 'text-right',
      render: (r) => <span className="tabular-nums font-medium">{formatGHS(balanceFor(r.account_id))}</span>,
      exportValue: (r) => balanceFor(r.account_id) },
    { key: 'active', header: 'Status', render: (r) => <Badge tone={r.is_active ? 'green' : 'grey'}>{r.is_active ? 'Active' : 'Inactive'}</Badge>, exportValue: (r) => r.is_active },
  ];

  const totalCash = (banks ?? []).reduce((t, b) => t + balanceFor(b.account_id), 0);
  const uncleared = (ledger.data ?? []).filter((l) => !l.cleared);

  return (
    <div>
      <PageHeader title="Cash, bank and Mobile Money" subtitle="Where money sits, transfers between accounts, and reconciliation"
        actions={isAccountant ? <Button icon={<ArrowRight className="h-4 w-4" />} onClick={() => { setTransfer({ ...transfer, from: banks?.[0]?.id ?? '', to: banks?.[1]?.id ?? '' }); setTransferOpen(true); }}>Transfer</Button> : null} />

      <Card className="mb-4" title="Total across all accounts">
        <p className="flex items-center gap-2 text-2xl font-semibold tabular-nums"><Landmark className="h-6 w-6 text-stone-400" />{formatGHS(totalCash)}</p>
        <p className="text-xs text-stone-500">Posted balances from the general ledger</p>
      </Card>

      <Tabs tabs={[
        { value: 'accounts', label: 'Accounts', count: (banks ?? []).length },
        { value: 'transfer', label: 'Transfers' },
        { value: 'reconcile', label: 'Reconcile' },
      ]} value={tab} onChange={setTab} />

      <div className="mt-4">
        {tab === 'accounts' ? (
          <CrudPage<BankAccount>
            title="Accounts"
            table="bank_accounts"
            select="*, account:accounts(code, name)"
            schema={bankSchema}
            fields={fields}
            columns={columns}
            searchColumns={['name', 'bank_name', 'account_number', 'momo_number']}
            defaultSort={{ column: 'name', ascending: true }}
            canEdit={isAccountant}
            exportName="bank-accounts"
            defaultValues={{ name: '', kind: 'bank', account_id: '', bank_name: '', branch: '', account_number: '', momo_number: '', is_active: true }}
          />
        ) : null}

        {tab === 'transfer' ? (
          transfers.isLoading ? <Spinner /> : (transfers.data ?? []).length ? (
            <Card bodyClassName="p-0">
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Number</th>
                      <th scope="col" className="px-3 py-2 font-medium">Date</th>
                      <th scope="col" className="px-3 py-2 font-medium">From</th>
                      <th scope="col" className="px-3 py-2 font-medium">To</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Fee</th>
                      <th scope="col" className="px-3 py-2 font-medium">Reference</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {(transfers.data ?? []).map((t) => (
                      <tr key={t.id}>
                        <td className="px-3 py-2 font-mono text-xs">{t.transfer_no}</td>
                        <td className="px-3 py-2">{formatDate(t.transfer_date)}</td>
                        <td className="px-3 py-2">{t.from_account?.name}</td>
                        <td className="px-3 py-2">{t.to_account?.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatGHS(t.amount)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{Number(t.fee) ? formatGHS(t.fee) : '—'}</td>
                        <td className="px-3 py-2 text-stone-600">{t.reference ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="p-3 text-xs text-stone-500">A transfer posts Dr the destination / Cr the source, and any fee to Bank and MoMo charges.</p>
            </Card>
          ) : <EmptyState title="No transfers yet" message="Record a transfer when you move cash to the bank or top up a MoMo wallet." />
        ) : null}

        {tab === 'reconcile' ? (
          <>
            <div className="mb-3 flex flex-wrap items-end gap-3">
              <Select label="Account to reconcile" options={toOptions(banks, (b) => b.name)} placeholder="Choose…"
                value={reconcileAccount ? (banks ?? []).find((b) => b.account_id === reconcileAccount)?.id ?? '' : ''}
                onChange={(e) => {
                  const bank = (banks ?? []).find((b) => b.id === e.target.value);
                  setReconcileAccount(bank?.account_id ?? '');
                  setSelected(new Set());
                }} />
              {selected.size ? <>
                <Button variant="success" size="sm" icon={<Check className="h-4 w-4" />} loading={markCleared.isPending}
                  onClick={() => markCleared.mutate(true)}>Mark {selected.size} cleared</Button>
                <Button variant="secondary" size="sm" loading={markCleared.isPending} onClick={() => markCleared.mutate(false)}>Mark not cleared</Button>
              </> : null}
            </div>

            {!reconcileAccount ? (
              <EmptyState title="Choose an account" message="Pick a cash, bank or MoMo account to tick off the entries that appear on its statement." />
            ) : ledger.isLoading ? <Spinner /> : (
              <Card bodyClassName="p-0">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 p-3 text-sm">
                  <span>Balance <span className="font-semibold tabular-nums">{formatGHS(balanceFor(reconcileAccount))}</span></span>
                  <span className="text-stone-600">{uncleared.length} entry(ies) not yet cleared</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                      <tr>
                        <th scope="col" className="w-8 px-3 py-2" />
                        <th scope="col" className="px-3 py-2 font-medium">Date</th>
                        <th scope="col" className="px-3 py-2 font-medium">Journal</th>
                        <th scope="col" className="px-3 py-2 font-medium">Description</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">In</th>
                        <th scope="col" className="px-3 py-2 text-right font-medium">Out</th>
                        <th scope="col" className="px-3 py-2 font-medium">Cleared</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-100">
                      {(ledger.data ?? []).map((l) => (
                        <tr key={l.id} className={l.cleared ? 'bg-stone-50/60' : undefined}>
                          <td className="px-3 py-2">
                            <input type="checkbox" aria-label="Select entry" className="h-4 w-4" checked={selected.has(l.id)}
                              onChange={(e) => {
                                const next = new Set(selected);
                                if (e.target.checked) next.add(l.id); else next.delete(l.id);
                                setSelected(next);
                              }} />
                          </td>
                          <td className="whitespace-nowrap px-3 py-2">{formatDate(l.entry?.entry_date)}</td>
                          <td className="px-3 py-2 font-mono text-xs">{l.entry?.entry_no}</td>
                          <td className="px-3 py-2">{l.description ?? l.entry?.description}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{Number(l.debit) ? formatGHS(l.debit) : ''}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{Number(l.credit) ? formatGHS(l.credit) : ''}</td>
                          <td className="px-3 py-2">{l.cleared ? <Badge tone="green">Cleared</Badge> : <Badge tone="grey">No</Badge>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="p-3 text-xs text-stone-500">
                  Ticking an entry as cleared only records that it appeared on the statement; it never changes the amount.
                </p>
              </Card>
            )}
          </>
        ) : null}
      </div>

      <Modal open={transferOpen} onClose={() => setTransferOpen(false)} title="Transfer between accounts" size="sm"
        footer={<><Button variant="secondary" onClick={() => setTransferOpen(false)}>Cancel</Button>
          <Button loading={doTransfer.isPending} disabled={!transfer.from || !transfer.to || transfer.from === transfer.to || transfer.amount <= 0}
            onClick={() => doTransfer.mutate()}>Record transfer</Button></>}>
        <div className="space-y-3">
          <Select label="From" required options={toOptions(banks, (b) => b.name)} placeholder="Choose…"
            value={transfer.from} onChange={(e) => setTransfer({ ...transfer, from: e.target.value })} />
          <Select label="To" required options={toOptions(banks, (b) => b.name)} placeholder="Choose…"
            value={transfer.to} onChange={(e) => setTransfer({ ...transfer, to: e.target.value })} />
          <Input label="Amount (GH₵)" type="number" step="0.01" required value={transfer.amount} onChange={(e) => setTransfer({ ...transfer, amount: Number(e.target.value) })} />
          <Input label="Fee (GH₵)" type="number" step="0.01" value={transfer.fee} onChange={(e) => setTransfer({ ...transfer, fee: Number(e.target.value) })}
            hint="MoMo and bank charges post to Bank and MoMo charges" />
          <Input label="Date" type="date" required value={transfer.date} onChange={(e) => setTransfer({ ...transfer, date: e.target.value })} />
          <Input label="Reference" value={transfer.reference} onChange={(e) => setTransfer({ ...transfer, reference: e.target.value })} />
          {transfer.from && transfer.from === transfer.to ? (
            <p className="text-sm text-red-600">Choose two different accounts.</p>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
