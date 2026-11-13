import { Loader2 } from 'lucide-react';

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div className="flex items-center justify-center gap-2 p-6 text-sm text-stone-500" role="status"><Loader2 className="h-5 w-5 animate-spin" />{label}</div>;
}

export function FullPageSpinner() {
  return <div className="flex min-h-screen items-center justify-center"><Spinner /></div>;
}
