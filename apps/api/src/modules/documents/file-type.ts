import { basename } from 'node:path';

/**
 * Allow-listed document formats (plan, D16). The type is decided by the file's
 * leading bytes ("magic numbers"); the browser's MIME type and the file name are
 * never trusted. The extension must agree with the detected content.
 */
export const ALLOWED_TYPES = {
  'application/pdf': { signature: [0x25, 0x50, 0x44, 0x46, 0x2d], extensions: ['pdf'] }, // %PDF-
  'image/png': {
    signature: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    extensions: ['png'],
  },
  'image/jpeg': { signature: [0xff, 0xd8, 0xff], extensions: ['jpg', 'jpeg'] },
} as const;

export type AllowedMimeType = keyof typeof ALLOWED_TYPES;

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const ALLOWED_EXTENSIONS = Object.values(ALLOWED_TYPES).flatMap((t) => t.extensions);

export function detectMimeType(data: Buffer): AllowedMimeType | null {
  for (const [mime, { signature }] of Object.entries(ALLOWED_TYPES)) {
    if (data.length >= signature.length && signature.every((byte, i) => data[i] === byte)) {
      return mime as AllowedMimeType;
    }
  }
  return null;
}

export function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : '';
}

/**
 * Original name kept only as display metadata: directory parts, control
 * characters and quotes are stripped; length capped.
 */
export function sanitizeOriginalName(raw: string): string {
  const name = basename(raw.replace(/\\/g, '/'))
    // Control characters are exactly what must be stripped here.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"<>|*?:]/g, '')
    .trim()
    .slice(-200);
  return name || 'documento';
}

export type FileCheck =
  | { ok: true; mimeType: AllowedMimeType }
  | { ok: false; reason: 'empty' | 'too-large' | 'unsupported-type' | 'extension-mismatch' };

export function checkFile(data: Buffer, originalName: string): FileCheck {
  if (data.length === 0) return { ok: false, reason: 'empty' };
  if (data.length > MAX_DOCUMENT_BYTES) return { ok: false, reason: 'too-large' };
  const mimeType = detectMimeType(data);
  if (!mimeType) return { ok: false, reason: 'unsupported-type' };
  const ext = extensionOf(originalName);
  if (!(ALLOWED_TYPES[mimeType].extensions as readonly string[]).includes(ext)) {
    return { ok: false, reason: 'extension-mismatch' };
  }
  return { ok: true, mimeType };
}

/** RFC 6266 / 5987 Content-Disposition that is safe for any original name. */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\;]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
