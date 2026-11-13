import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabaseClient';
import { friendlyError } from './rpc';

export type Bucket = 'customer-documents' | 'job-photos' | 'fleet-documents' | 'expense-receipts' | 'task-evidence' | 'contracts' | 'branding';

export const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'application/pdf'];
export const MAX_BYTES = 5 * 1024 * 1024;

/** Resize and re-encode photos in the browser (cheap phones, mobile data). PDFs pass through untouched. */
export async function compressImage(file: File, maxDim = 1600, quality = 0.78): Promise<File> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
  if (!blob || blob.size >= file.size) return file;
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}

export function safeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9.]+/g, '-').replace(/-+/g, '-').slice(-80);
}

/** Validate, compress and upload; returns the storage path. */
export async function uploadFile(bucket: Bucket, folder: string, file: File, allowed: string[] = ALLOWED_TYPES): Promise<{ path: string; file: File }> {
  if (!allowed.includes(file.type)) throw new Error('Only JPG, PNG or PDF files are allowed');
  const ready = await compressImage(file);
  if (ready.size > MAX_BYTES) throw new Error('File is larger than 5 MB');
  const path = `${folder}/${Date.now()}-${safeName(ready.name)}`;
  const { error } = await supabase.storage.from(bucket).upload(path, ready, { contentType: ready.type, upsert: false });
  if (error) throw new Error(friendlyError(error));
  return { path, file: ready };
}

/** Private files are only shown through short-lived signed URLs. */
export async function signedUrl(bucket: Bucket, path: string, seconds = 600): Promise<string> {
  if (bucket === 'branding') return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, seconds);
  if (error) throw new Error(friendlyError(error));
  return data.signedUrl;
}

export function useSignedUrl(bucket: Bucket, path: string | null | undefined) {
  return useQuery({
    queryKey: ['signed-url', bucket, path],
    enabled: !!path,
    staleTime: 8 * 60_000,
    queryFn: () => signedUrl(bucket, path as string),
  });
}
