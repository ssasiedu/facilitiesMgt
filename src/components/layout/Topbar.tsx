import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LogOut, Menu, UserCircle2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { ROLE_LABELS } from '@/lib/permissions';
import { initials } from '@/lib/format';
import { GlobalSearch } from './GlobalSearch';
import { NotificationBell } from './NotificationBell';

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { profile, roles, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-stone-200 bg-white/95 px-3 backdrop-blur sm:px-4">
      <button type="button" className="rounded-lg p-2 text-stone-600 hover:bg-stone-100 lg:hidden" aria-label="Open menu" onClick={onMenu}><Menu className="h-5 w-5" /></button>
      <div className="flex flex-1 justify-start"><GlobalSearch /></div>
      <NotificationBell />
      <div className="relative">
        <button type="button" className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-stone-100" aria-label="User menu" onClick={() => setOpen(!open)}>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700">{initials(profile?.full_name)}</span>
        </button>
        {open ? (
          <div className="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-stone-200 bg-white p-2 shadow-xl" onMouseLeave={() => setOpen(false)}>
            <div className="px-3 py-2">
              <p className="text-sm font-semibold">{profile?.full_name}</p>
              <p className="truncate text-xs text-stone-500">{profile?.email}</p>
              <p className="mt-1 text-xs text-stone-500">{roles.map((r) => ROLE_LABELS[r]).join(', ') || 'No role yet'}</p>
            </div>
            <Link to="/profile" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-stone-100"><UserCircle2 className="h-4 w-4" />My profile</Link>
            <button type="button" onClick={() => void signOut()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-red-700 hover:bg-red-50"><LogOut className="h-4 w-4" />Sign out</button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
