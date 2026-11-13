import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { supabase } from '@/lib/supabaseClient';
import { check, rpc } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { useRealtimeInvalidate } from '@/lib/realtime';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';

interface Note { id: string; title: string; body: string | null; link: string | null; severity: string; read_at: string | null; created_at: string }

export function NotificationBell() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const key = ['in_app_notifications', profile?.id];
  const { data = [] } = useQuery({
    queryKey: key, enabled: !!profile,
    queryFn: async () => check(await supabase.from('in_app_notifications').select('*').eq('profile_id', profile!.id).order('created_at', { ascending: false }).limit(30)) as Note[],
  });
  useRealtimeInvalidate(['in_app_notifications'], [key], profile ? `profile_id=eq.${profile.id}` : undefined);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const unread = data.filter((n) => !n.read_at).length;
  return (
    <div className="relative" ref={ref}>
      <button type="button" className="relative rounded-lg p-2 text-stone-600 hover:bg-stone-100" aria-label={`Notifications (${unread} unread)`} onClick={() => setOpen(!open)}>
        <Bell className="h-5 w-5" />
        {unread ? <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span> : null}
      </button>
      {open ? (
        <div className="absolute right-0 z-50 mt-2 w-[min(92vw,380px)] overflow-hidden rounded-xl border border-stone-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-stone-100 px-4 py-2">
            <span className="text-sm font-semibold">Notifications</span>
            <button type="button" className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline" onClick={async () => { await rpc('mark_notifications_read', {}); await qc.invalidateQueries({ queryKey: key }); }}>
              <CheckCheck className="h-3.5 w-3.5" />Mark all read
            </button>
          </div>
          <ul className="max-h-96 divide-y divide-stone-100 overflow-y-auto">
            {data.map((n) => (
              <li key={n.id}>
                <button type="button" className={cn('w-full px-4 py-3 text-left hover:bg-stone-50', !n.read_at && 'bg-brand-50/50')} onClick={async () => {
                  await rpc('mark_notifications_read', { p_ids: [n.id] }); await qc.invalidateQueries({ queryKey: key });
                  setOpen(false); if (n.link) navigate(n.link);
                }}>
                  <p className={cn('text-sm font-medium', n.severity === 'danger' ? 'text-red-700' : n.severity === 'warning' ? 'text-amber-700' : 'text-stone-800')}>{n.title}</p>
                  {n.body ? <p className="line-clamp-2 text-xs text-stone-600">{n.body}</p> : null}
                  <p className="mt-0.5 text-[11px] text-stone-400">{formatDateTime(n.created_at)}</p>
                </button>
              </li>
            ))}
            {!data.length ? <li className="px-4 py-6 text-center text-sm text-stone-500">You are all caught up.</li> : null}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
