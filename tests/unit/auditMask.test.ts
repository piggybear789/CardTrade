// Unit tests for tests/e2e/audit/core/mask.ts (Req 32.1, 32.2, 32.3, 32.4).
import { describe, expect, it } from 'vitest';
import {
  MASK_PLACEHOLDER,
  findLeaks,
  findPii,
  isForbiddenArtifact,
  legalNameMatcher,
  scrubText,
  secretEntries,
  secretValues,
} from '../e2e/audit/core/mask';

const ENV = {
  STRIPE_SECRET_KEY_US: 'sk_test_abcdefghijkl',
  E2E_SEED_PASSWORD: 'hunter2hunter2',
  JOBS_SECRET: 'short',
  NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
  PAYMENTS_PROVIDER: 'stripe',
};

describe('secretValues', () => {
  it('keeps secret-named variables of 8+ characters only', () => {
    expect(secretValues(ENV).sort()).toEqual(['hunter2hunter2', 'sk_test_abcdefghijkl']);
  });

  it('lists a padded value trimmed as well', () => {
    expect(secretEntries({ API_TOKEN: '  tok12345678  ' }).map((e) => e.value)).toContain('tok12345678');
  });
});

describe('scrubText', () => {
  const secrets = secretValues(ENV);

  it('replaces secrets with the placeholder and is idempotent', () => {
    const once = scrubText('key=sk_test_abcdefghijkl pw=hunter2hunter2', secrets);
    expect(once).toBe(`key=${MASK_PLACEHOLDER} pw=${MASK_PLACEHOLDER}`);
    expect(scrubText(once, secrets)).toBe(once);
  });

  it('returns clean text unchanged', () => {
    expect(scrubText('nothing to see', secrets)).toBe('nothing to see');
  });

  it('masks PII when asked', () => {
    const text = 'alice@example.com paid pi_123_secret_abc at /t/abcdefghijklmnop for Alice Example';
    const out = scrubText(text, secrets, { legalNames: ['Alice Example'] });
    expect(out).toBe(`a***@example.com paid ${MASK_PLACEHOLDER} at ${MASK_PLACEHOLDER} for ${MASK_PLACEHOLDER}`);
    expect(scrubText(out, secrets, { legalNames: ['Alice Example'] })).toBe(out);
  });
});

describe('findLeaks', () => {
  it('names the variable, never the value', () => {
    const leaks = findLeaks('oops sk_test_abcdefghijkl', ENV);
    expect(leaks).toEqual(['STRIPE_SECRET_KEY_US']);
    expect(findLeaks(scrubText('oops sk_test_abcdefghijkl', secretValues(ENV)), ENV)).toEqual([]);
  });
});

describe('findPii', () => {
  it('finds each kind of personal value', () => {
    const text = 'bob@example.com seti_1A_secret_Z /deals?link=abcdefghijklmnopqr Bob  Builder';
    const kinds = findPii(text, { legalNames: ['Bob Builder'] }).map((r) => r.kind);
    expect(kinds).toEqual(['email', 'clientSecret', 'inviteToken', 'legalName']);
  });

  it('matches legal names as whole words only', () => {
    const matcher = legalNameMatcher(['Ann Lee']);
    expect(matcher?.test('Joann Leeds')).toBe(false);
    expect(legalNameMatcher([' '])).toBeNull();
  });

  it('finds nothing in safe text', () => {
    expect(findPii('Pay now to reserve the card', { legalNames: ['Alice Example'] })).toEqual([]);
  });
});

describe('isForbiddenArtifact', () => {
  it.each([
    '.env.local',
    'sub\\.env.local.bak',
    'playwright/.auth/alice.json',
    'x\\playwright\\.auth\\bob.json',
    'audit-artifacts/alice.storageState.json',
  ])('refuses %s', (path) => {
    expect(isForbiddenArtifact(path)).toBe(true);
  });

  it.each(['audit-artifacts/run/shot.png', 'audit-artifacts/run/video.webm', 'audit-report/index.html'])(
    'allows %s',
    (path) => {
      expect(isForbiddenArtifact(path)).toBe(false);
    },
  );
});
