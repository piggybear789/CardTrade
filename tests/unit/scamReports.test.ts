// tests/unit/scamReports.test.ts
//
// The pure rules of off-platform scam reports (scam-reports spec): normalisation,
// fingerprints, validation, cluster strength and the fraud-ban guard.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  CORROBORATION_THRESHOLD,
  canFraudBan,
  clusterStrength,
  expandIdentifier,
  identifierHash,
  isCorroborated,
  maskIdentifier,
  matchStrength,
  normaliseBankAccount,
  normaliseIdentifier,
  normalisePhone,
  validateScamReport,
  type ClusterReport,
  type NormalisedIdentifier,
  type RawIdentifier,
  type ScamReportInput,
} from '@/domain/risk/scamReports';

const SECRET = 'test-secret';
const NOW = new Date('2026-10-16T00:00:00Z');

function hashOf(raw: RawIdentifier): string | null {
  const normalised = normaliseIdentifier(raw);
  return normalised ? identifierHash(normalised, SECRET) : null;
}

describe('normalisation', () => {
  it('is idempotent for every kind', () => {
    const samples: RawIdentifier[] = [
      { kind: 'PAYID_EMAIL', value: '  Scam.Person@Example.COM ' },
      { kind: 'PAYPAL_EMAIL', value: 'pay@example.com' },
      { kind: 'PAYID_PHONE', value: '0412 345 678' },
      { kind: 'PHONE', value: '+44 7700 900123' },
      { kind: 'BANK_ACCOUNT', value: '062-000 1234 5678' },
      { kind: 'BANK_PARTIAL', value: '062000 5678' },
      { kind: 'CRYPTO_WALLET', value: '0xAbCdEf0123456789abcdef0123456789ABCDEF01' },
      { kind: 'HANDLE', value: '@Card.Dealer_99', platform: 'instagram' },
    ];
    for (const sample of samples) {
      const once = normaliseIdentifier(sample);
      expect(once, sample.kind).not.toBeNull();
      const twice = normaliseIdentifier({ kind: once!.kind, value: once!.value, platform: once!.platform });
      expect(twice, sample.kind).toEqual(once);
    }
  });

  it('phone normalisation is idempotent for any digit string it accepts', () => {
    fc.assert(
      fc.property(fc.stringMatching(/^\+?[0-9 ()-]{6,20}$/), (raw) => {
        const once = normalisePhone(raw);
        if (once === null) return true;
        return normalisePhone(once) === once;
      }),
    );
  });

  it('formats an Australian mobile the same however it is typed', () => {
    const forms = ['0412 345 678', '0412345678', '+61 412 345 678', '61412345678', '0061 412 345 678'];
    const normalised = new Set(forms.map(normalisePhone));
    expect(normalised).toEqual(new Set(['+61412345678']));
  });

  it('rejects values that are not of the kind', () => {
    expect(normaliseIdentifier({ kind: 'PAYID_EMAIL', value: 'not an email' })).toBeNull();
    expect(normaliseIdentifier({ kind: 'PHONE', value: '123' })).toBeNull();
    expect(normaliseBankAccount('12345')).toBeNull();
    expect(normaliseIdentifier({ kind: 'HANDLE', value: 'https://instagram.com/x', platform: 'instagram' })).toBeNull();
    // A URL-kind platform is not a handle platform.
    expect(normaliseIdentifier({ kind: 'HANDLE', value: 'shop', platform: 'website' })).toBeNull();
    expect(normaliseIdentifier({ kind: 'HANDLE', value: 'shop', platform: 'nowhere' })).toBeNull();
  });
});

