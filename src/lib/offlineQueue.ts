import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

// Zonal officers work on mobile data. Task updates and GPS check-ins made offline are kept on the phone
// and sent when the connection returns. Each item has a client_ref so a resend never creates a duplicate.
const KEY = 'fm-offline-queue-v1';

export type QueuedItem =
  | { kind: 'task_update'; ref: string; payload: { task_id: string; status?: string | null; notes?: string | null; next_step?: string | null; follow_up_date?: string | null; deal_value?: number | null } }
  | { kind: 'task_checkin'; ref: string; payload: { task_id: string; lat: number; lng: number; accuracy_m?: number | null; checked_in_at: string } };

type NewItem =
  | { kind: 'task_update'; payload: Extract<QueuedItem, { kind: 'task_update' }>['payload'] }
  | { kind: 'task_checkin'; payload: Extract<QueuedItem, { kind: 'task_checkin' }>['payload'] };

function read(): QueuedItem[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]') as QueuedItem[]; } catch { return []; }
}
function write(items: QueuedItem[]) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* storage full or blocked */ }
  window.dispatchEvent(new Event('fm-queue-changed'));
}

export function newRef(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function sendOne(item: QueuedItem): Promise<void> {
  const table = item.kind === 'task_update' ? 'task_updates' : 'task_checkins';
  const { error } = await supabase.from(table).upsert({ ...item.payload, client_ref: item.ref }, { onConflict: 'client_ref', ignoreDuplicates: true });
  if (error) throw error;
}

/** Try to send now; if offline or it fails on the network, keep it in the queue. */
export async function submitOrQueue(item: NewItem): Promise<'sent' | 'queued'> {
  const full = { ...item, ref: newRef() } as QueuedItem;
  if (navigator.onLine) {
    try { await sendOne(full); return 'sent'; } catch (e) {
      if (!/fetch|network/i.test(String((e as Error).message))) throw e;
    }
  }
  write([...read(), full]);
  return 'queued';
}

let flushing = false;
export async function flushQueue(): Promise<number> {
  if (flushing || !navigator.onLine) return 0;
  flushing = true;
  let sent = 0;
  try {
    const items = read();
    const left: QueuedItem[] = [];
    for (const it of items) {
      try { await sendOne(it); sent++; } catch { left.push(it); }
    }
    write(left);
  } finally { flushing = false; }
  return sent;
}

export function useOfflineQueue() {
  const [count, setCount] = useState(() => read().length);
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setCount(read().length);
    const on = () => { setOnline(true); void flushQueue(); };
    const off = () => setOnline(false);
    window.addEventListener('fm-queue-changed', update);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    void flushQueue();
    return () => { window.removeEventListener('fm-queue-changed', update); window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return { pending: count, online };
}
