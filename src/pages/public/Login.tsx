import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound, Mail } from 'lucide-react';
import { toast } from 'sonner';
import { supabase, appName } from '@/lib/supabaseClient';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';

export default function Login() {
  const { session, loading, signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'password' | 'reset'>('password');
  const [error, setError] = useState<string | null>(null);

  // Already signed in (or just arrived back from an invite link): go to the app.
  useEffect(() => { if (!loading && session) navigate(params.get('next') || '/', { replace: true }); }, [loading, session, navigate, params]);

  const onSubmit = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'password') {
        await signIn(email.trim(), password);
        navigate(params.get('next') || '/', { replace: true });
      } else {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (resetError) throw new Error(resetError.message);
        toast.success('Check your email for the reset link');
        setMode('password');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>;

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-stone-100 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white">
            <KeyRound className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold text-stone-900">{appName}</h1>
          <p className="mt-1 text-sm text-stone-600">
            {mode === 'password' ? 'Sign in to continue' : 'We will email you a reset link'}
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 rounded-2xl border border-stone-200 bg-white p-5 shadow-sm">
          <Input label="Email" name="email" type="email" autoComplete="username" required value={email}
            onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          {mode === 'password' ? (
            <Input label="Password" name="password" type="password" autoComplete="current-password" required value={password}
              onChange={(e) => setPassword(e.target.value)} />
          ) : null}

          {error ? <p role="alert" className="rounded-lg bg-red-50 p-2.5 text-sm text-red-700">{error}</p> : null}

          <Button type="submit" size="lg" className="w-full" loading={busy}
            icon={mode === 'reset' ? <Mail className="h-4 w-4" /> : undefined}>
            {mode === 'password' ? 'Sign in' : 'Send reset link'}
          </Button>

          <button type="button" className="w-full text-center text-sm text-brand-700 hover:underline"
            onClick={() => { setMode(mode === 'password' ? 'reset' : 'password'); setError(null); }}>
            {mode === 'password' ? 'Forgot your password?' : 'Back to sign in'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-stone-500">
          Accounts are created by a Super Admin in Settings &gt; Users. If you were invited, open the link in your email to set a password.
        </p>
        <p className="mt-2 text-center text-xs text-stone-400">
          <Link to="/reset-password">Set a new password</Link>
        </p>
      </div>
    </div>
  );
}
