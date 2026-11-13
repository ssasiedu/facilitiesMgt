import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Star } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Textarea } from '@/components/ui/Textarea';
import { PublicError, PublicLoading, PublicShell } from './PublicShell';
import { ensureSignedOut, getPublicSurvey, submitPublicSurvey, type SurveyAnswer, type SurveyQuestion } from './publicApi';

type Value = { rating?: number; choice?: string; bool_value?: boolean; text_value?: string };

/** Star rating with large, finger-sized targets (customers answer on cheap phones). */
function Stars({ value, onChange }: { value: number | undefined; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1.5" role="radiogroup">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`}
          onClick={() => onChange(n)}
          className={cn('flex h-12 w-12 items-center justify-center rounded-lg border transition',
            value !== undefined && n <= value ? 'border-amber-400 bg-amber-50 text-amber-500' : 'border-stone-300 bg-white text-stone-300 hover:border-stone-400')}>
          <Star className="h-7 w-7" fill={value !== undefined && n <= value ? 'currentColor' : 'none'} />
        </button>
      ))}
    </div>
  );
}

function Nps({ value, onChange }: { value: number | undefined; onChange: (v: number) => void }) {
  return (
    <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-11" role="radiogroup">
      {Array.from({ length: 11 }, (_, n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} onClick={() => onChange(n)}
          className={cn('min-h-tap rounded-lg border text-sm font-medium transition',
            value === n ? 'border-brand-600 bg-brand-600 text-white' : 'border-stone-300 bg-white text-stone-700 hover:border-stone-400')}>
          {n}
        </button>
      ))}
    </div>
  );
}

/** Public survey page: opens from the receipt link, no login, one response per link. */
export default function PublicSurvey() {
  const { token = '' } = useParams<{ token: string }>();
  const [answers, setAnswers] = useState<Record<string, Value>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => { void ensureSignedOut(); }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: ['public-survey', token],
    queryFn: () => getPublicSurvey(token),
    retry: 0,
  });

  if (isLoading) return <PublicLoading />;
  if (error || !data) return <PublicError message={(error as Error)?.message ?? 'Survey not found.'} />;

  const company = { name: data.company?.name, logo_url: data.company?.logo_url, brand_color: data.company?.brand_color };

  if (data.state === 'not_found') return <PublicError message="This survey link is not valid." />;
  if (data.state === 'expired') return <PublicError message="This survey link has expired. Thank you all the same — please tell our team directly if you have feedback." />;
  if (data.state === 'responded' || done) {
    return (
      <PublicShell company={company} title={data.survey?.name}>
        <div className="flex flex-col items-center py-8 text-center">
          <CheckCircle2 className="mb-3 h-12 w-12 text-emerald-600" />
          <h1 className="text-lg font-semibold text-stone-900">Thank you</h1>
          <p className="mt-1 max-w-sm text-sm text-stone-600">
            {done ?? data.survey?.thank_you_text ?? 'Your feedback has been recorded. We appreciate you taking the time.'}
          </p>
        </div>
      </PublicShell>
    );
  }

  const survey = data.survey;
  if (!survey) return <PublicError message="This survey is no longer available." />;

  const set = (id: string, v: Value) => {
    setAnswers((prev) => ({ ...prev, [id]: { ...prev[id], ...v } }));
    setFormError(null);
  };

  const isAnswered = (q: SurveyQuestion) => {
    const a = answers[q.id];
    if (!a) return false;
    return a.rating !== undefined || (a.choice ?? '') !== '' || a.bool_value !== undefined || (a.text_value ?? '').trim() !== '';
  };

  const submit = async () => {
    const missing = survey.questions.find((q) => q.required && !isAnswered(q));
    if (missing) {
      setFormError(`Please answer: ${missing.text}`);
      document.getElementById(`q-${missing.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setSubmitting(true);
    try {
      const payload: SurveyAnswer[] = survey.questions
        .filter((q) => isAnswered(q))
        .map((q) => ({
          question_id: q.id,
          rating: answers[q.id]?.rating ?? null,
          choice: answers[q.id]?.choice ?? null,
          bool_value: answers[q.id]?.bool_value ?? null,
          text_value: answers[q.id]?.text_value ?? null,
        }));
      const res = await submitPublicSurvey(token, payload);
      setDone(res.thank_you ?? survey.thank_you_text ?? 'Your feedback has been recorded.');
    } catch (e) {
      setFormError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PublicShell company={company} title={survey.name}>
      <h1 className="text-lg font-semibold text-stone-900">
        {data.customer_name ? `Hello ${data.customer_name},` : 'Hello,'}
      </h1>
      {survey.intro_text ? <p className="mt-1 text-sm text-stone-600">{survey.intro_text}</p> : null}

      <div className="mt-6 space-y-7">
        {survey.questions.map((q, i) => {
          const a = answers[q.id];
          return (
            <div key={q.id} id={`q-${q.id}`}>
              <p className="mb-2 text-sm font-medium text-stone-800">
                {i + 1}. {q.text}{q.required ? <span className="ml-0.5 text-red-600" aria-hidden>*</span> : null}
              </p>
              {q.type === 'star' ? <Stars value={a?.rating} onChange={(v) => set(q.id, { rating: v })} /> : null}
              {q.type === 'nps' ? (
                <>
                  <Nps value={a?.rating} onChange={(v) => set(q.id, { rating: v })} />
                  <p className="mt-1 flex justify-between text-xs text-stone-500"><span>Not at all likely</span><span>Extremely likely</span></p>
                </>
              ) : null}
              {q.type === 'choice' ? (
                <div className="flex flex-col gap-2">
                  {(q.options ?? []).map((opt) => (
                    <button key={opt} type="button" onClick={() => set(q.id, { choice: opt })}
                      className={cn('min-h-tap rounded-lg border px-4 text-left text-sm transition',
                        a?.choice === opt ? 'border-brand-600 bg-brand-50 font-medium text-brand-700' : 'border-stone-300 bg-white hover:border-stone-400')}>
                      {opt}
                    </button>
                  ))}
                </div>
              ) : null}
              {q.type === 'bool' ? (
                <div className="flex gap-2">
                  {[['Yes', true], ['No', false]].map(([label, val]) => (
                    <button key={String(label)} type="button" onClick={() => set(q.id, { bool_value: val as boolean })}
                      className={cn('min-h-tap flex-1 rounded-lg border text-sm transition',
                        a?.bool_value === val ? 'border-brand-600 bg-brand-50 font-medium text-brand-700' : 'border-stone-300 bg-white hover:border-stone-400')}>
                      {label as string}
                    </button>
                  ))}
                </div>
              ) : null}
              {q.type === 'text' ? (
                <Textarea rows={3} value={a?.text_value ?? ''} aria-label={q.text}
                  placeholder="Type here (optional)" onChange={(e) => set(q.id, { text_value: e.target.value })} />
              ) : null}
            </div>
          );
        })}
      </div>

      {formError ? <p role="alert" className="mt-5 rounded-lg bg-red-50 p-3 text-sm text-red-700">{formError}</p> : null}

      <Button className="mt-6 w-full" size="lg" loading={submitting} onClick={submit}>Send my feedback</Button>
      <p className="mt-2 text-center text-xs text-stone-500">You can only submit this once.</p>
    </PublicShell>
  );
}
