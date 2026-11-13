import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: string }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {back ? <Link to={back} className="mb-1 inline-flex items-center text-sm text-stone-500 hover:text-stone-800"><ChevronLeft className="h-4 w-4" />Back</Link> : null}
        <h1 className="truncate text-xl font-semibold text-stone-900 sm:text-2xl">{title}</h1>
        {subtitle ? <div className="mt-1 text-sm text-stone-500">{subtitle}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
