// domain/services/stripe/metadata.ts
//
// CardTrade context carried on Stripe objects via the provider's `metadata` map.
//
// Stripe webhook events deliver the PaymentIntent (including its metadata) but
// know nothing about Trades or Cash_Sales. Stamping our own intent onto every
// object is what lets `translateStripeEvent` decide whether an authorised
// PaymentIntent means "collateral hold is active" or "cash sale settled", and
// which row it belongs to. Without it, an inbound event is unroutable and is
// logged as a NO_OP (Req 10.4).
//
// Unlike Pinch — whose `metadata` is a single free-text string we JSON-encoded —
// Stripe metadata is a native string map (50 keys, 500 chars each), so the
// fields are stored flat under a `cardtrade_` prefix. That keeps them readable
// in the Stripe Dashboard and filterable in Sigma.
//
// Pure string handling — no I/O, safe to unit test directly.

/**
 * What a Stripe object represents in CardTrade terms.
 *
 * `REFUND` stamps a dispute resolution that returns funds to a Buyer. It is
 * informational only: refunds surface as `charge.refunded` / `refund.*`, none of
 * which `translateStripeEvent` routes, so adding it cannot change webhook
 * dispatch — unlike `HOLD` and `TRANSFER`, where the metadata is what makes one
 * `payment_intent.succeeded` mean different things.
 */
export type StripePaymentKind = 'HOLD' | 'TRANSFER' | 'REFUND';

/**
 * The kinds `decodeMetadata` will accept, derived from the union above so the two
 * can never drift. Adding a kind to the type is enough to make it decodable.
 */
const KINDS: ReadonlySet<StripePaymentKind> = new Set<StripePaymentKind>([
  'HOLD',
  'TRANSFER',
  'REFUND',
]);

/** The CardTrade payload embedded in a Stripe object's `metadata` map. */
export interface CardTradeMetadata {
  kind: StripePaymentKind;
  /** The caller-supplied operation reference (also used as the nonce). */
  ref: string;
  /** Owning Trade, when derivable from `ref`. */
  tradeId?: string;
  /** Owning Cash_Sale, when derivable from `ref`. */
  cashSaleId?: string;
  /** Owning Deal, when derivable from `ref`. */
  dealId?: string;
  /** Owning Profile, for customer records. */
  profileId?: string;
}

/** Key prefix so our data never collides with other metadata producers. */
const PREFIX = 'cardtrade_';

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
    // Every Cash_Sale operation resolves to its sale. These are distinct prefixes
    // rather than one because they appear on different provider objects and read
    // differently in the Dashboard — but they must all route home, and
    // `cash-sale-refund` in particular DOES drive routing: a refund that later
    // fails is only attributable through this metadata.
    case 'cash-sale':
    case 'cash-sale-refund':
    case 'cash-sale-payout':
      return { cashSaleId: first };
    case 'deal':
      return { dealId: first };
    default:
      return {};
  }
}

/**
 * Build the `metadata` map to send with a Stripe request. Undefined fields are
 * omitted rather than sent as the string `"undefined"`.
 */
export function encodeMetadata(data: CardTradeMetadata): Record<string, string> {
  const out: Record<string, string> = {
    [`${PREFIX}kind`]: data.kind,
    [`${PREFIX}ref`]: data.ref,
  };
  if (data.tradeId) out[`${PREFIX}trade_id`] = data.tradeId;
  if (data.cashSaleId) out[`${PREFIX}cash_sale_id`] = data.cashSaleId;
  if (data.dealId) out[`${PREFIX}deal_id`] = data.dealId;
  if (data.profileId) out[`${PREFIX}profile_id`] = data.profileId;
  return out;
}

/**
 * Recover the CardTrade context from a Stripe object's `metadata` map. Returns
 * `null` for absent or foreign metadata — the caller then treats the event as
 * unroutable (a logged NO_OP) rather than failing.
 */
export function decodeMetadata(metadata: unknown): CardTradeMetadata | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const map = metadata as Record<string, unknown>;

  const read = (key: string): string | undefined => {
    const value = map[`${PREFIX}${key}`];
    return typeof value === 'string' && value.trim() ? value : undefined;
  };

  const kind = read('kind');
  const ref = read('ref');
  // Validated against the union rather than an inline list. The previous inline
  // `kind !== 'HOLD' && kind !== 'TRANSFER'` check silently rejected every REFUND,
  // which made a failed refund unattributable even though its metadata was correct —
  // and would go on rejecting any future kind added to the type.
  if (!kind || !KINDS.has(kind as StripePaymentKind) || !ref) return null;

  return {
    kind: kind as StripePaymentKind,
    ref,
    tradeId: read('trade_id'),
    cashSaleId: read('cash_sale_id'),
    dealId: read('deal_id'),
    profileId: read('profile_id'),
  };
}

/** Build metadata for an operation, deriving the owning entity from `ref`. */
export function metadataFor(
  kind: StripePaymentKind,
  ref: string,
  extra: Pick<CardTradeMetadata, 'profileId'> = {},
): Record<string, string> {
  return encodeMetadata({ kind, ref, ...parseRef(ref), ...extra });
}
