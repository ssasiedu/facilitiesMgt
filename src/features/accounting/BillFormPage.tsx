import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useFieldArray, useForm, type FieldValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Plus, Save, Send, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { check, nullify, rpc, useAction } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { billSchema, type BillForm } from '@/lib/schemas';
import { formatDate, formatGHS, humanize, isoDate, round2 } from '@/lib/format';
import { useAccounts, useCostItems, useStockLocations, useSuppliers, useTrucks, toOptions } from '@/lib/lookups';
import { searchJobOrders, searchContracts } from '@/features/job-orders/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, DetailList } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { AsyncPicker } from '@/components/ui/AsyncPicker';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { FileUpload } from '@/components/ui/FileUpload';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/ErrorState';
import type { Tables } from '@/types/database';

interface BillFull extends Tables<'bills'> {
  bill_lines: (Tables<'bill_lines'> & { account: { code: string; name: string } | null; cost_item: { name: string } | null; stock_location: { name: string } | null })[];
  supplier: { id: string; name: string; payment_terms_days: number } | null;
  bill_payments: Tables<'bill_payments'>[];
  approver: { full_name: string } | null;
}

const EMPTY_LINE = { account_id: '', description: '', cost_item_id: '', quantity: 1, unit_cost: 0, stock_location_id: '' };

const DEFAULTS: BillForm = {
  supplier_id: '', supplier_ref: '', bill_date: isoDate(), due_date: '',
  job_order_id: '', contract_id: '', truck_id: '', notes: '', lines: [EMPTY_LINE],
};

