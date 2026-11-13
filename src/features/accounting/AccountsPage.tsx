import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BookOpen } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { check } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { useServices, toOptions } from '@/lib/lookups';
import { humanize } from '@/lib/format';
import { CrudPage, type CrudField } from '@/components/ui/CrudPage';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { enumOptions } from '@/components/ui/Select';
import { FilterSelect, type Column } from '@/components/ui/DataTable';
import type { Tables } from '@/types/database';
import { z } from 'zod';

type Account = Tables<'accounts'>;

const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;

const accountSchema = z.object({
  code: z.string().trim().min(1, 'Code is required'),
  name: z.string().trim().min(1, 'Name is required'),
  account_type: z.enum(ACCOUNT_TYPES),
  subtype: z.string().trim().optional().or(z.literal('')),
  parent_id: z.string().uuid().optional().or(z.literal('')),
  service_id: z.string().uuid().optional().or(z.literal('')),
  description: z.string().trim().optional().or(z.literal('')),
  is_active: z.boolean(),
});

const TONE: Record<string, 'green' | 'red' | 'blue' | 'amber' | 'purple'> = {
  asset: 'blue', liability: 'amber', equity: 'purple', income: 'green', expense: 'red',
};

/** Chart of accounts (spec 4.10). Seeded for a Ghana SME; system accounts cannot be deleted. */
export default function AccountsPage() {
  const { roles } = useAuth();
  const canEdit = hasAny(roles, 'accountant');
  const [type, setType] = useState('');
  const { data: services } = useServices(true);

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts-all'],
    queryFn: async () => check(await supabase.from('accounts').select('id, code, name').order('code')) as { id: string; code: string; name: string }[],
  });

  const fields: CrudField[] = [
    { name: 'code', label: 'Code', required: true, hint: 'Keep the numbering tidy: 1xxx assets, 2xxx liabilities, 4xxx income, 5xxx and 6xxx expenses' },
    { name: 'name', label: 'Name', required: true },
    { name: 'account_type', label: 'Type', type: 'select', required: true, options: enumOptions(ACCOUNT_TYPES) },
    { name: 'subtype', label: 'Subtype', placeholder: 'cash, bank, receivable, direct, overhead…' },
    { name: 'parent_id', label: 'Parent account', type: 'select', options: accounts.map((a) => ({ value: a.id, label: `${a.code} · ${a.name}` })) },
    { name: 'service_id', label: 'Service revenue for', type: 'select', options: toOptions(services, (s) => s.name),
      hint: 'Links an income account to a service, so revenue reports split by service' },
    { name: 'description', label: 'Description', type: 'textarea' },
    { name: 'is_active', label: 'Active', type: 'checkbox' },
  ];

  const columns: Column<Account>[] = [
    { key: 'code', header: 'Code', sort: 'code', render: (r) => <span className="font-mono text-xs">{r.code}</span>, exportValue: (r) => r.code },
    { key: 'name', header: 'Account', sort: 'name', render: (r) => <span className="font-medium">{r.name}</span>, exportValue: (r) => r.name },
    { key: 'type', header: 'Type', sort: 'account_type', render: (r) => <Badge tone={TONE[r.account_type] ?? 'grey'}>{humanize(r.account_type)}</Badge>, exportValue: (r) => r.account_type },
    { key: 'subtype', header: 'Subtype', render: (r) => (r.subtype ? humanize(r.subtype) : '—'), exportValue: (r) => r.subtype, hideOnMobile: true },
    { key: 'system', header: 'System', render: (r) => (r.is_system ? <Badge tone="grey">Built in</Badge> : <span className="text-stone-400">—</span>),
      exportValue: (r) => r.is_system, hideOnMobile: true },
    { key: 'active', header: 'Status', render: (r) => <Badge tone={r.is_active ? 'green' : 'grey'}>{r.is_active ? 'Active' : 'Inactive'}</Badge>, exportValue: (r) => r.is_active },
  ];

  return (
    <>
      <CrudPage<Account>
        title="Chart of accounts"
        subtitle="Every financial event posts to these accounts through the posting rules"
        table="accounts"
        schema={accountSchema}
        fields={fields}
        columns={columns}
        searchColumns={['code', 'name', 'subtype']}
        defaultSort={{ column: 'code', ascending: true }}
        canEdit={canEdit}
        filters={useMemo(() => ({ account_type: type }), [type])}
        exportName="chart-of-accounts"
        defaultValues={{ code: '', name: '', account_type: 'expense', subtype: '', parent_id: '', service_id: '', description: '', is_active: true }}
      />
      <Card className="mt-4" title="Filter">
        <FilterSelect label="Type" value={type} onChange={setType} options={ACCOUNT_TYPES.map((t) => ({ value: t, label: humanize(t) }))} />
      </Card>
      <Card className="mt-4" title="How posting works">
        <p className="flex items-start gap-2 text-sm text-stone-600">
          <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-stone-400" />
          Nothing is posted by hand for day-to-day work. Each event — a job approved, an invoice issued, a payment
          received, stock issued, fuel bought — looks up its accounts in the posting rules and writes a balanced journal.
          Change where an event posts under Finance &gt; Posting rules rather than editing journals.
        </p>
        {!canEdit ? <p className="mt-2 text-xs text-stone-500">Only an Accountant can add or change accounts.</p> : null}
      </Card>
    </>
  );
}
