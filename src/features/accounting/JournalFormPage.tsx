import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useFieldArray, useForm, type FieldValues } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Plus, Save, Send, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { check, nullify, rpc, useAction } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { journalSchema, type JournalForm } from '@/lib/schemas';
import { formatDate, formatGHS, humanize, isoDate, round2 } from '@/lib/format';
import { useAccounts, toOptions } from '@/lib/lookups';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, DetailList } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/ErrorState';
import type { Tables } from '@/types/database';

interface JournalFull extends Tables<'journal_entries'> {
  journal_lines: (Tables<'journal_lines'> & { account: { code: string; name: string } | null })[];
  poster: { full_name: string } | null;
}

const EMPTY_LINE = { account_id: '', description: '', debit: 0, credit: 0 };
const DEFAULTS: JournalForm = {
  entry_date: isoDate(), description: '', recur_frequency: 'none',
  lines: [EMPTY_LINE, EMPTY_LINE],
};

/** Manual journal entry (spec 4.10): must balance before it can be posted, and can recur. */
export default function JournalFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { roles } = useAuth();
  const isAccountant = hasAny(roles, 'accountant');
  const { data: accounts } = useAccounts();
  const [postOpen, setPostOpen] = useState(false);

  const form = useForm<FieldValues>({ resolver: zodResolver(journalSchema), defaultValues: DEFAULTS as unknown as FieldValues });
  const lines = useFieldArray({ control: form.control, name: 'lines' });
  const values = form.watch() as JournalForm;

  const query = useQuery({
    queryKey: ['journal', id],
    enabled: !!id,
    queryFn: async () => check(await supabase.from('journal_entries')
      .select('*, journal_lines(*, account:accounts(code, name)), poster:profiles!journal_entries_posted_by_fkey(full_name)')
      .eq('id', id as string).single()) as JournalFull,
  });

  useEffect(() => {
    const j = query.data;
    if (!j || j.status === 'posted') return;
    form.reset({
      entry_date: j.entry_date, description: j.description, recur_frequency: j.recur_frequency,
      lines: [...j.journal_lines].sort((a, b) => a.line_no - b.line_no).map((l) => ({
        account_id: l.account_id, description: l.description ?? '', debit: Number(l.debit), credit: Number(l.credit),
      })),
    } as unknown as FieldValues);
  }, [query.data, form]);

  const totals = useMemo(() => {
    const debit = (values.lines ?? []).reduce((t, l) => t + (Number(l.debit) || 0), 0);
    const credit = (values.lines ?? []).reduce((t, l) => t + (Number(l.credit) || 0), 0);
    return { debit: round2(debit), credit: round2(credit), diff: round2(debit - credit) };
  }, [values.lines]);

  const save = useAction(async (v: JournalForm) => {
    const header = nullify({ entry_date: v.entry_date, description: v.description, recur_frequency: v.recur_frequency, is_manual: true, source_type: 'manual', event_code: 'manual' });
    let entryId = id;
    if (entryId) {
      check(await supabase.from('journal_entries').update(header).eq('id', entryId));
      check(await supabase.from('journal_lines').delete().eq('entry_id', entryId));
    } else {
      const created = check(await supabase.from('journal_entries').insert(header).select('id').single()) as { id: string };
      entryId = created.id;
    }
    check(await supabase.from('journal_lines').insert(v.lines.map((l, i) => nullify({
      entry_id: entryId, line_no: i + 1, account_id: l.account_id, description: l.description || null,
      debit: Number(l.debit) || 0, credit: Number(l.credit) || 0,
    }))));
    return entryId;
  }, {
    success: 'Journal saved as a draft',
    invalidate: [['journal', id], ['table', 'journal_entries']],
    onSuccess: (entryId) => { if (!id) navigate(`/finance/journals/${entryId}`, { replace: true }); else void query.refetch(); },
  });

  const post = useAction(() => rpc('post_journal', { p_entry_id: id as string }), {
    success: 'Journal posted',
    invalidate: [['journal', id], ['table', 'journal_entries']],
    onSuccess: () => setPostOpen(false),
  });

  const onSubmitForm = form.handleSubmit((v) => save.mutate(v as JournalForm));

  if (id && query.isLoading) return <Spinner />;
  if (id && query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;

  const j = query.data;

  // A posted journal is read-only, for ever.
  if (j && j.status === 'posted') {
    return (
      <div>
        <PageHeader back="/finance/journals" title={`Journal ${j.entry_no}`}
          subtitle={<span className="flex flex-wrap items-center gap-2">
            <StatusBadge status="completed" />
            {j.event_code ? <Badge tone="brand">{humanize(j.event_code)}</Badge> : null}
            {j.reversed_by ? <Badge tone="red">Reversed</Badge> : null}
            {j.reversal_of ? <Badge tone="grey">This is a reversal</Badge> : null}
          </span>} />
        <div className="space-y-4">
          <Card title="Entry">
            <DetailList items={[
              ['Date', formatDate(j.entry_date)],
              ['Description', j.description],
              ['Source', humanize(j.source_type)],
              ['Event', j.event_code ? humanize(j.event_code) : 'Manual'],
              ['Posted by', j.poster?.full_name ?? 'System'],
              ['Total', formatGHS(j.total_debit)],
            ]} />
          </Card>
          <Card title="Lines" bodyClassName="p-0">
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">#</th>
                    <th scope="col" className="px-3 py-2 font-medium">Account</th>
                    <th scope="col" className="px-3 py-2 font-medium">Description</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Debit</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {[...j.journal_lines].sort((a, b) => a.line_no - b.line_no).map((l) => (
                    <tr key={l.id}>
                      <td className="px-3 py-2 text-stone-400">{l.line_no}</td>
                      <td className="px-3 py-2"><span className="font-mono text-xs text-stone-500">{l.account?.code}</span> {l.account?.name}</td>
                      <td className="px-3 py-2 text-stone-600">{l.description ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(l.debit) ? formatGHS(l.debit) : ''}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{Number(l.credit) ? formatGHS(l.credit) : ''}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="bg-stone-50 font-semibold">
                  <tr>
                    <td colSpan={3} className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatGHS(j.total_debit)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatGHS(j.total_credit)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>
          <p className="text-xs text-stone-500">
            Posted journals cannot be changed. To correct one, reverse it from the journals list and post a new entry.
          </p>
        </div>
      </div>
    );
  }

  const errors = form.formState.errors;
  const linesError = errors.lines as unknown as { message?: string } | undefined;

  return (
    <div>
      <PageHeader back="/finance/journals" title={j ? `Draft journal ${j.entry_no ?? ''}` : 'New journal'}
        subtitle="Debits and credits must be equal before it can be posted"
        actions={<>
          <Button variant="secondary" icon={<Save className="h-4 w-4" />} loading={save.isPending} onClick={onSubmitForm}>Save draft</Button>
          {j && isAccountant ? (
            <Button icon={<Send className="h-4 w-4" />} disabled={totals.diff !== 0} onClick={() => setPostOpen(true)}>Post</Button>
          ) : null}
        </>} />

      <div className="space-y-4">
        <Card title="Entry">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Input label="Date" type="date" required error={errors.entry_date?.message as string | undefined} {...form.register('entry_date')} />
            <Input className="sm:col-span-2" label="Description" required error={errors.description?.message as string | undefined} {...form.register('description')} />
            <Select label="Repeat" options={[
              { value: 'none', label: 'Does not repeat' }, { value: 'monthly', label: 'Every month' }, { value: 'quarterly', label: 'Every quarter' },
            ]} hint="A recurring journal is re-created automatically after posting" {...form.register('recur_frequency')} />
          </div>
        </Card>

        <Card title="Lines" actions={<Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => lines.append(EMPTY_LINE)}>Add line</Button>}>
          {linesError?.message ? <p role="alert" className="mb-2 rounded-lg bg-red-50 p-2.5 text-sm text-red-700">{linesError.message}</p> : null}
          <div className="space-y-2">
            {lines.fields.map((field, i) => (
              <div key={field.id as string} className="grid grid-cols-2 items-end gap-2 rounded-lg border border-stone-200 p-2 sm:grid-cols-12">
                <Select className="sm:col-span-5" label="Account" required options={toOptions(accounts, (a) => `${a.code} · ${a.name}`)} placeholder="Choose…"
                  {...form.register(`lines.${i}.account_id`)} />
                <Input className="sm:col-span-3" label="Description" {...form.register(`lines.${i}.description`)} />
                <Input className="sm:col-span-2" label="Debit" type="number" step="0.01" {...form.register(`lines.${i}.debit`)} />
                <Input className="sm:col-span-1" label="Credit" type="number" step="0.01" {...form.register(`lines.${i}.credit`)} />
                <div className="flex items-center justify-end sm:col-span-1">
                  {lines.fields.length > 2 ? (
                    <Button variant="ghost" size="sm" aria-label="Remove line" onClick={() => lines.remove(i)}><Trash2 className="h-4 w-4" /></Button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

          <dl className="mt-4 ml-auto w-full max-w-xs space-y-1.5 text-sm">
            <div className="flex justify-between"><dt className="text-stone-600">Total debits</dt><dd className="tabular-nums">{formatGHS(totals.debit)}</dd></div>
            <div className="flex justify-between"><dt className="text-stone-600">Total credits</dt><dd className="tabular-nums">{formatGHS(totals.credit)}</dd></div>
            <div className="flex items-center justify-between border-t border-stone-200 pt-1.5">
              <dt className="font-medium">Difference</dt>
              <dd>{totals.diff === 0 ? <Badge tone="green">Balanced</Badge> : <Badge tone="red">{formatGHS(totals.diff)}</Badge>}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-stone-500">
            Each line carries either a debit or a credit, never both. The database checks this again before posting.
          </p>
        </Card>
      </div>

      <ConfirmDialog open={postOpen} onClose={() => setPostOpen(false)} title="Post this journal?"
        confirmLabel="Post" loading={post.isPending} onConfirm={() => post.mutate()}
        message="Once posted, the entry cannot be edited or deleted — only reversed. It takes effect in the ledger and the reports immediately." />
    </div>
  );
}
