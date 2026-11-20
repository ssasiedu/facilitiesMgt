import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GripVertical, Plus, Star, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { check, friendlyError } from '@/lib/rpc';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface Option {
  id: string;
  value: string;
  label: string;
  numeric_value: number | null;
  is_default: boolean;
  sort_order: number;
}

interface Props {
  category: string;
  title: string;
  description: string;
  /** Payment terms carry a day count; a plain list does not. */
  numericLabel?: string;
  numericHint?: string;
  /** Payment terms need one entry marked as the value new customers start on. */
  allowDefault?: boolean;
  addLabel?: string;
}

/**
 * One editable dropdown list. Removing an option archives it rather than deleting it, because
 * records already carrying that value have to keep reading correctly — an archived option stays
 * out of the dropdown but still resolves on old invoices and customers.
 */
export function ListOptionsCard({ category, title, description, numericLabel, numericHint, allowDefault, addLabel }: Props) {
  const qc = useQueryClient();
  const [label, setLabel] = useState('');
  const [numeric, setNumeric] = useState('');
  const [removing, setRemoving] = useState<Option | null>(null);

  const query = useQuery({
    queryKey: ['list_options', 'manage', category],
    queryFn: async () => check(await supabase.from('list_options')
      .select('id, value, label, numeric_value, is_default, sort_order')
      .eq('category', category).is('archived_at', null)
      .order('sort_order').order('label')) as Option[],
  });

  const options = query.data ?? [];

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['list_options', 'manage', category] });
    void qc.invalidateQueries({ queryKey: ['lookup', 'list_options', category] });
  }

  /** A stable key from the label, so reports can group on it even if the wording is tidied later. */
  function slugify(text: string) {
    return text.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50);
  }

  const add = useMutation({
    mutationFn: async () => {
      const trimmed = label.trim();
      if (!trimmed) throw new Error('Give the option a name.');
      if (options.some((o) => o.label.toLowerCase() === trimmed.toLowerCase())) throw new Error(`"${trimmed}" is already on the list.`);
      const days = numericLabel ? Number(numeric) : null;
      if (numericLabel && (!Number.isFinite(days) || (days as number) < 0)) throw new Error(`Enter the ${numericLabel.toLowerCase()}.`);
      const value = slugify(trimmed) || `option_${Date.now()}`;
      check(await supabase.from('list_options').insert({
        category,
        value,
        label: trimmed,
        numeric_value: days,
        sort_order: (options.at(-1)?.sort_order ?? 0) + 10,
      }));
    },
    onSuccess: () => { setLabel(''); setNumeric(''); invalidate(); toast.success('Option added'); },
    onError: (e: unknown) => toast.error(friendlyError(e)),
  });

  const rename = useMutation({
    mutationFn: async (o: Option) => check(await supabase.from('list_options').update({ label: o.label }).eq('id', o.id)),
    onSuccess: invalidate,
    onError: (e: unknown) => toast.error(friendlyError(e)),
  });

  const archive = useMutation({
    mutationFn: async (o: Option) => check(await supabase.from('list_options')
      .update({ archived_at: new Date().toISOString(), is_default: false }).eq('id', o.id)),
    onSuccess: () => { setRemoving(null); invalidate(); toast.success('Option removed from the list'); },
    onError: (e: unknown) => toast.error(friendlyError(e)),
  });

  const makeDefault = useMutation({
    // The unique index allows one default per list, so the old one is cleared in the same step.
    mutationFn: async (o: Option) => {
      check(await supabase.from('list_options').update({ is_default: false })
        .eq('category', category).eq('is_default', true).is('archived_at', null));
      check(await supabase.from('list_options').update({ is_default: true }).eq('id', o.id));
    },
    onSuccess: () => { invalidate(); toast.success('Default set'); },
    onError: (e: unknown) => toast.error(friendlyError(e)),
  });

  const move = useMutation({
    mutationFn: async ({ index, direction }: { index: number; direction: -1 | 1 }) => {
      const a = options[index];
      const b = options[index + direction];
      if (!a || !b) return;
      check(await supabase.from('list_options').update({ sort_order: b.sort_order }).eq('id', a.id));
      check(await supabase.from('list_options').update({ sort_order: a.sort_order }).eq('id', b.id));
    },
    onSuccess: invalidate,
    onError: (e: unknown) => toast.error(friendlyError(e)),
  });

  return (
    <Card className="mt-4" title={title}>
      <p className="text-sm text-stone-600">{description}</p>

      {query.isPending ? <div className="mt-4"><Spinner /></div> : (
        <ul className="mt-4 divide-y divide-stone-100">
          {options.map((o, i) => (
            <li key={o.id} className="flex items-center gap-2 py-2">
              <div className="flex flex-col">
                <button type="button" aria-label={`Move ${o.label} up`} disabled={i === 0}
                  className="text-stone-400 hover:text-stone-700 disabled:opacity-30"
                  onClick={() => move.mutate({ index: i, direction: -1 })}>▲</button>
                <button type="button" aria-label={`Move ${o.label} down`} disabled={i === options.length - 1}
                  className="text-stone-400 hover:text-stone-700 disabled:opacity-30"
                  onClick={() => move.mutate({ index: i, direction: 1 })}>▼</button>
              </div>
              <GripVertical className="h-4 w-4 shrink-0 text-stone-300" aria-hidden />

              <input aria-label={`Name of ${o.label}`} defaultValue={o.label}
                className="min-w-0 flex-1 rounded-lg border border-transparent px-2 py-1 text-sm hover:border-stone-200 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                onBlur={(e) => {
                  const field = e.currentTarget;
                  const next = field.value.trim();
                  if (next && next !== o.label) rename.mutate({ ...o, label: next });
                  else field.value = o.label;
                }} />

              {numericLabel ? <span className="shrink-0 text-xs tabular-nums text-stone-500">{o.numeric_value ?? 0} days</span> : null}

              {allowDefault ? (
                o.is_default
                  ? <Badge tone="green" className="shrink-0">Default</Badge>
                  : <Button variant="ghost" size="sm" className="shrink-0" onClick={() => makeDefault.mutate(o)}>
                      <Star className="h-3.5 w-3.5" /> Set default
                    </Button>
              ) : null}

              <Button variant="ghost" size="sm" className="shrink-0 text-red-700" aria-label={`Remove ${o.label}`}
                onClick={() => setRemoving(o)}><Trash2 className="h-4 w-4" /></Button>
            </li>
          ))}
          {!options.length ? <li className="py-3 text-sm text-stone-500">Nothing on this list yet.</li> : null}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-stone-200 pt-3">
        <Input className="min-w-40 flex-1" label={addLabel ?? 'Add an option'} value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add.mutate(); } }} />
        {numericLabel ? (
          <Input className="w-32" label={numericLabel} type="number" min="0" value={numeric} hint={numericHint}
            onChange={(e) => setNumeric(e.target.value)} />
        ) : null}
        <Button onClick={() => add.mutate()} loading={add.isPending}><Plus className="h-4 w-4" /> Add</Button>
      </div>

      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} title="Remove this option?"
        message={`"${removing?.label ?? ''}" will no longer be offered when adding or editing records. Records already using it keep showing it, so nothing already saved changes.`}
        confirmLabel="Remove" danger onConfirm={() => { if (removing) archive.mutate(removing); }} />
    </Card>
  );
}
