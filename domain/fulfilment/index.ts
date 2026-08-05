// domain/fulfilment/index.ts
//
// The shared fulfilment model: one vocabulary, one validator and one inspection
// clock for both Cash_Sales and 2-way Trades. Framework-free, so it runs in the
// Node-only `domain` Vitest project.

export type {
  DeliveryAddress,
  DeliveryTerms,
  FulfilmentMethod,
  FulfilmentTermsError,
  FulfilmentTerms,
  FulfilmentTrackingState,
  FulfilmentValidation,
  MeetingTerms,
  ResolvedPlace,
  ShipmentSnapshot,
} from './types';

export {
  DELIVERY_COST_MAX_CENTS,
  areFulfilmentTermsComplete,
  emptyFulfilmentTerms,
  hasValidCoords,
  isDelivery,
  isInPerson,
  isResolvedAddress,
  isResolvedPlace,
  normalizeFulfilmentTerms,
  validateFulfilmentTerms,
} from './terms';
export type { ValidateFulfilmentOptions } from './terms';

export {
  TRADE_INSPECTION_FLOOR_HOURS,
  TRADE_INSPECTION_HOURS,
  deriveTradeInspectionDeadline,
  inspectionExpired,
  inspectionHoldRisk,
} from './inspection';
export type { InspectionHoldRisk, TradeInspectionFacts } from './inspection';
