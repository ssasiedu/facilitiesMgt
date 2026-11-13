import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { supabase } from './supabaseClient';
import { friendlyError } from './rpc';

export interface ServerTableOptions {
  table: string;
  select?: string;
  /** columns searched with ilike */
  searchColumns?: string[];
  defaultSort?: { column: string; ascending: boolean };
  pageSize?: number;
  /** extra filters; values of '' / null / undefined are ignored. Prefix a key with ! for "not equal", ~ for ilike, >= / <= for ranges */
  filters?: Record<string, string | number | boolean | null | undefined | string[]>;
  enabled?: boolean;
  queryKey?: unknown[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilters(q: any, filters: ServerTableOptions['filters']) {
  for (const [rawKey, value] of Object.entries(filters ?? {})) {
    if (value === '' || value === null || value === undefined) continue;
    if (Array.isArray(value)) { if (value.length) q = q.in(rawKey, value); continue; }
    if (rawKey.startsWith('!')) q = q.neq(rawKey.slice(1), value);
    else if (rawKey.startsWith('~')) q = q.ilike(rawKey.slice(1), `%${value}%`);
    else if (rawKey.startsWith('>=')) q = q.gte(rawKey.slice(2), value);
    else if (rawKey.startsWith('<=')) q = q.lte(rawKey.slice(2), value);
    else if (rawKey.startsWith('is:')) q = value === 'null' ? q.is(rawKey.slice(3), null) : q.not(rawKey.slice(3), 'is', null);
    else q = q.eq(rawKey, value);
  }
  return q;
}

/** Server-side pagination, sorting, search and filtering for any table or view. */
export function useServerTable<T>(opts: ServerTableOptions) {
  const pageSize = opts.pageSize ?? 25;
  const [page, setPage] = useState(0);
  const [search, setSearchRaw] = useState('');
  const [sort, setSort] = useState(opts.defaultSort ?? { column: 'created_at', ascending: false });
  const setSearch = (s: string) => { setSearchRaw(s); setPage(0); };

  const key = useMemo(() => [opts.table, opts.select, opts.filters, search, sort, page, pageSize, ...(opts.queryKey ?? [])], [opts.table, opts.select, opts.filters, search, sort, page, pageSize, opts.queryKey]);
  const query = useQuery({
    queryKey: ['table', ...key],
    enabled: opts.enabled ?? true,
    placeholderData: keepPreviousData,
    queryFn: async () => {
      let q = supabase.from(opts.table).select(opts.select ?? '*', { count: 'exact' });
      q = applyFilters(q, opts.filters);
      const s = search.trim().replace(/[,()]/g, ' ');
      if (s && opts.searchColumns?.length) q = q.or(opts.searchColumns.map((c) => `${c}.ilike.%${s}%`).join(','));
      q = q.order(sort.column, { ascending: sort.ascending, nullsFirst: false }).range(page * pageSize, page * pageSize + pageSize - 1);
      const { data, count, error } = await q;
      if (error) throw new Error(friendlyError(error));
      return { rows: (data ?? []) as T[], count: count ?? 0 };
    },
  });

  /** Fetch every row matching the current filters (for export), in chunks of 1,000. */
  const fetchAll = async (): Promise<T[]> => {
    const all: T[] = [];
    for (let from = 0; ; from += 1000) {
      let q = supabase.from(opts.table).select(opts.select ?? '*');
      q = applyFilters(q, opts.filters);
      const s = search.trim().replace(/[,()]/g, ' ');
      if (s && opts.searchColumns?.length) q = q.or(opts.searchColumns.map((c) => `${c}.ilike.%${s}%`).join(','));
      const { data, error } = await q.order(sort.column, { ascending: sort.ascending }).range(from, from + 999);
      if (error) throw new Error(friendlyError(error));
      all.push(...((data ?? []) as T[]));
      if (!data || data.length < 1000) break;
    }
    return all;
  };

  return {
    rows: query.data?.rows ?? [], count: query.data?.count ?? 0, isLoading: query.isLoading, isFetching: query.isFetching,
    error: query.error as Error | null, refetch: query.refetch, page, setPage, pageSize, search, setSearch, sort,
    toggleSort: (column: string) => setSort((s) => ({ column, ascending: s.column === column ? !s.ascending : true })),
    fetchAll,
  };
}
