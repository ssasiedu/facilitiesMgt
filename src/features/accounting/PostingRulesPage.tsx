import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, Save } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { check, friendlyError } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { useAccounts, toOptions } from '@/lib/lookups';
import { humanize } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { ErrorState } from '@/components/ui/ErrorState';
import type { Tables } from '@/types/database';

type Rule = Tables<'posting_rules'> & {
  debit_account: { code: string; name: string } | null;
  credit_account: { code: string; name: string } | null;
};

/** Posting rules (spec 4.10): which accounts each event uses, editable without touching code. */
export default function PostingRulesPage() {
  const { roles } = useAuth();
  const canEdit = hasAny(roles, 'accountant');
  const { data: accounts } = useAccounts();
  const [edits, setEdits] = useState<Record<string, { debit: string; credit: string }>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const { data = [], isLoading, error, refetch } = useQuery({
    queryKey: ['posting-rules'],
    queryFn: async () => check(await supabase.from('posting_rules')
      .select('*, debit_account:accounts!posting_rules_debit_account_id_fkey(code, name), credit_account:accounts!posting_rules_credit_account_id_fkey(code, name)')
      .order('event_code')) as Rule[],
  });

  const save = async (rule: Rule) => {
    const edit = edits[rule.event_code];
    if (!edit) return;
    setSaving(rule.event_code);
    try {
      const { error: updateError } = await supabase.from('posting_rules').update({
        debit_account_id: edit.debit || null,
        credit_account_id: edit.credit || null,
      }).eq('event_code', rule.event_code);
      if (updateError) throw new Error(friendlyError(updateError));
      toast.success(`${humanize(rule.event_code)} updated`);
      setEdits((e) => { const next = { ...e }; delete next[rule.event_code]; return next; });
      await refetch();
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(null); }
  };

  if (isLoading) return <Spinner />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;

  const options = toOptions(accounts, (a) => `${a.code} · ${a.name}`);

  return (
    <div>
      <PageHeader title="Posting rules" subtitle="Which accounts each financial event debits and credits" />

      <Card className="mb-4">
        <p className="flex items-start gap-2 text-sm text-stone-600">
          <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
          Every event in the app looks its accounts up here before writing a journal, so you can re-map a posting without
          changing any code. Some events override one side: a completed job credits the service's own revenue account when
          the service has one, and a payment debits the account the money actually landed in. The notes on each row say so.
        </p>
      </Card>

      <Card bodyClassName="p-0">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Event</th>
                <th scope="col" className="px-3 py-2 font-medium">Debit account</th>
                <th scope="col" className="px-3 py-2 font-medium">Credit account</th>
                <th scope="col" className="px-3 py-2 font-medium">Notes</th>
                {canEdit ? <th scope="col" className="px-3 py-2" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {data.map((r) => {
                const edit = edits[r.event_code];
                const dirty = !!edit;
                return (
                  <tr key={r.event_code} className={dirty ? 'bg-amber-50/60' : undefined}>
                    <td className="px-3 py-2">
                      <span className="font-medium">{humanize(r.event_code)}</span>
                      <span className="block text-xs text-stone-500">{r.description}</span>
                    </td>
                    <td className="px-3 py-2">
                      {canEdit ? (
                        <Select aria-label={`Debit account for ${r.event_code}`} options={options} placeholder="Set by the event"
                          value={edit ? edit.debit : r.debit_account_id ?? ''}
                          onChange={(e) => setEdits({ ...edits, [r.event_code]: { debit: e.target.value, credit: edit ? edit.credit : r.credit_account_id ?? '' } })} />
                      ) : (
                        r.debit_account ? `${r.debit_account.code} · ${r.debit_account.name}` : <span className="text-stone-400">Set by the event</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {canEdit ? (
                        <Select aria-label={`Credit account for ${r.event_code}`} options={options} placeholder="Set by the event"
                          value={edit ? edit.credit : r.credit_account_id ?? ''}
                          onChange={(e) => setEdits({ ...edits, [r.event_code]: { debit: edit ? edit.debit : r.debit_account_id ?? '', credit: e.target.value } })} />
                      ) : (
                        r.credit_account ? `${r.credit_account.code} · ${r.credit_account.name}` : <span className="text-stone-400">Set by the event</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-stone-500">{r.notes ?? '—'}</td>
                    {canEdit ? (
                      <td className="px-3 py-2 text-right">
                        {dirty ? (
                          <Button size="sm" icon={<Save className="h-4 w-4" />} loading={saving === r.event_code} onClick={() => void save(r)}>Save</Button>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!canEdit ? <p className="p-3 text-xs text-stone-500">Only an Accountant can change posting rules.</p> : null}
      </Card>
    </div>
  );
}
