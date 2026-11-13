import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GripVertical, Plus, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { check, friendlyError } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { useServices } from '@/lib/lookups';
import { useSettings } from '@/lib/settings';
import { humanize } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Checkbox } from '@/components/ui/Checkbox';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import type { Tables } from '@/types/database';

type Survey = Tables<'surveys'> & { survey_questions: Tables<'survey_questions'>[] };

const QUESTION_TYPES = [
  { value: 'star', label: 'Star rating (1–5)' },
  { value: 'nps', label: 'NPS (0–10)' },
  { value: 'choice', label: 'Multiple choice' },
  { value: 'bool', label: 'Yes / no' },
  { value: 'text', label: 'Free text' },
];

/** Survey builder (spec 4.11). The default survey goes out with every receipt. */
export default function SurveysPage() {
  const qc = useQueryClient();
  const { roles } = useAuth();
  const settings = useSettings();
  const canEdit = hasAny(roles, 'manager');
  const { data: services } = useServices(true);

  const [surveyOpen, setSurveyOpen] = useState(false);
  const [editing, setEditing] = useState<Survey | null>(null);
  const [form, setForm] = useState({ name: '', description: '', intro_text: '', thank_you_text: '', is_default: false, active: true, service_ids: [] as string[] });
  const [saving, setSaving] = useState(false);
  const [question, setQuestion] = useState<{ surveyId: string; question_type: string; question_text: string; metric_key: string; required: boolean; options: string } | null>(null);

  const { data = [], isLoading, refetch } = useQuery({
    queryKey: ['surveys'],
    queryFn: async () => check(await supabase.from('surveys')
      .select('*, survey_questions(*)').is('archived_at', null).order('created_at')) as Survey[],
  });

  const openSurvey = (s: Survey | null) => {
    setEditing(s);
    setForm(s ? {
      name: s.name, description: s.description ?? '', intro_text: s.intro_text ?? '', thank_you_text: s.thank_you_text ?? '',
      is_default: s.is_default, active: s.active, service_ids: s.service_ids ?? [],
    } : { name: '', description: '', intro_text: '', thank_you_text: '', is_default: false, active: true, service_ids: [] });
    setSurveyOpen(true);
  };

  const saveSurvey = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      if (editing) check(await supabase.from('surveys').update(form).eq('id', editing.id));
      else check(await supabase.from('surveys').insert(form));
      toast.success('Survey saved');
      setSurveyOpen(false);
      await refetch();
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  };

  const addQuestion = async () => {
    if (!question || !question.question_text.trim()) { toast.error('Question text is required'); return; }
    const survey = data.find((s) => s.id === question.surveyId);
    const position = (survey?.survey_questions.length ?? 0) + 1;
    const { error } = await supabase.from('survey_questions').insert({
      survey_id: question.surveyId, position, question_type: question.question_type,
      question_text: question.question_text, metric_key: question.metric_key || null, required: question.required,
      options: question.question_type === 'choice' ? question.options.split('\n').map((o) => o.trim()).filter(Boolean) : [],
    });
    if (error) { toast.error(friendlyError(error)); return; }
    setQuestion(null);
    await qc.invalidateQueries({ queryKey: ['surveys'] });
  };

  const removeQuestion = async (id: string) => {
    const { error } = await supabase.from('survey_questions').delete().eq('id', id);
    if (error) toast.error(friendlyError(error)); else await qc.invalidateQueries({ queryKey: ['surveys'] });
  };

  if (isLoading) return <Spinner />;

  return (
    <div>
      <PageHeader title="Surveys" subtitle="What you ask customers after every payment"
        actions={canEdit ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => openSurvey(null)}>New survey</Button> : null} />

      <Card className="mb-4" title="How surveys are sent">
        <p className="text-sm text-stone-600">
          Recording a payment creates a receipt, and the receipt message carries a survey link with a token unique to
          that job and invoice. The link needs no login, accepts one response and expires after
          {' '}{settings?.survey_expiry_days ?? 30} days. A score of {settings?.survey_low_score ?? 2} or less, or an NPS
          of {settings?.survey_low_nps ?? 6} or less, raises a follow-up task for the Manager.
        </p>
      </Card>

      {!data.length ? (
        <EmptyState icon={<Star className="h-6 w-6" />} title="No surveys yet"
          action={canEdit ? <Button onClick={() => openSurvey(null)}>Create one</Button> : undefined} />
      ) : (
        <div className="space-y-4">
          {data.map((s) => (
            <Card key={s.id}
              title={<span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-stone-800">{s.name}</span>
                {s.is_default ? <Badge tone="green">Default</Badge> : null}
                {!s.active ? <Badge tone="grey">Inactive</Badge> : null}
                {(s.service_ids ?? []).length ? <Badge tone="brand">{(s.service_ids ?? []).length} service(s) only</Badge> : <Badge tone="grey">All services</Badge>}
              </span>}
              actions={canEdit ? <>
                <Button variant="secondary" size="sm" onClick={() => openSurvey(s)}>Edit</Button>
                <Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" />}
                  onClick={() => setQuestion({ surveyId: s.id, question_type: 'star', question_text: '', metric_key: '', required: true, options: '' })}>Question</Button>
              </> : null}>
              {s.description ? <p className="mb-3 text-sm text-stone-600">{s.description}</p> : null}
              <ol className="divide-y divide-stone-100">
                {[...s.survey_questions].sort((a, b) => a.position - b.position).map((q) => (
                  <li key={q.id} className="flex items-start justify-between gap-2 py-2">
                    <div className="flex min-w-0 items-start gap-2">
                      <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-stone-300" />
                      <div className="min-w-0">
                        <p className="text-sm text-stone-800">
                          {q.position}. {q.question_text}
                          {q.required ? <span className="ml-1 text-red-600" aria-hidden>*</span> : null}
                        </p>
                        <p className="text-xs text-stone-500">
                          {QUESTION_TYPES.find((t) => t.value === q.question_type)?.label ?? humanize(q.question_type)}
                          {q.metric_key ? ` · reported as "${q.metric_key}"` : ''}
                        </p>
                        {Array.isArray(q.options) && q.options.length ? (
                          <p className="text-xs text-stone-500">Options: {(q.options as string[]).join(', ')}</p>
                        ) : null}
                      </div>
                    </div>
                    {canEdit ? (
                      <Button variant="ghost" size="sm" aria-label="Remove question" onClick={() => void removeQuestion(q.id)}><Trash2 className="h-4 w-4" /></Button>
                    ) : null}
                  </li>
                ))}
                {!s.survey_questions.length ? <li className="py-2 text-sm text-stone-500">No questions yet.</li> : null}
              </ol>
            </Card>
          ))}
        </div>
      )}

      <Modal open={surveyOpen} onClose={() => setSurveyOpen(false)} title={editing ? 'Edit survey' : 'New survey'} size="lg"
        footer={<><Button variant="secondary" onClick={() => setSurveyOpen(false)}>Cancel</Button>
          <Button loading={saving} onClick={() => void saveSurvey()}>Save</Button></>}>
        <div className="space-y-4">
          <Input label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Description (internal)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Textarea label="Opening text the customer sees" value={form.intro_text} onChange={(e) => setForm({ ...form, intro_text: e.target.value })} />
          <Textarea label="Thank-you text" value={form.thank_you_text} onChange={(e) => setForm({ ...form, thank_you_text: e.target.value })} />
          <div>
            <p className="mb-1 text-sm font-medium text-stone-700">Limit to certain services</p>
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-stone-200 p-2">
              {(services ?? []).map((s) => (
                <label key={s.id} className="flex min-h-[36px] items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 rounded border-stone-300 text-brand-600"
                    checked={form.service_ids.includes(s.id)}
                    onChange={(e) => setForm({
                      ...form,
                      service_ids: e.target.checked ? [...form.service_ids, s.id] : form.service_ids.filter((x) => x !== s.id),
                    })} />
                  {s.name}
                </label>
              ))}
            </div>
            <p className="mt-1 text-xs text-stone-500">Leave all unticked to use this survey for every service.</p>
          </div>
          <Checkbox label="Use as the default survey" hint="Sent with receipts when no service-specific survey matches"
            checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
          <Checkbox label="Active" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
        </div>
      </Modal>

      <Modal open={question !== null} onClose={() => setQuestion(null)} title="Add a question" size="md"
        footer={<><Button variant="secondary" onClick={() => setQuestion(null)}>Cancel</Button>
          <Button onClick={() => void addQuestion()}>Add</Button></>}>
        {question ? (
          <div className="space-y-4">
            <Select label="Type" required options={QUESTION_TYPES} value={question.question_type}
              onChange={(e) => setQuestion({ ...question, question_type: e.target.value })} />
            <Textarea label="Question" required value={question.question_text}
              onChange={(e) => setQuestion({ ...question, question_text: e.target.value })} />
            {question.question_type === 'choice' ? (
              <Textarea label="Options, one per line" value={question.options}
                onChange={(e) => setQuestion({ ...question, options: e.target.value })} rows={4} />
            ) : null}
            <Input label="Metric key" value={question.metric_key} onChange={(e) => setQuestion({ ...question, metric_key: e.target.value })}
              hint='Use "overall" for the headline satisfaction score, or leave blank' />
            <Checkbox label="Answer required" checked={question.required} onChange={(e) => setQuestion({ ...question, required: e.target.checked })} />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
