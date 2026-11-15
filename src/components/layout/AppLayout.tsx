import { Suspense, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { OfflineBanner } from './OfflineBanner';
import { PasswordBanner } from './PasswordBanner';
import { PageSkeleton } from '@/components/ui/Skeleton';

export function AppLayout() {
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('fm-sidebar') === 'collapsed');
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  return (
    <div className="flex min-h-screen">
      <Sidebar collapsed={collapsed} mobileOpen={mobileOpen} onNavigate={() => setMobileOpen(false)}
        onToggle={() => { const c = !collapsed; setCollapsed(c); localStorage.setItem('fm-sidebar', c ? 'collapsed' : 'open'); }} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMobileOpen(true)} />
        <OfflineBanner />
        <PasswordBanner />
        <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-4 sm:px-6 sm:py-6" key={location.pathname}>
          <Suspense fallback={<PageSkeleton />}><Outlet /></Suspense>
        </main>
      </div>
    </div>
  );
}
