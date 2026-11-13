import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { check } from '@/lib/rpc';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { Button } from './Button';
import { Textarea } from './Textarea';

type Entity = 'customer' | 'job_order' | 'contract' | 'lead' | 'invoice' | 'estimate' | 'truck';

export function CommentsPanel({ entityType, entityId }: { entityType: Entity; entityId: string }) {
  const qc = useQueryClient();
  const { profile } = useAuth();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const key = ['comments', entityType, entityId];
  const { data = [] } = useQuery({
    queryKey: key,
    queryFn: async () => check(await supabase.from('comments').select('id, body, created_at, author:profiles(full_name)').eq('entity_type', entityType).eq('entity_id', entityId).order('created_at', { ascending: false })) as { id: string; body: string; created_at: string; author: { full_name: string } | null }[],
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Textarea className="flex-1" label="Add a comment" rows={2} value={body} onChange={(e) => setBody(e.target.value)} />
        <Button loading={busy} disabled={!body.trim()} onClick={async () => {
          setBusy(true);
          try {
            check(await supabase.from('comments').insert({ entity_type: entityType, entity_id: entityId, body: body.trim(), author_id: profile?.id }));
            setBody(''); await qc.invalidateQueries({ queryKey: key });
          } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
        }}>Post</Button>
      </div>
      <ul className="divide-y divide-stone-100">
        {data.map((c) => (
          <li key={c.id} className="py-2">
            <p className="whitespace-pre-wrap text-sm text-stone-800">{c.body}</p>
            <p className="text-xs text-stone-500">{c.author?.full_name ?? 'Unknown'} · {formatDateTime(c.created_at)}</p>
          </li>
        ))}
        {!data.length ? <li className="py-2 text-sm text-stone-500">No comments yet.</li> : null}
      </ul>
    </div>
  );
}
