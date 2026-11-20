import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Clock, Hash, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { check, friendlyError, rpc } from '@/lib/rpc';
import { useSettings } from '@/lib/settings';
import { configurationSchema, type ConfigurationValues } from '@/lib/schemas';
import { formatDate, humanize } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Checkbox } from '@/components/ui/Checkbox';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Spinner } from '@/components/ui/Spinner';
import { SettingsTabs } from './SettingsTabs';
import { ListOptionsCard } from './ListOptionsCard';
import type { Tables } from '@/types/database';

type Sequence = Tables<'document_sequences'>;
type Period = Tables<'fiscal_periods'>;

const CRON_LABELS: Record<string, string> = {
  service_today: 'Morning job-sheet messages',
  recurring_billing: 'Contract invoices generated',
  morning_alerts: 'Fleet, contract and overdue alerts',
  zonal_reminder: 'Reminder to officers who have not updated',
  evening: 'Evening summary to managers',
  nightly: 'Overnight housekeeping and reports',
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Business rules a Super Admin can change without touching code (spec 4.14). */
export default function ConfigurationPage() {
  const settings = useSettings();
  const qc = useQueryClient();
  const [times, setTimes] = useState<Record<string, string>>({});
  const [lockConfirm, setLockConfirm] = useState<string | null>(null);

  const form = useForm<ConfigurationValues>({
    resolver: zodResolver(configurationSchema),
    defaultValues: {
      segregation_of_duties: true, estimate_margin_threshold: 20, contract_margin_threshold: 20,
      overdue_reminder_days: '1, 7, 14, 30', survey_expiry_days: 30, survey_low_score: 3, survey_low_nps: 6,
      fiscal_year_start_month: 1, lock_date: '', online_payments_enabled: false,
      sms_provider: '', email_provider: '', payment_provider: '',
    },
  });

  useEffect(() => {
    if (!settings) return;
    form.reset({
      segregation_of_duties: settings.segregation_of_duties,
      estimate_margin_threshold: Number(settings.estimate_margin_threshold),
      contract_margin_threshold: Number(settings.contract_margin_threshold),
      overdue_reminder_days: (settings.overdue_reminder_days ?? []).join(', '),
      survey_expiry_days: settings.survey_expiry_days,
      survey_low_score: settings.survey_low_score,
      survey_low_nps: settings.survey_low_nps,
      fiscal_year_start_month: settings.fiscal_year_start_month,
      lock_date: settings.lock_date ?? '',
      online_payments_enabled: settings.online_payments_enabled,
      sms_provider: settings.sms_provider,
      email_provider: settings.email_provider,
      payment_provider: settings.payment_provider,
    });
    setTimes((settings.cron_times ?? {}) as Record<string, string>);
  }, [settings, form]);

  const { data: sequences = [] } = useQuery({
    queryKey: ['document_sequences'],
    queryFn: async () => check(await supabase.from('document_sequences').select('*').order('doc_type')) as Sequence[],
  });
  const { data: periods = [] } = useQuery({
    queryKey: ['fiscal_periods'],
    queryFn: async () => check(await supabase.from('fiscal_periods').select('*').order('start_date', { ascending: false })) as Period[],
  });

  const save = form.handleSubmit(async (values) => {
    const payload = {
      ...values,
      lock_date: values.lock_date || null,
      overdue_reminder_days: values.overdue_reminder_days.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n >= 0),
      cron_times: times,
    };
    const { error } = await supabase.from('company_settings').update(payload).eq('id', 1);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Configuration saved');
    await qc.invalidateQueries({ queryKey: ['company_settings'] });
  });

  const reschedule = useMutation({
    mutationFn: () => rpc<{ scheduled: boolean }>('schedule_app_jobs', {}),
    onSuccess: (r) => toast[r?.scheduled === false ? 'error' : 'success'](
      r?.scheduled === false ? 'pg_cron is not enabled on this project yet' : 'Scheduled jobs updated to the new times'),
    onError: (e) => toast.error(friendlyError(e)),
  });

  const closePeriod = useMutation({
    mutationFn: async (p: Period) => check(await supabase.from('fiscal_periods').update({ is_closed: !p.is_closed }).eq('id', p.id)),
    onSuccess: async () => { toast.success('Period updated'); await qc.invalidateQueries({ queryKey: ['fiscal_periods'] }); },
    onError: (e) => toast.error(friendlyError(e)),
  });

  const saveLock = async (date: string | null) => {
    const { error } = await supabase.from('company_settings').update({ lock_date: date }).eq('id', 1);
    setLockConfirm(null);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success(date ? `Books locked up to ${formatDate(date)}` : 'Lock removed');
    await qc.invalidateQueries({ queryKey: ['company_settings'] });
  };

  if (!settings) return <Spinner />;

  return (
    <div>
      <PageHeader title="Settings" subtitle="Approval rules, thresholds, numbering and scheduled jobs" />
      <SettingsTabs />

      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="mt-4 space-y-4">
        <Card title="Approvals">
          <Checkbox label="The person who raises a document cannot approve it"
            hint="Segregation of duties. With this on, a Manager who raises a job order needs another Manager or a Super Admin to approve it."
            {...form.register('segregation_of_duties')} />
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input label="Estimate margin threshold (%)" type="number" step="0.01" required
              {...form.register('estimate_margin_threshold', { valueAsNumber: true })}
              error={form.formState.errors.estimate_margin_threshold?.message}
              hint="An estimate below this margin is flagged and needs approval" />
            <Input label="Contract margin threshold (%)" type="number" step="0.01" required
              {...form.register('contract_margin_threshold', { valueAsNumber: true })}
              error={form.formState.errors.contract_margin_threshold?.message}
              hint="A contract month below this margin raises an alert" />
          </div>
        </Card>

        <Card title="Reminders and surveys">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Input label="Overdue reminders (days after due date)" required
              {...form.register('overdue_reminder_days')} error={form.formState.errors.overdue_reminder_days?.message}
              hint="Separate with commas, e.g. 1, 7, 14, 30" />
            <Input label="Survey link valid for (days)" type="number" required
              {...form.register('survey_expiry_days', { valueAsNumber: true })} error={form.formState.errors.survey_expiry_days?.message} />
            <Input label="Low satisfaction score (1–5)" type="number" min={1} max={5} required
              {...form.register('survey_low_score', { valueAsNumber: true })} error={form.formState.errors.survey_low_score?.message}
              hint="At or below this, a follow-up task is created automatically" />
            <Input label="Low recommendation score (0–10)" type="number" min={0} max={10} required
              {...form.register('survey_low_nps', { valueAsNumber: true })} error={form.formState.errors.survey_low_nps?.message} />
          </div>
        </Card>

        <Card title="Accounting">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Select label="Financial year starts in" required
              options={MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))}
              {...form.register('fiscal_year_start_month', { valueAsNumber: true })} />
            <div>
              <Input label="Books locked up to" type="date" readOnly value={settings.lock_date ?? ''}
                hint="Nothing dated on or before this can be posted, edited or reversed" />
              <div className="mt-2 flex gap-2">
                <input type="date" aria-label="New lock date" className="h-10 rounded-lg border border-stone-300 px-2 text-sm"
                  onChange={(e) => setLockConfirm(e.target.value || null)} />
                {settings.lock_date ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => void saveLock(null)}>Remove lock</Button>
                ) : null}
              </div>
            </div>
          </div>
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            Posted invoices, payments and journals are never edited or deleted anywhere in this system. Corrections are made
            with a credit note, a refund or a reversing journal, so the trail stays complete.
          </p>
        </Card>

        <Card title="Providers">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Input label="SMS provider" required {...form.register('sms_provider')} error={form.formState.errors.sms_provider?.message} />
            <Input label="Email provider" required {...form.register('email_provider')} error={form.formState.errors.email_provider?.message} />
            <Select label="Payment provider" required
              options={[{ value: 'hubtel', label: 'Hubtel' }, { value: 'paystack', label: 'Paystack' }]}
              {...form.register('payment_provider')} error={form.formState.errors.payment_provider?.message} />
          </div>
          <div className="mt-3">
            <Checkbox label="Let customers pay invoices online" {...form.register('online_payments_enabled')}
              hint="Adds a Pay now button to the invoice link. The provider keys stay in Edge Function secrets." />
          </div>
          <p className="mt-2 text-xs text-stone-500">
            Changing a provider here only tells the Edge Functions which one to call. The keys themselves are set with
            <code className="mx-1 rounded bg-stone-100 px-1">supabase secrets set</code> and never reach the browser.
          </p>
          {form.watch('payment_provider') === 'hubtel' && form.watch('online_payments_enabled') ? (
            <p className="mt-2 rounded-lg bg-stone-50 p-3 text-xs text-stone-600">
              Hubtel does not sign its payment callback, so each checkout carries a secret of its own in the callback
              address, and a callback is only accepted when that secret matches, the reference is one we opened, and the
              amount is exactly what we asked for. Hubtel's status API is consulted as well, but it only answers
              allow-listed IP addresses, which this app cannot offer — so it strengthens the check when it answers and
              never weakens it when it does not.
            </p>
          ) : null}
        </Card>

        <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur">
          <Button type="button" variant="secondary" onClick={() => form.reset()} disabled={!form.formState.isDirty}>Undo changes</Button>
          <Button type="submit" loading={form.formState.isSubmitting}>Save</Button>
        </div>
      </form>

      <Card className="mt-4" title={<span className="flex items-center gap-2"><Clock className="h-4 w-4" />Scheduled jobs</span>}
        actions={<Button variant="secondary" size="sm" loading={reschedule.isPending} onClick={() => reschedule.mutate()}>Apply times</Button>}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Object.keys(CRON_LABELS).map((key) => (
            <Input key={key} label={CRON_LABELS[key]} type="time" value={times[key] ?? ''}
              onChange={(e) => setTimes({ ...times, [key]: e.target.value })} />
          ))}
        </div>
        <p className="mt-3 text-xs text-stone-500">
          Times are Ghana time (UTC). Save the page first, then choose Apply times to move the jobs. Outgoing messages are
          processed every minute regardless of these settings.
        </p>
      </Card>

      <Card className="mt-4" bodyClassName="p-0"
        title={<span className="flex items-center gap-2"><Hash className="h-4 w-4" />Document numbering</span>}>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Document</th>
                <th scope="col" className="px-3 py-2 font-medium">Prefix</th>
                <th scope="col" className="px-3 py-2 font-medium">Resets each year</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Last issued</th>
                <th scope="col" className="px-3 py-2 font-medium">Next number</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {sequences.map((s) => {
                const next = String(s.last_value + 1).padStart(s.padding, '0');
                return (
                  <tr key={`${s.doc_type}-${s.year}`}>
                    <td className="px-3 py-2 font-medium">{humanize(s.doc_type)}</td>
                    <td className="px-3 py-2 font-mono">{s.prefix}</td>
                    <td className="px-3 py-2">{s.per_year ? <Badge tone="blue">Yes</Badge> : <span className="text-stone-500">No</span>}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{s.last_value}</td>
                    <td className="px-3 py-2 font-mono text-stone-600">
                      {s.per_year ? `${s.prefix}-${s.year || new Date().getFullYear()}-${next}` : `${s.prefix}-${next}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="p-3 text-xs text-stone-500">
          Numbers are issued by the database in one atomic step, so two people saving at the same moment can never get the
          same number, and no number is ever skipped or reused.
        </p>
      </Card>

      {periods.length ? (
        <Card className="mt-4" bodyClassName="p-0"
          title={<span className="flex items-center gap-2"><Lock className="h-4 w-4" />Accounting periods</span>}>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">Period</th>
                  <th scope="col" className="px-3 py-2 font-medium">From</th>
                  <th scope="col" className="px-3 py-2 font-medium">To</th>
                  <th scope="col" className="px-3 py-2 font-medium">Status</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {periods.map((p) => (
                  <tr key={p.id}>
                    <td className="px-3 py-2 font-medium">{p.name}</td>
                    <td className="px-3 py-2">{formatDate(p.start_date)}</td>
                    <td className="px-3 py-2">{formatDate(p.end_date)}</td>
                    <td className="px-3 py-2">{p.is_closed ? <Badge tone="grey">Closed</Badge> : <Badge tone="green">Open</Badge>}</td>
                    <td className="px-3 py-2 text-right">
                      <Button variant="ghost" size="sm" onClick={() => closePeriod.mutate(p)}>{p.is_closed ? 'Reopen' : 'Close'}</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <ListOptionsCard category="customer_sector" title="Customer sectors"
        description="The sectors offered when adding or editing a customer. Keeping them on a list rather than typed in each time is what lets the sector reports group properly."
        addLabel="Add a sector" />

      <ListOptionsCard category="payment_terms" title="Payment terms"
        description="The terms offered on a customer, a quotation and an invoice. The day count is what the invoice due date is worked out from."
        numericLabel="Days" numericHint="0 means due on receipt" allowDefault addLabel="Add a term" />

      <ConfirmDialog open={lockConfirm !== null} onClose={() => setLockConfirm(null)} title="Lock the books?"
        message={`Nothing dated on or before ${lockConfirm ? formatDate(lockConfirm) : ''} can be posted, edited or reversed after this. Only a Super Admin can lift the lock.`}
        confirmLabel="Lock the books" danger onConfirm={() => { if (lockConfirm) void saveLock(lockConfirm); }} />
    </div>
  );
}
