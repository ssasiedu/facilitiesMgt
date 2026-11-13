import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { check } from '@/lib/rpc';
import { useStaff, toOptions } from '@/lib/lookups';
import { formatDateTime, humanize, isoDate } from '@/lib/format';
import { exportXlsx } from '@/lib/export';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { FilterSelect } from '@/components/ui/DataTable';
import { DateRange } from '@/components/ui/DateRange';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { SettingsTabs } from './SettingsTabs';
import type { Tables } from '@/types/database';

// The audit log deliberately has no foreign key to profiles: entries must outlive the person's
// record. Names are therefore resolved here from a separate lookup.
type Entry = Tables<'audit_log'>;

const ACTION_TONE: Record<string, 'green' | 'blue' | 'red' | 'grey'> = {
  INSERT: 'green', UPDATE: 'blue', DELETE: 'red',
};

/** Rows are JSON snapshots; compare them field by field so a change is readable at a glance. */
function diff(oldV: Record<string, unknown> | null, newV: Record<string, unknown> | null) {
  const keys = [...new Set([...Object.keys(oldV ?? {}), ...Object.keys(newV ?? {})])].sort();
  return keys
    .map((k) => ({ key: k, before: oldV?.[k], after: newV?.[k] }))
    .filter((r) => JSON.stringify(r.before ?? null) !== JSON.stringify(r.after ?? null));
}

const show = (v: unknown) => v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);