describe('fingerprints', () => {
  it('match across formatting differences', () => {
    expect(hashOf({ kind: 'PAYID_EMAIL', value: 'Scam@Example.com ' })).toBe(
      hashOf({ kind: 'PAYID_EMAIL', value: 'scam@example.com' }),
    );
    expect(hashOf({ kind: 'BANK_ACCOUNT', value: '062-000 12345678' })).toBe(
      hashOf({ kind: 'BANK_ACCOUNT', value: '06200012345678' }),
    );
    expect(hashOf({ kind: 'HANDLE', value: '@CardDealer', platform: 'instagram' })).toBe(
      hashOf({ kind: 'HANDLE', value: 'carddealer', platform: 'instagram' }),
    );
  });

  it('never collide across kinds or platforms for the same value', () => {
    const email = 'same@example.com';
    expect(hashOf({ kind: 'PAYID_EMAIL', value: email })).not.toBe(hashOf({ kind: 'PAYPAL_EMAIL', value: email }));
    expect(hashOf({ kind: 'PHONE', value: '0412345678' })).not.toBe(hashOf({ kind: 'PAYID_PHONE', value: '0412345678' }));
    expect(hashOf({ kind: 'HANDLE', value: 'dealer', platform: 'instagram' })).not.toBe(
      hashOf({ kind: 'HANDLE', value: 'dealer', platform: 'tiktok' }),
    );
  });

  it('depend on the secret, and refuse to hash without one', () => {
    const identifier = normaliseIdentifier({ kind: 'PAYID_EMAIL', value: 'a@example.com' })!;
    expect(identifierHash(identifier, 'one')).not.toBe(identifierHash(identifier, 'two'));
    expect(identifierHash(identifier, '  ')).toBeNull();
    expect(identifierHash(identifier, SECRET)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('a full bank account also yields its BSB-plus-last-4 form', () => {
    const bank = normaliseIdentifier({ kind: 'BANK_ACCOUNT', value: '062000 12345678' })!;
    const expanded = expandIdentifier(bank);
    expect(expanded.map((identifier) => identifier.kind)).toEqual(['BANK_ACCOUNT', 'BANK_PARTIAL']);
    expect(expanded[1].value).toBe('062000:5678');
    // The same partial a member's payout hint produces.
    expect(identifierHash(expanded[1], SECRET)).toBe(hashOf({ kind: 'BANK_PARTIAL', value: '0620005678' }));
  });

  it('masked hints never contain the full value', () => {
    const samples: NormalisedIdentifier[] = [
      normaliseIdentifier({ kind: 'PAYID_EMAIL', value: 'scamperson@example.com' })!,
      normaliseIdentifier({ kind: 'BANK_ACCOUNT', value: '062000 12345678' })!,
      normaliseIdentifier({ kind: 'PHONE', value: '0412345678' })!,
      normaliseIdentifier({ kind: 'HANDLE', value: 'carddealer99', platform: 'instagram' })!,
    ];
    for (const identifier of samples) {
      expect(maskIdentifier(identifier)).not.toContain(identifier.value);
    }
  });
});

describe('validateScamReport', () => {
  const owner = 'reporter-1/';
  const base: ScamReportInput = {
    narrative: 'I paid for a sealed booster box over Instagram and the seller blocked me straight after.',
    occurredMonth: '2026-09',
    paymentMethod: 'PAYID',
    amount: '250.50',
    currency: 'aud',
    identifiers: [{ kind: 'PAYID_EMAIL', value: 'Scam@Example.com' }, { kind: 'PAYID_EMAIL', value: 'scam@example.com ' }],
    scammerName: 'Sam',
    evidencePaths: ['reporter-1/a.jpg'],
    declared: true,
  };

  it('accepts a complete report and de-duplicates identifiers', () => {
    const result = validateScamReport(base, owner, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.identifiers).toHaveLength(1);
    expect(result.value.amountMinor).toBe(25_050);
    expect(result.value.occurredMonth).toBe('2026-09-01');
  });

  it('uses the currency’s own minor unit', () => {
    const result = validateScamReport({ ...base, amount: '5000', currency: 'jpy' }, owner, NOW);
    expect(result.ok && result.value.amountMinor).toBe(5000);
    expect(validateScamReport({ ...base, amount: '50.5', currency: 'jpy' }, owner, NOW).ok).toBe(false);
  });

  it('refuses a future month, a missing declaration, and evidence outside the reporter’s folder', () => {
    expect(validateScamReport({ ...base, occurredMonth: '2026-11' }, owner, NOW)).toMatchObject({ ok: false, field: 'occurredMonth' });
    expect(validateScamReport({ ...base, declared: false }, owner, NOW)).toMatchObject({ ok: false, field: 'declared' });
    expect(validateScamReport({ ...base, evidencePaths: ['someone-else/a.jpg'] }, owner, NOW)).toMatchObject({
      ok: false,
      field: 'evidence',
    });
    expect(validateScamReport({ ...base, evidencePaths: [] }, owner, NOW)).toMatchObject({ ok: false, field: 'evidence' });
  });

  it('refuses a report with no usable identifier, and never lets a reporter enter BANK_PARTIAL', () => {
    expect(validateScamReport({ ...base, identifiers: [] }, owner, NOW)).toMatchObject({ ok: false, field: 'identifiers' });
    expect(
      validateScamReport({ ...base, identifiers: [{ kind: 'BANK_PARTIAL', value: '0620005678' }] }, owner, NOW),
    ).toMatchObject({ ok: false, field: 'identifiers.0' });
  });
});

describe('clusterStrength', () => {
  const unrelated = () => false;
  const report = (id: string, reporterId: string, sharedKinds: ClusterReport['sharedKinds'], status: ClusterReport['status'] = 'SUBMITTED'): ClusterReport => ({
    reportId: id,
    reporterId,
    status,
    sharedKinds,
  });

  it('counts independent reporters once each', () => {
    expect(clusterStrength([report('r1', 'a', ['PAYID_EMAIL']), report('r2', 'b', ['PAYID_EMAIL'])], unrelated)).toBe(2);
    // The same reporter twice is still one person.
    expect(clusterStrength([report('r1', 'a', ['PAYID_EMAIL']), report('r2', 'a', ['PAYID_EMAIL'])], unrelated)).toBe(1);
  });

  it('related reporters do not raise the strength', () => {
    const related = (x: string, y: string) => [x, y].sort().join() === 'a,b';
    expect(clusterStrength([report('r1', 'a', ['PAYID_EMAIL']), report('r2', 'b', ['PAYID_EMAIL'])], related)).toBe(1);
  });

  it('a handle-only link counts half', () => {
    expect(clusterStrength([report('r1', 'a', ['HANDLE']), report('r2', 'b', ['HANDLE'])], unrelated)).toBe(1);
    expect(isCorroborated(1)).toBe(false);
    expect(clusterStrength([report('r1', 'a', ['HANDLE']), report('r2', 'b', ['PAYID_EMAIL'])], unrelated)).toBe(1.5);
  });

  it('dismissed and withdrawn reports do not count', () => {
    expect(
      clusterStrength(
        [report('r1', 'a', ['PAYID_EMAIL']), report('r2', 'b', ['PAYID_EMAIL'], 'DISMISSED'), report('r3', 'c', ['PAYID_EMAIL'], 'WITHDRAWN')],
        unrelated,
      ),
    ).toBe(1);
  });

  it('never exceeds the number of distinct reporters', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            reporter: fc.constantFrom('a', 'b', 'c', 'd'),
            handleOnly: fc.boolean(),
          }),
          { maxLength: 12 },
        ),
        (rows) => {
          const reports = rows.map((row, index) =>
            report(`r${index}`, row.reporter, row.handleOnly ? ['HANDLE'] : ['BANK_ACCOUNT']),
          );
          const distinct = new Set(rows.map((row) => row.reporter)).size;
          return clusterStrength(reports, unrelated) <= distinct;
        },
      ),
    );
  });

  it('two independent reporters is the corroboration threshold', () => {
    expect(CORROBORATION_THRESHOLD).toBe(2);
  });
});

