import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabaseClient';
import { check } from '@/lib/rpc';
import { signedUrl, type Bucket } from '@/lib/storage';
import { formatDateTime } from '@/lib/format';
import { FileUpload } from './FileUpload';
import { Button } from './Button';

/** Attachments on any major record (files live in a private bucket, opened through signed URLs). */
export function AttachmentsPanel({ entityType, entityId, bucket, folder, canUpload = true }: { entityType: string; entityId: string; bucket: Bucket; folder: string; canUpload?: boolean }) {
  const qc = useQueryClient();
  const key = ['attachments', entityType, entityId];
  const { data = [] } = useQuery({
    queryKey: key,
    queryFn: async () => check(await supabase.from('attachments').select('*').eq('entity_type', entityType).eq('entity_id', entityId).order('created_at', { ascending: false })) as { id: string; file_name: string; file_path: string; bucket: Bucket; created_at: string }[],
  });
  return (
    <div className="space-y-3">
      {canUpload ? (
        <FileUpload bucket={bucket} folder={folder} label="Attach file" onUploaded={async (path, file) => {
          check(await supabase.from('attachments').insert({ entity_type: entityType, entity_id: entityId, bucket, file_path: path, file_name: file.name, mime_type: file.type, size_bytes: file.size }));
          await qc.invalidateQueries({ queryKey: key });
        }} />
      ) : null}
      <ul className="divide-y divide-stone-100">
        {data.map((a) => (
          <li key={a.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <div className="min-w-0"><p className="truncate font-medium">{a.file_name}</p><p className="text-xs text-stone-500">{formatDateTime(a.created_at)}</p></div>
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" aria-label="Open" onClick={async () => { try { window.open(await signedUrl(a.bucket, a.file_path), '_blank'); } catch (e) { toast.error((e as Error).message); } }}><ExternalLink className="h-4 w-4" /></Button>
              <Button variant="ghost" size="sm" aria-label="Remove" onClick={async () => {
                const { error } = await supabase.from('attachments').delete().eq('id', a.id);
                if (error) toast.error(error.message); else await qc.invalidateQueries({ queryKey: key });
              }}><Trash2 className="h-4 w-4" /></Button>
            </div>
          </li>
        ))}
        {!data.length ? <li className="py-2 text-sm text-stone-500">No attachments.</li> : null}
      </ul>
    </div>
  );
}
