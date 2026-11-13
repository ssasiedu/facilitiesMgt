import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { check, nullify } from '@/lib/rpc';
import { normalizePhone } from '@/lib/format';
import { leadSchema, SOURCES, type LeadForm } from '@/lib/schemas';
import { useServices, useStaff, useZones, toOptions } from '@/lib/lookups';
import { useAuth } from '@/lib/auth';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select, enumOptions } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import type { Tables } from '@/types/database';

export const STAGES = ['new', 'contacted', 'site_visit', 'estimate_sent', 'negotiation', 'won', 'lost'] as const;

export function LeadFormModal({ open, onClose, lead, onSaved }: { open: boolean; onClose: () => void; lead?: Tables<'leads'> | null; onSaved?: (id: string) => void }) {
  const { profile, zoneIds, is } = useAuth();
  const { data: services } = useServices();
  const { data: zones } = useZones();
  const { data: staff } = useStaff();
  const form = useForm<LeadForm>({ resolver: zodResolver(leadSchema) });
  const stage = useWatch({ control: form.control, name: 'stage' });
  useEffect(() => {
    if (!open) return;
    form.reset(lead ? {
      name: lead.name, company_name: lead.company_name ?? '', phone: lead.phone ? `0${lead.phone.slice(3)}` : '', email: lead.email ?? '', service_id: lead.service_id ?? '',
      source: lead.source as LeadForm['source'], location: lead.location ?? '', zone_id: lead.zone_id ?? '', estimated_value: Number(lead.estimated_value), owner_id: lead.owner_id ?? '',
      stage: lead.stage as LeadForm['stage'], lost_reason: lead.lost_reason ?? '', next_follow_up: lead.next_follow_up ?? '', notes: lead.notes ?? '',
    } : { name: '', company_name: '', phone: '', email: '', service_id: '', source: is('zonal_officer') ? 'zonal_officer' : 'call_in', location: '', zone_id: zoneIds[0] ?? '',
      estimated_value: 0, owner_id: profile?.id ?? '', stage: 'new', lost_reason: '', next_follow_up: '', notes: '' });
  }, [open, lead, form, profile, zoneIds, is]);
  const e = form.formState.errors;
  const save = form.handleSubmit(async (v) => {
    try {
      // zonal officers always own the leads they raise
      const owner = is('manager', 'sales_exec') ? v.owner_id : profile?.id;
      const row = nullify({ ...v, phone: normalizePhone(v.phone), owner_id: owner ?? '' });
      const res = lead ? check(await supabase.from('leads').update(row).eq('id', lead.id).select('id').single()) : check(await supabase.from('leads').insert(row).select('id').single());
      toast.success(lead ? 'Lead saved' : 'Lead created');
      onSaved?.((res as { id: string }).id);
      onClose();
    } catch (err) { toast.error((err as Error).message); }
  });
  return (
    <Modal open={open} onClose={onClose} title={lead ? 'Edit lead' : 'New lead'} size="lg"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={form.formState.isSubmitting} onClick={save}>Save lead</Button></>}>
      <form onSubmit={save} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input label="Person name" required error={e.name?.message} {...form.register('name')} />
        <Input label="Company / organisation" {...form.register('company_name')} />
        <Input label="Phone" error={e.phone?.message} {...form.register('phone')} />
        <Input label="Email" error={e.email?.message} {...form.register('email')} />
        <Select label="Service of interest" options={toOptions(services, (s) => s.name)} placeholder="—" {...form.register('service_id')} />
        <Select label="Source" options={enumOptions(SOURCES)} {...form.register('source')} />
        <Input label="Location" {...form.register('location')} />
        <Select label="Zone" options={toOptions(zones, (z) => z.name)} placeholder="—" {...form.register('zone_id')} />
        <Input label="Estimated value (GH₵)" type="number" step="0.01" error={e.estimated_value?.message} {...form.register('estimated_value')} />
        <Select label="Owner" disabled={!is('manager', 'sales_exec')} options={toOptions((staff ?? []).filter((s) => s.roles.some((r) => ['sales_exec', 'zonal_officer', 'manager'].includes(r))), (s) => s.full_name)} placeholder="—" {...form.register('owner_id')} />
        <Select label="Stage" options={enumOptions(STAGES)} {...form.register('stage')} />
        <Input label="Next follow-up" type="date" {...form.register('next_follow_up')} />
        {stage === 'lost' ? <Input className="sm:col-span-2" label="Reason lost" required error={e.lost_reason?.message} {...form.register('lost_reason')} /> : null}
        <Textarea className="sm:col-span-2" label="Notes" {...form.register('notes')} />
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
