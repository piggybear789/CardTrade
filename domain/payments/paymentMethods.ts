// domain/payments/paymentMethods.ts
//
// How a cash-sale buyer can pay, and what each way costs them. Pure and client-safe:
// the Pay dialog lists the options and prices each one from this module, and the
// orchestrator re-derives the same figure before anything is charged.
//
// WHICH RAILS, AND WHY THESE (2026-10). Card stays the default everywhere and the
// only rail for trade collateral, because a hold needs a card authorisation that can
// be captured later. A cash sale is collected up front and held by the platform, so a
// bank rail works for it as long as the money cannot be clawed back with no recourse:
//
//   US_BANK     Stripe Instant Bank Payments (Link). ACH underneath, but Stripe
//               guarantees settlement and a buyer dispute is CONTESTED with evidence,
//               like a card chargeback. Plain ACH Direct Debit is deliberately absent:
//               its returns cannot be challenged, and enabling it hides this option.
//               DEFINED BUT NOT OFFERED: see `offered` on its definition.
//   IDEAL, BANCONTACT, EPS, P24
//               Authenticated bank transfers. The buyer approves in their banking app
//               and there is no bank dispute process: final once paid.
//   PAYTO       Australian real-time payment, approved in the banking app. Disputes
//               exist and are FINAL against us (Stripe cannot appeal them), so this is
//               a cost choice, not a risk improvement over card.
//
// Direct debits (BECS, SEPA, Bacs, ACH) are refused on purpose: the payer can reverse
// them for weeks to years with no evidence process, after the seller has been paid.
//
// Each rail is offered only where it can work: the contract currency it settles in,
// and the BUYER's own trading region, which is where their bank account is.
//
// CARD IS PRICED BY WHERE THE CARD WAS ISSUED (0159). `CARD_UK_EEA` and
// `CARD_INTERNATIONAL` are not choices the buyer makes. They are what CARD is priced
// and stored as when the saved card was issued outside the contract's domestic card
// zone (`cardMethodFor`, from `domain/fees/processingFee.ts`): Stripe charges more for
// those cards, so they carry a higher service fee. The buyer picks "Card"; the card
// decides which of the three card rates applies.

import { cardTierFor, cardZoneOf, cashSaleFeeMinor } from '@/domain/fees/processingFee';

/** Integer minor units of the contract currency. */
type Cents = number;

/**
 * Every way a cash sale may be paid, and every way a card payment may be priced.
 * Mirrors the 0159 CHECK on `cash_sales.payment_method_kind`.
 */
export const PAYMENT_METHOD_KINDS = [
  'CARD',
  'CARD_UK_EEA',
  'CARD_INTERNATIONAL',
  'US_BANK',
  'IDEAL',
  'BANCONTACT',
  'EPS',
  'P24',
  'PAYTO',
] as const;

export type PaymentMethodKind = (typeof PAYMENT_METHOD_KINDS)[number];

/** What a dispute on the rail means for the platform. */
export type DisputeProfile =
  /** The buyer's bank can reverse it, and we answer with evidence. */
  | 'CONTESTABLE'
  /** The buyer's bank can reverse it, and we cannot answer. */
  | 'FINAL'
  /** There is no bank dispute process: the payment is final. */
  | 'NONE';

export interface PaymentMethodDefinition {
  kind: PaymentMethodKind;
  /** The Stripe `payment_method_types` entry. Read only by the Stripe binding. */
  stripeType: 'card' | 'link' | 'ideal' | 'bancontact' | 'eps' | 'p24' | 'payto';
  /** Lower-cased ISO 4217 currencies the rail settles in. */
  currencies: readonly string[];
  /** Buyer trading regions (ISO alpha-2) whose banks run the rail. Absent: any. */
  buyerRegions?: readonly string[];
  /** Largest payment Stripe offers the rail for by default, in minor units. */
  maxAmountMinor?: Cents;
  /**
   * False keeps a rail out of every Pay step while leaving it in the vocabulary (the
   * 0158 CHECK, stored rows). Absent means offered.
   */
  offered?: boolean;
  /**
   * Set on the two card tiers (0159): not a choice, but what CARD is priced as for a
   * card issued outside the contract's domestic zone. Never listed by
   * {@link paymentMethodsFor}.
   */
  cardTier?: 'UK_EEA' | 'INTERNATIONAL';
  /** Member-facing name. */
  label: string;
  /** One line under the name in the Pay dialog. */
  description: string;
  disputes: DisputeProfile;
}