describe('matchStrength', () => {
  it('ranks an exact payment detail above a partial bank above a handle', () => {
    expect(matchStrength(['PAYID_EMAIL'])).toBe('STRONG');
    expect(matchStrength(['HANDLE', 'PAYPAL_EMAIL'])).toBe('STRONG');
    expect(matchStrength(['BANK_PARTIAL'])).toBe('MEDIUM');
    expect(matchStrength(['HANDLE'])).toBe('WEAK');
  });
});

describe('canFraudBan', () => {
  const ready = {
    clusterStrength: 2,
    matchStrength: 'STRONG' as const,
    notifiedAt: '2026-09-01T00:00:00Z',
    respondedAt: '2026-09-05T00:00:00Z',
    responseDueAt: '2026-09-15T00:00:00Z',
    now: NOW,
  };

  it('allows a corroborated, non-handle match once the member has had their say', () => {
    expect(canFraudBan(ready)).toEqual({ ok: true });
    expect(canFraudBan({ ...ready, respondedAt: null })).toEqual({ ok: true });
  });

  it('refuses a single source', () => {
    expect(canFraudBan({ ...ready, clusterStrength: 1.5 }).ok).toBe(false);
  });

  it('refuses a handle-only match whatever the cluster', () => {
    expect(canFraudBan({ ...ready, clusterStrength: 10, matchStrength: 'WEAK' }).ok).toBe(false);
  });

  it('refuses before the member was told', () => {
    expect(canFraudBan({ ...ready, notifiedAt: null, respondedAt: null, responseDueAt: null }).ok).toBe(false);
  });

  it('refuses while the response window is open and they have not answered', () => {
    expect(canFraudBan({ ...ready, respondedAt: null, responseDueAt: '2026-10-20T00:00:00Z' }).ok).toBe(false);
  });
});
