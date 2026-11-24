// tests/unit/e2eAudit/stripeFixtureSignature.test.ts
//
// A signed Stripe webhook fixture verifies with the SDK's own `constructEvent` and the
// same secret, and a tampered or wrongly-signed one is refused (Req 26.6). Also pins
// the test-key refusal of the audit's Stripe client (Req 26.5). No network, no env:
// the secret and keys here are dummies.

import Stripe from 'stripe';
import { describe, expect, it } from 'vitest';

import { signStripeFixture, stripeEventEnvelope } from '../../e2e/audit/backend/stripeEvents';
import { assertTestSecretKey, StripeKeyRefusedError } from '../../e2e/audit/backend/stripe';

const SECRET = 'whsec_e2eUnitTestSecret0123456789';
const stripe = new Stripe('sk_test_dummy');

function fixture() {
  return stripeEventEnvelope(
    'radar.early_fraud_warning.created',
    {
      id: 'issfr_e2eunit',
      object: 'radar.early_fraud_warning',
      actionable: true,
      charge: 'ch_e2eunit',
      created: 1_700_000_000,
      fraud_type: 'made_with_stolen_card',
      livemode: false,
      payment_intent: 'pi_e2eunit',
    },
    { runId: 'unit-run.1' },
  );
}

describe('signed Stripe fixtures', () => {
  it('verifies with constructEvent and the same secret', () => {
    const event = fixture();
    const { body, signature } = signStripeFixture(event, SECRET);
    const verified = stripe.webhooks.constructEvent(body, signature, SECRET, 300);
    expect(verified.id).toBe(event.id);
    expect(verified.type).toBe('radar.early_fraud_warning.created');
    expect(verified.livemode).toBe(false);
    expect('account' in verified && verified.account).toBeFalsy();
  });

  it('is refused when the body is tampered with', () => {
    const { body, signature } = signStripeFixture(fixture(), SECRET);
    const tampered = body.replace('pi_e2eunit', 'pi_someoneelse');
    expect(() => stripe.webhooks.constructEvent(tampered, signature, SECRET, 300)).toThrow();
  });

  it('is refused under a different secret', () => {
    const { body, signature } = signStripeFixture(fixture(), SECRET);
    expect(() =>
      stripe.webhooks.constructEvent(body, signature, 'whsec_someOtherSecret0123456789', 300),
    ).toThrow();
  });

  it('refuses to sign with something that is not a whsec_ secret', () => {
    expect(() => signStripeFixture(fixture(), 'sk_test_notASigningSecret')).toThrow(/whsec_/);
  });
});

describe('assertTestSecretKey', () => {
  it('accepts an sk_test_ key', () => {
    expect(() => assertTestSecretKey('STRIPE_SECRET_KEY', 'sk_test_abc')).not.toThrow();
  });

  it.each([
    ['sk_live_abc', 'live'],
    ['rk_live_abc', 'live'],
    ['pk_live_abc', 'live'],
    ['  sk_live_padded ', 'live'],
    ['rk_test_abc', 'not-test-secret'],
    ['pk_test_abc', 'not-test-secret'],
    ['whsec_abc', 'not-test-secret'],
    ['', 'missing'],
    [undefined, 'missing'],
  ] as const)('refuses %j as %s, naming the variable and not the value', (value, reason) => {
    let thrown: unknown;
    try {
      assertTestSecretKey('STRIPE_SECRET_KEY_US', value);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StripeKeyRefusedError);
    const refused = thrown as StripeKeyRefusedError;
    expect(refused.reason).toBe(reason);
    expect(refused.message).toContain('STRIPE_SECRET_KEY_US');
    if (value?.trim()) expect(refused.message).not.toContain(value.trim());
  });
});
