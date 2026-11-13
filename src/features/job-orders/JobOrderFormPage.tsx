import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useForm, useFieldArray, type FieldValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, LocateFixed, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { check, useAction } from '@/lib/rpc';
import { jobOrderSchema, type JobOrderForm } from '@/lib/schemas';
import { formatGHS, isoDate, round2 } from '@/lib/format';
import { getPosition } from '@/lib/geo';
import { useAuth } from '@/lib/auth';
import { useEmployees, useServices, useStaff, toOptions } from '@/lib/lookups';
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
import { TruckPicker } from './TruckPicker';
import { loadJobOrder, saveJobOrder, searchContracts, searchEstimatesForJob } from './api';

const EMPTY_LINE = { service_id: '', description: '', quantity: 1, unit_price: 0, discount: 0, taxable: true };

const DEFAULTS: JobOrderForm = {
  customer_id: '', contact_id: '', channel: 'call_in', priority: 'normal',
  site_address: '', digital_address: '', site_lat: '', site_lng: '',
  officer_id: '', execution_date: isoDate(), end_date: '', time_window: '',
  contract_id: '', estimate_id: '', instructions: '',
  lines: [EMPTY_LINE], truck_ids: [], driver_id: '', crew_ids: [],
};

/** Raise or edit a draft job order (spec 4.4). Approval, booking and invoicing happen in the database. */
export default function JobOrderFormPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { data: services } = useServices();
  const { data: employees } = useEmployees();
  const { data: officers } = useStaff();

  const [customerLabel, setCustomerLabel] = useState<string | null>(null);
  const [contractLabel, setContractLabel] = useState<string | null>(null);
  const [estimateLabel, setEstimateLabel] = useState<string | null>(null);

  const form = useForm<FieldValues>({ resolver: zodResolver(jobOrderSchema), defaultValues: DEFAULTS as unknown as FieldValues });
  const lines = useFieldArray({ control: form.control, name: 'lines' });
  const values = form.watch() as JobOrderForm;

  const query = useQuery({ queryKey: ['job-order', id], enabled: !!id, queryFn: () => loadJobOrder(id as string) });

  // Contact people of the chosen customer.
  const { data: contacts = [] } = useQuery({
    queryKey: ['customer-contacts', values.customer_id],
    enabled: !!values.customer_id,
    queryFn: async () => check(await supabase.from('customer_contacts').select('id, name, position, phone, receives_invoices')
      .eq('customer_id', values.customer_id).order('is_primary', { ascending: false })) as { id: string; name: string; position: string | null }[],
  });

  useEffect(() => {
    const j = query.data;
    if (!j) return;
    setCustomerLabel(j.customer?.display_name ?? null);
    setContractLabel(j.contract ? `${j.contract.contract_no ?? ''} · ${j.contract.title}` : null);
    setEstimateLabel(j.estimate?.estimate_no ?? null);
    form.reset({
      customer_id: j.customer_id, contact_id: j.contact_id ?? '', channel: j.channel, priority: j.priority,
      site_address: j.site_address ?? '', digital_address: j.digital_address ?? '',
      site_lat: j.site_lat === null ? '' : String(j.site_lat), site_lng: j.site_lng === null ? '' : String(j.site_lng),
      officer_id: j.officer_id ?? '', execution_date: j.execution_date, end_date: j.end_date ?? '',
      time_window: j.time_window ?? '', contract_id: j.contract_id ?? '', estimate_id: j.estimate_id ?? '',
      instructions: j.instructions ?? '',
      lines: [...j.job_order_lines].sort((a, b) => a.sort_order - b.sort_order).map((l) => ({
        service_id: l.service_id, description: l.description ?? '', quantity: Number(l.quantity),
        unit_price: Number(l.unit_price), discount: Number(l.discount), taxable: l.taxable,
      })),
      truck_ids: j.job_order_assignments.filter((a) => a.kind === 'truck' && a.truck_id).map((a) => a.truck_id as string),
      driver_id: j.job_order_assignments.find((a) => a.kind === 'driver')?.employee_id ?? '',
      crew_ids: j.job_order_assignments.filter((a) => a.kind === 'crew' && a.employee_id).map((a) => a.employee_id as string),
    } as unknown as FieldValues);
  }, [query.data, form]);

  // New job started from a customer or contract page; default the officer to the signed-in user.
  useEffect(() => {
    if (id) return;
    const customer = params.get('customer');
    const contract = params.get('contract');
    if (customer) form.setValue('customer_id', customer);
    if (contract) form.setValue('contract_id', contract);
    if (profile?.id) form.setValue('officer_id', profile.id);
  }, [id, params, form, profile?.id]);

  // Choosing a service fills its default price.
  const setLineService = (index: number, serviceId: string) => {
    form.setValue(`lines.${index}.service_id`, serviceId);
    const s = (services ?? []).find((x) => x.id === serviceId);
    if (s) {
      form.setValue(`lines.${index}.unit_price`, Number(s.default_price));
      form.setValue(`lines.${index}.taxable`, s.taxable);
      if (!form.getValues(`lines.${index}.description`)) form.setValue(`lines.${index}.description`, s.name);
    }
  };

  const chosenServices = useMemo(
    () => (values.lines ?? []).map((l) => (services ?? []).find((s) => s.id === l.service_id)).filter(Boolean),
    [values.lines, services],
  );
  const requiredTruckType = chosenServices.find((s) => s?.requires_truck)?.required_truck_type ?? null;
  const needsTruck = chosenServices.some((s) => s?.requires_truck);

  const subtotal = (values.lines ?? []).reduce((t, l) => t + round2(Number(l.quantity) * Number(l.unit_price)) - Number(l.discount || 0), 0);

  const save = useAction((v: JobOrderForm) => saveJobOrder(id, v), {
    success: 'Job order saved',
    invalidate: [['job-order', id], ['table', 'job_orders']],
    onSuccess: (jobId) => navigate(`/jobs/${jobId}`),
  });

  const fillGps = async () => {
    try {
      const p = await getPosition();
      form.setValue('site_lat', String(p.lat));
      form.setValue('site_lng', String(p.lng));
      toast.success(`Location captured (±${p.accuracy} m)`);
    } catch (e) { toast.error((e as Error).message); }
  };

  const onSubmitForm = form.handleSubmit((v) => save.mutate(v as JobOrderForm));

  if (id && query.isLoading) return <Spinner />;
  if (id && query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const job = query.data;
  if (job && !['draft', 'rejected'].includes(job.status)) {
    return (
      <div>
        <PageHeader back={`/jobs/${id}`} title={`Job order ${job.job_no}`} />
        <Card>
          <p className="text-sm text-stone-700">
            This job order is {job.status.replace(/_/g, ' ')} and can no longer be edited. Statuses change through the
            buttons on the job order page, so the database can keep the bookings, invoice and ledger in step.
          </p>
        </Card>
      </div>
    );
  }

  const errors = form.formState.errors;
  const lineErrors = errors.lines as unknown as { message?: string } | undefined;

  return (
    <div>
      <PageHeader back={id ? `/jobs/${id}` : '/jobs'} title={job ? `Edit job order ${job.job_no ?? 'draft'}` : 'New job order'}
        subtitle="Saved as a draft. Send it for approval from the job order page."
        actions={<Button icon={<Save className="h-4 w-4" />} loading={save.isPending} onClick={onSubmitForm}>Save draft</Button>} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Customer and channel">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <AsyncPicker label="Customer" required queryKey="customers" value={values.customer_id || null} valueLabel={customerLabel}
                error={errors.customer_id?.message as string | undefined}
                onChange={(cid, item) => { form.setValue('customer_id', cid ?? ''); setCustomerLabel(item?.label ?? null); form.setValue('contact_id', ''); }}
                search={searchCustomers} placeholder="Search by name, code or phone…" />
              <Select label="Contact person" options={contacts.map((c) => ({ value: c.id, label: c.position ? `${c.name} (${c.position})` : c.name }))}
                placeholder="—" hint="For company customers" {...form.register('contact_id')} />
              <Select label="How the work arrived" required options={[
                { value: 'call_in', label: 'Call-in' }, { value: 'walk_in', label: 'Walk-in' }, { value: 'sales', label: 'Sales field' },
              ]} {...form.register('channel')} />
              <Select label="Priority" required options={[
                { value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' },
              ]} {...form.register('priority')} />
              <Select label="Officer in charge" options={toOptions(officers, (o) => o.full_name)} placeholder="—" {...form.register('officer_id')} />
              <AsyncPicker label="Under a contract" queryKey="contracts" value={values.contract_id || null} valueLabel={contractLabel}
                onChange={(cid, item) => { form.setValue('contract_id', cid ?? ''); setContractLabel(item?.label ?? null); }}
                search={searchContracts} placeholder="Not under a contract" />
              <AsyncPicker label="From an estimate" queryKey="estimates-job" value={values.estimate_id || null} valueLabel={estimateLabel}
                onChange={(eid, item) => { form.setValue('estimate_id', eid ?? ''); setEstimateLabel(item?.label ?? null); }}
                search={searchEstimatesForJob} placeholder="No estimate" />
            </div>
          </Card>

          <Card title="Service lines" actions={<Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => lines.append(EMPTY_LINE)}>Add line</Button>}>
            {lineErrors?.message ? <p role="alert" className="mb-2 text-sm text-red-600">{lineErrors.message}</p> : null}
            <div className="space-y-3">
              {lines.fields.map((field, i) => {
                const line = (values.lines ?? [])[i];
                const amount = line ? round2(Number(line.quantity) * Number(line.unit_price)) - Number(line.discount || 0) : 0;
                return (
                  <div key={field.id as string} className="grid grid-cols-2 items-end gap-3 rounded-lg border border-stone-200 p-3 sm:grid-cols-12">
                    <Select className="sm:col-span-4" label="Service" required options={toOptions(services, (s) => s.name)} placeholder="Choose…"
                      value={line?.service_id ?? ''} onChange={(e) => setLineService(i, e.target.value)} />
                    <Input className="sm:col-span-3" label="Description" {...form.register(`lines.${i}.description`)} />
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
            <p className="mt-3 text-right text-sm text-stone-700">
              Lines total <span className="font-semibold tabular-nums">{formatGHS(subtotal)}</span>
              <span className="block text-xs text-stone-500">Tax, if any, is added by the database when the invoice is issued.</span>
            </p>
          </Card>

          <Card title="Site">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input className="sm:col-span-2" label="Site address" required error={errors.site_address?.message as string | undefined} {...form.register('site_address')} />
              <Input label="GhanaPost GPS" placeholder="GA-123-4567" error={errors.digital_address?.message as string | undefined} {...form.register('digital_address')} />
              <div className="flex items-end gap-2">
                <Input className="flex-1" label="Latitude" {...form.register('site_lat')} />
                <Input className="flex-1" label="Longitude" {...form.register('site_lng')} />
                <Button variant="secondary" aria-label="Use my location" icon={<LocateFixed className="h-4 w-4" />} onClick={() => void fillGps()} />
              </div>
              <Textarea className="sm:col-span-2" label="Instructions for the crew" {...form.register('instructions')} />
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="When">
            <div className="space-y-4">
              <Input label="Execution date" type="date" required error={errors.execution_date?.message as string | undefined} {...form.register('execution_date')} />
              <Input label="End date" type="date" hint="For jobs over several days" error={errors.end_date?.message as string | undefined} {...form.register('end_date')} />
              <Input label="Time window" placeholder="e.g. 08:00 – 12:00" {...form.register('time_window')} />
            </div>
          </Card>

          <Card title={`Trucks${requiredTruckType ? ` · ${requiredTruckType.replace(/_/g, ' ')} needed` : ''}`}>
            {needsTruck && !values.truck_ids.length ? (
              <p className="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                This service needs a truck. The database will refuse to submit the job order without one.
              </p>
            ) : null}
            <TruckPicker from={values.execution_date} to={values.end_date || values.execution_date}
              requiredType={requiredTruckType} excludeJob={id} selected={values.truck_ids}
              onChange={(ids) => form.setValue('truck_ids', ids)} />
          </Card>

          <Card title="People">
            <div className="space-y-4">
              <Select label="Driver" options={toOptions((employees ?? []).filter((e) => e.role_type === 'driver' && e.status === 'active'), (e) => e.full_name)}
                placeholder="Filled from the truck if left blank" {...form.register('driver_id')} />
              <div>
                <p className="mb-1 text-sm font-medium text-stone-700">Crew</p>
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-stone-200 p-2">
                  {(employees ?? []).filter((e) => e.role_type !== 'driver' && e.status === 'active').map((e) => (
                    <label key={e.id} className="flex min-h-[40px] items-center gap-2 text-sm">
                      <input type="checkbox" className="h-5 w-5 rounded border-stone-300 text-brand-600"
                        checked={values.crew_ids.includes(e.id)}
                        onChange={(ev) => form.setValue('crew_ids', ev.target.checked ? [...values.crew_ids, e.id] : values.crew_ids.filter((x) => x !== e.id))} />
                      <span>{e.full_name} <Badge tone="grey">{e.role_type}</Badge></span>
                    </label>
                  ))}
                  {!(employees ?? []).some((e) => e.role_type !== 'driver') ? <p className="p-2 text-sm text-stone-500">No crew members on file yet.</p> : null}
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
