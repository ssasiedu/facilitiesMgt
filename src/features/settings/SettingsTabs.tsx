import { NavLink } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { hasAny, type Role } from '@/lib/permissions';
import { cn } from '@/lib/cn';

const TABS: { to: string; label: string; roles: Role[] }[] = [
  { to: '/settings/company', label: 'Company', roles: ['super_admin'] },
  { to: '/settings/users', label: 'Users and roles', roles: ['super_admin'] },
  { to: '/settings/taxes', label: 'Taxes', roles: ['super_admin'] },
  { to: '/settings/templates', label: 'Messages', roles: ['super_admin'] },
  { to: '/settings/config', label: 'Configuration', roles: ['super_admin'] },
  { to: '/settings/audit', label: 'Audit log', roles: ['super_admin', 'manager', 'accountant', 'executive'] },
  { to: '/settings/export', label: 'Data export', roles: ['super_admin'] },
];

/** The settings sub-navigation, shown on every settings screen. */
export function SettingsTabs() {
  const { roles } = useAuth();
  const visible = TABS.filter((t) => hasAny(roles, ...t.roles));
  return (
    <nav aria-label="Settings sections" className="-mx-4 overflow-x-auto px-4">
      <ul className="flex min-w-max gap-1 border-b border-stone-200">
        {visible.map((t) => (
          <li key={t.to}>
            <NavLink to={t.to} className={({ isActive }) => cn(
              'inline-flex min-h-[44px] items-center whitespace-nowrap border-b-2 px-3 text-sm font-medium',
              isActive ? 'border-brand-600 text-brand-700' : 'border-transparent text-stone-600 hover:text-stone-900',
            )}>{t.label}</NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
