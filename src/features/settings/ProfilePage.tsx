import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { CloudOff, LogOut, MapPin, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { check, friendlyError, nullify } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { ROLE_LABELS, MATRIX, MODULE_LABELS, level, type Module } from '@/lib/permissions';
import { useOfflineQueue, flushQueue } from '@/lib/offlineQueue';
import { passwordSchema, profileSchema } from '@/lib/schemas';
import { displayPhone, formatDateTime, normalizePhone } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import type { z } from 'zod';

type ProfileForm = z.infer<typeof profileSchema>;
type PasswordForm = z.infer<typeof passwordSchema>;

const LEVEL_TEXT: Record<string, string> = {
  F: 'Everything', A: 'Create, edit and approve', C: 'Create and edit', V: 'View only', O: 'Only your own records',
};

/** The signed-in person's own details, password, zones and what their roles let them do. */
export default function ProfilePage() {
  const { profile, user, roles, zoneIds, signOut, refresh } = useAuth();
  const { pending, online } = useOfflineQueue();
  const [flushing, setFlushing] = useState(false);

  const form = useForm<ProfileForm>({ resolver: zodResolver(profileSchema), defaultValues: { full_name: '', phone: '', email: '' } });
  const pw = useForm<PasswordForm>({ resolver: zodResolver(passwordSchema), defaultValues: { password: '', confirm: '' } });

  useEffect(() => {
    if (!profile) return;
    form.reset({ full_name: profile.full_name, phone: profile.phone ?? '', email: profile.email ?? '' });
  }, [profile, form]);

  const { data: zones = [] } = useQuery({
    queryKey: ['my-zone-names', zoneIds],
    enabled: zoneIds.length > 0,
    queryFn: async () => check(await supabase.from('zones').select('id, name').in('id', zoneIds)) as { id: string; name: string }[],
  });

  const save = form.handleSubmit(async (values) => {
    if (!profile) return;
    const { error } = await supabase.from('profiles')
      .update(nullify({ full_name: values.full_name, phone: normalizePhone(values.phone) ?? '', email: values.email }))
      .eq('id', profile.id);
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Your details are saved');
    await refresh();
  });

  const changePassword = pw.handleSubmit(async (values) => {
    const { error } = await supabase.auth.updateUser({ password: values.password });
    if (error) { toast.error(friendlyError(error)); return; }
    toast.success('Password changed');
    pw.reset({ password: '', confirm: '' });
  });

  const flush = async () => {
    setFlushing(true);
    const n = await flushQueue();
    setFlushing(false);
    toast.success(n ? `${n} update${n === 1 ? '' : 's'} sent` : 'Nothing was waiting');
  };

  if (!profile) return <Spinner />;

  const myModules = (Object.keys(MATRIX) as Module[])
    .map((m) => ({ module: m, lvl: level(roles, m) }))
    .filter((r) => r.lvl !== '-');

  return (
    <div>
      <PageHeader title="My profile" subtitle="Your details, your password and what your roles allow"
        actions={<Button variant="secondary" icon={<LogOut className="h-4 w-4" />} onClick={() => void signOut()}>Sign out</Button>} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Your details">
          <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-4">
            <Input label="Full name" required {...form.register('full_name')} error={form.formState.errors.full_name?.message} />
            <Input label="Phone" {...form.register('phone')} error={form.formState.errors.phone?.message}
              placeholder="024 412 3456" hint="Used for job alerts and the daily summary" />
            <Input label="Email" type="email" {...form.register('email')} error={form.formState.errors.email?.message}
              hint="You sign in with this address" />
            <Button type="submit" loading={form.formState.isSubmitting} disabled={!form.formState.isDirty}>Save</Button>
          </form>
          {profile.phone ? (
            <p className="mt-3 text-xs text-stone-500">Messages go to {displayPhone(profile.phone)}.</p>
          ) : (
            <p className="mt-3 text-xs text-amber-700">Add your phone number so you get job and alert messages.</p>
          )}
        </Card>

        <Card title="Password">
          <form onSubmit={(e) => { e.preventDefault(); void changePassword(); }} className="space-y-4">
            <Input label="New password" type="password" autoComplete="new-password" required
              {...pw.register('password')} error={pw.formState.errors.password?.message}
              hint="At least 10 characters. Use a phrase you will remember." />
            <Input label="Repeat the new password" type="password" autoComplete="new-password" required
              {...pw.register('confirm')} error={pw.formState.errors.confirm?.message} />
            <Button type="submit" loading={pw.formState.isSubmitting}>Change password</Button>
          </form>
          <p className="mt-3 text-xs text-stone-500">
            Nobody else, including a Super Admin, can see or set your password. They can only send you a reset link.
          </p>
        </Card>

        <Card title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" />What you may do</span>}>
          <div className="mb-3 flex flex-wrap gap-1">
            {roles.length ? roles.map((r) => <Badge key={r} tone={r === 'super_admin' ? 'amber' : 'blue'}>{ROLE_LABELS[r]}</Badge>)
              : <Badge tone="red">No role assigned yet</Badge>}
          </div>
          {myModules.length ? (
            <dl className="divide-y divide-stone-100 text-sm">
              {myModules.map((r) => (
                <div key={r.module} className="flex items-center justify-between gap-3 py-1.5">
                  <dt className="text-stone-700">{MODULE_LABELS[r.module]}</dt>
                  <dd className="shrink-0 text-xs text-stone-500">{LEVEL_TEXT[r.lvl]}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-sm text-stone-600">Ask a Super Admin to give you a role before you can do anything here.</p>
          )}
          <p className="mt-3 text-xs text-stone-500">
            These limits are enforced by the database itself, so they hold however the system is reached.
          </p>
        </Card>

        <div className="space-y-4">
          {zones.length ? (
            <Card title={<span className="flex items-center gap-2"><MapPin className="h-4 w-4" />Your zones</span>}>
              <div className="flex flex-wrap gap-1">{zones.map((z) => <Badge key={z.id} tone="grey">{z.name}</Badge>)}</div>
              <p className="mt-2 text-xs text-stone-500">You see customers, leads and tasks in these zones only.</p>
            </Card>
          ) : null}

          <Card title={<span className="flex items-center gap-2"><Smartphone className="h-4 w-4" />Working offline</span>}>
            <p className="flex items-center gap-2 text-sm">
              {online ? <Badge tone="green">Online</Badge> : <Badge tone="amber"><CloudOff className="mr-1 inline h-3 w-3" />Offline</Badge>}
              {pending ? <span className="text-stone-700">{pending} update{pending === 1 ? '' : 's'} waiting to be sent</span>
                : <span className="text-stone-600">Everything has been sent</span>}
            </p>
            {pending ? (
              <Button className="mt-3" variant="secondary" size="sm" icon={<RefreshCw className="h-4 w-4" />}
                loading={flushing} disabled={!online} onClick={() => void flush()}>Send them now</Button>
            ) : null}
            <p className="mt-3 text-xs text-stone-500">
              Task updates and check-ins you make without a signal are kept on this device and sent as soon as you are back
              online. Keep the app open until the count reaches zero.
            </p>
          </Card>

          <Card title="Account">
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-stone-500">Signed in as</dt><dd className="truncate">{user?.email ?? profile.email ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-stone-500">Member since</dt><dd>{formatDateTime(profile.created_at)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-stone-500">Status</dt>
                <dd>{profile.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="red">Deactivated</Badge>}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </div>
    </div>
  );
}
