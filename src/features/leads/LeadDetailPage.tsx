import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil, Trophy } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { check, rpc } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { canEdit } from '@/lib/permissions';
import { leadActivitySchema } from '@/lib/schemas';
import { displayPhone, formatDate, formatDateTime, formatGHS, humanize } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, DetailList } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Select, enumOptions } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Modal } from '@/components/ui/Modal';
import { PageSkeleton } from '@/components/ui/Skeleton';
import { ErrorState } from '@/components/ui/ErrorState';
import { CommentsPanel } from '@/components/ui/CommentsPanel';
import { LeadFormModal } from './LeadFormModal';
import type { Tables } from '@/types/database';

type Lead = Tables<'leads'> & { service: { name: string } | null; owner: { full_name: string } | null; zone: { name: string } | null };

export default function LeadDetailPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { roles, is } = useAuth();
  const [edit, setEdit] = useState(false);
  const [won, setWon] = useState(false);
  const lead = useQuery({ queryKey: ['lead', id], queryFn: async () => check(await supabase.from('leads').select('*, service:services(name), owner:profiles!leads_owner_id_fkey(full_name), zone:zones(name)').eq('id', id).single()) as Lead });
  const acts = useQuery({ queryKey: ['lead-activities', id], queryFn: async () => check(await supabase.from('lead_activities').select('*, by:profiles(full_name)').eq('lead_id', id).order('activity_at', { ascending: false })) as (Tables<'lead_activities'> & { by: { full_name: string } | null })[] });
  const form = useForm({ resolver: zodResolver(leadActivitySchema), defaultValues: { activity_type: 'call' as const, outcome: '', notes: '' } });

  if (lead.isLoading) return <PageSkeleton />;
  if (lead.error || !lead.data) return <ErrorState error={lead.error} onRetry={() => lead.refetch()} />;
  const l = lead.data;
  const editable = canEdit(roles, 'leads');

  const convert = async (next: 'estimate' | 'job' | 'customer') => {
    try {
      const customerId = await rpc<string>('convert_lead_to_customer', { p_lead_id: l.id });
      toast.success('Customer created from lead');
      await qc.invalidateQueries({ queryKey: ['lead', id] });
      if (next === 'estimate') navigate(`/estimates/new?customer=${customerId}${l.service_id ? `&service=${l.service_id}` : ''}`);
      else if (next === 'job') navigate(`/jobs/new?customer=${customerId}${l.service_id ? `&service=${l.service_id}` : ''}`);
      else navigate(`/customers/${customerId}`);
    } catch (e) { toast.error((e as Error).message); }
  };

  return (
    <div>
      <PageHeader back="/leads" title={<span className="flex items-center gap-2">{l.company_name ?? l.name}<StatusBadge status={l.stage} /></span>} subtitle={l.company_name ? l.name : undefined}
        actions={<>
          {editable ? <Button variant="secondary" icon={<Pencil className="h-4 w-4" />} onClick={() => setEdit(true)}>Edit</Button> : null}
          {l.customer_id ? <Link to={`/customers/${l.customer_id}`}><Button variant="secondary">Open customer</Button></Link> : null}
          {editable && l.stage !== 'lost' && !l.customer_id ? <Button variant="success" icon={<Trophy className="h-4 w-4" />} onClick={() => setWon(true)}>Mark won and convert</Button> : null}
        </>} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Lead">
            <DetailList items={[['Phone', displayPhone(l.phone)], ['Email', l.email], ['Service of interest', l.service?.name], ['Estimated value', formatGHS(l.estimated_value)],
              ['Source', humanize(l.source)], ['Location', l.location], ['Zone', l.zone?.name], ['Owner', l.owner?.full_name], ['Next follow-up', formatDate(l.next_follow_up)],
              ['Lost reason', l.lost_reason], ['Notes', l.notes]]} />
          </Card>
          <Card title="Activities">
            {editable ? (
              <form className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-4" onSubmit={form.handleSubmit(async (v) => {
                try { check(await supabase.from('lead_activities').insert({ ...v, lead_id: l.id })); form.reset({ activity_type: 'call', outcome: '', notes: '' }); await qc.invalidateQueries({ queryKey: ['lead-activities', id] }); toast.success('Activity logged'); }
                catch (e) { toast.error((e as Error).message); }
              })}>
                <Select label="Type" options={enumOptions(['call', 'visit', 'meeting', 'sms', 'email', 'note'])} {...form.register('activity_type')} />
                <Input label="Outcome" {...form.register('outcome')} />
                <Textarea label="Notes" rows={1} {...form.register('notes')} />
                <div className="flex items-end"><Button type="submit" className="w-full" loading={form.formState.isSubmitting}>Log activity</Button></div>
              </form>
            ) : null}
            <ul className="divide-y divide-stone-100">
              {(acts.data ?? []).map((a) => (
                <li key={a.id} className="py-2 text-sm">
                  <p><span className="font-medium">{humanize(a.activity_type)}</span>{a.outcome ? ` – ${a.outcome}` : ''}</p>
                  {a.notes ? <p className="text-stone-600">{a.notes}</p> : null}
                  <p className="text-xs text-stone-500">{formatDateTime(a.activity_at)} · {a.by?.full_name}</p>
                </li>
              ))}
              {!acts.data?.length ? <li className="py-2 text-sm text-stone-500">No activities logged.</li> : null}
            </ul>
          </Card>
        </div>
        <Card title="Comments"><CommentsPanel entityType="lead" entityId={l.id} /></Card>
      </div>
      <LeadFormModal open={edit} lead={l} onClose={() => setEdit(false)} onSaved={() => void qc.invalidateQueries({ queryKey: ['lead', id] })} />
      <Modal open={won} onClose={() => setWon(false)} title="Lead won – what next?" size="sm">
        <p className="mb-4 text-sm text-stone-600">A customer is created with the lead's details. Then:</p>
        <div className="grid gap-2">
          {is('sales_exec', 'ops_officer', 'manager') ? <Button size="lg" onClick={() => convert('estimate')}>Create customer and open an estimate</Button> : null}
          {is('sales_exec', 'ops_officer', 'manager') ? <Button size="lg" variant="secondary" onClick={() => convert('job')}>Create customer and open a job order</Button> : null}
          <Button size="lg" variant="ghost" onClick={() => convert('customer')}>Just create the customer</Button>
        </div>
      </Modal>
    </div>
  );
}
