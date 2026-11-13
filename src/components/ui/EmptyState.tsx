import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';

export function EmptyState({ title, message, action, icon }: { title: string; message?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 rounded-full bg-stone-100 p-3 text-stone-500">{icon ?? <Inbox className="h-6 w-6" />}</div>
      <h3 className="text-sm font-semibold text-stone-800">{title}</h3>
      {message ? <p className="mt-1 max-w-sm text-sm text-stone-500">{message}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