/** Enter or review a supplier bill (spec 4.10), linked to a job, contract or truck. */
export default function BillFormPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { roles } = useAuth();
  const canEnter = hasAny(roles, 'accountant', 'fleet_manager');
  const { data: accounts } = useAccounts();
  const { data: suppliers } = useSuppliers();
  const { data: costItems } = useCostItems();
  const { data: locations } = useStockLocations();
  const { data: trucks } = useTrucks();

  const [jobLabel, setJobLabel] = useState<string | null>(null);
  const [contractLabel, setContractLabel] = useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [receiptPath, setReceiptPath] = useState<string | null>(null);

  const form = useForm<FieldValues>({ resolver: zodResolver(billSchema), defaultValues: DEFAULTS as unknown as FieldValues });
  const lines = useFieldArray({ control: form.control, name: 'lines' });
  const values = form.watch() as BillForm;

  const query = useQuery({
    queryKey: ['bill', id],
    enabled: !!id,
    queryFn: async () => check(await supabase.from('bills')
      .select(`*, bill_lines(*, account:accounts(code, name), cost_item:cost_items(name), stock_location:stock_locations(name)),
               supplier:suppliers(id, name, payment_terms_days), bill_payments(*), approver:profiles!bills_approved_by_fkey(full_name)`)
      .eq('id', id as string).single()) as BillFull,
  });

  useEffect(() => {
    const b = query.data;
    if (!b || b.status !== 'draft') return;
    setJobLabel(null);
    setContractLabel(null);
    setReceiptPath(b.receipt_path);
    form.reset({
      supplier_id: b.supplier_id, supplier_ref: b.supplier_ref ?? '', bill_date: b.bill_date, due_date: b.due_date ?? '',
      job_order_id: b.job_order_id ?? '', contract_id: b.contract_id ?? '', truck_id: b.truck_id ?? '', notes: b.notes ?? '',
      lines: b.bill_lines.map((l) => ({
        account_id: l.account_id, description: l.description, cost_item_id: l.cost_item_id ?? '',
        quantity: Number(l.quantity), unit_cost: Number(l.unit_cost), stock_location_id: l.stock_location_id ?? '',
      })),
    } as unknown as FieldValues);
  }, [query.data, form]);

  useEffect(() => {
    if (id) return;
    const supplierId = params.get('supplier');
    const truckId = params.get('truck');
    if (supplierId) form.setValue('supplier_id', supplierId);
    if (truckId) form.setValue('truck_id', truckId);
  }, [id, params, form]);

  // Due date follows the supplier's payment terms unless set by hand.
  useEffect(() => {
    const sup = (suppliers ?? []).find((s) => s.id === values.supplier_id);
    if (sup && !values.due_date && values.bill_date) {
      const d = new Date(values.bill_date);
      d.setDate(d.getDate() + (sup.payment_terms_days ?? 0));
      form.setValue('due_date', isoDate(d));
    }
  }, [values.supplier_id, values.bill_date, values.due_date, suppliers, form]);

  const save = useAction(async (v: BillForm) => {
    const header = nullify({
      supplier_id: v.supplier_id, supplier_ref: v.supplier_ref || null, bill_date: v.bill_date, due_date: v.due_date || null,
      job_order_id: v.job_order_id || null, contract_id: v.contract_id || null, truck_id: v.truck_id || null,
      notes: v.notes || null, receipt_path: receiptPath,
    });
    let billId = id;
    if (billId) {
      check(await supabase.from('bills').update(header).eq('id', billId));
      check(await supabase.from('bill_lines').delete().eq('bill_id', billId));
    } else {
      const created = check(await supabase.from('bills').insert(header).select('id').single()) as { id: string };
      billId = created.id;
    }
    check(await supabase.from('bill_lines').insert(v.lines.map((l) => nullify({
      bill_id: billId, account_id: l.account_id, description: l.description, cost_item_id: l.cost_item_id || null,
      quantity: l.quantity, unit_cost: l.unit_cost, stock_location_id: l.stock_location_id || null,
    }))));
    return billId;
  }, {
    success: 'Bill saved as a draft',
    invalidate: [['bill', id], ['table', 'bills']],
    onSuccess: (billId) => { if (!id) navigate(`/finance/bills/${billId}`, { replace: true }); else void query.refetch(); },
  });

  const submit = useAction(() => rpc('submit_bill', { p_bill_id: id as string }), {
    success: 'Bill sent for approval',
    invalidate: [['bill', id], ['table', 'bills']],
    onSuccess: () => setSubmitOpen(false),
  });

  const pickItem = (index: number, itemId: string) => {
    form.setValue(`lines.${index}.cost_item_id`, itemId);
    const item = (costItems ?? []).find((c) => c.id === itemId);
    if (item) {
      form.setValue(`lines.${index}.description`, item.name);
      form.setValue(`lines.${index}.unit_cost`, Number(item.category === 'vehicle' ? item.cost_per_trip : item.unit_cost));
      const expense = (accounts ?? []).find((a) => a.subtype === 'direct' && a.name.toLowerCase().includes(item.category === 'consumable' ? 'consumable' : item.category));
      if (expense && !form.getValues(`lines.${index}.account_id`)) form.setValue(`lines.${index}.account_id`, expense.id);
    }
  };

  const onSubmitForm = form.handleSubmit((v) => save.mutate(v as BillForm));
  const total = useMemo(() => (values.lines ?? []).reduce((t, l) => t + round2(Number(l.quantity) * Number(l.unit_cost)), 0), [values.lines]);

  if (id && query.isLoading) return <Spinner />;
  if (id && query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const b = query.data;

  // Anything past draft is read-only; approval and payment happen from the list.
  if (b && b.status !== 'draft') {
    return (
      <div>
        <PageHeader back="/finance/bills" title={`Bill ${b.bill_no ?? ''}`}
          subtitle={<span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={b.status} />
            {b.is_fleet ? <Badge tone="blue">Fleet</Badge> : null}
            <span className="text-stone-500">{b.supplier?.name}</span>
          </span>} />
        <div className="space-y-4">
          {b.status === 'rejected' && b.rejection_reason ? (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800">Rejected: {b.rejection_reason}</p>
          ) : null}
          <Card title="Bill">
            <DetailList items={[
              ['Supplier', b.supplier?.name ?? '—'],
              ['Their reference', b.supplier_ref ?? '—'],
              ['Bill date', formatDate(b.bill_date)],
              ['Due date', b.due_date ? formatDate(b.due_date) : '—'],
              ['Total', formatGHS(b.total)],
              ['Paid', formatGHS(b.amount_paid)],
              ['Balance', formatGHS(b.balance)],
              ['Approved by', b.approver?.full_name ? `${b.approver.full_name} · ${formatDate(b.approved_at)}` : '—'],
              ['Notes', b.notes ?? '—'],
            ]} />
          </Card>
          <Card title="Lines" bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Account</th>
                    <th scope="col" className="px-3 py-2 font-medium">Description</th>
                    <th scope="col" className="px-3 py-2 font-medium">Into store</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Qty</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Unit cost</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {b.bill_lines.map((l) => (
                    <tr key={l.id}>
                      <td className="px-3 py-2"><span className="font-mono text-xs text-stone-500">{l.account?.code}</span> {l.account?.name}</td>
                      <td className="px-3 py-2">{l.description}</td>
                      <td className="px-3 py-2">{l.stock_location?.name ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(l.quantity)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatGHS(l.unit_cost)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatGHS(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          {b.bill_payments.length ? (
            <Card title="Payments">
              <ul className="divide-y divide-stone-100 text-sm">
                {b.bill_payments.map((p) => (
                  <li key={p.id} className="flex items-center justify-between py-2">
                    <span>{formatDate(p.payment_date)}{p.reference ? ` · ${p.reference}` : ''}</span>
                    <span className="tabular-nums">{formatGHS(p.amount)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </div>
      </div>
    );
  }

  const errors = form.formState.errors;

  return (
    <div>
      <PageHeader back="/finance/bills" title={b ? 'Edit draft bill' : 'New supplier bill'}
        subtitle="Saved as a draft, then sent to a Manager for approval"
        actions={<>
          <Button variant="secondary" icon={<Save className="h-4 w-4" />} loading={save.isPending} onClick={onSubmitForm}>Save draft</Button>
          {b && canEnter ? <Button icon={<Send className="h-4 w-4" />} onClick={() => setSubmitOpen(true)}>Send for approval</Button> : null}
        </>} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Supplier and dates">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Select label="Supplier" required options={toOptions(suppliers, (s) => s.name)} placeholder="Choose…"
                error={errors.supplier_id?.message as string | undefined} {...form.register('supplier_id')} />
              <Input label="Their reference" {...form.register('supplier_ref')} hint="The number on the supplier's own invoice" />
              <Input label="Bill date" type="date" required error={errors.bill_date?.message as string | undefined} {...form.register('bill_date')} />
              <Input label="Due date" type="date" hint="Filled from the supplier's payment terms" {...form.register('due_date')} />
            </div>
          </Card>

          <Card title="Lines" actions={<Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => lines.append(EMPTY_LINE)}>Add line</Button>}>
            <div className="space-y-3">
              {lines.fields.map((field, i) => {
                const line = (values.lines ?? [])[i];
                const amount = line ? round2(Number(line.quantity) * Number(line.unit_cost)) : 0;
                return (
                  <div key={field.id as string} className="grid grid-cols-2 items-end gap-3 rounded-lg border border-stone-200 p-3 sm:grid-cols-12">
                    <Select className="sm:col-span-4" label="Account" required options={toOptions(accounts, (a) => `${a.code} · ${a.name}`)} placeholder="Choose…"
                      {...form.register(`lines.${i}.account_id`)} />
                    <Select className="sm:col-span-3" label="Catalogue item" options={toOptions(costItems, (c) => `${c.code} · ${c.name}`)} placeholder="None"
                      value={line?.cost_item_id ?? ''} onChange={(e) => pickItem(i, e.target.value)} />
                    <Input className="sm:col-span-3" label="Description" required {...form.register(`lines.${i}.description`)} />
                    <Input className="sm:col-span-1" label="Qty" type="number" step="0.001" {...form.register(`lines.${i}.quantity`)} />
                    <Input className="sm:col-span-1" label="Unit cost" type="number" step="0.01" {...form.register(`lines.${i}.unit_cost`)} />
                    <Select className="sm:col-span-4" label="Receive into store" options={toOptions(locations, (l) => l.name)} placeholder="Not stocked"
                      hint="Adds to stock when the bill is approved" {...form.register(`lines.${i}.stock_location_id`)} />
                    <div className="flex items-center justify-between gap-2 sm:col-span-8">
                      <span className="text-sm font-medium tabular-nums">{formatGHS(amount)}</span>
                      {lines.fields.length > 1 ? (
                        <Button variant="ghost" size="sm" aria-label="Remove line" onClick={() => lines.remove(i)}><Trash2 className="h-4 w-4" /></Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-right text-sm text-stone-700">Total <span className="font-semibold tabular-nums">{formatGHS(total)}</span></p>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="What is this for?">
            <div className="space-y-4">
              <AsyncPicker label="Job order" queryKey="jobs-bill" value={values.job_order_id || null} valueLabel={jobLabel}
                onChange={(jid, item) => { form.setValue('job_order_id', jid ?? ''); setJobLabel(item?.label ?? null); }}
                search={searchJobOrders} placeholder="Not for one job" />
              <AsyncPicker label="Contract" queryKey="contracts-bill" value={values.contract_id || null} valueLabel={contractLabel}
                onChange={(cid, item) => { form.setValue('contract_id', cid ?? ''); setContractLabel(item?.label ?? null); }}
                search={searchContracts} placeholder="Not for one contract" />
              <Select label="Truck" options={toOptions(trucks, (t) => t.registration_no)} placeholder="Not for one truck"
                hint="Fleet bills show up in fleet cost reports" {...form.register('truck_id')} />
              <Textarea label="Notes" {...form.register('notes')} />
            </div>
            <p className="mt-3 text-xs text-stone-500">
              Linking a bill to a job, contract or truck is what makes profitability and fleet cost reports accurate.
            </p>
          </Card>

          <Card title="Receipt or invoice scan">
            <FileUpload bucket="expense-receipts" folder={`bills/${id ?? 'new'}`} label={receiptPath ? 'Replace scan' : 'Attach a scan'}
              onUploaded={(path) => setReceiptPath(path)} capture />
            {receiptPath ? <p className="mt-2 text-xs text-stone-500">Attached. Save the bill to keep it.</p> : null}
          </Card>
        </div>
      </div>

      <ConfirmDialog open={submitOpen} onClose={() => setSubmitOpen(false)} title="Send this bill for approval?"
        confirmLabel="Send" loading={submit.isPending} onConfirm={() => submit.mutate()}
        message={`A Manager will be asked to approve ${formatGHS(total)}. Nothing is posted to the ledger until then.`} />

      <p className="mt-4 text-xs text-stone-500">{humanize('bills')} are posted on approval, never on entry.</p>
    </div>
  );
}
