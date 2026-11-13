import { WifiOff, UploadCloud } from 'lucide-react';
import { useOfflineQueue } from '@/lib/offlineQueue';

export function OfflineBanner() {
  const { online, pending } = useOfflineQueue();
  if (online && !pending) return null;
  return (
    <div role="status" className={online ? 'flex items-center gap-2 bg-blue-50 px-4 py-2 text-sm text-blue-800' : 'flex items-center gap-2 bg-amber-50 px-4 py-2 text-sm text-amber-900'}>
      {online ? <UploadCloud className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
      {online ? `Sending ${pending} saved update(s)…` : `You are offline. ${pending ? `${pending} update(s) saved on this phone; ` : ''}changes will be sent when you reconnect.`}
    </div>
  );
}
