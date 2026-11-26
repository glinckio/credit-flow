import { isValidCnpj, isValidCpf } from '@creditflow/shared';
import {
  buildSyntheticPdf,
  buildSyntheticPdfPages,
  pdfVisibleText,
  sha256Hex,
  syntheticCnpj,
  syntheticCpf,
  syntheticEmail,
  syntheticPhone,
} from './synthetic.js';

/** Small deterministic PRNG (mulberry32) for repeatable tests. */
function seededRandomInt(seed: number) {
  let a = seed;
  return (min: number, max: number) => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return min + Math.floor(r * (max - min + 1));
  };
}

describe('synthetic identifiers', () => {
  it('generates check-digit-valid CPFs and CNPJs', () => {
    const rnd = seededRandomInt(42);
    for (let i = 0; i < 200; i++) {
      expect(isValidCpf(syntheticCpf(rnd))).toBe(true);
      expect(isValidCnpj(syntheticCnpj(rnd))).toBe(true);
    }
  });

  it('is deterministic for the same random source', () => {
    expect(syntheticCpf(seededRandomInt(7))).toBe(syntheticCpf(seededRandomInt(7)));
  });

  it('uses only reserved/fictitious contact data', () => {
    expect(syntheticEmail('João da Silva')).toBe('joao.da.silva@exemplo.test');
    expect(syntheticPhone(12)).toBe('+55 11 90000-0012');
  });
});

describe('buildSyntheticPdf', () => {
  const pdf = buildSyntheticPdf(['DOCUMENTO SINTÉTICO', 'Cliente (demo): Ana']);
  const text = pdf.toString('latin1');

  it('starts with the PDF magic bytes and ends with %%EOF', () => {
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });

  it('has a consistent xref table (every offset points at its object)', () => {
    const xrefStart = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    expect(text.slice(xrefStart, xrefStart + 4)).toBe('xref');
    const offsets = [...text.slice(xrefStart).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    );
    expect(offsets).toHaveLength(5);
    offsets.forEach((offset, i) => {
      expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
  });

  it('escapes parentheses and strips accents', () => {
    expect(text).toContain('(DOCUMENTO SINTETICO)');
    expect(text).toContain('Cliente \\(demo\\): Ana');
  });

  it('hashes deterministically', () => {
    expect(sha256Hex(pdf)).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(pdf)).toBe(
      sha256Hex(buildSyntheticPdf(['DOCUMENTO SINTÉTICO', 'Cliente (demo): Ana'])),
    );
  });
});

describe('buildSyntheticPdfPages', () => {
  it('produces exactly the single-page bytes of buildSyntheticPdf', () => {
    const lines = ['DOCUMENTO SINTETICO', 'Renda: R$ 1,00'];
    expect(buildSyntheticPdfPages([{ lines }]).equals(buildSyntheticPdf(lines))).toBe(true);
  });

  it('writes several pages with a consistent xref and a text-less scanned page', () => {
    const pdf = buildSyntheticPdfPages([
      { lines: ['p1'] },
      { scan: true, variant: 3 },
      { lines: ['p3'] },
    ]);
    const text = pdf.toString('latin1');
    expect(text).toContain('/Kids [3 0 R 6 0 R 8 0 R] /Count 3');
    const xrefStart = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    const offsets = [...text.slice(xrefStart).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    );
    expect(offsets).toHaveLength(9);
    offsets.forEach((offset, i) => {
      expect(text.slice(offset, offset + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
    // The scanned page has no text operators.
    const scanStream =
      /7 0 obj\n<< \/Length \d+ >>\nstream\n([\s\S]*?)\nendstream/.exec(text)?.[1] ?? '';
    expect(scanStream).not.toMatch(/BT|Tj|'/);
  });

  it('varies scan bytes by variant', () => {
    expect(
      buildSyntheticPdfPages([{ scan: true, variant: 1 }]).equals(
        buildSyntheticPdfPages([{ scan: true, variant: 2 }]),
      ),
    ).toBe(false);
  });

  it('exposes the visible text a reader recovers', () => {
    expect(pdfVisibleText('Líquido: R$ 1,00 (ok)')).toBe('Liquido: R$ 1,00 (ok)');
  });
});
