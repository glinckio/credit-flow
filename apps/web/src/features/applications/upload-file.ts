export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg'];

/** Quick client-side check; the API re-validates the real content (magic bytes). */
export function checkUploadFile(file: { name: string; size: number }): string | null {
  const ext = file.name.includes('.') ? (file.name.split('.').pop()?.toLowerCase() ?? '') : '';
  if (!ACCEPTED_EXTENSIONS.includes(ext)) return 'Envie PDF, PNG ou JPEG.';
  if (file.size === 0) return 'O arquivo está vazio.';
  if (file.size > MAX_UPLOAD_BYTES) return 'O arquivo excede 10 MB.';
  return null;
}
