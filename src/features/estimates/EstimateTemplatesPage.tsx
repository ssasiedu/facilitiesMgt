import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { check, friendlyError } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { useCostItems, useServices, toOptions } from '@/lib/lookups';
import { formatNumber, formatPct, humanize } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Checkbox } from '@/components/ui/Checkbox';
import { Badge } from '@/components/ui/Badge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import type { Tables } from '@/types/database';

type Template = Tables<'estimate_templates'> & { service: { name: string } | null; estimate_template_lines: Tables<'estimate_template_lines'>[] };

interface HeaderForm {
  name: string; service_id: string; duration_days: number; hours_per_day: number; is_recurring: boolean;
  visits_per_period: number; visit_period: string; contract_months: number;
  overhead_pct: number; contingency_pct: number; target_margin_pct: number; active: boolean;
}

const BLANK: HeaderForm = {
  name: '', service_id: '', duration_days: 1, hours_per_day: 8, is_recurring: false, visits_per_period: 1,
  visit_period: 'month', contract_months: 1, overhead_pct: 10, contingency_pct: 5, target_margin_pct: 25, active: true,
};

/** Estimate templates per service (spec 4.6), so a routine estimate takes under two minutes. */
export default function EstimateTemplatesPage() {
  const qc = useQueryClient();
  const { roles } = useAuth();
  const editable = hasAny(roles, 'manager');
  const { data: services } = useServices(true);
  const { data: costItems } = useCostItems();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Template | null>(null);
  const [header, setHeader] = useState<HeaderForm>(BLANK);
  const [saving, setSaving] = useState(false);
  const [newLine, setNewLine] = useState({ cost_item_id: '', basis: 'total', quantity: 1, headcount: 1, days: 1, km: 0 });

  const { data = [], isLoading, refetch } = useQuery({
    queryKey: ['estimate-templates-full'],
    queryFn: async () => check(await supabase.from('estimate_templates')
      .select('*, service:services(name), estimate_template_lines(*)')
      .is('archived_at', null).order('name')) as Template[],
  });

  const openForm = (t: Template | null) => {
    setEditing(t);
    setHeader(t ? {
      name: t.name, service_id: t.service_id, duration_days: Number(t.duration_days), hours_per_day: Number(t.hours_per_day),
      is_recurring: t.is_recurring, visits_per_period: Number(t.visits_per_period), visit_period: t.visit_period,
      contract_months: t.contract_months, overhead_pct: Number(t.overhead_pct), contingency_pct: Number(t.contingency_pct),
      target_margin_pct: Number(t.target_margin_pct), active: t.active,
    } : BLANK);
    setOpen(true);
  };

  const saveHeader = async () => {
    if (!header.name.trim() || !header.service_id) { toast.error('Name and service are required'); return; }
    setSaving(true);
    try {
      if (editing) check(await supabase.from('estimate_templates').update(header).eq('id', editing.id));
      else check(await supabase.from('estimate_templates').insert(header));
      toast.success('Template saved');
      setOpen(false);
      await refetch();
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  };

  const addLine = async (templateId: string) => {
    if (!newLine.cost_item_id) { toast.error('Choose a cost item'); return; }
    const { error } = await supabase.from('estimate_template_lines').insert({ ...newLine, template_id: templateId, sort_order: 99 });
    if (error) { toast.error(friendlyError(error)); return; }
    setNewLine({ cost_item_id: '', basis: 'total', quantity: 1, headcount: 1, days: 1, km: 0 });
    await qc.invalidateQueries({ queryKey: ['estimate-templates-full'] });
  };

  const removeLine = async (lineId: string) => {
    const { error } = await supabase.from('estimate_template_lines').delete().eq('id', lineId);
    if (error) toast.error(friendlyError(error));
    else await qc.invalidateQueries({ queryKey: ['estimate-templates-full'] });
  };

  const archive = async (t: Template) => {
    const { error } = await supabase.from('estimate_templates').update({ archived_at: new Date().toISOString() }).eq('id', t.id);
    if (error) toast.error(friendlyError(error)); else { toast.success('Template archived'); await refetch(); }
  };

  if (isLoading) return <Spinner />;

  return (
    <div>
      <PageHeader title="Estimate templates" subtitle="Default cost lines per service, so routine estimates are quick and consistent"
        actions={editable ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => openForm(null)}>New template</Button> : null} />

      {!data.length ? (
        <EmptyState icon={<ListChecks className="h-6 w-6" />} title="No templates yet"
          message="A template holds the usual items, quantities, overhead and target margin for one service."
          action={editable ? <Button onClick={() => openForm(null)}>Create the first template</Button> : undefined} />
      ) : (
        <div className="space-y-4">
          {data.map((t) => (
            <Card key={t.id}
              title={<span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-stone-800">{t.name}</span>
                <Badge tone="brand">{t.service?.name ?? 'No service'}</Badge>
                {t.is_recurring ? <Badge tone="purple">{formatNumber(t.visits_per_period)} visits per {t.visit_period} · {t.contract_months} months</Badge> : <Badge tone="grey">One-off</Badge>}
                {!t.active ? <Badge tone="grey">Inactive</Badge> : null}
              </span>}
              actions={editable ? <>
                <Button variant="secondary" size="sm" onClick={() => openForm(t)}>Edit</Button>
                <Button variant="ghost" size="sm" onClick={() => void archive(t)}>Archive</Button>
              </> : null}>
              <p className="mb-3 text-sm text-stone-600">
                {formatNumber(t.duration_days)} day(s) × {formatNumber(t.hours_per_day)} h · overhead {formatPct(t.overhead_pct)} ·
                contingency {formatPct(t.contingency_pct)} · target margin {formatPct(t.target_margin_pct)}
              </p>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Item</th>
                      <th scope="col" className="px-3 py-2 font-medium">Category</th>
                      <th scope="col" className="px-3 py-2 font-medium">Basis</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Qty</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">People</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Days</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Km</th>
                      {editable ? <th scope="col" className="w-8 px-3 py-2" /> : null}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {[...t.estimate_template_lines].sort((a, b) => a.sort_order - b.sort_order).map((l) => {
                      const item = (costItems ?? []).find((c) => c.id === l.cost_item_id);
                      return (
                        <tr key={l.id}>
                          <td className="px-3 py-2">{item ? `${item.code} · ${item.name}` : '—'}</td>
                          <td className="px-3 py-2">{humanize(item?.category)}</td>
                          <td className="px-3 py-2">{l.basis === 'per_visit' ? 'Per visit' : 'Total'}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatNumber(l.quantity)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatNumber(l.headcount)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatNumber(l.days)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{formatNumber(l.km)}</td>
                          {editable ? (
                            <td className="px-3 py-2">
                              <Button variant="ghost" size="sm" aria-label="Remove line" onClick={() => void removeLine(l.id)}><Trash2 className="h-4 w-4" /></Button>
                            </td>
                          ) : null}
                        </tr>
                      );
                    })}
                    {!t.estimate_template_lines.length ? (
                      <tr><td colSpan={editable ? 8 : 7} className="px-3 py-3 text-stone-500">No lines yet.</td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              {editable ? (
                <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-stone-100 pt-3">
                  <Select className="min-w-[14rem]" label="Add item" options={toOptions(costItems, (c) => `${c.code} · ${c.name}`)} placeholder="Choose…"
                    value={newLine.cost_item_id} onChange={(e) => setNewLine({ ...newLine, cost_item_id: e.target.value })} />
                  <Select label="Basis" options={[{ value: 'total', label: 'Total' }, { value: 'per_visit', label: 'Per visit' }]}
                    value={newLine.basis} onChange={(e) => setNewLine({ ...newLine, basis: e.target.value })} />
                  <Input className="w-20" label="Qty" type="number" step="0.001" value={newLine.quantity} onChange={(e) => setNewLine({ ...newLine, quantity: Number(e.target.value) })} />
                  <Input className="w-20" label="People" type="number" step="0.5" value={newLine.headcount} onChange={(e) => setNewLine({ ...newLine, headcount: Number(e.target.value) })} />
                  <Input className="w-20" label="Days" type="number" step="0.5" value={newLine.days} onChange={(e) => setNewLine({ ...newLine, days: Number(e.target.value) })} />
                  <Input className="w-20" label="Km" type="number" step="1" value={newLine.km} onChange={(e) => setNewLine({ ...newLine, km: Number(e.target.value) })} />
                  <Button variant="secondary" onClick={() => void addLine(t.id)}>Add</Button>
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit template' : 'New template'} size="lg"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={saving} onClick={() => void saveHeader()}>Save</Button></>}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Name" required value={header.name} onChange={(e) => setHeader({ ...header, name: e.target.value })} />
          <Select label="Service" required options={toOptions(services, (s) => s.name)} placeholder="Choose…"
            value={header.service_id} onChange={(e) => setHeader({ ...header, service_id: e.target.value })} />
          <Input label="Duration (days)" type="number" step="0.5" value={header.duration_days} onChange={(e) => setHeader({ ...header, duration_days: Number(e.target.value) })} />
          <Input label="Hours per day" type="number" step="0.5" value={header.hours_per_day} onChange={(e) => setHeader({ ...header, hours_per_day: Number(e.target.value) })} />
          <div className="sm:col-span-2"><Checkbox label="Recurring work" checked={header.is_recurring} onChange={(e) => setHeader({ ...header, is_recurring: e.target.checked })} /></div>
          {header.is_recurring ? <>
            <Input label="Visits per period" type="number" step="0.5" value={header.visits_per_period} onChange={(e) => setHeader({ ...header, visits_per_period: Number(e.target.value) })} />
            <Select label="Period" options={[{ value: 'week', label: 'Per week' }, { value: 'month', label: 'Per month' }]}
              value={header.visit_period} onChange={(e) => setHeader({ ...header, visit_period: e.target.value })} />
            <Input label="Contract months" type="number" value={header.contract_months} onChange={(e) => setHeader({ ...header, contract_months: Number(e.target.value) })} />
          </> : null}
          <Input label="Overhead %" type="number" step="0.5" value={header.overhead_pct} onChange={(e) => setHeader({ ...header, overhead_pct: Number(e.target.value) })} />
          <Input label="Contingency %" type="number" step="0.5" value={header.contingency_pct} onChange={(e) => setHeader({ ...header, contingency_pct: Number(e.target.value) })} />
          <Input label="Target margin %" type="number" step="0.5" value={header.target_margin_pct} onChange={(e) => setHeader({ ...header, target_margin_pct: Number(e.target.value) })} />
          <div className="sm:col-span-2"><Checkbox label="Active" checked={header.active} onChange={(e) => setHeader({ ...header, active: e.target.checked })} /></div>
        </div>
      </Modal>
    </div>
  );
}
