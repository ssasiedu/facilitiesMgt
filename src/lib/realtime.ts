import { useEffect } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { supabase } from './supabaseClient';

/** Invalidate queries when rows change (RLS still applies to what each user receives). */
export function useRealtimeInvalidate(tables: string[], keys: QueryKey[], filter?: string) {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase.channel(`rt-${tables.join('-')}-${filter ?? 'all'}-${Math.random().toString(36).slice(2, 8)}`);
    for (const table of tables) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, () => {
        keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
      });
    }
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables.join(','), filter]);
}
