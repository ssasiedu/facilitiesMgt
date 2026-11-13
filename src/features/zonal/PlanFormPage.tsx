import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFieldArray, useForm, type FieldValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Plus, Save, Trash2 } from 'lucide-react';
import { addDays } from 'date-fns';
import { supabase } from '@/lib/supabaseClient';
import { check, nullify, useAction } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { planSchema, type PlanForm } from '@/lib/schemas';
import { formatDate, isoDate } from '@/lib/format';
import { useTaskTypes, useZones, toOptions } from '@/lib/lookups';
import { searchCustomers } from '@/features/customers/api';
import { searchLeads } from '@/features/estimates/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { AsyncPicker } from '@/components/ui/AsyncPicker';

const emptyTask = (date: string) => ({
  title: '', task_type_id: '', customer_id: '', lead_id: '', target_org: '', contact_name: '', contact_phone: '',
  location: '', planned_date: date, priority: 'normal', expected_outcome: '',
});

/** A zonal officer plans a day, a week or a custom period (spec 4.12). */
export default function PlanFormPage() {
  const navigate = useNavigate();
  const { profile, zoneIds } = useAuth();
  const { data: taskTypes } = useTaskTypes();
  const { data: zones } = useZones();
  const [labels, setLabels] = useState<Record<number, { customer?: string; lead?: string }>>({});

  const today = isoDate();
  const form = useForm<FieldValues>({
    resolver: zodResolver(planSchema),
    defaultValues: {
      title: `Plan for ${formatDate(today)}`, period_type: 'day', start_date: today, end_date: today,
      zone_id: zoneIds[0] ?? '', notes: '', tasks: [emptyTask(today)],
    } as unknown as FieldValues,
  });
  const tasks = useFieldArray({ control: form.control, name: 'tasks' });
  const values = form.watch() as PlanForm;

  // Keep the end date in step with the period type.
  useEffect(() => {
    if (values.period_type === 'day') form.setValue('end_date', values.start_date);
    else if (values.period_type === 'week') form.setValue('end_date', isoDate(addDays(new Date(values.start_date), 6)));
  }, [values.period_type, values.start_date, form]);

  const save = useAction(async (v: PlanForm) => {
    const plan = check(await supabase.from('task_plans').insert(nullify({
      officer_id: profile?.id, zone_id: v.zone_id || null, title: v.title, period_type: v.period_type,
      start_date: v.start_date, end_date: v.end_date, notes: v.notes || null,
    })).select('id').single()) as { id: string };

    check(await supabase.from('tasks').insert(v.tasks.map((t) => nullify({
      plan_id: plan.id, officer_id: profile?.id, zone_id: v.zone_id || null,
      task_type_id: t.task_type_id, title: t.title,
      customer_id: t.customer_id || null, lead_id: t.lead_id || null,
      target_org: t.target_org || null, contact_name: t.contact_name || null, contact_phone: t.contact_phone || null,
      location: t.location || null, planned_date: t.planned_date, priority: t.priority,
      expected_outcome: t.expected_outcome || null,
    }))));
    return plan.id;
  }, {
    success: 'Plan saved',
    invalidate: [['my-tasks'], ['zonal-board']],
    onSuccess: () => navigate('/zonal/my-tasks'),
  });

  const onSubmitForm = form.handleSubmit((v) => save.mutate(v as PlanForm));
  const errors = form.formState.errors;
  const tasksError = errors.tasks as unknown as { message?: string } | undefined;

  return (
    <div>
      <PageHeader back="/zonal/my-tasks" title="New task plan" subtitle="Plan your visits, meetings and collections"
        actions={<Button size="lg" icon={<Save className="h-5 w-5" />} loading={save.isPending} onClick={onSubmitForm}>Save plan</Button>} />

      <div className="space-y-4">
        <Card title="The plan">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input className="sm:col-span-2" label="Title" required error={errors.title?.message as string | undefined} {...form.register('title')} />
            <Select label="Period" required options={[
              { value: 'day', label: 'One day' }, { value: 'week', label: 'One week' }, { value: 'custom', label: 'Custom dates' },
            ]} {...form.register('period_type')} />
            <Select label="Zone" options={toOptions(zones, (z) => z.name)} placeholder="—" {...form.register('zone_id')} />
            <Input label="Start date" type="date" required error={errors.start_date?.message as string | undefined} {...form.register('start_date')} />
            <Input label="End date" type="date" required disabled={values.period_type !== 'custom'}
              error={errors.end_date?.message as string | undefined} {...form.register('end_date')} />
            <Textarea className="sm:col-span-2" label="Notes" {...form.register('notes')} />
          </div>
        </Card>

        <Card title={`Tasks (${tasks.fields.length})`}
          actions={<Button variant="secondary" size="lg" icon={<Plus className="h-5 w-5" />}
            onClick={() => tasks.append(emptyTask(values.start_date))}>Add task</Button>}>
          {tasksError?.message ? <p role="alert" className="mb-2 text-sm text-red-600">{tasksError.message}</p> : null}
          <div className="space-y-4">
            {tasks.fields.map((field, i) => (
              <div key={field.id as string} className="rounded-xl border border-stone-200 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-medium text-stone-700">Task {i + 1}</span>
                  {tasks.fields.length > 1 ? (
                    <Button variant="ghost" size="sm" aria-label="Remove task" onClick={() => tasks.remove(i)}><Trash2 className="h-4 w-4" /></Button>
                  ) : null}
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Input className="sm:col-span-2" label="What are you doing?" required
                    placeholder="e.g. Meet the AMA sanitation officer" {...form.register(`tasks.${i}.title`)} />
                  <Select label="Type" required options={toOptions(taskTypes, (t) => t.name)} placeholder="Choose…" {...form.register(`tasks.${i}.task_type_id`)} />
                  <Input label="Date" type="date" required {...form.register(`tasks.${i}.planned_date`)} />
                  <Input label="Organisation" placeholder="MMDA, association or business" {...form.register(`tasks.${i}.target_org`)} />
                  <Input label="Location" placeholder="Where you are going" {...form.register(`tasks.${i}.location`)} />
                  <Input label="Contact person" {...form.register(`tasks.${i}.contact_name`)} />
                  <Input label="Contact phone" type="tel" placeholder="024 412 3456" {...form.register(`tasks.${i}.contact_phone`)} />
                  <AsyncPicker label="Existing customer" queryKey={`cust-task-${i}`} value={values.tasks?.[i]?.customer_id || null}
                    valueLabel={labels[i]?.customer ?? null}
                    onChange={(cid, item) => {
                      form.setValue(`tasks.${i}.customer_id`, cid ?? '');
                      setLabels((l) => ({ ...l, [i]: { ...l[i], customer: item?.label } }));
                    }}
                    search={searchCustomers} placeholder="Not an existing customer" />
                  <AsyncPicker label="Existing lead" queryKey={`lead-task-${i}`} value={values.tasks?.[i]?.lead_id || null}
                    valueLabel={labels[i]?.lead ?? null}
                    onChange={(lid, item) => {
                      form.setValue(`tasks.${i}.lead_id`, lid ?? '');
                      setLabels((l) => ({ ...l, [i]: { ...l[i], lead: item?.label } }));
                    }}
                    search={searchLeads} placeholder="Not an existing lead" />
                  <Select label="Priority" options={[
                    { value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }, { value: 'urgent', label: 'Urgent' },
                  ]} {...form.register(`tasks.${i}.priority`)} />
                  <Textarea className="sm:col-span-2" label="What do you expect to come out of it?" {...form.register(`tasks.${i}.expected_outcome`)} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <p className="mt-4 text-xs text-stone-500">
        You can update each task through the day, check in with GPS at the site, and attach photos as evidence.
      </p>
    </div>
  );
}
