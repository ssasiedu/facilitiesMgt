import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useFieldArray, useForm, type FieldValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Plus, Save, Trash2 } from 'lucide-react';
import { useAction } from '@/lib/rpc';
import { invoiceSchema } from '@/lib/schemas';
import { formatGHS, isoDate, round2 } from '@/lib/format';
import { useServices, useTaxRates, toOptions } from '@/lib/lookups';
import { searchCustomers } from '@/features/customers/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Checkbox } from '@/components/ui/Checkbox';
import { AsyncPicker } from '@/components/ui/AsyncPicker';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/ErrorState';
import { loadInvoice, saveInvoice, type InvoiceFormValues } from './api';

const EMPTY_LINE = { service_id: '', description: '', quantity: 1, unit_price: 0, discount: 0, taxable: true };

const DEFAULTS: InvoiceFormValues = {
  customer_id: '', issue_date: isoDate(), due_date: '', notes: '', terms: '', lines: [EMPTY_LINE],
};

/** Manual invoice entry (spec 4.9). Job-order and contract invoices are raised by the database. */
export default function InvoiceFormPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { data: services } = useServices();
  const { data: taxes } = useTaxRates();
  const [customerLabel, setCustomerLabel] = useState<string | null>(null);

  const form = useForm<FieldValues>({ resolver: zodResolver(invoiceSchema), defaultValues: DEFAULTS as unknown as FieldValues });
  const lines = useFieldArray({ control: form.control, name: 'lines' });
  const values = form.watch() as InvoiceFormValues;

  const query = useQuery({ queryKey: ['invoice', id], enabled: !!id, queryFn: () => loadInvoice(id as string) });

  useEffect(() => {
    const inv = query.data;
    if (!inv) return;
    setCustomerLabel(inv.customer?.display_name ?? null);
    form.reset({
      customer_id: inv.customer_id, issue_date: inv.issue_date, due_date: inv.due_date ?? '',
      notes: inv.notes ?? '', terms: inv.terms ?? '',
      lines: [...inv.invoice_lines].sort((a, b) => a.sort_order - b.sort_order).map((l) => ({
        service_id: l.service_id ?? '', description: l.description, quantity: Number(l.quantity),
        unit_price: Number(l.unit_price), discount: Number(l.discount), taxable: l.taxable,
      })),
    } as unknown as FieldValues);
  }, [query.data, form]);

  useEffect(() => {
    if (id) return;
    const customer = params.get('customer');
    if (customer) form.setValue('customer_id', customer);
  }, [id, params, form]);

  const save = useAction((v: InvoiceFormValues) => saveInvoice(id, v), {
    success: 'Draft invoice saved',
    invalidate: [['invoice', id], ['table', 'invoices']],
    onSuccess: (invoiceId) => navigate(`/finance/invoices/${invoiceId}`),
  });

  const setLineService = (index: number, serviceId: string) => {
    form.setValue(`lines.${index}.service_id`, serviceId);
    const s = (services ?? []).find((x) => x.id === serviceId);
    if (s) {
      form.setValue(`lines.${index}.unit_price`, Number(s.default_price));
      form.setValue(`lines.${index}.taxable`, s.taxable);
      if (!form.getValues(`lines.${index}.description`)) form.setValue(`lines.${index}.description`, s.name);
    }
  };

  const onSubmitForm = form.handleSubmit((v) => save.mutate(v as InvoiceFormValues));

  if (id && query.isLoading) return <Spinner />;
  if (id && query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const inv = query.data;
  if (inv && inv.status !== 'draft') {
    return (
      <div>
        <PageHeader back={`/finance/invoices/${id}`} title={`Invoice ${inv.invoice_no}`} />
        <Card><p className="text-sm text-stone-700">
          This invoice has been issued and cannot be edited. Posted financial records are never changed: use a credit
          note to reverse it, then raise a new invoice if needed.
        </p></Card>
      </div>
    );
  }

  const subtotal = (values.lines ?? []).reduce((t, l) => t + round2(Number(l.quantity) * Number(l.unit_price)) - Number(l.discount || 0), 0);
  const taxableBase = (values.lines ?? []).filter((l) => l.taxable)
    .reduce((t, l) => t + round2(Number(l.quantity) * Number(l.unit_price)) - Number(l.discount || 0), 0);
  const activeTaxes = (taxes ?? []).filter((t) => t.active);
  const taxTotal = activeTaxes.reduce((t, tax) => t + round2(taxableBase * Number(tax.rate) / 100), 0);
  const errors = form.formState.errors;

  return (
    <div>
      <PageHeader back={id ? `/finance/invoices/${id}` : '/finance/invoices'} title={inv ? `Edit draft invoice` : 'New invoice'}
        subtitle="Saved as a draft with no number. Issue it from the invoice page to post it."
        actions={<Button icon={<Save className="h-4 w-4" />} loading={save.isPending} onClick={onSubmitForm}>Save draft</Button>} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Customer and dates">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <AsyncPicker label="Customer" required queryKey="customers" value={values.customer_id || null} valueLabel={customerLabel}
                error={errors.customer_id?.message as string | undefined}
                onChange={(cid, item) => { form.setValue('customer_id', cid ?? ''); setCustomerLabel(item?.label ?? null); }}
                search={searchCustomers} placeholder="Search customers…" />
              <Input label="Issue date" type="date" required error={errors.issue_date?.message as string | undefined} {...form.register('issue_date')} />
              <Input label="Due date" type="date" hint="Leave blank to use the customer's payment terms" {...form.register('due_date')} />
            </div>
          </Card>

          <Card title="Lines" actions={<Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => lines.append(EMPTY_LINE)}>Add line</Button>}>
            <div className="space-y-3">
              {lines.fields.map((field, i) => {
                const line = (values.lines ?? [])[i];
                const amount = line ? round2(Number(line.quantity) * Number(line.unit_price)) - Number(line.discount || 0) : 0;
                return (
                  <div key={field.id as string} className="grid grid-cols-2 items-end gap-3 rounded-lg border border-stone-200 p-3 sm:grid-cols-12">
                    <Select className="sm:col-span-3" label="Service" options={toOptions(services, (s) => s.name)} placeholder="None"
                      value={line?.service_id ?? ''} onChange={(e) => setLineService(i, e.target.value)}
                      hint="Sets the revenue account" />
                    <Input className="sm:col-span-4" label="Description" required {...form.register(`lines.${i}.description`)} />
                    <Input className="sm:col-span-1" label="Qty" type="number" step="0.001" {...form.register(`lines.${i}.quantity`)} />
                    <Input className="sm:col-span-2" label="Unit price" type="number" step="0.01" {...form.register(`lines.${i}.unit_price`)} />
                    <Input className="sm:col-span-1" label="Discount" type="number" step="0.01" {...form.register(`lines.${i}.discount`)} />
                    <div className="flex items-center justify-between gap-2 sm:col-span-1">
                      <span className="text-sm font-medium tabular-nums">{formatGHS(amount)}</span>
                      {lines.fields.length > 1 ? (
                        <Button variant="ghost" size="sm" aria-label="Remove line" onClick={() => lines.remove(i)}><Trash2 className="h-4 w-4" /></Button>
                      ) : null}
                    </div>
                    <div className="sm:col-span-12"><Checkbox label="Tax applies to this line" {...form.register(`lines.${i}.taxable`)} /></div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card title="Notes and terms">
            <div className="space-y-4">
              <Textarea label="Notes (shown on the invoice)" {...form.register('notes')} />
              <Textarea label="Terms" hint="Leave blank to use the standard terms from Settings" {...form.register('terms')} />
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Totals">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between"><dt className="text-stone-600">Subtotal</dt><dd className="tabular-nums">{formatGHS(subtotal)}</dd></div>
              <div className="flex justify-between"><dt className="text-stone-600">Taxable amount</dt><dd className="tabular-nums">{formatGHS(taxableBase)}</dd></div>
              {activeTaxes.map((t) => (
                <div key={t.id} className="flex justify-between"><dt className="text-stone-600">{t.name} ({Number(t.rate)}%)</dt>
                  <dd className="tabular-nums">{formatGHS(round2(taxableBase * Number(t.rate) / 100))}</dd></div>
              ))}
              <div className="flex justify-between border-t border-stone-200 pt-1.5 text-base font-semibold">
                <dt>Total</dt><dd className="tabular-nums">{formatGHS(subtotal + taxTotal)}</dd>
              </div>
            </dl>
            {!activeTaxes.length ? (
              <p className="mt-3 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900">
                No tax is active. A Super Admin sets the current rates in Settings &gt; Taxes; until then invoices carry no tax.
              </p>
            ) : null}
            <p className="mt-3 text-xs text-stone-500">
              This is a preview. The database recalculates every total and tax line when the invoice is saved and issued.
            </p>
          </Card>

          <Card title="Active taxes">
            {activeTaxes.length ? (
              <ul className="space-y-1 text-sm">
                {activeTaxes.map((t) => (
                  <li key={t.id} className="flex items-center justify-between">
                    <span>{t.name}</span>
                    <Badge tone="brand">{Number(t.rate)}%{t.compound ? ' · compounds' : ''}</Badge>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-stone-500">None configured.</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}