const DEFINITIONS: Record<PaymentMethodKind, PaymentMethodDefinition> = {
  CARD: {
    kind: 'CARD',
    stripeType: 'card',
    currencies: [],
    label: 'Card',
    description: 'Your saved debit or credit card. Paid straight away.',
    disputes: 'CONTESTABLE',
  },
  CARD_UK_EEA: {
    kind: 'CARD_UK_EEA',
    stripeType: 'card',
    currencies: [],
    cardTier: 'UK_EEA',
    label: 'Card',
    description: 'Your saved debit or credit card. Paid straight away.',
    disputes: 'CONTESTABLE',
  },
  CARD_INTERNATIONAL: {
    kind: 'CARD_INTERNATIONAL',
    stripeType: 'card',
    currencies: [],
    cardTier: 'INTERNATIONAL',
    label: 'Card',
    description: 'Your saved debit or credit card. Paid straight away.',
    disputes: 'CONTESTABLE',
  },
  US_BANK: {
    kind: 'US_BANK',
    stripeType: 'link',
    currencies: ['usd'],
    buyerRegions: ['US'],
    // Stripe presents Instant Bank Payments only below this by default.
    maxAmountMinor: 750_000,
    // NOT OFFERED YET (found end to end, 2026-10-21). Payment Element refuses to render
    // `link` on its own ("pass both 'link' and 'card'"), so an intent created for this
    // rail alone cannot be approved in the browser, and one created with card as well
    // lets the buyer pay by card at the bank price. Offering it needs the deferred
    // flow: the buyer picks in Payment Element, then the server prices the intent from
    // the confirmation token's payment method.
    offered: false,
    label: 'US bank account',
    description: 'Log in to your bank through Stripe Link. Confirmed instantly.',
    disputes: 'CONTESTABLE',
  },
  IDEAL: {
    kind: 'IDEAL',
    stripeType: 'ideal',
    currencies: ['eur'],
    buyerRegions: ['NL'],
    label: 'iDEAL | Wero',
    description: 'Approve the payment in your Dutch banking app.',
    disputes: 'NONE',
  },
  BANCONTACT: {
    kind: 'BANCONTACT',
    stripeType: 'bancontact',
    currencies: ['eur'],
    buyerRegions: ['BE'],
    label: 'Bancontact',
    description: 'Approve the payment in your Belgian banking app.',
    disputes: 'NONE',
  },
  EPS: {
    kind: 'EPS',
    stripeType: 'eps',
    currencies: ['eur'],
    buyerRegions: ['AT'],
    label: 'EPS',
    description: 'Approve the payment in your Austrian banking app.',
    disputes: 'NONE',
  },
  P24: {
    kind: 'P24',
    stripeType: 'p24',
    currencies: ['eur', 'pln'],
    buyerRegions: ['PL'],
    label: 'Przelewy24',
    description: 'Approve the payment in your Polish banking app.',
    disputes: 'NONE',
  },
  PAYTO: {
    kind: 'PAYTO',
    stripeType: 'payto',
    currencies: ['aud'],
    buyerRegions: ['AU'],
    label: 'PayTo',
    description: 'Approve the payment in your Australian banking app. Usually confirmed within a minute.',
    disputes: 'FINAL',
  },
};

export function isPaymentMethodKind(value: unknown): value is PaymentMethodKind {
  return typeof value === 'string' && (PAYMENT_METHOD_KINDS as readonly string[]).includes(value);
}

export function paymentMethodDefinition(kind: PaymentMethodKind): PaymentMethodDefinition {
  return DEFINITIONS[kind];
}

/** A stored kind, read leniently: anything unrecognised (or absent) is a card payment. */
export function storedPaymentMethod(value: unknown): PaymentMethodKind {
  return isPaymentMethodKind(value) ? value : 'CARD';
}

/** Whether a kind is a card payment, at any of the three card rates. */
export function isCardMethod(kind: PaymentMethodKind): boolean {
  return DEFINITIONS[kind].stripeType === 'card';
}

/** Whether a rail confirms in the buyer's bank rather than against a saved card. */
export function isBankMethod(kind: PaymentMethodKind): boolean {
  return !isCardMethod(kind);
}

/** The choice behind a kind: every card tier is the buyer choosing "Card". */
export function paymentRailOf(kind: PaymentMethodKind): PaymentMethodKind {
  return isCardMethod(kind) ? 'CARD' : kind;
}

