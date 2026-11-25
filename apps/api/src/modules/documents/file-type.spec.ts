import {
  MAX_DOCUMENT_BYTES,
  attachmentDisposition,
  checkFile,
  detectMimeType,
  extensionOf,
  sanitizeOriginalName,
} from './file-type.js';

const PDF = Buffer.from('%PDF-1.4\n%sintetico\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);
const EXE = Buffer.from('MZ\x90\x00\x03\x00\x00\x00');
const HTML = Buffer.from('<html><script>alert(1)</script></html>');

describe('detectMimeType', () => {
  it('recognises the three allowed formats by their magic bytes', () => {
    expect(detectMimeType(PDF)).toBe('application/pdf');
    expect(detectMimeType(PNG)).toBe('image/png');
    expect(detectMimeType(JPEG)).toBe('image/jpeg');
  });

  it('rejects everything else, including truncated signatures', () => {
    expect(detectMimeType(EXE)).toBeNull();
    expect(detectMimeType(HTML)).toBeNull();
    expect(detectMimeType(Buffer.from('%PD'))).toBeNull();
    expect(detectMimeType(Buffer.alloc(0))).toBeNull();
  });
});

describe('checkFile', () => {
  it('accepts content whose extension agrees (case-insensitive)', () => {
    expect(checkFile(PDF, 'renda.PDF')).toEqual({ ok: true, mimeType: 'application/pdf' });
    expect(checkFile(JPEG, 'rg.jpeg')).toEqual({ ok: true, mimeType: 'image/jpeg' });
    expect(checkFile(JPEG, 'rg.jpg')).toEqual({ ok: true, mimeType: 'image/jpeg' });
  });

  it('rejects renamed executables, mismatched extensions, empty and oversized files', () => {
    expect(checkFile(EXE, 'contrato.pdf')).toEqual({ ok: false, reason: 'unsupported-type' });
    expect(checkFile(PDF, 'foto.png')).toEqual({ ok: false, reason: 'extension-mismatch' });
    expect(checkFile(PDF, 'semextensao')).toEqual({ ok: false, reason: 'extension-mismatch' });
    expect(checkFile(Buffer.alloc(0), 'x.pdf')).toEqual({ ok: false, reason: 'empty' });
    const big = Buffer.concat([PDF, Buffer.alloc(MAX_DOCUMENT_BYTES)]);
    expect(checkFile(big, 'x.pdf')).toEqual({ ok: false, reason: 'too-large' });
  });
});

describe('file names', () => {
  it('extracts the extension', () => {
    expect(extensionOf('a.b.PdF')).toBe('pdf');
    expect(extensionOf('.pdf')).toBe('');
  });

  it('strips directories, control characters and dangerous punctuation', () => {
    expect(sanitizeOriginalName('../../etc/passwd.pdf')).toBe('passwd.pdf');
    expect(sanitizeOriginalName('C:\\Users\\x\\renda.pdf')).toBe('renda.pdf');
    expect(sanitizeOriginalName('a\u0000b\r\n"<c>.pdf')).toBe('abc.pdf');
    expect(sanitizeOriginalName('   ')).toBe('documento');
  });

  it('builds a safe Content-Disposition for non-ASCII names', () => {
    expect(attachmentDisposition('comprovante de renda – março.pdf')).toBe(
      `attachment; filename="comprovante de renda _ mar_o.pdf"; filename*=UTF-8''comprovante%20de%20renda%20%E2%80%93%20mar%C3%A7o.pdf`,
    );
  });
});
