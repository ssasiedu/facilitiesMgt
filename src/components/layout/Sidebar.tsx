import { NavLink } from 'react-router-dom';
import { ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useSettings } from '@/lib/settings';
import { appName } from '@/lib/supabaseClient';
import { cn } from '@/lib/cn';
import { NAV } from './nav';

export function Sidebar({ collapsed, onToggle, mobileOpen, onNavigate }: { collapsed: boolean; onToggle: () => void; mobileOpen: boolean; onNavigate: () => void }) {
  const { roles } = useAuth();
  const settings = useSettings();
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.show(roles)) })).filter((g) => g.items.length);
  return (
    <>
      {mobileOpen ? <div className="fixed inset-0 z-30 bg-stone-900/40 lg:hidden" onClick={onNavigate} aria-hidden /> : null}
      <aside className={cn('fixed inset-y-0 left-0 z-40 flex flex-col border-r border-stone-200 bg-white transition-all lg:static lg:translate-x-0',
        collapsed ? 'lg:w-[68px]' : 'lg:w-64', mobileOpen ? 'w-72 translate-x-0' : 'w-72 -translate-x-full')} aria-label="Main navigation">
        <div className="flex h-14 items-center gap-2 border-b border-stone-100 px-4">
          {settings?.logo_url ? <img src={settings.logo_url} alt="" className="h-8 w-8 rounded object-contain" /> : <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">FM</div>}
          {!collapsed ? <span className="truncate text-sm font-semibold">{settings?.company_name ?? appName}</span> : null}
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {groups.map((g) => (
            <div key={g.label} className="mb-4">
              {!collapsed ? <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-stone-400">{g.label}</p> : <div className="mx-2 mb-1 border-t border-stone-100" />}
              {g.items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.to === '/jobs' || i.to === '/contracts' || i.to === '/estimates' || i.to === '/supplies' || i.to === '/surveys'} onClick={onNavigate} title={collapsed ? i.label : undefined}
                  className={({ isActive }) => cn('flex min-h-[40px] items-center gap-3 rounded-lg px-2.5 text-sm font-medium', isActive ? 'bg-brand-50 text-brand-700' : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900')}>
                  <i.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />{!collapsed ? <span className="truncate">{i.label}</span> : null}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <button type="button" onClick={onToggle} className="hidden h-10 items-center justify-center border-t border-stone-100 text-stone-500 hover:bg-stone-50 lg:flex" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
      </aside>
    </>
  );
}
