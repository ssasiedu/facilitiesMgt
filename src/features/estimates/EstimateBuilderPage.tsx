import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useForm, useFieldArray, type FieldValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Check, FileText, Plus, Save, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { estimateSchema, type EstimateForm } from '@/lib/schemas';
import { CATEGORIES, computeEstimate, lineCost, totalVisits, type CostCategory } from '@/lib/calc';
import { formatGHS, formatNumber, formatPct, humanize } from '@/lib/format';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { useSettings } from '@/lib/settings';
import { useCostItems, useEstimateTemplates, useServices, toOptions } from '@/lib/lookups';
import { useAction } from '@/lib/rpc';
import { downloadPdf } from '@/lib/pdf/download';
import { QuotationPdf } from '@/lib/pdf/QuotationPdf';
import { companyFromSettings } from '@/lib/pdf/company';
import { searchCustomers } from '@/features/customers/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Checkbox } from '@/components/ui/Checkbox';
import { AsyncPicker } from '@/components/ui/AsyncPicker';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Badge } from '@/components/ui/Badge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/ErrorState';
import {
  approveEstimate, convertToContract, convertToJob, createQuotation, loadEstimate, newVersion,
  rejectEstimate, saveEstimate, searchLeads, submitEstimate, toCalcLine,
} from './api';

const CAT_COLOURS: Record<CostCategory, string> = {
  consumable: '#0f766e', equipment: '#2563eb', labour: '#d97706', vehicle: '#7c3aed', subcontract: '#0891b2', overhead: '#78716c',
};

const EMPTY_LINE = {
  cost_item_id: '', category: 'consumable' as CostCategory, description: '', unit_of_measure: '', basis: 'total' as const,
  quantity: 1, headcount: 1, days: 1, km: 0, unit_cost: 0, cost_per_trip: 0, cost_per_km: 0, cost_per_day: 0, rate_basis: 'day' as const,
};

const DEFAULTS: EstimateForm = {
  customer_id: '', lead_id: '', service_id: '', title: '', site: '',
  duration_days: 1, hours_per_day: 8, is_recurring: false, visits_per_period: 1, visit_period: 'month', contract_months: 1,
  overhead_pct: 10, contingency_pct: 5, target_margin_pct: 25, tax_pct: 0, proposed_price: 0, notes: '', lines: [],
};

/**
 * Cost estimator (spec 4.6). The maths runs live in the browser from src/lib/calc.ts, which
 * mirrors the database functions exactly; the saved figures always come from the database.
 */