/**
 * What a card payment on a contract in `currency` is priced as, from the card's
 * issuing country (ISO alpha-2, Stripe's `card.country`). Domestic is CARD; across the
 * UK–EEA line CARD_UK_EEA; anywhere else CARD_INTERNATIONAL. An unknown country is
 * CARD (see `cardTierFor`).
 */
export function cardMethodFor(
  currency: string | null | undefined,
  cardCountry: string | null | undefined,
): PaymentMethodKind {
  switch (cardTierFor(currency, cardCountry)) {
    case 'UK_EEA':
      return 'CARD_UK_EEA';
    case 'INTERNATIONAL':
      return 'CARD_INTERNATIONAL';
    default:
      return 'CARD';
  }
}

/** The three card tiers, domestic first. */
export const CARD_METHODS: readonly PaymentMethodKind[] = ['CARD', 'CARD_UK_EEA', 'CARD_INTERNATIONAL'];

/**
 * Which cards a card tier covers on a contract in `currency`, as members read it:
 * "issued in Australia", "issued in the UK", "issued outside the EEA and the UK". Null
 * for a bank rail, a currency with no card zone, or a tier the currency does not have.
 * The one wording, so the Pay dialog and the server's refusal name the same cards.
 */
export function cardTierPhrase(
  currency: string | null | undefined,
  method: PaymentMethodKind,
): string | null {
  const zone = cardZoneOf(currency);
  if (!zone) return null;
  switch (method) {
    case 'CARD':
      return `issued in ${zone.domesticName}`;
    case 'CARD_UK_EEA':
      return zone.ukEeaName ? `issued in ${zone.ukEeaName}` : null;
    case 'CARD_INTERNATIONAL':
      return `issued outside ${zone.domesticName}${zone.ukEeaName ? ` and ${zone.ukEeaName}` : ''}`;
    default:
      return null;
  }
}

/**
 * The ways this buyer may pay this contract, card first. A bank rail is offered only
 * in its own currency, to a buyer whose trading region is where that bank runs, and
 * under its amount limit.
 */
export function paymentMethodsFor(params: {
  currency: string | null | undefined;
  buyerRegion: string | null | undefined;
  amountMinor?: Cents;
}): PaymentMethodKind[] {
  const currency = params.currency?.trim().toLowerCase() ?? '';
  const region = params.buyerRegion?.trim().toUpperCase() ?? '';
  const out: PaymentMethodKind[] = ['CARD'];
  for (const kind of PAYMENT_METHOD_KINDS) {
    // Card is listed once; its tiers are prices, not choices.
    if (isCardMethod(kind)) continue;
    const def = DEFINITIONS[kind];
    if (def.offered === false) continue;
    if (!def.currencies.includes(currency)) continue;
    if (def.buyerRegions && !def.buyerRegions.includes(region)) continue;
    if (
      def.maxAmountMinor !== undefined &&
      params.amountMinor !== undefined &&
      params.amountMinor > def.maxAmountMinor
    ) {
      continue;
    }
    out.push(kind);
  }
  return out;
}

/** The parts of a contract its price depends on. */
export interface MethodPricingFacts {
  agreedPriceCents: Cents;
  shippingCostCents: Cents;
  platformFeeCents: Cents;
  amountCents: Cents;
  currency: string;
  /**
   * What the stored fee was last priced for (0158): a rail, or a card tier (0159).
   * Absent: a domestic card.
   */
  paymentMethod?: PaymentMethodKind | null;
}

/**
 * The service fee this contract costs when paid with `method`. For card, pass the
 * buyer's tier (`cardMethodFor`), not the bare CARD, or a card issued abroad is priced
 * as a domestic one.
 *
 * A method keeps the fee stored on the contract while the contract is priced for it, so
 * a contract that stored a domestic card fee earlier keeps it until its terms change
 * (the rule every other fee change has followed). Every other rail or tier, and card
 * after an abandoned attempt re-priced the row, is derived fresh from price plus postage.
 */
export function serviceFeeForMethod(sale: MethodPricingFacts, method: PaymentMethodKind): Cents {
  const pricedFor = sale.paymentMethod ?? 'CARD';
  if (method === pricedFor) return sale.platformFeeCents;
  return cashSaleFeeMinor(sale.agreedPriceCents, sale.shippingCostCents, sale.currency, method);
}

/** What the buyer is charged with `method`: the contract total, re-priced for that rail. */
export function totalForMethod(sale: MethodPricingFacts, method: PaymentMethodKind): Cents {
  return sale.amountCents - sale.platformFeeCents + serviceFeeForMethod(sale, method);
}
