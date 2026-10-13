// tests/unit/regionalStripeConfig.test.ts
//
// Per-region Stripe credential resolution (0068).
//
// WHAT THIS PINS SHUT, AND WHY IT IS THE DANGEROUS ONE.
//
// Each region is a separate Stripe PLATFORM account, because Stripe permits
// cross-border transfers on the payments balance only between the US, Canada, UK, EEA
// and Switzerland — elsewhere "your platform and any connected account must be in the
// same region" — and cross-border payouts additionally require the platform to sit in
// the US/UK/EEA/CA/CH, which excludes AU, and are refused entirely for connected
// accounts under a recipient service agreement, which is what we open.
//
// The failure mode a bug here produces is the worst kind: silent misrouting. If GB
// were allowed to fall back to the unsuffixed (AU) key, a UK seller's account would be
// opened on the Australian platform. Nothing would look wrong at onboarding. It would
// fail at the first transfer, after a buyer had been charged and goods possibly
// shipped. So the fallback is asserted to be absent for non-default regions, not just
// documented as absent.

import { describe, expect, it } from 'vitest';

import {
  allConfiguredRegionCodes,
  credentialRegionFor,
  DEFAULT_CONFIG_REGION,
  isStripeConfigured,
  readStripeConfig,
  readStripeEnvironment,
  readStripePublishableKey,
  readWebhookSecrets,
  type EnvLike,
} from '@/domain/services/stripe/config';

const AU_KEY = 'sk_test_FAKE_AU';
const NZ_KEY = 'sk_test_FAKE_NZ';
const NZ_LIVE_KEY = 'sk_live_FAKE_NZ_LIVE';

function env(extra: EnvLike = {}): EnvLike {
  return { ...extra };
}

describe('per-region credential resolution', () => {
  it('uses the unsuffixed key for the default region', () => {
    // Backwards compatibility: the existing single-region deployment sets
    // STRIPE_SECRET_KEY with no suffix and must keep working untouched.
    const e = env({ STRIPE_SECRET_KEY: AU_KEY });
    expect(isStripeConfigured(e, DEFAULT_CONFIG_REGION)).toBe(true);
    expect(readStripeConfig(e, DEFAULT_CONFIG_REGION).secretKey).toBe(AU_KEY);
  });

  it('NEVER falls back to the unsuffixed key for another region', () => {
    // THE CENTRAL ASSERTION. An NZ seller resolved onto the AU platform account would
    // be undetectable until a transfer failed with money already collected.
    const e = env({ STRIPE_SECRET_KEY: AU_KEY });
    expect(isStripeConfigured(e, 'NZ')).toBe(false);
    expect(() => readStripeConfig(e, 'NZ')).toThrow(/NZ/);
  });

  it('prefers a suffixed key over the unsuffixed one, even for the default region', () => {
    const e = env({ STRIPE_SECRET_KEY: AU_KEY, STRIPE_SECRET_KEY_AU: NZ_KEY });
    expect(readStripeConfig(e, 'AU').secretKey).toBe(NZ_KEY);
  });

  it('resolves each region to its own key', () => {
    const e = env({ STRIPE_SECRET_KEY: AU_KEY, STRIPE_SECRET_KEY_NZ: NZ_KEY });
    expect(readStripeConfig(e, 'AU').secretKey).toBe(AU_KEY);
    expect(readStripeConfig(e, 'NZ').secretKey).toBe(NZ_KEY);
  });

  it('derives environment per region, so one region can be live while another is test', () => {
    // Mixed modes are a real operational state during a rollout, and treating the
    // whole deployment as live because one key is would be wrong in the unsafe
    // direction.
    const e = env({ STRIPE_SECRET_KEY: AU_KEY, STRIPE_SECRET_KEY_NZ: NZ_LIVE_KEY });
    expect(readStripeEnvironment(e, 'AU')).toBe('test');
    expect(readStripeEnvironment(e, 'NZ')).toBe('live');
  });

  it('treats a blank key as absent rather than as configured', () => {
    const e = env({ STRIPE_SECRET_KEY_NZ: '   ' });
    expect(isStripeConfigured(e, 'NZ')).toBe(false);
    expect(allConfiguredRegionCodes(e)).not.toContain('NZ');
  });
});

describe('currency and country come from the region table, not the environment', () => {
  it('derives them from the region rather than STRIPE_CURRENCY', () => {
    // A per-region env var for either would be a SECOND place the mapping GB→gbp
    // lives, and the one place it lives is domain/region/regions.ts.
    const e = env({ STRIPE_SECRET_KEY_NZ: NZ_KEY, STRIPE_CURRENCY: 'aud' });
    const config = readStripeConfig(e, 'NZ');
    expect(config.currency).toBe('nzd');
    expect(config.country).toBe('nz');
    expect(config.region).toBe('NZ');
  });

  it('records the zero-decimal region correctly', () => {
    const e = env({ STRIPE_SECRET_KEY_JP: NZ_KEY });
    expect(readStripeConfig(e, 'JP').currency).toBe('jpy');
  });

  it('normalises a lower-case region argument', () => {
    const e = env({ STRIPE_SECRET_KEY_NZ: NZ_KEY });
    expect(readStripeConfig(e, 'nz').region).toBe('NZ');
  });
});

