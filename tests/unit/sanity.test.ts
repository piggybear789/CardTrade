import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

// Trivial sanity test for the Node (domain/property) project. Confirms Vitest
// and fast-check are wired up and running in the correct environment.
describe('test tooling sanity (domain project)', () => {
  it('runs a basic assertion', () => {
    expect(1 + 1).toBe(2);
  });

  it('runs a trivial fast-check property', () => {
    fc.assert(
      fc.property(fc.integer(), (n) => n + 0 === n),
      { numRuns: 100 },
    );
  });
});
