import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Map as MapIcon, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { check, friendlyError } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { hasAny } from '@/lib/permissions';
import { useStaff, toOptions } from '@/lib/lookups';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import type { Tables } from '@/types/database';

type Zone = Tables<'zones'> & {
  user_zones: { profile_id: string; profile: { id: string; full_name: string } | null }[];
};

/** Zones and the officers assigned to them (spec 4.12). */
export default function ZonesPage() {
  const qc = useQueryClient();
  const { roles } = useAuth();
  const canEdit = hasAny(roles, 'manager');
  const { data: staff } = useStaff();

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Zone | null>(null);
  const [form, setForm] = useState({ name: '', description: '', regions: '', districts: '' });
  const [saving, setSaving] = useState(false);
  const [assigning, setAssigning] = useState<{ zoneId: string; profileId: string } | null>(null);

  const { data = [], isLoading, refetch } = useQuery({
    queryKey: ['zones-full'],
    queryFn: async () => check(await supabase.from('zones')
      .select('*, user_zones(profile_id, profile:profiles(id, full_name))')
      .is('archived_at', null).order('name')) as Zone[],
  });

  const openForm = (z: Zone | null) => {
    setEditing(z);
    setForm(z
      ? { name: z.name, description: z.description ?? '', regions: (z.regions ?? []).join(', '), districts: (z.districts ?? []).join(', ') }
      : { name: '', description: '', regions: '', districts: '' });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    const row = {
      name: form.name.trim(),
      description: form.description || null,
      regions: form.regions.split(',').map((s) => s.trim()).filter(Boolean),
      districts: form.districts.split(',').map((s) => s.trim()).filter(Boolean),
    };
    setSaving(true);
    try {
      if (editing) check(await supabase.from('zones').update(row).eq('id', editing.id));
      else check(await supabase.from('zones').insert(row));
      toast.success('Zone saved');
      setOpen(false);
      await refetch();
      await qc.invalidateQueries({ queryKey: ['lookup', 'zones'] });
    } catch (e) { toast.error((e as Error).message); } finally { setSaving(false); }
  };

  const assign = async () => {
    if (!assigning?.profileId) return;
    const { error } = await supabase.from('user_zones').insert({ zone_id: assigning.zoneId, profile_id: assigning.profileId });
    if (error) { toast.error(friendlyError(error)); return; }
    setAssigning(null);
    await refetch();
  };

  const unassign = async (zoneId: string, profileId: string) => {
    const { error } = await supabase.from('user_zones').delete().eq('zone_id', zoneId).eq('profile_id', profileId);
    if (error) toast.error(friendlyError(error)); else await refetch();
  };

  const archive = async (z: Zone) => {
    const { error } = await supabase.from('zones').update({ archived_at: new Date().toISOString() }).eq('id', z.id);
    if (error) toast.error(friendlyError(error));
    else { toast.success('Zone archived'); await refetch(); }
  };

  if (isLoading) return <Spinner />;

  return (
    <div>
      <PageHeader title="Zones" subtitle="The areas your officers cover, and who covers each one"
        actions={canEdit ? <Button icon={<Plus className="h-4 w-4" />} onClick={() => openForm(null)}>New zone</Button> : null} />

      {!data.length ? (
        <EmptyState icon={<MapIcon className="h-6 w-6" />} title="No zones yet"
          message="A zone groups the regions and districts an officer looks after, and limits what they can see."
          action={canEdit ? <Button onClick={() => openForm(null)}>Create the first zone</Button> : undefined} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {data.map((z) => (
            <Card key={z.id} title={<span className="text-sm font-semibold text-stone-800">{z.name}</span>}
              actions={canEdit ? <>
                <Button variant="secondary" size="sm" onClick={() => openForm(z)}>Edit</Button>
                <Button variant="ghost" size="sm" onClick={() => void archive(z)}>Archive</Button>
              </> : null}>
              {z.description ? <p className="mb-2 text-sm text-stone-600">{z.description}</p> : null}
              <dl className="mb-3 space-y-1 text-sm">
                <div><dt className="text-xs uppercase tracking-wide text-stone-500">Regions</dt>
                  <dd>{(z.regions ?? []).length ? (z.regions ?? []).join(', ') : '—'}</dd></div>
                <div><dt className="text-xs uppercase tracking-wide text-stone-500">Districts and MMDAs</dt>
                  <dd>{(z.districts ?? []).length ? (z.districts ?? []).join(', ') : '—'}</dd></div>
              </dl>

              <div className="border-t border-stone-100 pt-3">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs uppercase tracking-wide text-stone-500">Officers ({z.user_zones.length})</p>
                  {canEdit ? (
                    <Button variant="ghost" size="sm" icon={<Plus className="h-4 w-4" />}
                      onClick={() => setAssigning({ zoneId: z.id, profileId: '' })}>Assign</Button>
                  ) : null}
                </div>
                {z.user_zones.length ? (
                  <ul className="flex flex-wrap gap-2">
                    {z.user_zones.map((uz) => (
                      <li key={uz.profile_id}>
                        <span className="inline-flex items-center gap-1 rounded-full bg-stone-100 px-2.5 py-1 text-sm">
                          {uz.profile?.full_name ?? 'Unknown'}
                          {canEdit ? (
                            <button type="button" aria-label={`Remove ${uz.profile?.full_name ?? 'officer'}`}
                              className="text-stone-400 hover:text-red-600" onClick={() => void unassign(z.id, uz.profile_id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : <p className="text-sm text-stone-500">Nobody assigned yet.</p>}
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit zone' : 'New zone'} size="md"
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button loading={saving} onClick={() => void save()}>Save</Button></>}>
        <div className="space-y-4">
          <Input label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="e.g. Greater Accra East" />
          <Textarea label="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <Input label="Regions" value={form.regions} onChange={(e) => setForm({ ...form, regions: e.target.value })}
            hint="Separate with commas, e.g. Greater Accra, Eastern" />
          <Input label="Districts and MMDAs" value={form.districts} onChange={(e) => setForm({ ...form, districts: e.target.value })}
            hint="Separate with commas, e.g. Adentan Municipal, Madina" />
        </div>
      </Modal>

      <Modal open={assigning !== null} onClose={() => setAssigning(null)} title="Assign an officer to this zone" size="sm"
        footer={<><Button variant="secondary" onClick={() => setAssigning(null)}>Cancel</Button>
          <Button disabled={!assigning?.profileId} onClick={() => void assign()}>Assign</Button></>}>
        {assigning ? (
          <>
            <Select label="Officer" required options={toOptions(staff, (s) => s.full_name)} placeholder="Choose…"
              value={assigning.profileId} onChange={(e) => setAssigning({ ...assigning, profileId: e.target.value })} />
            <p className="mt-3 text-xs text-stone-500">
              A zonal officer only sees customers, leads and tasks in the zones assigned to them.
            </p>
          </>
        ) : null}
      </Modal>

      <Card className="mt-4" title="What zones do">
        <p className="text-sm text-stone-600">
          Zones drive the zonal officer's view: they see their own tasks and the customers and leads in their zones,
          and nothing from other zones — enforced by the database, not just hidden in the interface.
          <Badge tone="grey" className="ml-2">Row Level Security</Badge>
        </p>
      </Card>
    </div>
  );
}