describe('allConfiguredRegionCodes', () => {
  it('discovers regions from the environment rather than a maintained list', () => {
    const e = env({
      STRIPE_SECRET_KEY: AU_KEY,
      STRIPE_SECRET_KEY_NZ: NZ_KEY,
      STRIPE_SECRET_KEY_US: NZ_KEY,
      // Not a key at all — must not be mistaken for a region.
      STRIPE_WEBHOOK_SECRET_NZ: 'whsec_FAKENZ00000000000',
    });
    expect(allConfiguredRegionCodes(e)).toEqual(['AU', 'NZ', 'US']);
  });

  it('is empty when nothing is configured', () => {
    expect(allConfiguredRegionCodes(env())).toEqual([]);
  });
});

describe('webhook secrets span every region', () => {
  it('accepts secrets from all regions at once', () => {
    // Verification tries each in turn, and it must be able to authenticate a delivery
    // BEFORE it knows which region the event concerns — the routing metadata inside
    // the payload cannot be trusted until the signature is.
    const e = env({
      STRIPE_SECRET_KEY: AU_KEY,
      STRIPE_SECRET_KEY_NZ: NZ_KEY,
      STRIPE_WEBHOOK_SECRET: 'whsec_FAKEAU00000000000',
      STRIPE_WEBHOOK_SECRET_NZ: 'whsec_FAKENZ00000000000',
    });
    const secrets = readWebhookSecrets(e);
    expect(secrets).toContain('whsec_FAKEAU00000000000');
    expect(secrets).toContain('whsec_FAKENZ00000000000');
  });

  it('still splits several secrets out of one variable', () => {
    // Pre-existing behaviour: a platform endpoint and a Connect endpoint can share one
    // variable. Kept working alongside the new suffixes.
    const e = env({
      STRIPE_SECRET_KEY: AU_KEY,
      STRIPE_WEBHOOK_SECRET: 'whsec_FAKEONE0000000000 whsec_FAKETWO0000000000',
    });
    expect(readWebhookSecrets(e)).toHaveLength(2);
  });

  it('drops values that are not signing secrets', () => {
    const e = env({
      STRIPE_SECRET_KEY: AU_KEY,
      STRIPE_WEBHOOK_SECRET: 'not-a-secret',
    });
    expect(readWebhookSecrets(e)).toEqual([]);
  });
});

describe('publishable keys are region-scoped', () => {
  it('does not lend the default region key to another region', () => {
    // Confirming a SetupIntent minted on the NZ platform with the AU publishable key
    // fails in the browser with an opaque error, so this must not fall back either.
    const e = env({ NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_au' });
    expect(readStripePublishableKey(e, 'AU')).toBe('pk_test_au');
    expect(readStripePublishableKey(e, 'NZ')).toBeNull();
  });

  it('resolves a suffixed publishable key', () => {
    const e = env({ NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_NZ: 'pk_test_nz' });
    expect(readStripePublishableKey(e, 'NZ')).toBe('pk_test_nz');
  });
});

describe('regions that share the US platform (0136)', () => {
  // The UK, EEA, Canada and Switzerland have no credentials of their own: their money
  // moves through the US platform, which can pay connected accounts in all of them.
  const US_KEY = 'sk_test_FAKE_US';

  it('maps GB, DE and CA onto the US platform', () => {
    expect(credentialRegionFor('GB')).toBe('US');
    expect(credentialRegionFor('de')).toBe('US');
    expect(credentialRegionFor('CA')).toBe('US');
    expect(credentialRegionFor('AU')).toBe('AU');
  });

  it('reads the US key, and the US settlement currency, for a German member', () => {
    const e = env({ STRIPE_SECRET_KEY: AU_KEY, STRIPE_SECRET_KEY_US: US_KEY });
    const config = readStripeConfig(e, 'DE');
    expect(config.secretKey).toBe(US_KEY);
    expect(config.region).toBe('US');
    expect(config.currency).toBe('usd');
    expect(config.country).toBe('us');
  });

  it('NEVER borrows the AU key for the group', () => {
    // The same failure mode as above: a UK seller on the AU platform is undetectable
    // until the first transfer fails with a buyer already charged.
    const e = env({ STRIPE_SECRET_KEY: AU_KEY });
    expect(isStripeConfigured(e, 'GB')).toBe(false);
    expect(() => readStripeConfig(e, 'GB')).toThrow(/US/);
  });

  it('lends the US publishable key to the group and to nobody else', () => {
    const e = env({ NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_US: 'pk_test_us' });
    expect(readStripePublishableKey(e, 'FR')).toBe('pk_test_us');
    expect(readStripePublishableKey(e, 'AU')).toBeNull();
  });
});
