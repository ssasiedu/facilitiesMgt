import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Columns3, List, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { check } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { canEdit } from '@/lib/permissions';
import { useServerTable } from '@/lib/useServerTable';
import { displayPhone, formatDate, formatGHS, humanize, isoDate } from '@/lib/format';
import { cn } from '@/lib/cn';
import { PageHeader } from '@/components/ui/PageHeader';
import { Button } from '@/components/ui/Button';
import { DataTable, FilterSelect, type Column } from '@/components/ui/DataTable';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Spinner } from '@/components/ui/Spinner';
import { LeadFormModal, STAGES } from './LeadFormModal';
import type { Tables } from '@/types/database';

type Lead = Tables<'leads'> & { service: { name: string } | null; owner: { full_name: string } | null };

export default function LeadsPage() {
  const { roles } = useAuth();
  const qc = useQueryClient();
  const [view, setView] = useState<'board' | 'list'>('board');
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState('');
  const editable = canEdit(roles, 'leads');
  const select = '*, service:services(name), owner:profiles!leads_owner_id_fkey(full_name)';
  const board = useQuery({
    queryKey: ['leads-board'], enabled: view === 'board',
    queryFn: async () => check(await supabase.from('leads').select(select).is('archived_at', null).order('next_follow_up', { ascending: true, nullsFirst: false }).limit(500)) as Lead[],
  });
  const filters = useMemo(() => ({ stage, 'is:archived_at': 'null' }), [stage]);
  const table = useServerTable<Lead>({ table: 'leads', select, searchColumns: ['name', 'company_name', 'phone', 'location'], filters, enabled: view === 'list' });
  const today = isoDate();

  const move = async (lead: Lead, to: string) => {
    if (to === 'lost') { toast.info('Open the lead to record why it was lost'); return; }
    const { error } = await supabase.from('leads').update({ stage: to }).eq('id', lead.id);
    if (error) toast.error(error.message); else void qc.invalidateQueries({ queryKey: ['leads-board'] });
  };

  const columns: Column<Lead>[] = [
    { key: 'name', header: 'Lead', sort: 'name', render: (r) => <Link to={`/leads/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.name}{r.company_name ? <span className="block text-xs text-stone-500">{r.company_name}</span> : null}</Link>, exportValue: (r) => r.company_name ?? r.name },
    { key: 'phone', header: 'Phone', render: (r) => displayPhone(r.phone), exportValue: (r) => r.phone },
    { key: 'service', header: 'Service', render: (r) => r.service?.name ?? '—', exportValue: (r) => r.service?.name, hideOnMobile: true },
    { key: 'value', header: 'Est. value', sort: 'estimated_value', render: (r) => formatGHS(r.estimated_value), exportValue: (r) => r.estimated_value },
    { key: 'owner', header: 'Owner', render: (r) => r.owner?.full_name ?? '—', exportValue: (r) => r.owner?.full_name, hideOnMobile: true },
    { key: 'follow', header: 'Next follow-up', sort: 'next_follow_up', render: (r) => <span className={cn(r.next_follow_up && r.next_follow_up < today && !['won', 'lost'].includes(r.stage) && 'font-medium text-red-700')}>{formatDate(r.next_follow_up)}</span>, exportValue: (r) => r.next_follow_up },
    { key: 'stage', header: 'Stage', render: (r) => <StatusBadge status={r.stage} />, exportValue: (r) => r.stage },
  ];

  return (
    <div>
      <PageHeader title="Leads and pipeline" subtitle="From first call to won or lost"
        actions={<>
          <div className="flex rounded-lg border border-stone-300 bg-white p-0.5">
            <button type="button" aria-pressed={view === 'board'} onClick={() => setView('board')} className={cn('rounded-md px-2 py-1.5', view === 'board' && 'bg-stone-100')} aria-label="Kanban board"><Columns3 className="h-4 w-4" /></button>
            <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')} className={cn('rounded-md px-2 py-1.5', view === 'list' && 'bg-stone-100')} aria-label="List"><List className="h-4 w-4" /></button>
          </div>
          {editable ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => setOpen(true)}>New lead</Button> : null}
        </>} />
      {view === 'board' ? (
        board.isLoading ? <Spinner /> : (
          <div className="-mx-3 flex gap-3 overflow-x-auto px-3 pb-3">
            {STAGES.map((s) => {
              const items = (board.data ?? []).filter((l) => l.stage === s);
              const total = items.reduce((t, l) => t + Number(l.estimated_value), 0);
              return (
                <div key={s} className="w-72 shrink-0 rounded-xl bg-stone-100 p-2"
                  onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const lead = board.data?.find((l) => l.id === e.dataTransfer.getData('text/plain')); if (lead && lead.stage !== s) void move(lead, s); }}>
                  <div className="mb-2 flex items-center justify-between px-1"><StatusBadge status={s} /><span className="text-xs text-stone-500">{items.length} · {formatGHS(total)}</span></div>
                  <div className="space-y-2">
                    {items.map((l) => (
                      <Link key={l.id} to={`/leads/${l.id}`} draggable={editable} onDragStart={(e) => e.dataTransfer.setData('text/plain', l.id)}
                        className="block rounded-lg border border-stone-200 bg-white p-3 shadow-sm hover:border-brand-500">
                        <p className="text-sm font-medium">{l.company_name ?? l.name}</p>
                        {l.company_name ? <p className="text-xs text-stone-500">{l.name}</p> : null}
                        <p className="mt-1 text-xs text-stone-600">{l.service?.name ?? 'No service yet'} · {formatGHS(l.estimated_value)}</p>
                        {l.next_follow_up ? <p className={cn('mt-1 text-xs', l.next_follow_up < today && !['won', 'lost'].includes(l.stage) ? 'font-medium text-red-700' : 'text-stone-500')}>Follow up {formatDate(l.next_follow_up)}</p> : null}
                        <p className="mt-1 text-[11px] text-stone-400">{l.owner?.full_name ?? 'Unassigned'} · {humanize(l.source)}</p>
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : (
        <DataTable table={table} columns={columns} rowLink={(r) => `/leads/${r.id}`} exportName="leads"
          toolbar={<FilterSelect label="Stage" value={stage} onChange={setStage} options={STAGES.map((s) => ({ value: s, label: humanize(s) }))} />}
          empty={{ title: 'No leads yet', action: editable ? <Button onClick={() => setOpen(true)}>New lead</Button> : undefined }} />
      )}
      <LeadFormModal open={open} onClose={() => setOpen(false)} onSaved={() => { void qc.invalidateQueries({ queryKey: ['leads-board'] }); void table.refetch(); }} />
    </div>
  );
}
