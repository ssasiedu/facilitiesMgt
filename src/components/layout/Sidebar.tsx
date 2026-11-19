import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useSettings } from '@/lib/settings';
import { appName } from '@/lib/supabaseClient';
import { cn } from '@/lib/cn';
import { NAV } from './nav';

const SHUT_KEY = 'fm:nav-shut';

/** Which groups the person last folded away. Kept per browser; a failure here is never fatal. */
function loadShut(): string[] {
  try {
    const raw = localStorage.getItem(SHUT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch { return []; }
}

export function Sidebar({ collapsed, onToggle, mobileOpen, onNavigate }: { collapsed: boolean; onToggle: () => void; mobileOpen: boolean; onNavigate: () => void }) {
  const { roles } = useAuth();
  const settings = useSettings();
  const { pathname } = useLocation();
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.show(roles)) })).filter((g) => g.items.length);

  const [shut, setShut] = useState<string[]>(loadShut);
  useEffect(() => {
    try { localStorage.setItem(SHUT_KEY, JSON.stringify(shut)); } catch { /* a full or blocked store is not worth failing over */ }
  }, [shut]);

  const toggleGroup = (label: string) =>
    setShut((s) => (s.includes(label) ? s.filter((x) => x !== label) : [...s, label]));

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
          {groups.map((g) => {
            // A group holding the page you are on never hides, or the current page would vanish.
            const hasCurrent = g.items.some((i) => pathname === i.to || pathname.startsWith(`${i.to}/`));
            const open = collapsed || hasCurrent || !shut.includes(g.label);
            const panelId = `nav-${g.label.toLowerCase().replace(/\s+/g, '-')}`;
            return (
              <div key={g.label} className="mb-4">
                {collapsed ? (
                  <div className="mx-2 mb-1 border-t border-stone-100" />
                ) : (
                  <button type="button" onClick={() => toggleGroup(g.label)} aria-expanded={open} aria-controls={panelId}
                    title={hasCurrent && shut.includes(g.label) ? 'Holds the page you are on' : open ? `Hide ${g.label}` : `Show ${g.label}`}
                    className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-stone-400 hover:bg-stone-50 hover:text-stone-600">
                    <span className="truncate">{g.label}</span>
                    <span className="flex items-center gap-1">
                      {!open ? <span className="rounded-full bg-stone-100 px-1.5 text-[10px] font-semibold text-stone-500">{g.items.length}</span> : null}
                      <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !open && '-rotate-90')} aria-hidden />
                    </span>
                  </button>
                )}
                <div id={panelId} hidden={!open}>
                  {g.items.map((i) => (
                    <NavLink key={i.to} to={i.to} end={i.to === '/jobs' || i.to === '/contracts' || i.to === '/estimates' || i.to === '/supplies' || i.to === '/surveys'} onClick={onNavigate} title={collapsed ? i.label : undefined}
                      className={({ isActive }) => cn('flex min-h-[40px] items-center gap-3 rounded-lg px-2.5 text-sm font-medium', isActive ? 'bg-brand-50 text-brand-700' : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900')}>
                      <i.icon className="h-[18px] w-[18px] shrink-0" aria-hidden />{!collapsed ? <span className="truncate">{i.label}</span> : null}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <button type="button" onClick={onToggle} className="hidden h-10 items-center justify-center border-t border-stone-100 text-stone-500 hover:bg-stone-50 lg:flex" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
        </button>
      </aside>
    </>
  );
}
