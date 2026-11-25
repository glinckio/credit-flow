import { describe, expect, it } from 'vitest';
import { APPLICATION_STATUSES, ApplicationStatus, ROLES } from './enums.js';

describe('shared enums', () => {
  it('exposes the three initial roles', () => {
    expect(ROLES).toEqual(['ADMIN', 'ANALYST', 'OPERATOR']);
  });

  it('exposes the seven application statuses from the roadmap', () => {
    expect(APPLICATION_STATUSES).toHaveLength(7);
    expect(APPLICATION_STATUSES).toContain(ApplicationStatus.PENDING_INFORMATION);
  });
});