/** Who changed what, when (spec 4.14). The log itself can never be edited, only read. */
export default function AuditLogPage() {
  const { data: staff } = useStaff();
  const [table, setTable] = useState('');
  const [action, setAction] = useState('');
  const [who, setWho] = useState('');
  const [record, setRecord] = useState('');
  const [from, setFrom] = useState(isoDate(new Date(Date.now() - 6 * 86_400_000)));
  const [to, setTo] = useState(isoDate());
  const [limit, setLimit] = useState(200);
  const [open, setOpen] = useState<Entry | null>(null);

  const { data: names = {} } = useQuery({
    queryKey: ['audit-people'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const rows = check(await supabase.from('profiles').select('id, full_name')) as { id: string; full_name: string }[];
      return Object.fromEntries(rows.map((r) => [r.id, r.full_name])) as Record<string, string>;
    },
  });
  const personName = (e: Entry) => (e.changed_by ? names[e.changed_by] : null) ?? e.changed_by_user ?? null;

  const { data: tables = [] } = useQuery({
    queryKey: ['audit-tables'],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const rows = check(await supabase.from('audit_log').select('table_name').limit(2000)) as { table_name: string }[];
      return [...new Set(rows.map((r) => r.table_name))].sort();
    },
  });

  const { data = [], isLoading } = useQuery({
    queryKey: ['audit_log', from, to, table, action, who, record, limit],
    queryFn: async () => {
      let q = supabase.from('audit_log')
        .select('*')
        .gte('changed_at', `${from}T00:00:00Z`).lte('changed_at', `${to}T23:59:59Z`)
        .order('changed_at', { ascending: false }).limit(limit);
      if (table) q = q.eq('table_name', table);
      if (action) q = q.eq('action', action);
      if (who) q = q.eq('changed_by', who);
      if (record.trim()) q = q.eq('record_id', record.trim());
      return check(await q) as Entry[];
    },
  });

  const changes = useMemo(() => open ? diff(
    open.old_values as Record<string, unknown> | null,
    open.new_values as Record<string, unknown> | null,
  ) : [], [open]);

  const exportExcel = () => exportXlsx(data, [
    { header: 'When', value: (e: Entry) => formatDateTime(e.changed_at) },
    { header: 'Who', value: (e: Entry) => personName(e) ?? 'System' },
    { header: 'Action', value: (e: Entry) => e.action },
    { header: 'Table', value: (e: Entry) => e.table_name },
    { header: 'Record', value: (e: Entry) => e.record_id ?? '' },
    { header: 'Changed fields', value: (e: Entry) => diff(e.old_values as Record<string, unknown> | null, e.new_values as Record<string, unknown> | null).map((c) => c.key).join(', ') },
    { header: 'Database role', value: (e: Entry) => e.db_role ?? '' },
  ], `audit-log-${from}-to-${to}`);

  return (
    <div>
      <PageHeader title="Settings" subtitle="Every change to every record, kept permanently"
        actions={<Button variant="secondary" size="sm" icon={<Download className="h-4 w-4" />} disabled={!data.length} onClick={exportExcel}>Excel</Button>} />
      <SettingsTabs />

      <Card className="mt-4">
        <div className="flex flex-wrap items-end gap-2">
          <DateRange presets from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
          <FilterSelect label="Table" value={table} onChange={setTable} options={tables.map((t) => ({ value: t, label: humanize(t) }))} />
          <FilterSelect label="Action" value={action} onChange={setAction}
            options={[{ value: 'INSERT', label: 'Created' }, { value: 'UPDATE', label: 'Changed' }, { value: 'DELETE', label: 'Deleted' }]} />
          <FilterSelect label="Person" value={who} onChange={setWho} options={toOptions(staff, (s) => s.full_name)} />
          <Input label="Record ID" className="w-64" value={record} onChange={(e) => setRecord(e.target.value)}
            placeholder="Paste a record's ID to follow its whole history" />
        </div>
      </Card>

      {isLoading ? <Spinner /> : !data.length ? (
        <div className="mt-4">
          <EmptyState icon={<ShieldCheck className="h-6 w-6" />} title="Nothing in this period"
            message="Widen the dates or clear the filters." />
        </div>
      ) : (
        <Card className="mt-4" bodyClassName="p-0">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">When</th>
                  <th scope="col" className="px-3 py-2 font-medium">Who</th>
                  <th scope="col" className="px-3 py-2 font-medium">Action</th>
                  <th scope="col" className="px-3 py-2 font-medium">Record</th>
                  <th scope="col" className="hidden px-3 py-2 font-medium lg:table-cell">Fields changed</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {data.map((e) => {
                  const fields = diff(e.old_values as Record<string, unknown> | null, e.new_values as Record<string, unknown> | null);
                  return (
                    <tr key={e.id}>
                      <td className="whitespace-nowrap px-3 py-2 text-stone-600">{formatDateTime(e.changed_at)}</td>
                      <td className="px-3 py-2">
                        {personName(e) ?? <span className="text-stone-500">System</span>}
                        {e.db_role && e.db_role !== 'authenticated' ? <Badge tone="grey" className="ml-1">{e.db_role}</Badge> : null}
                      </td>
                      <td className="px-3 py-2"><Badge tone={ACTION_TONE[e.action] ?? 'grey'}>{humanize(e.action.toLowerCase())}</Badge></td>
                      <td className="px-3 py-2">
                        <span className="font-medium">{humanize(e.table_name)}</span>
                        <span className="block font-mono text-xs text-stone-400">{e.record_id?.slice(0, 8) ?? '—'}</span>
                      </td>
                      <td className="hidden max-w-sm truncate px-3 py-2 text-xs text-stone-600 lg:table-cell">
                        {fields.length ? fields.map((f) => humanize(f.key)).join(', ') : '—'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setOpen(e)}>Details</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between p-3">
            <p className="text-xs text-stone-500">Showing the {data.length} most recent entries in this period.</p>
            {data.length === limit ? (
              <Button variant="secondary" size="sm" onClick={() => setLimit(limit + 200)}>Show more</Button>
            ) : null}
          </div>
        </Card>
      )}

      <Modal open={open !== null} onClose={() => setOpen(null)} title="Audit entry" size="lg"
        footer={<Button variant="secondary" onClick={() => setOpen(null)}>Close</Button>}>
        {open ? (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div><dt className="text-xs uppercase tracking-wide text-stone-500">When</dt><dd>{formatDateTime(open.changed_at)}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-stone-500">Who</dt>
                <dd>{personName(open) ?? 'System'}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-stone-500">Action</dt><dd>{humanize(open.action.toLowerCase())}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-stone-500">Table</dt><dd>{humanize(open.table_name)}</dd></div>
              <div className="col-span-2"><dt className="text-xs uppercase tracking-wide text-stone-500">Record ID</dt>
                <dd className="break-all font-mono text-xs">{open.record_id ?? '—'}</dd></div>
            </dl>

            {changes.length ? (
              <div className="overflow-x-auto rounded-lg border border-stone-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Field</th>
                      <th scope="col" className="px-3 py-2 font-medium">Before</th>
                      <th scope="col" className="px-3 py-2 font-medium">After</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {changes.map((c) => (
                      <tr key={c.key}>
                        <td className="px-3 py-2 font-medium">{humanize(c.key)}</td>
                        <td className="max-w-xs break-words px-3 py-2 text-red-700">{show(c.before)}</td>
                        <td className="max-w-xs break-words px-3 py-2 text-emerald-700">{show(c.after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <p className="text-sm text-stone-600">No field-level differences were recorded for this entry.</p>}

            {open.record_id ? (
              <Button variant="secondary" size="sm" onClick={() => { setRecord(open.record_id ?? ''); setOpen(null); }}>
                Show everything that happened to this record
              </Button>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
