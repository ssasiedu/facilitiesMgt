import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Check, Copy, KeyRound, ShieldCheck, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { check, friendlyError } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { ALL_ROLES, MATRIX, MATRIX_ORDER, MODULE_LABELS, ROLE_LABELS, type Module, type Role } from '@/lib/permissions';
import { useZones } from '@/lib/lookups';
import { inviteSchema } from '@/lib/schemas';
import { displayPhone, formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Checkbox } from '@/components/ui/Checkbox';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Tabs } from '@/components/ui/Tabs';
import { Spinner } from '@/components/ui/Spinner';
import { SettingsTabs } from './SettingsTabs';
import type { Tables } from '@/types/database';
import type { z } from 'zod';

type Person = Tables<'profiles'> & {
  user_roles: { role_code: string }[];
  user_zones: { zone_id: string; zone: { name: string } | null }[];
};
type InviteForm = z.infer<typeof inviteSchema>;

/**
 * supabase-js reports every non-2xx as the same opaque "Edge Function returned a non-2xx status
 * code" and hands the actual Response back on error.context. The function always answers with
 * { error: "..." }, so read it: the reason is the whole value of the message.
 */
async function callInviteFunction(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('invite-user', { body });
  if (error) {
    let message = error.message;
    const ctx: unknown = (error as { context?: unknown }).context;
    let raw = '';
    if (typeof Response !== 'undefined' && ctx instanceof Response) {
      raw = await ctx.clone().text().catch(() => '');
      if (!raw) message = `${message} (HTTP ${ctx.status})`;
    } else if (typeof ctx === 'string') {
      raw = ctx;
    } else if (ctx && typeof ctx === 'object' && typeof (ctx as { body?: unknown }).body === 'string') {
      raw = (ctx as { body: string }).body;
    }
    if (raw) {
      try { message = (JSON.parse(raw) as { error?: string }).error ?? raw; } catch { message = raw; }
    }
    throw new Error(message);
  }
  return data as { ok: boolean; password?: string };
}

