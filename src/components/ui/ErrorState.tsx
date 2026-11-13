import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50 px-6 py-10 text-center">
      <AlertTriangle className="mb-2 h-6 w-6 text-red-600" />
      <p className="text-sm font-medium text-red-800">Something went wrong</p>
      <p className="mt-1 max-w-md text-sm text-red-700">{(error as Error)?.message ?? String(error)}</p>
      {onRetry ? <Button variant="secondary" className="mt-4" onClick={onRetry}>Try again</Button> : null}
    </div>
  );
}
