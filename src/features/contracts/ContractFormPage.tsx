import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useFieldArray, useForm, type FieldValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Plus, Save, Trash2 } from 'lucide-react';
import { useAction } from '@/lib/rpc';
import { contractSchema, type ContractForm } from '@/lib/schemas';
import { formatGHS, isoDate } from '@/lib/format';
import { useServices, useStaff, toOptions } from '@/lib/lookups';
import { searchCustomers } from '@/features/customers/api';
import { searchEstimates } from '@/features/estimates/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Checkbox } from '@/components/ui/Checkbox';
import { AsyncPicker } from '@/components/ui/AsyncPicker';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/ErrorState';
import { loadContract, saveContract } from './api';

const DEFAULTS: ContractForm = {
  customer_id: '', contract_type: 'recurring', title: '', description: '',
  start_date: isoDate(), end_date: '', billing_frequency: 'monthly', amount_per_period: 0, total_agreed: 0,
  billing_day: 1, payment_terms_days: 30, taxable: true, service_id: '',
  auto_send: true, prorate: true, price_review_date: '', supervisor_id: '', estimate_id: '',
  budgeted_monthly_cost: 0, overhead_pct: 5, renewal_reminder_days: 60,
  services: [], sites: [],
};

/** Create or edit a contract (spec 4.7). One-off contracts group job orders under one agreed total. */
export default function ContractFormPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { data: services } = useServices();
  const { data: staff } = useStaff();
  const [customerLabel, setCustomerLabel] = useState<string | null>(null);
  const [estimateLabel, setEstimateLabel] = useState<string | null>(null);

  const form = useForm<FieldValues>({ resolver: zodResolver(contractSchema), defaultValues: DEFAULTS as unknown as FieldValues });
  const serviceLines = useFieldArray({ control: form.control, name: 'services' });
  const sites = useFieldArray({ control: form.control, name: 'sites' });
  const values = form.watch() as ContractForm;
  const recurring = values.contract_type === 'recurring';

  const query = useQuery({ queryKey: ['contract', id], enabled: !!id, queryFn: () => loadContract(id as string) });

  useEffect(() => {
    const k = query.data;
    if (!k) return;
    setCustomerLabel(k.customer?.display_name ?? null);
    setEstimateLabel(k.estimate?.estimate_no ?? null);
    form.reset({
      customer_id: k.customer_id, contract_type: k.contract_type, title: k.title, description: k.description ?? '',
      start_date: k.start_date, end_date: k.end_date, billing_frequency: k.billing_frequency,
      amount_per_period: Number(k.amount_per_period), total_agreed: Number(k.total_agreed),
      billing_day: k.billing_day, payment_terms_days: k.payment_terms_days, taxable: k.taxable,
      service_id: k.service_id ?? '', auto_send: k.auto_send, prorate: k.prorate,
      price_review_date: k.price_review_date ?? '', supervisor_id: k.supervisor_id ?? '', estimate_id: k.estimate_id ?? '',
      budgeted_monthly_cost: Number(k.budgeted_monthly_cost), overhead_pct: Number(k.overhead_pct),
      renewal_reminder_days: k.renewal_reminder_days,
      services: k.contract_services.map((s) => ({ service_id: s.service_id, description: s.description ?? '', quantity: Number(s.quantity), unit_price: Number(s.unit_price) })),
      sites: k.contract_sites.map((s) => ({ name: s.name, address: s.address ?? '', digital_address: s.digital_address ?? '' })),
    } as unknown as FieldValues);
  }, [query.data, form]);

  useEffect(() => {
    if (id) return;
    const customer = params.get('customer');
    const estimate = params.get('estimate');
    if (customer) form.setValue('customer_id', customer);
    if (estimate) form.setValue('estimate_id', estimate);
  }, [id, params, form]);

  const save = useAction((v: ContractForm) => saveContract(id, v), {
    success: 'Contract saved',
    invalidate: [['contract', id], ['table', 'contracts']],
    onSuccess: (contractId) => navigate(`/contracts/${contractId}`),
  });

  const setLineService = (index: number, serviceId: string) => {
    form.setValue(`services.${index}.service_id`, serviceId);
    const s = (services ?? []).find((x) => x.id === serviceId);
    if (s) {
      form.setValue(`services.${index}.unit_price`, Number(s.default_price));
      if (!form.getValues(`services.${index}.description`)) form.setValue(`services.${index}.description`, s.name);
    }
  };

  const onSubmitForm = form.handleSubmit((v) => save.mutate(v as ContractForm));

  if (id && query.isLoading) return <Spinner />;
  if (id && query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const k = query.data;
  if (k && !['draft', 'rejected'].includes(k.status)) {
    return (
      <div>
        <PageHeader back={`/contracts/${id}`} title={`Contract ${k.contract_no}`} />
        <Card><p className="text-sm text-stone-700">
          This contract is {k.status.replace(/_/g, ' ')} and can no longer be edited. Suspend or terminate it from the
          contract page, so billing and the ledger stay consistent.
        </p></Card>
      </div>
    );
  }

  const errors = form.formState.errors;
  const linesTotal = (values.services ?? []).reduce((t, s) => t + Number(s.quantity) * Number(s.unit_price), 0);

  return (
    <div>
      <PageHeader back={id ? `/contracts/${id}` : '/contracts'} title={k ? `Edit contract ${k.contract_no ?? 'draft'}` : 'New contract'}
        subtitle="Saved as a draft. Send it for approval from the contract page."
        actions={<Button icon={<Save className="h-4 w-4" />} loading={save.isPending} onClick={onSubmitForm}>Save draft</Button>} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Contract">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <AsyncPicker label="Customer" required queryKey="customers" value={values.customer_id || null} valueLabel={customerLabel}
                error={errors.customer_id?.message as string | undefined}
                onChange={(cid, item) => { form.setValue('customer_id', cid ?? ''); setCustomerLabel(item?.label ?? null); }}
                search={searchCustomers} placeholder="Search customers…" />
              <Select label="Type" required options={[
                { value: 'recurring', label: 'Recurring (billed every period)' },
                { value: 'one_off', label: 'One-off (one agreed total)' },
              ]} {...form.register('contract_type')} />
              <Input className="sm:col-span-2" label="Title" required error={errors.title?.message as string | undefined}
                placeholder="e.g. Office and warehouse cleaning" {...form.register('title')} />
              <Textarea className="sm:col-span-2" label="Description" {...form.register('description')} />
              <Select label="Main service" options={toOptions(services, (s) => s.name)} placeholder="—"
                hint="Used for reporting by service" {...form.register('service_id')} />
              <Select label="Supervisor" options={toOptions(staff, (s) => s.full_name)} placeholder="—" {...form.register('supervisor_id')} />
              <AsyncPicker label="From an estimate" queryKey="estimates-contract" value={values.estimate_id || null} valueLabel={estimateLabel}
                onChange={(eid, item) => { form.setValue('estimate_id', eid ?? ''); setEstimateLabel(item?.label ?? null); }}
                search={searchEstimates} placeholder="No estimate" />
              <Input label="Budgeted monthly cost (GH₵)" type="number" step="0.01" hint="From the estimate, used for variance"
                {...form.register('budgeted_monthly_cost')} />
            </div>
          </Card>

          <Card title="Services and prices" actions={<Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" />}
            onClick={() => serviceLines.append({ service_id: '', description: '', quantity: 1, unit_price: 0 })}>Add service</Button>}>
            {serviceLines.fields.length ? (
              <div className="space-y-3">
                {serviceLines.fields.map((field, i) => {
                  const line = (values.services ?? [])[i];
                  return (
                    <div key={field.id as string} className="grid grid-cols-2 items-end gap-3 rounded-lg border border-stone-200 p-3 sm:grid-cols-12">
                      <Select className="sm:col-span-4" label="Service" required options={toOptions(services, (s) => s.name)} placeholder="Choose…"
                        value={line?.service_id ?? ''} onChange={(e) => setLineService(i, e.target.value)} />
                      <Input className="sm:col-span-4" label="Description" {...form.register(`services.${i}.description`)} />
                      <Input className="sm:col-span-1" label="Qty" type="number" step="0.001" {...form.register(`services.${i}.quantity`)} />
                      <Input className="sm:col-span-2" label="Unit price" type="number" step="0.01" {...form.register(`services.${i}.unit_price`)} />
                      <div className="flex items-center justify-end sm:col-span-1">
                        <Button variant="ghost" size="sm" aria-label="Remove" onClick={() => serviceLines.remove(i)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                  );
                })}
                <p className="text-right text-sm text-stone-700">Services total <span className="font-semibold tabular-nums">{formatGHS(linesTotal)}</span></p>
              </div>
            ) : <p className="text-sm text-stone-500">Add the services this contract covers. The billed amount comes from the period amount below.</p>}
          </Card>

          <Card title="Sites" actions={<Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" />}
            onClick={() => sites.append({ name: '', address: '', digital_address: '' })}>Add site</Button>}>
            {sites.fields.length ? (
              <div className="space-y-3">
                {sites.fields.map((field, i) => (
                  <div key={field.id as string} className="grid grid-cols-2 items-end gap-3 rounded-lg border border-stone-200 p-3 sm:grid-cols-12">
                    <Input className="sm:col-span-4" label="Site name" required {...form.register(`sites.${i}.name`)} />
                    <Input className="sm:col-span-5" label="Address" {...form.register(`sites.${i}.address`)} />
                    <Input className="sm:col-span-2" label="GhanaPost GPS" {...form.register(`sites.${i}.digital_address`)} />
                    <div className="flex items-center justify-end sm:col-span-1">
                      <Button variant="ghost" size="sm" aria-label="Remove" onClick={() => sites.remove(i)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : <p className="text-sm text-stone-500">No sites listed yet. Sites let you record supplies against one location.</p>}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Dates">
            <div className="space-y-4">
              <Input label="Start date" type="date" required error={errors.start_date?.message as string | undefined} {...form.register('start_date')} />
              <Input label="End date" type="date" required error={errors.end_date?.message as string | undefined} {...form.register('end_date')} />
              <Input label="Price review date" type="date" {...form.register('price_review_date')} />
              <Input label="Renewal reminder (days before end)" type="number" hint="The Manager is also alerted at 60, 30 and 7 days"
                {...form.register('renewal_reminder_days')} />
            </div>
          </Card>

          <Card title="Billing">
            <div className="space-y-4">
              {recurring ? <>
                <Select label="Frequency" required options={[
                  { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' },
                ]} {...form.register('billing_frequency')} />
                <Input label="Amount per period (GH₵)" type="number" step="0.01" required
                  error={errors.amount_per_period?.message as string | undefined} {...form.register('amount_per_period')} />
                <Input label="Billing day of the month" type="number" min="1" max="28" hint="1 to 28, so every month works"
                  {...form.register('billing_day')} />
                <Checkbox label="Pro-rate the first and last period" {...form.register('prorate')} />
              </> : (
                <Input label="Agreed total (GH₵)" type="number" step="0.01" required
                  error={errors.total_agreed?.message as string | undefined}
                  hint="Job orders under this contract are billed against this total"
                  {...form.register('total_agreed')} />
              )}
              <Input label="Payment terms (days)" type="number" {...form.register('payment_terms_days')} />
              <Input label="Overhead allocation %" type="number" step="0.5" hint="Shown separately in profitability"
                {...form.register('overhead_pct')} />
              <Checkbox label="Tax applies" {...form.register('taxable')} />
              <Checkbox label="Send each invoice by email and SMS automatically" {...form.register('auto_send')} />
            </div>
          </Card>

          {recurring ? (
            <Card title="What happens next">
              <p className="text-sm text-stone-600">
                Once approved, a scheduled job runs every day at 07:00 and raises the period invoice when the billing date
                arrives. Running it twice on the same day cannot create two invoices for the same period.
              </p>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
