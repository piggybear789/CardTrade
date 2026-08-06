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
  DEFAULT_CONFIG_REGION,
  isStripeConfigured,
  readStripeConfig,
  readStripeEnvironment,
  readStripePublishableKey,
  readWebhookSecrets,
  type EnvLike,
} from '@/domain/services/stripe/config';

const AU_KEY = 'sk_test_FAKE_AU';
const GB_KEY = 'sk_test_FAKE_GB';
const GB_LIVE_KEY = 'sk_live_FAKE_GB_LIVE';

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
    // THE CENTRAL ASSERTION. A GB seller resolved onto the AU platform account would
    // be undetectable until a transfer failed with money already collected.
    const e = env({ STRIPE_SECRET_KEY: AU_KEY });
    expect(isStripeConfigured(e, 'GB')).toBe(false);
    expect(() => readStripeConfig(e, 'GB')).toThrow(/GB/);
  });

  it('prefers a suffixed key over the unsuffixed one, even for the default region', () => {
    const e = env({ STRIPE_SECRET_KEY: AU_KEY, STRIPE_SECRET_KEY_AU: GB_KEY });
    expect(readStripeConfig(e, 'AU').secretKey).toBe(GB_KEY);
  });

  it('resolves each region to its own key', () => {
    const e = env({ STRIPE_SECRET_KEY: AU_KEY, STRIPE_SECRET_KEY_GB: GB_KEY });
    expect(readStripeConfig(e, 'AU').secretKey).toBe(AU_KEY);
    expect(readStripeConfig(e, 'GB').secretKey).toBe(GB_KEY);
  });

  it('derives environment per region, so one region can be live while another is test', () => {
    // Mixed modes are a real operational state during a rollout, and treating the
    // whole deployment as live because one key is would be wrong in the unsafe
    // direction.
    const e = env({ STRIPE_SECRET_KEY: AU_KEY, STRIPE_SECRET_KEY_GB: GB_LIVE_KEY });
    expect(readStripeEnvironment(e, 'AU')).toBe('test');
    expect(readStripeEnvironment(e, 'GB')).toBe('live');
  });

  it('treats a blank key as absent rather than as configured', () => {
    const e = env({ STRIPE_SECRET_KEY_GB: '   ' });
    expect(isStripeConfigured(e, 'GB')).toBe(false);
    expect(allConfiguredRegionCodes(e)).not.toContain('GB');
  });
});

describe('currency and country come from the region table, not the environment', () => {
  it('derives them from the region rather than STRIPE_CURRENCY', () => {
    // A per-region env var for either would be a SECOND place the mapping GB→gbp
    // lives, and the one place it lives is domain/region/regions.ts.
    const e = env({ STRIPE_SECRET_KEY_GB: GB_KEY, STRIPE_CURRENCY: 'aud' });
    const config = readStripeConfig(e, 'GB');
    expect(config.currency).toBe('gbp');
    expect(config.country).toBe('gb');
    expect(config.region).toBe('GB');
  });

  it('records the zero-decimal region correctly', () => {
    const e = env({ STRIPE_SECRET_KEY_JP: GB_KEY });
    expect(readStripeConfig(e, 'JP').currency).toBe('jpy');
  });

  it('normalises a lower-case region argument', () => {
    const e = env({ STRIPE_SECRET_KEY_GB: GB_KEY });
    expect(readStripeConfig(e, 'gb').region).toBe('GB');
  });
});

describe('allConfiguredRegionCodes', () => {
  it('discovers regions from the environment rather than a maintained list', () => {
    const e = env({
      STRIPE_SECRET_KEY: AU_KEY,
      STRIPE_SECRET_KEY_GB: GB_KEY,
      STRIPE_SECRET_KEY_US: GB_KEY,
      // Not a key at all — must not be mistaken for a region.
      STRIPE_WEBHOOK_SECRET_GB: 'whsec_FAKEGB00000000000',
    });
    expect(allConfiguredRegionCodes(e)).toEqual(['AU', 'GB', 'US']);
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
      STRIPE_SECRET_KEY_GB: GB_KEY,
      STRIPE_WEBHOOK_SECRET: 'whsec_FAKEAU00000000000',
      STRIPE_WEBHOOK_SECRET_GB: 'whsec_FAKEGB00000000000',
    });
    const secrets = readWebhookSecrets(e);
    expect(secrets).toContain('whsec_FAKEAU00000000000');
    expect(secrets).toContain('whsec_FAKEGB00000000000');
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
    // Confirming a SetupIntent minted on the GB platform with the AU publishable key
    // fails in the browser with an opaque error, so this must not fall back either.
    const e = env({ NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_au' });
    expect(readStripePublishableKey(e, 'AU')).toBe('pk_test_au');
    expect(readStripePublishableKey(e, 'GB')).toBeNull();
  });

  it('resolves a suffixed publishable key', () => {
    const e = env({ NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_GB: 'pk_test_gb' });
    expect(readStripePublishableKey(e, 'GB')).toBe('pk_test_gb');
  });
});
