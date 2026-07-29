// domain/services/providerMode.ts
//
// Resolves whether money movement goes through real Pinch (test or live) or the
// deterministic MockService. KYC stays on the mock delegate either way — Pinch
// Glassbox has no public REST KYC contract.

import { isPinchConfigured, type EnvLike } from './pinch/config';

/**
 * True when payment operations should call the real Pinch API.
 *
 * - `PAYMENTS_PROVIDER=mock` → always false (local UI demos without credentials)
 * - `PAYMENTS_PROVIDER=pinch` → true only when credentials are present
 * - unset → true when Pinch credentials exist (hackathon default: go live when
 *   keys are configured), otherwise mock
 */
export function isLivePaymentsProvider(env: EnvLike = process.env): boolean {
  const explicit = env.PAYMENTS_PROVIDER?.trim().toLowerCase();
  if (explicit === 'mock') return false;
  if (explicit === 'pinch') return isPinchConfigured(env);
  return isPinchConfigured(env);
}

/**
 * True when the fake webhook demo panels / fire* actions may run. Never when
 * live Pinch is active — those buttons inject mock-signed events that skip the
 * real charge path.
 */
export function isPaymentDemoEnabled(env: EnvLike = process.env): boolean {
  if (isLivePaymentsProvider(env)) return false;
  return env.ENABLE_PAYMENT_DEMO?.trim().toLowerCase() !== 'false';
}