export default function EstimateBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { roles } = useAuth();
  const settings = useSettings();
  const { data: services } = useServices();
  const { data: costItems } = useCostItems();
  const { data: templates } = useEstimateTemplates();

  const [customerLabel, setCustomerLabel] = useState<string | null>(null);
  const [leadLabel, setLeadLabel] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState<'job' | 'contract' | null>(null);
  const [convertDate, setConvertDate] = useState('');
  const [quoteDays, setQuoteDays] = useState(30);
  const [quoteTerms, setQuoteTerms] = useState('');

  const canWrite = hasAny(roles, 'manager', 'ops_officer', 'sales_exec');
  const canApprove = hasAny(roles, 'manager');

  const form = useForm<FieldValues>({ resolver: zodResolver(estimateSchema), defaultValues: DEFAULTS as unknown as FieldValues });
  const lines = useFieldArray({ control: form.control, name: 'lines' });
  const values = form.watch() as EstimateForm;

  const query = useQuery({
    queryKey: ['estimate', id],
    enabled: !!id,
    queryFn: () => loadEstimate(id as string),
  });

  // Load the saved estimate into the form.
  useEffect(() => {
    const e = query.data;
    if (!e) return;
    setCustomerLabel(e.customer?.display_name ?? null);
    setLeadLabel(e.lead?.name ?? null);
    form.reset({
      customer_id: e.customer_id ?? '', lead_id: e.lead_id ?? '', service_id: e.service_id ?? '', title: e.title ?? '', site: e.site ?? '',
      duration_days: Number(e.duration_days), hours_per_day: Number(e.hours_per_day), is_recurring: e.is_recurring,
      visits_per_period: Number(e.visits_per_period), visit_period: e.visit_period as 'week' | 'month', contract_months: e.contract_months,
      overhead_pct: Number(e.overhead_pct), contingency_pct: Number(e.contingency_pct), target_margin_pct: Number(e.target_margin_pct),
      tax_pct: Number(e.tax_pct), proposed_price: Number(e.proposed_price), notes: e.notes ?? '',
      lines: [...e.estimate_lines].sort((a, b) => a.sort_order - b.sort_order).map((l) => ({
        cost_item_id: l.cost_item_id ?? '', category: l.category, description: l.description, unit_of_measure: l.unit_of_measure ?? '',
        basis: l.basis === 'per_visit' ? 'per_visit' : 'total', quantity: Number(l.quantity), headcount: Number(l.headcount),
        days: Number(l.days), km: Number(l.km), unit_cost: Number(l.unit_cost), cost_per_trip: Number(l.cost_per_trip),
        cost_per_km: Number(l.cost_per_km), cost_per_day: Number(l.cost_per_day), rate_basis: l.rate_basis === 'hour' ? 'hour' : 'day',
      })),
    } as unknown as FieldValues);
  }, [query.data, form]);

  // New estimate started from a customer or lead page.
  useEffect(() => {
    if (id) return;
    const customer = params.get('customer');
    const lead = params.get('lead');
    const service = params.get('service');
    if (customer) form.setValue('customer_id', customer);
    if (lead) form.setValue('lead_id', lead);
    if (service) form.setValue('service_id', service);
  }, [id, params, form]);

  const result = useMemo(() => computeEstimate({
    duration_days: Number(values.duration_days) || 1,
    hours_per_day: Number(values.hours_per_day) || 8,
    is_recurring: !!values.is_recurring,
    visits_per_period: Number(values.visits_per_period) || 1,
    visit_period: values.visit_period ?? 'month',
    contract_months: Number(values.contract_months) || 1,
    overhead_pct: Number(values.overhead_pct) || 0,
    contingency_pct: Number(values.contingency_pct) || 0,
    target_margin_pct: Number(values.target_margin_pct) || 0,
    proposed_price: Number(values.proposed_price) || 0,
    tax_pct: Number(values.tax_pct) || 0,
    margin_threshold: Number(settings?.estimate_margin_threshold ?? 15),
  }, (values.lines ?? []).map(toCalcLine)), [values, settings?.estimate_margin_threshold]);

  const estimate = query.data;
  const locked = !!estimate && !['draft', 'rejected'].includes(estimate.status);
  const readOnly = locked || !canWrite;

  const save = useAction(async (v: EstimateForm) => saveEstimate(id, v), {
    success: 'Estimate saved',
    invalidate: [['estimate', id], ['table', 'estimates']],
    onSuccess: (newId) => { if (!id) navigate(`/estimates/${newId}`, { replace: true }); else void query.refetch(); },
  });

  const submit = useAction(() => submitEstimate(id as string), { success: 'Sent for approval', invalidate: [['estimate', id]] });
  const approve = useAction(() => approveEstimate(id as string), { success: 'Estimate approved', invalidate: [['estimate', id]] });
  const reject = useAction((reason: string) => rejectEstimate(id as string, reason), { success: 'Estimate rejected', invalidate: [['estimate', id]], onSuccess: () => setRejectOpen(false) });
  const version = useAction(() => newVersion(id as string), { success: 'New version created', onSuccess: (newId) => navigate(`/estimates/${newId}`) });
  const quote = useAction(() => createQuotation(id as string, quoteDays, quoteTerms || undefined), {
    success: 'Quotation created', invalidate: [['estimate', id], ['table', 'quotations']], onSuccess: () => { setQuoteOpen(false); navigate('/quotations'); },
  });
  const toJob = useAction(() => convertToJob(id as string, convertDate || undefined), {
    success: 'Job order created', onSuccess: (jobId) => navigate(`/jobs/${jobId}`),
  });
  const toContract = useAction(() => convertToContract(id as string, convertDate || undefined), {
    success: 'Contract created', onSuccess: (contractId) => navigate(`/contracts/${contractId}`),
  });

  const onSubmitForm = form.handleSubmit((v) => save.mutate(v as EstimateForm));

  const addLine = (category: CostCategory) => lines.append({ ...EMPTY_LINE, category } as unknown as Record<string, unknown>);

  /** Picking a catalogue item copies its current costs into the line (the snapshot). */
  const pickItem = (index: number, itemId: string) => {
    const item = (costItems ?? []).find((c) => c.id === itemId);
    if (!item) { form.setValue(`lines.${index}.cost_item_id`, ''); return; }
    form.setValue(`lines.${index}.cost_item_id`, item.id);
    form.setValue(`lines.${index}.category`, item.category);
    form.setValue(`lines.${index}.description`, item.name);
    form.setValue(`lines.${index}.unit_of_measure`, item.unit_of_measure);
    form.setValue(`lines.${index}.unit_cost`, Number(item.unit_cost));
    form.setValue(`lines.${index}.cost_per_trip`, Number(item.cost_per_trip));
    form.setValue(`lines.${index}.cost_per_km`, Number(item.cost_per_km));
    form.setValue(`lines.${index}.cost_per_day`, Number(item.cost_per_day));
    form.setValue(`lines.${index}.rate_basis`, item.rate_basis === 'hour' ? 'hour' : 'day');
  };

  const useTemplate = async (templateId: string) => {
    if (!templateId) return;
    const t = (templates ?? []).find((x) => x.id === templateId);
    if (!t) return;
    const items = costItems ?? [];
    // read the template's lines and copy current catalogue costs into the form
    const { supabase } = await import('@/lib/supabaseClient');
    const { data, error } = await supabase.from('estimate_template_lines').select('*').eq('template_id', templateId).order('sort_order');
    if (error) { toast.error(error.message); return; }
    form.setValue('duration_days', Number(t.duration_days));
    form.setValue('hours_per_day', Number(t.hours_per_day));
    form.setValue('is_recurring', t.is_recurring);
    form.setValue('visits_per_period', Number(t.visits_per_period));
    form.setValue('visit_period', t.visit_period);
    form.setValue('contract_months', t.contract_months);
    form.setValue('overhead_pct', Number(t.overhead_pct));
    form.setValue('contingency_pct', Number(t.contingency_pct));
    form.setValue('target_margin_pct', Number(t.target_margin_pct));
    if (t.service_id) form.setValue('service_id', t.service_id);
    lines.replace((data ?? []).map((tl: Record<string, unknown>) => {
      const item = items.find((c) => c.id === tl.cost_item_id);
      return {
        cost_item_id: (tl.cost_item_id as string) ?? '',
        category: item?.category ?? 'consumable',
        description: item?.name ?? '',
        unit_of_measure: item?.unit_of_measure ?? '',
        basis: tl.basis === 'per_visit' ? 'per_visit' : 'total',
        quantity: Number(tl.quantity), headcount: Number(tl.headcount), days: Number(tl.days), km: Number(tl.km),
        unit_cost: Number(item?.unit_cost ?? 0), cost_per_trip: Number(item?.cost_per_trip ?? 0),
        cost_per_km: Number(item?.cost_per_km ?? 0), cost_per_day: Number(item?.cost_per_day ?? 0),
        rate_basis: item?.rate_basis === 'hour' ? 'hour' : 'day',
      };
    }));
    toast.success(`Template "${t.name}" applied — check the quantities`);
  };

  const downloadQuote = () => {
    if (!settings) return;
    const taxAmount = Math.round(Number(values.proposed_price) * Number(values.tax_pct) / 100 * 100) / 100;
    void downloadPdf(
      <QuotationPdf
        company={companyFromSettings(settings)}
        quote={{
          quote_no: estimate?.estimate_no ?? 'DRAFT', quote_date: new Date().toISOString().slice(0, 10),
          valid_until: '', title: values.title || estimate?.service?.name || 'Proposal',
          description: values.notes ?? '', amount: Number(values.proposed_price), tax_amount: taxAmount,
          total: Number(values.proposed_price) + taxAmount, terms: settings.invoice_terms ?? '',
          customer_name: customerLabel ?? leadLabel ?? 'Customer',
        }}
      />,
      `quotation-${estimate?.estimate_no ?? 'draft'}`,
    );
  };

  if (id && query.isLoading) return <Spinner />;
  if (id && query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const errors = form.formState.errors;
  const chartData = CATEGORIES.map((c) => ({ name: humanize(c), value: result.byCategory[c], category: c })).filter((r) => r.value > 0);

  return (
    <div>
      <PageHeader
        back="/estimates"
        title={estimate ? `Estimate ${estimate.estimate_no ?? 'draft'} v${estimate.version}` : 'New estimate'}
        subtitle={estimate ? <span className="flex flex-wrap items-center gap-2"><StatusBadge status={estimate.status} />{estimate.requires_approval ? <Badge tone="amber">Needs Manager approval</Badge> : null}</span> : 'Work out the true cost before you price the job'}
        actions={<>
          {!readOnly ? <Button icon={<Save className="h-4 w-4" />} loading={save.isPending} onClick={onSubmitForm}>Save</Button> : null}
          {estimate && ['draft', 'rejected'].includes(estimate.status) && canWrite ? (
            <Button variant="secondary" loading={submit.isPending} onClick={() => submit.mutate()}>Send for approval</Button>
          ) : null}
          {estimate?.status === 'pending_approval' && canApprove ? <>
            <Button variant="success" icon={<Check className="h-4 w-4" />} loading={approve.isPending} onClick={() => approve.mutate()}>Approve</Button>
            <Button variant="danger" icon={<X className="h-4 w-4" />} onClick={() => setRejectOpen(true)}>Reject</Button>
          </> : null}
          {estimate && ['approved', 'quoted', 'accepted'].includes(estimate.status) && canWrite ? <>
            <Button variant="secondary" icon={<FileText className="h-4 w-4" />} onClick={() => setQuoteOpen(true)}>Quotation</Button>
            <Button variant="secondary" onClick={() => { setConvertDate(''); setConvertOpen(values.is_recurring ? 'contract' : 'job'); }}>
              {values.is_recurring ? 'Create contract' : 'Create job order'}
            </Button>
          </> : null}
          {estimate && locked && canWrite ? <Button variant="ghost" loading={version.isPending} onClick={() => version.mutate()}>New version</Button> : null}
        </>}
      />

      {locked ? (
        <p className="mb-4 rounded-lg bg-stone-100 p-3 text-sm text-stone-700">
          This estimate is {humanize(estimate?.status).toLowerCase()} and can no longer be edited. Create a new version to change the figures.
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Who and what">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <AsyncPicker label="Customer" queryKey="customers" value={values.customer_id || null} valueLabel={customerLabel}
                disabled={readOnly} error={errors.customer_id?.message as string | undefined}
                onChange={(cid, item) => { form.setValue('customer_id', cid ?? ''); setCustomerLabel(item?.label ?? null); if (cid) { form.setValue('lead_id', ''); setLeadLabel(null); } }}
                search={searchCustomers} placeholder="Search customers…" />
              <AsyncPicker label="…or a lead" queryKey="leads" value={values.lead_id || null} valueLabel={leadLabel}
                disabled={readOnly}
                onChange={(lid, item) => { form.setValue('lead_id', lid ?? ''); setLeadLabel(item?.label ?? null); if (lid) { form.setValue('customer_id', ''); setCustomerLabel(null); } }}
                search={searchLeads} placeholder="Search leads…" />
              <Select label="Service" required disabled={readOnly} options={toOptions(services, (s) => s.name)} placeholder="Choose…"
                error={errors.service_id?.message as string | undefined} {...form.register('service_id')} />
              <Select label="Start from a template" disabled={readOnly} options={toOptions(templates, (t) => t.name)} placeholder="—"
                hint="Fills the cost lines and the drivers" onChange={(e) => void useTemplate(e.target.value)} value="" />
              <Input label="Title" disabled={readOnly} placeholder="e.g. Monthly office cleaning" {...form.register('title')} />
              <Input label="Site" disabled={readOnly} placeholder="Where the work happens" {...form.register('site')} />
            </div>
          </Card>

          <Card title="How long and how often">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Input label="Duration (days)" type="number" step="0.5" disabled={readOnly} error={errors.duration_days?.message as string | undefined} {...form.register('duration_days')} />
              <Input label="Hours per day" type="number" step="0.5" disabled={readOnly} {...form.register('hours_per_day')} />
              <div className="col-span-2 flex items-end">
                <Checkbox label="Recurring work (a contract)" disabled={readOnly} {...form.register('is_recurring')} />
              </div>
              {values.is_recurring ? <>
                <Input label="Visits per period" type="number" step="0.5" disabled={readOnly} {...form.register('visits_per_period')} />
                <Select label="Period" disabled={readOnly} options={[{ value: 'week', label: 'Per week' }, { value: 'month', label: 'Per month' }]} {...form.register('visit_period')} />
                <Input label="Contract months" type="number" disabled={readOnly} {...form.register('contract_months')} />
                <div className="flex items-end text-sm text-stone-600">{formatNumber(totalVisits({
                  is_recurring: true, visits_per_period: Number(values.visits_per_period) || 1,
                  visit_period: values.visit_period ?? 'month', contract_months: Number(values.contract_months) || 1,
                }))} visits in total</div>
              </> : null}
            </div>
          </Card>

          <Card title="Cost lines" actions={!readOnly ? (
            <div className="flex flex-wrap gap-1">
              {CATEGORIES.map((c) => (
                <Button key={c} variant="secondary" size="sm" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => addLine(c)}>{humanize(c)}</Button>
              ))}
            </div>
          ) : null} bodyClassName="p-0">
            {lines.fields.length === 0 ? (
              <p className="p-4 text-sm text-stone-500">No cost lines yet. Add materials, labour, vehicles, equipment and subcontract costs, or start from a template.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th scope="col" className="px-2 py-2 font-medium">Item</th>
                      <th scope="col" className="px-2 py-2 font-medium">Category</th>
                      <th scope="col" className="px-2 py-2 font-medium">Basis</th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">Qty</th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">People</th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">Days</th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">Km</th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">Unit cost</th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">Line cost</th>
                      <th scope="col" className="w-8 px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {lines.fields.map((field, i) => {
                      const line = (values.lines ?? [])[i];
                      if (!line) return null;
                      const lineTotal = lineCost(toCalcLine(line), Number(values.hours_per_day) || 8, result.visits);
                      const isVehicle = line.category === 'vehicle';
                      const isLabour = line.category === 'labour';
                      return (
                        <tr key={field.id as string}>
                          <td className="px-2 py-1.5">
                            <select aria-label="Catalogue item" disabled={readOnly} className="w-44 rounded border-stone-300 text-sm"
                              value={line.cost_item_id ?? ''} onChange={(e) => pickItem(i, e.target.value)}>
                              <option value="">Custom…</option>
                              {(costItems ?? []).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
                            </select>
                            <input aria-label="Description" disabled={readOnly} placeholder="Description"
                              className="mt-1 w-44 rounded border-stone-300 text-sm" {...form.register(`lines.${i}.description`)} />
                          </td>
                          <td className="px-2 py-1.5">
                            <select aria-label="Category" disabled={readOnly} className="w-28 rounded border-stone-300 text-sm" {...form.register(`lines.${i}.category`)}>
                              {CATEGORIES.map((c) => <option key={c} value={c}>{humanize(c)}</option>)}
                            </select>
                          </td>
                          <td className="px-2 py-1.5">
                            <select aria-label="Basis" disabled={readOnly} className="w-24 rounded border-stone-300 text-sm" {...form.register(`lines.${i}.basis`)}>
                              <option value="total">Total</option>
                              <option value="per_visit">Per visit</option>
                            </select>
                          </td>
                          <td className="px-2 py-1.5"><input aria-label="Quantity" type="number" step="0.001" disabled={readOnly} className="w-20 rounded border-stone-300 text-right text-sm" {...form.register(`lines.${i}.quantity`)} /></td>
                          <td className="px-2 py-1.5"><input aria-label="People" type="number" step="0.5" disabled={readOnly || !isLabour} className="w-16 rounded border-stone-300 text-right text-sm disabled:bg-stone-100" {...form.register(`lines.${i}.headcount`)} /></td>
                          <td className="px-2 py-1.5"><input aria-label="Days" type="number" step="0.5" disabled={readOnly} className="w-16 rounded border-stone-300 text-right text-sm" {...form.register(`lines.${i}.days`)} /></td>
                          <td className="px-2 py-1.5"><input aria-label="Kilometres" type="number" step="1" disabled={readOnly || !isVehicle} className="w-16 rounded border-stone-300 text-right text-sm disabled:bg-stone-100" {...form.register(`lines.${i}.km`)} /></td>
                          <td className="px-2 py-1.5">
                            <input aria-label="Unit cost" type="number" step="0.01" disabled={readOnly}
                              className="w-24 rounded border-stone-300 text-right text-sm"
                              {...form.register(isVehicle ? `lines.${i}.cost_per_trip` : `lines.${i}.unit_cost`)} />
                            {isVehicle ? <input aria-label="Cost per km" type="number" step="0.01" disabled={readOnly}
                              className="mt-1 w-24 rounded border-stone-300 text-right text-sm" placeholder="per km" {...form.register(`lines.${i}.cost_per_km`)} /> : null}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums font-medium">{formatGHS(lineTotal)}</td>
                          <td className="px-2 py-1.5">
                            {!readOnly ? <Button variant="ghost" size="sm" aria-label="Remove line" onClick={() => lines.remove(i)}><Trash2 className="h-4 w-4" /></Button> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Notes">
            <Textarea label="Notes for the customer (appear on the quotation)" disabled={readOnly} {...form.register('notes')} />
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="What-if panel">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Overhead %" type="number" step="0.5" disabled={readOnly} {...form.register('overhead_pct')} />
              <Input label="Contingency %" type="number" step="0.5" disabled={readOnly} {...form.register('contingency_pct')} />
              <Input label="Target margin %" type="number" step="0.5" disabled={readOnly} {...form.register('target_margin_pct')} />
              <Input label="Tax %" type="number" step="0.5" disabled={readOnly} hint="On the quotation" {...form.register('tax_pct')} />
              <Input className="col-span-2" label="Proposed Quotation Price (GH₵)" type="number" step="0.01" disabled={readOnly}
                hint="Before tax. The customer's total is shown below." {...form.register('proposed_price')} />
            </div>

            {result.warning === 'below_cost' ? (
              <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                The proposed price is below the total cost. You would lose {formatGHS(Math.abs(result.profit))} on this work.
              </p>
            ) : result.warning === 'below_margin' ? (
              <p role="alert" className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Margin {formatPct(result.marginPct)} is below your target of {formatPct(Number(values.target_margin_pct) || 0)}.
                {result.requiresApproval ? ' A Manager will have to approve this estimate.' : ''}
              </p>
            ) : null}

            <dl className="mt-4 space-y-1.5 text-sm">
              {CATEGORIES.filter((c) => result.byCategory[c] > 0).map((c) => (
                <div key={c} className="flex justify-between"><dt className="text-stone-600">{humanize(c)}</dt><dd className="tabular-nums">{formatGHS(result.byCategory[c])}</dd></div>
              ))}
              <div className="flex justify-between border-t border-stone-200 pt-1.5 font-medium"><dt>Direct cost</dt><dd className="tabular-nums">{formatGHS(result.direct)}</dd></div>
              <div className="flex justify-between"><dt className="text-stone-600">Overhead</dt><dd className="tabular-nums">{formatGHS(result.overhead)}</dd></div>
              <div className="flex justify-between"><dt className="text-stone-600">Contingency</dt><dd className="tabular-nums">{formatGHS(result.contingency)}</dd></div>
              <div className="flex justify-between border-t border-stone-200 pt-1.5 text-base font-semibold"><dt>Total cost</dt><dd className="tabular-nums">{formatGHS(result.total)}</dd></div>
              <div className="flex justify-between"><dt className="text-stone-600">Break-even price</dt><dd className="tabular-nums">{formatGHS(result.breakEven)}</dd></div>
              <div className="flex justify-between"><dt className="text-stone-600">Recommended at target margin</dt><dd className="tabular-nums font-medium text-brand-700">{formatGHS(result.recommended)}</dd></div>
              {Number(values.tax_pct) > 0 ? (
                <div className="flex justify-between text-xs"><dt className="text-stone-500">Recommended, with tax</dt>
                  <dd className="tabular-nums text-stone-500">{formatGHS(result.recommendedWithTax)}</dd></div>
              ) : null}
              <div className="flex justify-between border-t border-stone-200 pt-1.5"><dt className="text-stone-600">Profit at proposed price</dt>
                <dd className={`tabular-nums font-semibold ${result.profit < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{formatGHS(result.profit)}</dd></div>
              <div className="flex justify-between"><dt className="text-stone-600">Margin</dt>
                <dd className={`tabular-nums font-semibold ${result.marginPct < 0 ? 'text-red-700' : ''}`}>{formatPct(result.marginPct)}</dd></div>
            </dl>

            {/* Tax is collected on the customer's behalf, so it sits apart from the margin figures. */}
            <dl className="mt-4 space-y-1.5 border-t border-stone-200 pt-3 text-sm">
              <div className="flex justify-between"><dt className="text-stone-600">Quotation price, before tax</dt>
                <dd className="tabular-nums">{formatGHS(Number(values.proposed_price) || 0)}</dd></div>
              <div className="flex justify-between"><dt className="text-stone-600">Tax at {formatPct(Number(values.tax_pct) || 0)}</dt>
                <dd className="tabular-nums">{formatGHS(result.taxAmount)}</dd></div>
              <div className="flex justify-between border-t border-stone-200 pt-1.5 text-base font-semibold">
                <dt>Customer pays</dt><dd className="tabular-nums">{formatGHS(result.priceWithTax)}</dd></div>
              <p className="pt-1 text-xs text-stone-500">
                Tax is collected for the revenue authority, so profit and margin above are worked out on the
                price before tax.
              </p>
            </dl>

            <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-stone-200 pt-3 text-center text-sm">
              <div><dt className="text-xs text-stone-500">Per visit</dt><dd className="font-medium tabular-nums">{formatGHS(result.perVisit)}</dd></div>
              <div><dt className="text-xs text-stone-500">Per day</dt><dd className="font-medium tabular-nums">{formatGHS(result.perDay)}</dd></div>
              <div><dt className="text-xs text-stone-500">Per month</dt><dd className="font-medium tabular-nums">{formatGHS(result.perMonth)}</dd></div>
            </dl>
          </Card>

          {chartData.length ? (
            <Card title="Cost breakdown">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{ left: 8, right: 16 }}>
                    <XAxis type="number" fontSize={11} tickFormatter={(v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))} />
                    <YAxis type="category" dataKey="name" fontSize={11} width={78} />
                    <Tooltip formatter={(v: number) => formatGHS(v)} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {chartData.map((row) => <Cell key={row.category} fill={CAT_COLOURS[row.category]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          ) : null}

          {estimate && ['approved', 'quoted', 'accepted', 'converted'].includes(estimate.status) ? (
            <Card title="Customer-facing quotation">
              <p className="text-sm text-stone-600">The quotation shows only the price, never your costs.</p>
              <Button variant="secondary" className="mt-3" icon={<FileText className="h-4 w-4" />} onClick={downloadQuote}>Preview PDF</Button>
            </Card>
          ) : null}
        </div>
      </div>

      <ConfirmDialog open={rejectOpen} onClose={() => setRejectOpen(false)} title="Reject this estimate" danger confirmLabel="Reject"
        reasonLabel="Reason (sent to the officer who raised it)" loading={reject.isPending} onConfirm={(reason) => reject.mutate(reason)} />

      <Modal open={quoteOpen} onClose={() => setQuoteOpen(false)} title="Create a quotation" size="sm"
        footer={<><Button variant="secondary" onClick={() => setQuoteOpen(false)}>Cancel</Button>
          <Button loading={quote.isPending} onClick={() => quote.mutate()}>Create</Button></>}>
        <div className="space-y-3">
          <Input label="Valid for (days)" type="number" value={quoteDays} onChange={(e) => setQuoteDays(Number(e.target.value))} />
          <Textarea label="Terms (optional)" value={quoteTerms} onChange={(e) => setQuoteTerms(e.target.value)}
            placeholder="Leave blank to use the standard terms from Settings" />
        </div>
      </Modal>

      <Modal open={convertOpen !== null} onClose={() => setConvertOpen(null)} title={convertOpen === 'contract' ? 'Create a contract' : 'Create a job order'} size="sm"
        footer={<><Button variant="secondary" onClick={() => setConvertOpen(null)}>Cancel</Button>
          <Button loading={toJob.isPending || toContract.isPending}
            onClick={() => (convertOpen === 'contract' ? toContract.mutate() : toJob.mutate())}>Create</Button></>}>
        <p className="mb-3 text-sm text-stone-600">
          The new {convertOpen === 'contract' ? 'contract' : 'job order'} keeps its link to this estimate, so you can compare estimated and actual cost later.
        </p>
        <Input label={convertOpen === 'contract' ? 'Start date' : 'Execution date'} type="date" value={convertDate}
          onChange={(e) => setConvertDate(e.target.value)} hint="Leave blank for today" />
      </Modal>
    </div>
  );
}
