// domain/services/pinch/metadata.ts
//
// CardTrade context carried on Pinch Payment records via the provider's
// free-text `metadata` field.
//
// Pinch webhook events deliver the Payment object (including its metadata
// string) but know nothing about Trades or Cash_Sales. Stamping our own intent
// onto each payment is what lets `translatePinchEvent` decide whether an
// approved payment means "collateral hold is active" or "cash sale settled",
// and which row it belongs to. Without it, an inbound event is unroutable.
//
// Pure string/JSON handling - no I/O, safe to unit test directly.

/** What a Pinch Payment represents in CardTrade terms. */
export type PinchPaymentKind = 'HOLD' | 'TRANSFER';

/** The CardTrade payload embedded in a Pinch record's `metadata` string. */
export interface CardTradeMetadata {
  kind: PinchPaymentKind;
  /** The caller-supplied operation reference (also used as the nonce). */
  ref: string;
  /** Owning Trade, when derivable from `ref`. */
  tradeId?: string;
  /** Owning Cash_Sale, when derivable from `ref`. */
  cashSaleId?: string;
  /** Owning Deal, when derivable from `ref`. */
  dealId?: string;
  /** Owning Profile, for payer records. */
  profileId?: string;
}

/** Namespace key so our data never collides with other metadata producers. */
const NAMESPACE = 'cardtrade';

/**
 * Derive the owning entity from an operation `ref`. The refs are built by the
 * orchestrators: `hold:<tradeId>:<traderId>`, `cash-sale:<saleId>`, and
 * `deal:<dealId>:...` for deal-room collateral.
 */
export function parseRef(ref: string): Pick<CardTradeMetadata, 'tradeId' | 'cashSaleId' | 'dealId'> {
  const [prefix, first] = ref.split(':');
  if (!first) return {};
  switch (prefix) {
    case 'hold':
      return { tradeId: first };
    case 'cash-sale':
      return { cashSaleId: first };
    case 'deal':
      return { dealId: first };
    default:
      return {};
  }
}

/** Build the `metadata` string to send with a Pinch payment/payer request. */
export function encodeMetadata(data: CardTradeMetadata): string {
  return JSON.stringify({ [NAMESPACE]: data });
}

/**
 * Recover the CardTrade context from a Pinch record's `metadata` value.
 * Returns `null` for absent, non-JSON, or foreign metadata - the caller then
 * treats the event as unroutable (a logged NO_OP) rather than failing.
 */
export function decodeMetadata(metadata: unknown): CardTradeMetadata | null {
  if (typeof metadata !== 'string' || !metadata.trim()) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(metadata);
  } catch {
    return null;
  }
  const container = (parsed as Record<string, unknown> | null)?.[NAMESPACE];
  if (!container || typeof container !== 'object') return null;

  const data = container as Partial<CardTradeMetadata>;
  if (data.kind !== 'HOLD' && data.kind !== 'TRANSFER') return null;
  if (typeof data.ref !== 'string') return null;

  return {
    kind: data.kind,
    ref: data.ref,
    tradeId: typeof data.tradeId === 'string' ? data.tradeId : undefined,
    cashSaleId: typeof data.cashSaleId === 'string' ? data.cashSaleId : undefined,
    dealId: typeof data.dealId === 'string' ? data.dealId : undefined,
    profileId: typeof data.profileId === 'string' ? data.profileId : undefined,
  };
}
