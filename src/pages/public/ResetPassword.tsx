import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, appName } from '@/lib/supabaseClient';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';

/**
 * Lands here from the invite or password-reset email. Supabase puts a recovery session
 * in the URL (detectSessionInUrl), so the user is briefly signed in and can set a password.
 */
export default function ResetPassword() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }: { data: { session: unknown } }) => {
      if (!active) return;
      setHasSession(!!data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event: string, s: unknown) => {
      setHasSession(!!s);
      setReady(true);
    });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  const submit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) { setError('Use at least 8 characters'); return; }
    if (password !== confirm) { setError('The two passwords do not match'); return; }
    setBusy(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw new Error(updateError.message);
      toast.success('Password set. Welcome aboard.');
      navigate('/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!ready) return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-stone-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white">
            <KeyRound className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold text-stone-900">{appName}</h1>
          <p className="mt-1 text-sm text-stone-600">Choose a password for your account</p>
        </div>

        {hasSession ? (
          <form onSubmit={submit} className="space-y-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
            <Input label="New password" name="password" type="password" autoComplete="new-password" required
              value={password} onChange={(e) => setPassword(e.target.value)} hint="At least 8 characters" />
            <Input label="Repeat password" name="confirm" type="password" autoComplete="new-password" required
              value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            {error ? <p role="alert" className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700">{error}</p> : null}
            <Button type="submit" size="lg" className="w-full" loading={busy}>Save password and sign in</Button>
          </form>
        ) : (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p className="font-medium">This link is no longer valid</p>
            <p className="mt-1">Reset links can only be used once and expire after a short time. Ask for a new one from the sign-in page.</p>
            <Button variant="secondary" className="mt-4" onClick={() => navigate('/login')}>Back to sign in</Button>
          </div>
        )}
      </div>
    </div>
  );
}
