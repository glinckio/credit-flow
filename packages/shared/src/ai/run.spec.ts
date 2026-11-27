import { describe, expect, it } from 'vitest';
import { requestCostUsd } from './run.js';

describe('requestCostUsd', () => {
  it('prices Claude Haiku 5.5 per request, with the tier decided by that request', () => {
    expect(requestCostUsd('claude-haiku-5-5', 4_500, 2_000)).toBe(0.00145); // 4.5k×0.10 + 2k×0.50
    expect(requestCostUsd('claude-haiku-5-5', 1_000_000, 0)).toBe(0.5); // above 100K: 0.50/MTok
  });

  it('is zero for models without a price (recorded answers)', () => {
    expect(requestCostUsd('recorded', 1_000_000, 1_000_000)).toBe(0);
  });
});
