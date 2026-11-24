// Unit tests for tests/e2e/audit/core/findings.ts (Req 3.5).
import { describe, expect, it } from 'vitest';
import {
  findingDraft,
  findingEntries,
  nextFindingNumber,
  type FindingPathway,
} from '../e2e/audit/core/findings';

const FINDINGS = [
  '# E2E findings',
  '---',
  '## F2 — Seed accounts could not sign in (severity 4, FIXED)',
  '## F72 — A declined offer (severity 2, OPEN)',
  '### F90 UPDATE - not a heading that claims a number',
  '## F21 - The trade room (severity 2, OPEN)',
  'Prose mentioning F99 does not count.',
].join('\r\n');

function record(over: Partial<FindingPathway> = {}): FindingPathway {
  return {
    declaration: { id: 'cash-sale.buy-now', title: 'Buy now by card', kind: 'happy' },
    viewport: 'desktop',
    runId: 'run-1',
    status: 'passed',
    steps: [],
    ...over,
  };
}

describe('nextFindingNumber', () => {
  it('continues from the largest two-hash heading, in any order, CRLF included', () => {
    expect(nextFindingNumber(FINDINGS)).toBe(73);
  });

  it('starts at 1 for a file with no findings', () => {
    expect(nextFindingNumber('# E2E findings\n')).toBe(1);
  });
});

describe('findingDraft', () => {
  it('drafts a failed Pathway and each distinct unsuppressed blocking observation', () => {
    const blocking = {
      check: 'overflow', severity: 'blocking' as const, member: 'buyer', url: '/sales/x',
      message: 'Page is 14 px wider than the viewport.',
    };
    const records = [
      record({
        status: 'failed',
        declaration: { id: 'cash-sale.buy-now', title: 'Buy now by card', kind: 'happy', knownFindings: ['F21'] },
        tracePath: 'audit-artifacts/cash-sale.buy-now/desktop/run-1/trace.zip',
        steps: [{
          index: 2, name: 'Buyer pays', status: 'failed', error: 'Timed out\nwaiting',
          observations: [
            blocking,
            blocking,
            { ...blocking, severity: 'advisory', message: 'advisory' },
            { ...blocking, message: 'suppressed', suppressedBy: 'known layout' },
          ],
        }],
      }),
      record({ declaration: { id: 'offers.decline', title: 'Decline', kind: 'refusal' } }),
    ];

    const entries = findingEntries(FINDINGS, records);
    expect(entries.map((e) => [e.number, e.severity])).toEqual([[73, 4], [74, 2]]);

    const md = findingDraft(FINDINGS, records);
    expect(md).toContain('## F73 — Buy now by card fails on desktop (severity 4, OPEN)');
    expect(md).toContain('**Symptom.** The Pathway failed at step 2, "Buyer pays": Timed out waiting');
    expect(md).toContain('## F74 — overflow on Buy now by card (desktop) (severity 2, OPEN)');
    expect(md).toContain('F21');
    expect(md).not.toContain('advisory.');
    expect(md).not.toContain('suppressed');
    expect(md.split('\n---\n')).toHaveLength(3);
  });

  it('says there is nothing to draft for a clean run', () => {
    expect(findingDraft(FINDINGS, [record()])).toContain('Nothing to draft');
  });
});
