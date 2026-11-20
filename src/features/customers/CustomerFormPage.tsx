import { useEffect, useMemo, useState } from 'react';
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { check } from '@/lib/rpc';
import { customerSchema, SOURCES, type CustomerForm } from '@/lib/schemas';
import { useStaff, useZones, toOptions, useListOptions, usePaymentTerms } from '@/lib/lookups';
import { useAuth } from '@/lib/auth';
import { displayPhone } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select, enumOptions } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Checkbox } from '@/components/ui/Checkbox';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { findDuplicates, saveCustomer, type Customer, type Duplicate } from './api';

const empty: CustomerForm = {
  customer_type: 'individual', title: '', first_name: '', middle_name: '', last_name: '', gender: '', birth_day: 0, birth_month: 0, birth_year: 0,
  ghana_card_no: '', phone: '', alt_phone: '', whatsapp: '', email: '', occupation: '', residential_address: '', company_name: '', trading_name: '',
  registration_no: '', tin: '', sector: '', company_phone: '', company_email: '', digital_address: '', region: '', district: '', zone_id: '', source: 'call_in',
  assigned_to: '', preferred_channel: 'sms', sms_opt_in: true, marketing_consent: false, credit_limit: 0, payment_terms_days: 7, tags: '', notes: '', status: 'active',
};

