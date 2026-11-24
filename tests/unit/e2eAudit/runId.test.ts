// tests/unit/e2eAudit/runId.test.ts
//
// The run id from tests/e2e/support/marker.ts must be a RUN_ID_PATTERN id, because
// every artifact path, the upload ledger and the run manifest are built from it and
// refuse anything else (Req 29.5). It must also order by start time as a string,
// which is what `supersededRuns` relies on (Req 29.6).

import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { RUN_ID_PATTERN } from '../../e2e/audit/core/artifactPaths';
import { newRunId, runId, RUN_ID_ENV } from '../../e2e/support/marker';

const original = process.env[RUN_ID_ENV];

afterEach(() => {
  if (original === undefined) delete process.env[RUN_ID_ENV];
  else process.env[RUN_ID_ENV] = original;
});

describe('newRunId', () => {
  it('formats the UTC second with - for :', () => {
    expect(newRunId(new Date('2026-12-01T09:30:00.987Z'), 'a1b2c3d')).toBe(
      '2026-12-01T09-30-00Z-a1b2c3d',
    );
  });

  it('refuses an invalid date or suffix', () => {
    expect(() => newRunId(new Date('nope'))).toThrow(RangeError);
    expect(() => newRunId(new Date(), 'Bad_Suffix')).toThrow(RangeError);
  });

  it('always matches RUN_ID_PATTERN and orders by start time', () => {
    const instant = fc.date({
      min: new Date('2000-01-01T00:00:00Z'),
      max: new Date('9999-12-31T23:59:59Z'),
      noInvalidDate: true,
    });
    fc.assert(
      fc.property(instant, instant, (a, b) => {
        const idA = newRunId(a);
        const idB = newRunId(b);
        expect(idA).toMatch(RUN_ID_PATTERN);
        const secondA = Math.floor(a.getTime() / 1000);
        const secondB = Math.floor(b.getTime() / 1000);
        if (secondA < secondB) expect(idA < idB).toBe(true);
      }),
    );
  });
});

describe('runId', () => {
  it('generates once and reuses the value through E2E_RUN_ID', () => {
    delete process.env[RUN_ID_ENV];
    const first = runId();
    expect(first).toMatch(RUN_ID_PATTERN);
    expect(process.env[RUN_ID_ENV]).toBe(first);
    expect(runId()).toBe(first);
  });

  it('reads a valid E2E_RUN_ID and refuses an invalid one', () => {
    process.env[RUN_ID_ENV] = '2026-12-01T09-30-00Z-abc';
    expect(runId()).toBe('2026-12-01T09-30-00Z-abc');
    process.env[RUN_ID_ENV] = 'not-a-run';
    expect(() => runId()).toThrow(/not a run id/);
  });
});
