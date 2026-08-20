// components/onboarding/stripeBrowser.ts
//
// Browser-side Stripe.js loader cache shared by the embedded onboarding components
// (unified-seller-onboarding). One `loadStripe` per publishable key, reused across
// mounts — mirrors the cache in `components/payments/AddPaymentMethodForm.tsx`.
//
// BROWSER SDK ONLY. Nothing here imports the Stripe server SDK; that stays boxed in
// `domain/services/stripe/**`. These helpers take a server-minted client secret and a
// browser-safe publishable key and never see a secret key.

'use client';

import { loadStripe, type Stripe } from '@stripe/stripe-js';

/**
 * Sentinel publishable key returned by the MockService. Stripe.js would reject it, so
 * a caller seeing this key must render its fallback rather than mount a real SDK.
 */
export const MOCK_PUBLISHABLE_KEY = 'pk_test_mock';

const stripeCache = new Map<string, Promise<Stripe | null>>();

/** One Stripe.js load per publishable key, shared across component mounts. */
export function getStripe(publishableKey: string): Promise<Stripe | null> {
  let cached = stripeCache.get(publishableKey);
  if (!cached) {
    cached = loadStripe(publishableKey);
    stripeCache.set(publishableKey, cached);
  }
  return cached;
}

/** True for a real (non-mock) publishable key that Stripe.js can initialise. */
export function isRealPublishableKey(publishableKey: string | null | undefined): boolean {
  return Boolean(publishableKey) && publishableKey !== MOCK_PUBLISHABLE_KEY;
}
