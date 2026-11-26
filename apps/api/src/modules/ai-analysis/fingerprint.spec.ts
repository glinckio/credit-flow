import { inputFingerprint } from './fingerprint.js';

const docs = [
  { id: 'a', sha256: '1'.repeat(64) },
  { id: 'b', sha256: '2'.repeat(64) },
];
const base = { documents: docs, model: 'claude-haiku-5-5', promptVersion: 'p1' };

describe('inputFingerprint', () => {
  it('is a sha256 hex independent of document order', () => {
    expect(inputFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(inputFingerprint({ ...base, documents: [...docs].reverse() })).toBe(
      inputFingerprint(base),
    );
  });

  it('changes with the documents, the model or the prompt', () => {
    const fp = inputFingerprint(base);
    expect(inputFingerprint({ ...base, documents: docs.slice(1) })).not.toBe(fp);
    expect(
      inputFingerprint({ ...base, documents: [docs[0]!, { id: 'b', sha256: '3'.repeat(64) }] }),
    ).not.toBe(fp);
    expect(inputFingerprint({ ...base, model: 'other' })).not.toBe(fp);
    expect(inputFingerprint({ ...base, promptVersion: 'p2' })).not.toBe(fp);
  });
});
