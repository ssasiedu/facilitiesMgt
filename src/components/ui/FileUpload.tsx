import { useRef, useState } from 'react';
import { Paperclip, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { uploadFile, type Bucket } from '@/lib/storage';
import { Button } from './Button';

/** Picks a file (camera on phones), compresses images, uploads to a private bucket and returns the path. */
export function FileUpload({ bucket, folder, onUploaded, label = 'Upload file', accept = 'image/jpeg,image/png,application/pdf', capture, disabled }: {
  bucket: Bucket; folder: string; onUploaded: (path: string, file: File) => void | Promise<void>; label?: string; accept?: string; capture?: boolean; disabled?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input ref={ref} type="file" className="hidden" accept={accept} {...(capture ? { capture: 'environment' as const } : {})}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setBusy(true);
          try {
            const { path, file } = await uploadFile(bucket, folder, f, accept.split(','));
            await onUploaded(path, file);
            toast.success('Uploaded');
          } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
        }} />
      <Button variant="secondary" size="sm" loading={busy} disabled={disabled} icon={capture ? <Upload className="h-4 w-4" /> : <Paperclip className="h-4 w-4" />} onClick={() => ref.current?.click()}>{label}</Button>
    </>
  );
}
