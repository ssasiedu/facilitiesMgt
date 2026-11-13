import { useEffect, type ReactNode } from 'react';
import { applyBrandColor } from '@/lib/theme';
import { Spinner } from '@/components/ui/Spinner';

/** Branded frame for the pages customers open from an SMS or email link, with no login. */
export function PublicShell({ company, title, subtitle, children, footer }: {
  company?: { name?: string | null; logo_url?: string | null; brand_color?: string | null } | null;
  title?: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode;
}) {
  useEffect(() => { applyBrandColor(company?.brand_color ?? undefined); }, [company?.brand_color]);
  return (
    <div className="min-h-screen bg-stone-100 px-3 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-3xl">
        <header className="mb-4 flex items-center gap-3">
          {company?.logo_url ? <img src={company.logo_url} alt="" className="h-12 w-12 rounded-lg bg-white object-contain p-1" /> : null}
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-stone-900">{company?.name ?? 'FacilitiesManagement'}</p>
            {title ? <p className="text-sm text-stone-600">{title}</p> : null}
          </div>
        </header>
        <main className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6">
          {subtitle ? <div className="mb-4">{subtitle}</div> : null}
          {children}
        </main>
        <footer className="mt-4 text-center text-xs text-stone-500">
          {footer ?? <>This page was shared with you by {company?.name ?? 'us'}. Please do not forward the link.</>}
        </footer>
      </div>
    </div>
  );
}

export function PublicLoading() {
  return (
    <div className="min-h-screen bg-stone-100">
      <Spinner label="Opening…" />
    </div>
  );
}

export function PublicError({ message }: { message: string }) {
  return (
    <PublicShell title="Link problem">
      <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-medium">We could not open this page</p>
        <p className="mt-1">{message}</p>
        <p className="mt-3 text-amber-800">
          If you received this link by SMS or email, please reply to that message and ask for a new one.
        </p>
      </div>
    </PublicShell>
  );
}

/** Label / value rows used by the invoice, receipt and statement pages. */
export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs uppercase tracking-wide text-stone-500">{k}</dt>
          <dd className="mt-0.5 font-medium text-stone-900">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}
