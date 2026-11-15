import { Link, useLocation } from 'react-router-dom';
import { KeyRound } from 'lucide-react';
import { useAuth } from '@/lib/auth';

/**
 * Shown while someone is signed in with a password an administrator set for them. It stays until
 * they choose their own, because until then a second person knows how to get into the account.
 * It is deliberately not dismissible, and hides itself on the page that resolves it.
 */
export function PasswordBanner() {
  const { profile } = useAuth();
  const { pathname } = useLocation();
  if (!profile?.must_change_password || pathname === '/profile') return null;
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 sm:px-6">
      <p className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-2 gap-y-1">
        <KeyRound className="h-4 w-4 shrink-0" />
        <span>You are using a password someone else set for you.</span>
        <Link to="/profile" className="font-semibold underline underline-offset-2">Choose your own</Link>
      </p>
    </div>
  );
}