/** Users, their roles and zones (spec 4.14), plus the role matrix from section 3 for reference. */
export default function UsersPage() {
  const { profile } = useAuth();
  const { data: zones } = useZones();
  const [tab, setTab] = useState<'people' | 'matrix'>('people');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<Person | null>(null);
  const [roleDraft, setRoleDraft] = useState<string[]>([]);
  const [zoneDraft, setZoneDraft] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Person | null>(null);
  const [resetting, setResetting] = useState<Person | null>(null);
  const [tempFor, setTempFor] = useState<Person | null>(null);
  const [tempChoice, setTempChoice] = useState<'generate' | 'choose'>('generate');
  const [tempTyped, setTempTyped] = useState('');
  const [issued, setIssued] = useState<{ person: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const { data = [], isLoading, refetch } = useQuery({
    queryKey: ['users'],
    queryFn: async () => check(await supabase.from('profiles')
      .select('*, user_roles(role_code), user_zones(zone_id, zone:zones(name))')
      .order('full_name')) as Person[],
  });

  const form = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: '', full_name: '', phone: '', roles: [], zone_ids: [] },
  });
  const invitedRoles = form.watch('roles');
  const needsZones = invitedRoles.includes('zonal_officer');

  const invite = form.handleSubmit(async (values) => {
    try {
      await callInviteFunction({ action: 'invite', ...values, zone_ids: needsZones ? values.zone_ids : [] });
      toast.success(`Invitation emailed to ${values.email}`);
      setInviteOpen(false);
      form.reset({ email: '', full_name: '', phone: '', roles: [], zone_ids: [] });
      await refetch();
    } catch (e) { toast.error(friendlyError(e)); }
  });

  const openEdit = (p: Person) => {
    setEditing(p);
    setRoleDraft(p.user_roles.map((r) => r.role_code));
    setZoneDraft(p.user_zones.map((z) => z.zone_id));
  };

  const saveRoles = async () => {
    if (!editing) return;
    if (!roleDraft.length) { toast.error('Choose at least one role'); return; }
    setBusy(true);
    try {
      await callInviteFunction({ action: 'update', profile_id: editing.id, roles: roleDraft, zone_ids: zoneDraft });
      toast.success('Roles saved');
      setEditing(null);
      await refetch();
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  };

  const toggleActive = async (p: Person) => {
    setBusy(true);
    try {
      await callInviteFunction({ action: p.is_active ? 'deactivate' : 'reactivate', profile_id: p.id });
      toast.success(p.is_active ? 'Access removed' : 'Access restored');
      setConfirm(null);
      await refetch();
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  };

  const issuePassword = async () => {
    if (!tempFor) return;
    if (tempChoice === 'choose' && tempTyped.trim().length < 8) {
      toast.error('A password must be at least 8 characters');
      return;
    }
    setBusy(true);
    try {
      const res = await callInviteFunction({
        action: 'set_password',
        profile_id: tempFor.id,
        ...(tempChoice === 'choose' ? { password: tempTyped.trim() } : {}),
      });
      if (!res.password) throw new Error('The server did not return a password');
      setIssued({ person: tempFor.full_name, password: res.password });
      setTempFor(null);
      setTempTyped('');
      setCopied(false);
      await refetch();
    } catch (e) { toast.error(friendlyError(e)); } finally { setBusy(false); }
  };

  const copyPassword = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.password);
      setCopied(true);
      toast.success('Password copied');
    } catch { toast.info(issued.password); }
  };

  const sendReset = async (p: Person) => {
    if (!p.email) { toast.error('This person has no email address'); return; }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(p.email, { redirectTo: `${window.location.origin}/reset-password` });
    setBusy(false);
    setResetting(null);
    if (error) toast.error(friendlyError(error));
    else toast.success(`Reset link sent to ${p.email}`);
  };

  const active = useMemo(() => data.filter((p) => p.is_active), [data]);
  const inactive = useMemo(() => data.filter((p) => !p.is_active), [data]);

  const Row = ({ p }: { p: Person }) => (
    <tr className={p.is_active ? undefined : 'bg-stone-50 text-stone-500'}>
      <td className="px-3 py-2">
        <p className="font-medium text-stone-900">{p.full_name}{p.id === profile?.id ? <span className="ml-1 text-xs text-stone-500">(you)</span> : null}</p>
        <p className="text-xs text-stone-500">{p.email ?? '—'}{p.phone ? ` · ${displayPhone(p.phone)}` : ''}</p>
      </td>
      <td className="px-3 py-2">
        {p.user_roles.length ? (
          <span className="flex flex-wrap gap-1">
            {p.user_roles.map((r) => <Badge key={r.role_code} tone={r.role_code === 'super_admin' ? 'amber' : 'grey'}>{ROLE_LABELS[r.role_code as Role] ?? r.role_code}</Badge>)}
          </span>
        ) : <Badge tone="red">No role</Badge>}
      </td>
      <td className="hidden px-3 py-2 text-sm md:table-cell">
        {p.user_zones.length ? p.user_zones.map((z) => z.zone?.name).filter(Boolean).join(', ') : '—'}
      </td>
      <td className="hidden px-3 py-2 text-xs text-stone-500 lg:table-cell">
        {p.user_id ? 'Signed up' : 'Invitation pending'}
        {p.is_demo ? <Badge tone="blue" className="ml-1">Demo</Badge> : null}
        {p.must_change_password ? <Badge tone="amber" className="ml-1">Temporary password</Badge> : null}
        <span className="block">{formatDateTime(p.created_at)}</span>
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex flex-wrap justify-end gap-1">
          <Button variant="secondary" size="sm" onClick={() => openEdit(p)}>Roles</Button>
          <Button variant="ghost" size="sm" icon={<KeyRound className="h-4 w-4" />}
            onClick={() => { setTempFor(p); setTempChoice('generate'); setTempTyped(''); }}>Password</Button>
          <Button variant="ghost" size="sm" onClick={() => setResetting(p)}>Email a reset</Button>
          {p.id === profile?.id ? null : (
            <Button variant="ghost" size="sm" onClick={() => setConfirm(p)}>{p.is_active ? 'Deactivate' : 'Reactivate'}</Button>
          )}
        </div>
      </td>
    </tr>
  );

  const Table = ({ people }: { people: Person[] }) => (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead className="bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Person</th>
            <th scope="col" className="px-3 py-2 font-medium">Roles</th>
            <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">Zones</th>
            <th scope="col" className="hidden px-3 py-2 font-medium lg:table-cell">Status</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">{people.map((p) => <Row key={p.id} p={p} />)}</tbody>
      </table>
    </div>
  );

  if (isLoading) return <Spinner />;

  return (
    <div>
      <PageHeader title="Settings" subtitle="Who can sign in, and what each of them may do"
        actions={<Button icon={<UserPlus className="h-4 w-4" />} onClick={() => setInviteOpen(true)}>Invite someone</Button>} />
      <SettingsTabs />

      <div className="mt-4">
        <Tabs tabs={[{ value: 'people', label: 'People', count: data.length }, { value: 'matrix', label: 'What each role may do' }]}
          value={tab} onChange={setTab} />
      </div>

      {tab === 'people' ? (
        <div className="mt-4 space-y-4">
          <Card bodyClassName="p-0" title={`Active (${active.length})`}><Table people={active} /></Card>
          {inactive.length ? (
            <Card bodyClassName="p-0" title={`Deactivated (${inactive.length})`}><Table people={inactive} /></Card>
          ) : null}
          <p className="text-xs text-stone-500">
            Deactivating someone blocks their sign-in but keeps their history: the job orders they raised, the payments they
            recorded and their audit trail all stay as they are.
          </p>
        </div>
      ) : (
        <Card className="mt-4" bodyClassName="p-0" title="Role matrix"
          actions={<span className="text-xs text-stone-500">Enforced in the database, not only hidden here</span>}>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th scope="col" className="sticky left-0 bg-stone-50 px-3 py-2 text-left font-medium">Area</th>
                  {MATRIX_ORDER.map((r) => <th key={r} scope="col" className="px-2 py-2 font-medium">{ROLE_LABELS[r]}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {(Object.keys(MATRIX) as Module[]).map((m) => (
                  <tr key={m}>
                    <th scope="row" className="sticky left-0 bg-white px-3 py-2 text-left font-normal">{MODULE_LABELS[m]}</th>
                    {MATRIX[m].map((lvl, i) => (
                      <td key={MATRIX_ORDER[i]} className="px-2 py-2 text-center">
                        {lvl === '-' ? <span className="text-stone-300">·</span> : (
                          <Badge tone={lvl === 'F' ? 'green' : lvl === 'A' ? 'amber' : lvl === 'C' ? 'blue' : 'grey'}>{lvl}</Badge>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 p-3 text-xs text-stone-600 sm:grid-cols-3">
            <div><dt className="inline font-semibold">F</dt> <dd className="inline">everything in that area</dd></div>
            <div><dt className="inline font-semibold">A</dt> <dd className="inline">create, edit and approve</dd></div>
            <div><dt className="inline font-semibold">C</dt> <dd className="inline">create and edit, no approval</dd></div>
            <div><dt className="inline font-semibold">V</dt> <dd className="inline">view only</dd></div>
            <div><dt className="inline font-semibold">O</dt> <dd className="inline">only their own records</dd></div>
            <div><dt className="inline font-semibold">·</dt> <dd className="inline">no access</dd></div>
          </dl>
        </Card>
      )}

      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite someone" size="md"
        footer={<><Button variant="secondary" onClick={() => setInviteOpen(false)}>Cancel</Button>
          <Button loading={form.formState.isSubmitting} onClick={() => void invite()}>Send invitation</Button></>}>
        <div className="space-y-4">
          <Input label="Full name" required {...form.register('full_name')} error={form.formState.errors.full_name?.message} />
          <Input label="Email" type="email" required {...form.register('email')} error={form.formState.errors.email?.message}
            hint="They get an email with a link to set their own password" />
          <Input label="Phone" {...form.register('phone')} error={form.formState.errors.phone?.message} placeholder="024 412 3456" />
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-stone-700">Roles <span className="text-red-600">*</span></legend>
            <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
              {ALL_ROLES.map((r) => (
                <Checkbox key={r} label={ROLE_LABELS[r]} value={r} {...form.register('roles')} />
              ))}
            </div>
            {form.formState.errors.roles ? <p className="text-xs text-red-600">{form.formState.errors.roles.message}</p> : null}
          </fieldset>
          {needsZones ? (
            <fieldset>
              <legend className="mb-1 text-sm font-medium text-stone-700">Zones</legend>
              <p className="mb-1 text-xs text-stone-500">A zonal officer only sees customers, leads and tasks in their zones.</p>
              <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
                {(zones ?? []).map((z) => <Checkbox key={z.id} label={z.name} value={z.id} {...form.register('zone_ids')} />)}
              </div>
            </fieldset>
          ) : null}
        </div>
      </Modal>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing ? `Roles for ${editing.full_name}` : ''} size="md"
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
          <Button loading={busy} onClick={() => void saveRoles()}>Save</Button></>}>
        {editing ? (
          <div className="space-y-4">
            <fieldset>
              <legend className="mb-1 text-sm font-medium text-stone-700">Roles</legend>
              <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
                {ALL_ROLES.map((r) => (
                  <Checkbox key={r} label={ROLE_LABELS[r]} checked={roleDraft.includes(r)}
                    onChange={(e) => setRoleDraft(e.target.checked ? [...roleDraft, r] : roleDraft.filter((x) => x !== r))} />
                ))}
              </div>
            </fieldset>
            {roleDraft.includes('zonal_officer') ? (
              <fieldset>
                <legend className="mb-1 text-sm font-medium text-stone-700">Zones</legend>
                <div className="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
                  {(zones ?? []).map((z) => (
                    <Checkbox key={z.id} label={z.name} checked={zoneDraft.includes(z.id)}
                      onChange={(e) => setZoneDraft(e.target.checked ? [...zoneDraft, z.id] : zoneDraft.filter((x) => x !== z.id))} />
                  ))}
                </div>
              </fieldset>
            ) : null}
            {editing.id === profile?.id ? (
              <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                You cannot remove your own Super Admin role, so you can never lock yourself out.
              </p>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog open={confirm !== null} onClose={() => setConfirm(null)}
        title={confirm?.is_active ? 'Remove access?' : 'Restore access?'}
        message={confirm?.is_active
          ? `${confirm.full_name} will no longer be able to sign in. Their records and history stay in the system.`
          : `${confirm?.full_name} will be able to sign in again with their existing password.`}
        confirmLabel={confirm?.is_active ? 'Remove access' : 'Restore access'} danger={!!confirm?.is_active}
        loading={busy} onConfirm={() => { if (confirm) void toggleActive(confirm); }} />

      <Modal open={tempFor !== null} onClose={() => setTempFor(null)} size="md"
        title={tempFor ? `Set a password for ${tempFor.full_name}` : ''}
        footer={<><Button variant="secondary" onClick={() => setTempFor(null)}>Cancel</Button>
          <Button loading={busy} onClick={() => void issuePassword()}>Set the password</Button></>}>
        {tempFor ? (
          <div className="space-y-4">
            <p className="text-sm text-stone-600">
              Use this when someone cannot pick up an email — you read them the password and they sign in
              straight away. They are asked to replace it with one of their own as soon as they are in,
              so you do not go on knowing it.
            </p>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-stone-700">Password</legend>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" className="mt-1" checked={tempChoice === 'generate'} onChange={() => setTempChoice('generate')} />
                <span>Generate one<span className="block text-xs text-stone-500">Twelve characters, avoiding letters and digits that are easy to confuse out loud</span></span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input type="radio" className="mt-1" checked={tempChoice === 'choose'} onChange={() => setTempChoice('choose')} />
                <span>Type one myself</span>
              </label>
            </fieldset>
            {tempChoice === 'choose' ? (
              <Input label="Password" required value={tempTyped} onChange={(e) => setTempTyped(e.target.value)}
                hint="At least 8 characters" />
            ) : null}
            {tempFor.user_id ? (
              <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
                {tempFor.full_name} already has an account. Their current password stops working immediately.
              </p>
            ) : (
              <p className="rounded-lg bg-stone-50 p-3 text-xs text-stone-600">
                This creates their account, so they can sign in with {tempFor.email} without waiting for an invitation email.
              </p>
            )}
          </div>
        ) : null}
      </Modal>

      <Modal open={issued !== null} onClose={() => setIssued(null)} size="sm" title="Password set"
        footer={<Button onClick={() => setIssued(null)}>Done</Button>}>
        {issued ? (
          <div className="space-y-3">
            <p className="text-sm text-stone-600">
              Give this to {issued.person}. It is shown once and is not stored anywhere — if it is lost, set another.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 select-all rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 font-mono text-lg tracking-wide">{issued.password}</code>
              <Button variant="secondary" size="sm" icon={copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                onClick={() => void copyPassword()}>{copied ? 'Copied' : 'Copy'}</Button>
            </div>
            <p className="text-xs text-stone-500">
              Send it by a different route from the one carrying the sign-in address where you can — a phone call rather
              than the same inbox. They will be asked to set their own password as soon as they sign in.
            </p>
          </div>
        ) : null}
      </Modal>

      <ConfirmDialog open={resetting !== null} onClose={() => setResetting(null)} title="Send a password reset link?"
        message={`${resetting?.full_name} will get an email at ${resetting?.email ?? 'their address'} with a link to set a new password. You never see or set their password yourself.`}
        confirmLabel="Send the link" loading={busy}
        onConfirm={() => { if (resetting) void sendReset(resetting); }} />
    </div>
  );
}
