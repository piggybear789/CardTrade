// tests/unit/stripeWebhookSecrets.test.ts
//
// Webhook signing secret resolution (Req 10.1, 10.2).
//
// A platform needs MORE THAN ONE endpoint secret: our PaymentIntents are created
// on the platform, so `payment_intent.*` / `charge.*` / `identity.*` arrive as
// platform events, while `account.updated` for a connected account is a Connect
// event — Stripe signs each with a different secret, and `stripe listen` mints a
// third for local forwarding.
//
// Getting this wrong fails silently in the worst way: every delivery returns 401,
// no state advances, and nothing in the logs says why. Hence the explicit tests.

import { describe, expect, it } from 'vitest';

import { readWebhookSecrets } from '@/domain/services/stripe/config';

// SYNTHETIC FIXTURES. These previously held the project's REAL platform and Connect
// signing secrets, copied out of `.env.local`. `readWebhookSecrets` only parses and
// shape-checks strings — it never contacts Stripe — so a real value bought this test
// nothing and would have committed two live secrets to git history, where rotation is
// the only remedy. Any `whsec_`-prefixed string of the right shape exercises the same
// code. Never paste a real key into a test.
const PLATFORM = 'whsec_000000000000000000000000000000PLATFORM';
const CONNECT = 'whsec_0000000000000000000000000000000CONNECT';

describe('readWebhookSecrets', () => {
  it('returns nothing when unset, so the route fails closed', () => {
    expect(readWebhookSecrets({})).toEqual([]);
    expect(readWebhookSecrets({ STRIPE_WEBHOOK_SECRET: '   ' })).toEqual([]);
  });

  it('reads a single secret', () => {
    expect(readWebhookSecrets({ STRIPE_WEBHOOK_SECRET: PLATFORM })).toEqual([PLATFORM]);
  });

  it('reads several from one comma-separated variable', () => {
    expect(
      readWebhookSecrets({ STRIPE_WEBHOOK_SECRET: `${PLATFORM},${CONNECT}` }),
    ).toEqual([PLATFORM, CONNECT]);
  });

  it('tolerates whitespace separation and stray spaces', () => {
    expect(
      readWebhookSecrets({ STRIPE_WEBHOOK_SECRET: `  ${PLATFORM}   ${CONNECT} ` }),
    ).toEqual([PLATFORM, CONNECT]);
  });

  it('splits two secrets pasted with no separator at all', () => {
    // This is a real copy-paste shape: both Dashboard secrets concatenated.
    // Treating it as one opaque string would 401 every delivery.
    expect(
      readWebhookSecrets({ STRIPE_WEBHOOK_SECRET: `${PLATFORM}${CONNECT}` }),
    ).toEqual([PLATFORM, CONNECT]);
  });

  it('merges the dedicated Connect variable with the main one', () => {
    expect(
      readWebhookSecrets({
        STRIPE_WEBHOOK_SECRET: PLATFORM,
        STRIPE_CONNECT_WEBHOOK_SECRET: CONNECT,
      }),
    ).toEqual([PLATFORM, CONNECT]);
  });

  it('de-duplicates the same secret supplied twice', () => {
    expect(
      readWebhookSecrets({
        STRIPE_WEBHOOK_SECRET: PLATFORM,
        STRIPE_CONNECT_WEBHOOK_SECRET: PLATFORM,
      }),
    ).toEqual([PLATFORM]);
  });

  it('drops values that are not signing secrets rather than trusting them', () => {
    expect(
      readWebhookSecrets({
        STRIPE_WEBHOOK_SECRET: `sk_test_notasecret,${PLATFORM},whsec_short,placeholder`,
      }),
    ).toEqual([PLATFORM]);
  });
});
