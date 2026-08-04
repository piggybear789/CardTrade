// tests/unit/providerMode.test.ts
//
// Pins down the payment provider seam. Getting this wrong is the worst kind of
// bug in this codebase: silently falling back to the Mock when real payments
// were configured would fake money movement, and silently choosing a real
// provider during a UI demo would move it.
//
// Pure env resolution, so every case is a plain object — no process.env writes.

import { describe, expect, it } from 'vitest';

import {
  isLivePaymentsProvider,
  isPaymentDemoEnabled,
  isRealMoneyProvider,
  resolvePaymentProvider,
} from '@/domain/services/providerMode';

const STRIPE_TEST = { STRIPE_SECRET_KEY: 'sk_test_abc' };
const STRIPE_LIVE = { STRIPE_SECRET_KEY: 'sk_live_abc' };

describe('resolvePaymentProvider', () => {
  it('defaults to mock when nothing is configured', () => {
    expect(resolvePaymentProvider({})).toBe('mock');
  });

  it('picks Stripe when a secret key is present', () => {
    expect(resolvePaymentProvider(STRIPE_TEST)).toBe('stripe');
  });

  it('honours an explicit mock override even with credentials present', () => {
    expect(resolvePaymentProvider({ ...STRIPE_LIVE, PAYMENTS_PROVIDER: 'mock' })).toBe('mock');
  });

  it('still reports stripe when declared but unconfigured, so the factory can fail closed', () => {
    // resolve* must not silently downgrade to mock here — getPaymentService()
    // needs to see 'stripe' in order to throw rather than fake payments.
    expect(resolvePaymentProvider({ PAYMENTS_PROVIDER: 'stripe' })).toBe('stripe');
    expect(isLivePaymentsProvider({ PAYMENTS_PROVIDER: 'stripe' })).toBe(false);
  });

  it('ignores case and surrounding whitespace in PAYMENTS_PROVIDER', () => {
    expect(resolvePaymentProvider({ PAYMENTS_PROVIDER: '  STRIPE ' })).toBe('stripe');
    expect(resolvePaymentProvider({ ...STRIPE_TEST, PAYMENTS_PROVIDER: ' Mock ' })).toBe('mock');
  });

  it('treats a blank or whitespace-only secret key as unconfigured', () => {
    expect(resolvePaymentProvider({ STRIPE_SECRET_KEY: '   ' })).toBe('mock');
  });
});

describe('isRealMoneyProvider', () => {
  it('is false for a test key even though the API calls are real', () => {
    // A test key places genuine authorisations against the real API; it just
    // moves no real funds. The two questions must not be conflated.
    expect(isLivePaymentsProvider(STRIPE_TEST)).toBe(true);
    expect(isRealMoneyProvider(STRIPE_TEST)).toBe(false);
  });

  it('is true only for a live key', () => {
    expect(isRealMoneyProvider(STRIPE_LIVE)).toBe(true);
  });

  it('is false whenever the provider is mock, regardless of stray live keys', () => {
    expect(isRealMoneyProvider({ ...STRIPE_LIVE, PAYMENTS_PROVIDER: 'mock' })).toBe(false);
  });

  it('is false when nothing is configured', () => {
    expect(isRealMoneyProvider({})).toBe(false);
  });
});

describe('isPaymentDemoEnabled', () => {
  it('allows demo webhook panels when no real provider is active', () => {
    expect(isPaymentDemoEnabled({})).toBe(true);
  });

  it('disables demo panels whenever a real provider is active, including test mode', () => {
    // Mock-signed events skip the real charge path entirely, so they must never
    // be able to advance a Trade that a real provider is backing.
    expect(isPaymentDemoEnabled(STRIPE_TEST)).toBe(false);
    expect(isPaymentDemoEnabled(STRIPE_LIVE)).toBe(false);
  });

  it('can be switched off explicitly even on mock', () => {
    expect(isPaymentDemoEnabled({ ENABLE_PAYMENT_DEMO: 'false' })).toBe(false);
  });
});
