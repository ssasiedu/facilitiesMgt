import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, LocateFixed, Send, Target, UserPlus } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { check, rpc, useAction } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { useRealtimeInvalidate } from '@/lib/realtime';
import { submitOrQueue, useOfflineQueue } from '@/lib/offlineQueue';
import { getPosition } from '@/lib/geo';
import { displayPhone, formatDate, formatDateTime, formatGHS, humanize, isoDate } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, DetailList } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Timeline } from '@/components/ui/Timeline';
import { FileUpload } from '@/components/ui/FileUpload';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/ErrorState';
import type { Tables } from '@/types/database';

interface TaskFull extends Tables<'tasks'> {
  task_type: { name: string } | null;
  officer: { id: string; full_name: string } | null;
  zone: { name: string } | null;
  customer: { id: string; display_name: string | null } | null;
  lead: { id: string; name: string } | null;
  task_updates: (Tables<'task_updates'> & { author: { full_name: string } | null })[];
  task_checkins: Tables<'task_checkins'>[];
  task_comments: (Tables<'task_comments'> & { author: { full_name: string } | null })[];
}

const STATUSES = ['planned', 'in_progress', 'completed', 'pending', 'postponed', 'cancelled'] as const;

/** One task: update it, check in with GPS, attach evidence, and turn a closed deal into a lead. */
export default function TaskDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { profile, roles } = useAuth();
  const { online } = useOfflineQueue();
  const isManager = hasAny(roles, 'manager');

  const [update, setUpdate] = useState({ status: '', notes: '', next_step: '', follow_up_date: '', deal_value: '' });
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const query = useQuery({
    queryKey: ['task', id],
    queryFn: async () => check(await supabase.from('tasks')
      .select(`*, task_type:task_types(name), officer:profiles(id, full_name), zone:zones(name),
               customer:customers!tasks_customer_id_fkey(id, display_name), lead:leads!tasks_lead_id_fkey(id, name),
               task_updates(*, author:profiles(full_name)), task_checkins(*), task_comments(*, author:profiles(full_name))`)
      .eq('id', id).single()) as TaskFull,
  });
  useRealtimeInvalidate(['tasks', 'task_comments'], [['task', id]]);

  const t = query.data;
  const mine = t?.officer_id === profile?.id;

  const toLead = useAction(() => rpc<string>('convert_task_to_lead', { p_task_id: id }), {
    success: 'Lead created from this task',
    invalidate: [['task', id]],
  });

  const sendUpdate = async () => {
    if (!update.status && !update.notes.trim()) { toast.error('Choose a status or write a note'); return; }
    setBusy(true);
    try {
      const result = await submitOrQueue({
        kind: 'task_update',
        payload: {
          task_id: id,
          status: update.status || null,
          notes: update.notes || null,
          next_step: update.next_step || null,
          follow_up_date: update.follow_up_date || null,
          deal_value: update.deal_value === '' ? null : Number(update.deal_value),
        },
      });
      toast.success(result === 'sent' ? 'Update saved' : 'Saved on this phone — it will send when you are back online');
      setUpdate({ status: '', notes: '', next_step: '', follow_up_date: '', deal_value: '' });
      await query.refetch();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const checkIn = async () => {
    setBusy(true);
    try {
      const p = await getPosition();
      const result = await submitOrQueue({
        kind: 'task_checkin',
        payload: { task_id: id, lat: p.lat, lng: p.lng, accuracy_m: p.accuracy, checked_in_at: new Date().toISOString() },
      });
      toast.success(result === 'sent' ? `Checked in (±${p.accuracy} m)` : 'Check-in saved on this phone');
      await query.refetch();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  const addComment = async () => {
    if (!comment.trim()) return;
    setBusy(true);
    try {
      check(await supabase.from('task_comments').insert({ task_id: id, author_id: profile?.id, body: comment.trim() }));
      setComment('');
      await query.refetch();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  if (query.isLoading) return <Spinner />;
  if (query.error || !t) return <ErrorState error={query.error ?? new Error('Not found')} onRetry={() => void query.refetch()} />;

  const canUpdate = mine || isManager;
  const lastCheckin = [...t.task_checkins].sort((a, b) => b.checked_in_at.localeCompare(a.checked_in_at))[0];

  return (
    <div>
      <PageHeader back={mine ? '/zonal/my-tasks' : '/zonal/board'} title={t.title}
        subtitle={<span className="flex flex-wrap items-center gap-2">
          <StatusBadge status={t.status} />
          <Badge tone="brand">{t.task_type?.name}</Badge>
          {t.priority !== 'normal' ? <Badge tone={t.priority === 'urgent' ? 'red' : 'amber'}>{humanize(t.priority)}</Badge> : null}
          <span className="text-stone-500">{formatDate(t.planned_date)}</span>
        </span>} />

      {!online ? (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          You are offline. Your update and check-in are saved on this phone and sent automatically later.
        </p>
      ) : null}

      <div className="space-y-4">
        <Card title="Where and who">
          <DetailList items={[
            ['Organisation', t.target_org ?? '—'],
            ['Location', t.location ?? '—'],
            ['Contact', [t.contact_name, displayPhone(t.contact_phone)].filter((x) => x && x !== '—').join(' · ') || '—'],
            ['Zone', t.zone?.name ?? '—'],
            ['Officer', t.officer?.full_name ?? '—'],
            ['Customer', t.customer ? <Link to={`/customers/${t.customer.id}`} className="text-brand-700 hover:underline">{t.customer.display_name}</Link> : '—'],
            ['Lead', t.lead ? <Link to={`/leads/${t.lead.id}`} className="text-brand-700 hover:underline">{t.lead.name}</Link> : '—'],
            ['Expected outcome', t.expected_outcome ?? '—'],
          ]} />
          {t.contact_phone ? (
            <a href={`tel:${t.contact_phone}`} className="mt-3 inline-block">
              <Button variant="secondary" size="lg">Call {displayPhone(t.contact_phone)}</Button>
            </a>
          ) : null}
        </Card>

        {canUpdate ? (
          <Card title="Update this task">
            <div className="space-y-4">
              <Select label="Status" options={STATUSES.map((s) => ({ value: s, label: humanize(s) }))} placeholder="Leave unchanged"
                value={update.status} onChange={(e) => setUpdate({ ...update, status: e.target.value })} />
              <Textarea label="What happened?" value={update.notes} onChange={(e) => setUpdate({ ...update, notes: e.target.value })}
                placeholder="Who you met, what was agreed" />
              <Input label="Next step" value={update.next_step} onChange={(e) => setUpdate({ ...update, next_step: e.target.value })} />
              <Input label="Follow-up date" type="date" value={update.follow_up_date} onChange={(e) => setUpdate({ ...update, follow_up_date: e.target.value })} />
              <Input label="Deal value (GH₵)" type="number" step="0.01" value={update.deal_value}
                onChange={(e) => setUpdate({ ...update, deal_value: e.target.value })}
                hint="Fill this in when you agree a value — marking the task Completed with a value records a closed deal" />
              <div className="flex flex-wrap gap-2">
                <Button size="lg" icon={<Send className="h-5 w-5" />} loading={busy} onClick={() => void sendUpdate()}>Save update</Button>
                <Button variant="secondary" size="lg" icon={<LocateFixed className="h-5 w-5" />} loading={busy} onClick={() => void checkIn()}>Check in here</Button>
              </div>
            </div>
          </Card>
        ) : null}

        {canUpdate ? (
          <Card title="Evidence">
            <FileUpload bucket="task-evidence" folder={`${id}`} label="Add a photo or document" capture
              onUploaded={async (path, file) => {
                check(await supabase.from('attachments').insert({
                  entity_type: 'task', entity_id: id, bucket: 'task-evidence', file_path: path,
                  file_name: file.name, mime_type: file.type, size_bytes: file.size,
                }));
                toast.success('Evidence added');
              }} />
            <p className="mt-2 text-xs text-stone-500">Photos of a signed minute, a site or a meeting are the easiest proof of a visit.</p>
          </Card>
        ) : null}

        {t.deal_closed || Number(t.deal_value) > 0 ? (
          <Card title="Deal">
            <DetailList items={[
              ['Value', formatGHS(t.deal_value)],
              ['Closed', t.deal_closed ? 'Yes' : 'Not yet'],
              ['Became a lead', t.converted_lead_id ? <Link to={`/leads/${t.converted_lead_id}`} className="text-brand-700 hover:underline">Open the lead</Link> : 'No'],
              ['Became a customer', t.converted_customer_id ? <Link to={`/customers/${t.converted_customer_id}`} className="text-brand-700 hover:underline">Open the customer</Link> : 'No'],
              ['Became a job order', t.converted_job_id ? <Link to={`/jobs/${t.converted_job_id}`} className="text-brand-700 hover:underline">Open the job order</Link> : 'No'],
            ]} />
            {canUpdate && !t.converted_lead_id ? (
              <Button className="mt-3" size="lg" icon={<UserPlus className="h-5 w-5" />} loading={toLead.isPending}
                onClick={() => toLead.mutate()}>Turn into a lead</Button>
            ) : null}
            {t.converted_lead_id ? (
              <p className="mt-2 flex items-center gap-1 text-xs text-stone-500">
                <Target className="h-3.5 w-3.5" />From the lead you can convert to a customer and raise an estimate or job order.
              </p>
            ) : null}
          </Card>
        ) : null}

        <Card title="Check-ins">
          {t.task_checkins.length ? (
            <>
              {lastCheckin ? (
                <p className="mb-2 text-sm text-stone-700">
                  Last check-in {formatDateTime(lastCheckin.checked_in_at)} at {lastCheckin.lat}, {lastCheckin.lng}
                  {lastCheckin.accuracy_m ? ` (±${lastCheckin.accuracy_m} m)` : ''}
                </p>
              ) : null}
              <ul className="divide-y divide-stone-100 text-sm">
                {[...t.task_checkins].sort((a, b) => b.checked_in_at.localeCompare(a.checked_in_at)).map((c) => (
                  <li key={c.id} className="flex items-center justify-between py-2">
                    <span>{formatDateTime(c.checked_in_at)}</span>
                    <a className="text-brand-700 hover:underline"
                      href={`https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lng}#map=17/${c.lat}/${c.lng}`}
                      target="_blank" rel="noreferrer">{c.lat}, {c.lng}</a>
                  </li>
                ))}
              </ul>
            </>
          ) : <p className="text-sm text-stone-500">No check-ins yet.</p>}
        </Card>

        <Card title="Updates">
          <Timeline items={[...t.task_updates]
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map((u) => ({
              at: u.created_at,
              title: u.status ? humanize(u.status) : 'Note',
              detail: [u.notes, u.next_step ? `Next: ${u.next_step}` : null, u.follow_up_date ? `Follow up ${formatDate(u.follow_up_date)}` : null,
                u.deal_value ? `Deal ${formatGHS(u.deal_value)}` : null].filter(Boolean).join(' · '),
              actor: u.author?.full_name ?? undefined,
            }))} />
        </Card>

        <Card title={isManager ? 'Comments (the officer sees these straight away)' : 'Comments from your Manager'}>
          <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <Textarea className="flex-1" label="Add a comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
            <Button loading={busy} disabled={!comment.trim()} onClick={() => void addComment()}>Post</Button>
          </div>
          <ul className="divide-y divide-stone-100">
            {[...t.task_comments].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((c) => (
              <li key={c.id} className="py-2">
                <p className="whitespace-pre-wrap text-sm text-stone-800">{c.body}</p>
                <p className="text-xs text-stone-500">{c.author?.full_name ?? 'Unknown'} · {formatDateTime(c.created_at)}</p>
              </li>
            ))}
            {!t.task_comments.length ? <li className="py-2 text-sm text-stone-500">No comments yet.</li> : null}
          </ul>
        </Card>

        {t.status === 'completed' ? (
          <p className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
            <Check className="h-4 w-4" />Completed {t.completed_at ? formatDateTime(t.completed_at) : ''}
            {t.outcome_notes ? ` — ${t.outcome_notes}` : ''}
          </p>
        ) : null}
        {t.follow_up_date ? (
          <p className="text-sm text-stone-600">Next follow-up: {formatDate(t.follow_up_date)}{t.next_step ? ` · ${t.next_step}` : ''}</p>
        ) : null}
        <p className="text-xs text-stone-500">Planned for {formatDate(t.planned_date)}, created {formatDate(t.created_at)}. Today is {formatDate(isoDate())}.</p>
      </div>
    </div>
  );
}
