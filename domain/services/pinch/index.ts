// domain/services/pinch/index.ts
//
// Public surface of the real Pinch Payments integration. Only
// `domain/services/index.ts` (the service factory) and the Webhook_Handler
// import from here; nothing else in the codebase may depend on Pinch types.

export {
  isPinchConfigured,
  readPinchConfig,
  readPinchEnvironment,
  readPinchPublishableKey,
  type PinchConfig,
  type PinchEnvironment,
  type PinchHoldStrategy,
  type PinchKycMode,
} from './config';
export { PinchApiError, PinchClient, type FetchLike } from './PinchClient';
export { PinchService, type PinchServiceOptions } from './PinchService';
export {
  decodeMetadata,
  encodeMetadata,
  parseRef,
  type CardTradeMetadata,
  type PinchPaymentKind,
} from './metadata';
export {
  DEFAULT_TOLERANCE_SECONDS,
  PINCH_LIVE_SIGNATURE_HEADER,
  translatePinchEvent,
  verifyPinchSignature,
} from './webhook';
export {
  buildComplianceEvent,
  signPinchWebhook,
  simulateComplianceDecision,
  type SimulateComplianceResult,
  type SimulatedComplianceOutcome,
} from './simulateCompliance';

import type { KycService } from '../types';
import { readPinchConfig } from './config';
import { PinchClient } from './PinchClient';
import { PinchService } from './PinchService';

/**
 * Build a `PinchService` from the environment.
 *
 * @param kycDelegate serves verification runs and verified-identity lookups
 * while Pinch Glassbox KYC has no public REST API (`PINCH_KYC_MODE=mock`).
 * @throws Error when credentials for the selected environment are missing.
 */
export function createPinchService(kycDelegate?: KycService): PinchService {
  const config = readPinchConfig();
  return new PinchService({
    client: new PinchClient({ config }),
    config,
    kycDelegate: config.kycMode === 'mock' ? kycDelegate : undefined,
  });
}