const REGIONS = ['Greater Accra', 'Ashanti', 'Central', 'Eastern', 'Western', 'Western North', 'Volta', 'Oti', 'Northern', 'Savannah', 'North East', 'Upper East', 'Upper West', 'Bono', 'Bono East', 'Ahafo'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function fromRow(c: Customer): CustomerForm {
  const s = (v: string | null | undefined) => v ?? '';
  const ph = (v: string | null) => (v ? displayPhone(v).replace(/\s/g, '') : '');
  return {
    customer_type: c.customer_type as 'individual' | 'company', title: s(c.title), first_name: s(c.first_name), middle_name: s(c.middle_name), last_name: s(c.last_name),
    gender: (c.gender ?? '') as CustomerForm['gender'], birth_day: c.birth_day ?? 0, birth_month: c.birth_month ?? 0, birth_year: c.birth_year ?? 0,
    ghana_card_no: s(c.ghana_card_no), phone: ph(c.phone), alt_phone: ph(c.alt_phone), whatsapp: ph(c.whatsapp), email: s(c.email), occupation: s(c.occupation),
    residential_address: s(c.residential_address), company_name: s(c.company_name), trading_name: s(c.trading_name), registration_no: s(c.registration_no), tin: s(c.tin),
    sector: s(c.sector), company_phone: ph(c.company_phone), company_email: s(c.company_email), digital_address: s(c.digital_address), region: s(c.region), district: s(c.district),
    zone_id: s(c.zone_id), source: c.source as CustomerForm['source'], assigned_to: s(c.assigned_to), preferred_channel: c.preferred_channel as CustomerForm['preferred_channel'],
    sms_opt_in: c.sms_opt_in, marketing_consent: c.marketing_consent, credit_limit: Number(c.credit_limit), payment_terms_days: c.payment_terms_days,
    tags: (c.tags ?? []).join(', '), notes: s(c.notes), status: c.status as CustomerForm['status'],
  };
}

export default function CustomerFormPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { is, zoneIds } = useAuth();
  const { data: zones } = useZones();
  const sectors = useListOptions('customer_sector');
  const sectorOptions = (sectors.data ?? []).map((o) => ({ value: o.label, label: o.label }));
  const terms = usePaymentTerms();
  const termOptions = terms.options;
  const { data: staff } = useStaff();
  const [dupes, setDupes] = useState<Duplicate[]>([]);
  const { data: existing, isLoading } = useQuery({
    queryKey: ['customer', id], enabled: !!id,
    queryFn: async () => check(await supabase.from('customers').select('*').eq('id', id!).single()) as Customer,
  });
  const form = useForm<CustomerForm>({ resolver: zodResolver(customerSchema), defaultValues: { ...empty, zone_id: is('zonal_officer') && !is('manager', 'sales_exec', 'ops_officer') ? zoneIds[0] ?? '' : '' } });
  const { register, handleSubmit, formState: { errors, isDirty, isSubmitting }, reset, control } = form;
  useEffect(() => { if (existing) reset(fromRow(existing)); }, [existing, reset]);
  const type = useWatch({ control, name: 'customer_type' });
  const watched = useWatch({ control, name: ['phone', 'ghana_card_no', 'email', 'tin', 'company_phone', 'company_email'] });

  // duplicate warning (phone, Ghana Card, email, TIN) – warns and links, does not block
  useEffect(() => {
    const [phone, card, email, tin, cphone, cemail] = watched;
    const t = setTimeout(async () => {
      if (!phone && !card && !email && !tin && !cphone && !cemail) { setDupes([]); return; }
      try {
        const a = await findDuplicates({ phone: phone || cphone, ghana_card_no: card, email: email || cemail, tin }, id);
        setDupes(a);
      } catch { setDupes([]); }
    }, 500);
    return () => clearTimeout(t);
  }, [watched, id]);

  const blocker = useBlocker(({ currentLocation, nextLocation }) => isDirty && !isSubmitting && currentLocation.pathname !== nextLocation.pathname);
  const zoneOptions = useMemo(() => toOptions((zones ?? []).filter((z) => !is('zonal_officer') || is('manager', 'sales_exec', 'ops_officer') || zoneIds.includes(z.id)), (z) => z.name), [zones, zoneIds, is]);
  const err = (k: keyof CustomerForm) => errors[k]?.message as string | undefined;

  const onSubmit = handleSubmit(async (v) => {
    try {
      const newId = await saveCustomer(id, v);
      reset(v);
      toast.success(id ? 'Customer saved' : 'Customer created');
      navigate(`/customers/${newId}`);
    } catch (e) { toast.error((e as Error).message); }
  });

  if (id && isLoading) return <PageSkeleton />;
  return (
    <form onSubmit={onSubmit} noValidate>
      <PageHeader title={id ? `Edit ${existing?.display_name ?? 'customer'}` : 'New customer'} back={id ? `/customers/${id}` : '/customers'}
        actions={<Button type="submit" loading={isSubmitting}>Save customer</Button>} />
      {dupes.length ? (
        <div role="alert" className="mb-4 flex gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-medium">Possible duplicate</p>
            <ul className="mt-1 list-disc pl-5">{dupes.map((d) => <li key={`${d.id}-${d.matched_on}`}>Same {d.matched_on} as <Link className="font-medium underline" to={`/customers/${d.id}`}>{d.display_name} ({d.customer_code})</Link></li>)}</ul>
          </div>
        </div>
      ) : null}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Customer type">
            <div className="flex gap-2">
              {(['individual', 'company'] as const).map((t) => (
                <label key={t} className={`flex min-h-tap flex-1 cursor-pointer items-center justify-center rounded-lg border text-sm font-medium ${type === t ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-stone-300'}`}>
                  <input type="radio" value={t} className="sr-only" {...register('customer_type')} />{t === 'individual' ? 'Individual' : 'Company / organisation'}
                </label>
              ))}
            </div>
          </Card>
          {type === 'individual' ? (
            <Card title="Personal details">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Select label="Title" options={enumOptions(['Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Prof', 'Rev', 'Hon', 'Nana', 'Togbe'])} placeholder="—" {...register('title')} />
                <Input label="First name" required error={err('first_name')} {...register('first_name')} />
                <Input label="Middle name" {...register('middle_name')} />
                <Input label="Last name" required error={err('last_name')} {...register('last_name')} />
                <Select label="Gender" options={enumOptions(['male', 'female', 'other'])} placeholder="Prefer not to say" {...register('gender')} />
                <Input label="Occupation" {...register('occupation')} />
                <Select label="Birthday – day" options={Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))} placeholder="—" {...register('birth_day')} />
                <Select label="Birthday – month" options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} placeholder="—" {...register('birth_month')} />
                <Input label="Birth year (optional)" type="number" {...register('birth_year')} />
                <Input label="Ghana Card number" placeholder="GHA-123456789-0" error={err('ghana_card_no')} {...register('ghana_card_no')} />
                <Input label="Primary phone" required placeholder="024 412 3456" error={err('phone')} {...register('phone')} />
                <Input label="Alternate phone" error={err('alt_phone')} {...register('alt_phone')} />
                <Input label="WhatsApp number" error={err('whatsapp')} {...register('whatsapp')} />
                <Input label="Email" type="email" error={err('email')} {...register('email')} />
                <Input label="Residential address" className="sm:col-span-3" {...register('residential_address')} />
              </div>
            </Card>
          ) : (
            <Card title="Company details">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input label="Company name" required error={err('company_name')} {...register('company_name')} />
                <Input label="Trading name" {...register('trading_name')} />
                <Input label="Registrar-General registration no." {...register('registration_no')} />
                <Input label="TIN" {...register('tin')} />
                <Select label="Sector" placeholder="Choose…" options={sectorOptions} {...register('sector')} />
                <Input label="Company phone" required error={err('company_phone')} {...register('company_phone')} />
                <Input label="Company email" type="email" error={err('company_email')} {...register('company_email')} />
                <Input label="Office address" {...register('residential_address')} />
              </div>
              <p className="mt-3 text-xs text-stone-500">Add contact persons, the logo and registration documents on the customer profile after saving.</p>
            </Card>
          )}
          <Card title="Location">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="GhanaPost GPS digital address" placeholder="GA-123-4567" error={err('digital_address')} {...register('digital_address')} />
              <Select label="Region" options={REGIONS.map((r) => ({ value: r, label: r }))} placeholder="—" {...register('region')} />
              <Input label="District / MMDA" {...register('district')} />
              <Select label="Zone" options={zoneOptions} placeholder="—" {...register('zone_id')} />
            </div>
          </Card>
        </div>
        <div className="space-y-4">
          <Card title="Account">
            <div className="space-y-4">
              <Select label="Source" options={enumOptions(SOURCES)} {...register('source')} />
              <Select label="Assigned sales executive / zonal officer" options={toOptions((staff ?? []).filter((s) => s.roles.some((r) => ['sales_exec', 'zonal_officer', 'manager'].includes(r))), (s) => s.full_name)} placeholder="—" {...register('assigned_to')} />
              <Select label="Status" options={enumOptions(['active', 'inactive', 'blacklisted'])} {...register('status')} />
              <Input label="Credit limit (GH₵)" type="number" step="0.01" hint="0 = no limit" error={err('credit_limit')} {...register('credit_limit')} />
              <Select label="Payment terms" required options={termOptions} error={err('payment_terms_days')}
                hint="Invoice due dates are worked out from this" {...register('payment_terms_days')} />
              <Input label="Tags" placeholder="comma separated" {...register('tags')} />
            </div>
          </Card>
          <Card title="Communication and consent">
            <Select label="Preferred channel" options={enumOptions(['sms', 'email', 'whatsapp'])} {...register('preferred_channel')} />
            <div className="mt-2">
              <Checkbox label="SMS opt-in" hint="Service SMS (jobs, invoices, receipts) are always sent" {...register('sms_opt_in')} />
              <Checkbox label="Marketing consent" hint="Birthday and promotional messages (Data Protection Act, 2012, Act 843). The date is recorded." {...register('marketing_consent')} />
            </div>
          </Card>
          <Card title="Notes"><Textarea rows={4} {...register('notes')} /></Card>
        </div>
      </div>
      <ConfirmDialog open={blocker.state === 'blocked'} onClose={() => blocker.reset?.()} onConfirm={() => blocker.proceed?.()} title="Leave without saving?"
        message="You have unsaved changes on this form." confirmLabel="Leave" danger />
    </form>
  );
}
