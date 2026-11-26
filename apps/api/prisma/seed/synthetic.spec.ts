import { isValidCnpj, isValidCpf } from '@creditflow/shared';
import {
  buildSyntheticPdf,
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
