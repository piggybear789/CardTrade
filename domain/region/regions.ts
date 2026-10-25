// domain/region/regions.ts
//
// The trading-region registry and the ONE definition of what a region is.
//
// A region is an ISO 3166-1 alpha-2 country code. It maps onto ONE presentment
// currency and ONE Connect account country, and onto the Stripe PLATFORM account its
// money moves through (`platform`). Several regions may share a platform: the US
// platform serves the whole US/UK/EEA/CA/CH cross-border group, and members on one
// platform may trade across countries. Australia has its own platform.
//
// TWO REGION VALUES EXIST AND THEY ARE NOT THE SAME THING.
//
//   * Browse region — which listings a visitor sees. A preference. Guessed from
//     IP, changed by a control, carried in the URL. Wrong is harmless.
//   * Trading region — `profiles.region_code`. What the contract guards read and
//     what must match the Seller's Connect account country, or the transfer fails
//     against an account registered elsewhere.
//
// Never derive the second from the first. A member on a VPN, or reading this on
// holiday, would otherwise be handed a trading region they cannot settle in and
// would only discover it at payout time.
//
// WHICH REGIONS CAN SHARE A PLATFORM.
//
// Stripe supports cross-border transfers on the payments balance only between the
// US, Canada, UK, EEA and Switzerland; everywhere else "your platform and any
// connected account must be in the same region". Cross-border payouts also require
// the PLATFORM to sit in that group — Australia is not eligible — and are refused for
// RECIPIENT-only connected accounts. So a seller whose country differs from the
// platform's is created with a merchant (card_payments) configuration as well
// (`createManagedMerchant`); a seller in the platform's own country stays
// recipient-only.
//
// Our funds flow is buyer → PLATFORM balance → seller, so the platform's settlement
// currency (USD for the US platform) sits in the middle of every sale it handles. A
// contract in any other currency is converted twice — at collection and at payout —
// and the BUYER pays for both (`domain/fees/fxFee.ts`).
//
// VERIFIED against Stripe's documentation on 2026-09-01 and in test mode on
// 2026-10-13. Re-check before acting on any of it — provider availability changes.
//   https://docs.stripe.com/connect/cross-border-payouts
//   https://docs.stripe.com/connect/separate-charges-and-transfers
//   https://docs.stripe.com/connect/service-agreement-types
//   https://docs.stripe.com/global-payouts

/** ISO 3166-1 alpha-2, uppercased. */
export type RegionCode = string;

/**
 * A jurisdiction the marketplace can operate in.
 *
 * Presence here means "Stripe supports the funds flow we need in this country".
 * It does NOT mean the region is live — see {@link RegionDefinition.tradingEnabled}
 * and, at runtime, `operationalRegions()`.
 */
export interface RegionDefinition {
  /** ISO 3166-1 alpha-2, uppercase. */
  code: RegionCode;
  /** Member-facing name. */
  label: string;
  /** ISO 4217 presentment currency, lowercased to match Stripe. */
  currency: string;
  /** Country passed to `v2.core.accounts.create` for a Seller in this region. */
  stripeCountry: string;
  /**
   * BCP 47 locale used to format this region's money.
   *
   * English variants throughout, because the interface is English-only and there
   * is no i18n layer. Mixing `de-DE` number grouping into otherwise English copy
   * reads as a bug, while `Intl` still renders the correct symbol and placement
   * for any currency under an English locale. Revisit this if translation lands.
   */
  locale: string;
  /**
   * Whether contracts may be opened here, as a matter of PRODUCT intent.
   *
   * The runtime answer is stricter and lives outside this pure module: a region is
   * only genuinely operational when a Stripe platform binding is configured for
   * it (`operationalRegions()` in `domain/services`). Both must hold. This flag
   * exists so a region can be present and browsable — its listings visible, its
   * filter working — before the entity and Stripe account behind it exist.
   */
  tradingEnabled: boolean;
  /**
   * The region whose Stripe PLATFORM account this region's money moves through.
   *
   * Usually the region itself. The exception is the cross-border group: Stripe lets a
   * platform in the US, UK, EEA, CA or CH pay connected accounts in any of those, so
   * one US platform (`acct_1UIfsRRbOJEOZeCm`) serves all of them and their members
   * trade with each other. Verified in test mode on 2026-10-13: a DE account on the US
   * platform onboarded and received a USD transfer as EUR. Australia is not eligible
   * and keeps its own platform.
   */
  platform: RegionCode;
}

/**
 * Currencies Stripe treats as having NO minor unit.
 *
 * Load-bearing, not trivia. Every amount in this system is an integer in the
 * currency's smallest unit, and the whole codebase calls that "cents" because AUD
 * has 100 of them. For JPY the smallest unit IS the yen, so dividing by 100 to
 * display — or multiplying by 100 to store — is wrong by a factor of 100 in a
 * money path. `minorUnitDigits` is the one place that difference is expressed, and
 * `assertMinorUnitSupported` refuses anything this table cannot describe rather
 * than guessing 2.
 *
 * Only JPY out of the supported set below is zero-decimal. The three-decimal
 * currencies (BHD, JOD, KWD, OMR, TND) are absent because Stripe supports no
 * platform in those countries.
 */
const ZERO_DECIMAL_CURRENCIES: ReadonlySet<string> = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga',
  'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]);

/**
 * Every country in which Stripe supports separate charges and transfers, which is
 * the funds flow this platform requires (Req 4.7, 8.3).
 *
 * Taken from Stripe's published availability list for that flow. A country absent
 * from it cannot host a platform account for us at all, so adding one here would
 * be a promise the provider cannot keep.
 *
 * All 41 entries below were checked against that list on 2026-09-01 and matched
 * exactly: https://docs.stripe.com/connect/separate-charges-and-transfers
 *
 * `tradingEnabled` is true for AU and for the cross-border group served by the US
 * platform (US, UK, EEA, CA, CH — `platform: 'US'`), and false for everything else.
 * The rest need a registered legal entity and their own Stripe platform account before
 * a single deal can complete in them. Hungary sits on the US platform but stays closed
 * (see its row).
 *
 * THIS IS PRODUCT INTENT, NOT A LIVE SWITCH. `operationalRegions()` intersects it with
 * the configured platform keys: a region is operational only when ITS PLATFORM's key
 * is set (`STRIPE_SECRET_KEY_US` for the whole group). Without it the group is absent
 * from the onboarding region step and refused by every contract guard.
 */
export const REGIONS: readonly RegionDefinition[] = [
  { code: 'AE', label: 'United Arab Emirates', currency: 'aed', stripeCountry: 'ae', locale: 'en-AE', tradingEnabled: false, platform: 'AE' },
  { code: 'AT', label: 'Austria',              currency: 'eur', stripeCountry: 'at', locale: 'en-IE', tradingEnabled: true,  platform: 'US' },
  { code: 'AU', label: 'Australia',            currency: 'aud', stripeCountry: 'au', locale: 'en-AU', tradingEnabled: true,  platform: 'AU' },
  { code: 'BE', label: 'Belgium',              currency: 'eur', stripeCountry: 'be', locale: 'en-IE', tradingEnabled: true,  platform: 'US' },
  { code: 'BG', label: 'Bulgaria',             currency: 'bgn', stripeCountry: 'bg', locale: 'en-GB', tradingEnabled: true,  platform: 'US' },
  { code: 'BR', label: 'Brazil',               currency: 'brl', stripeCountry: 'br', locale: 'en-GB', tradingEnabled: false, platform: 'BR' },
  { code: 'CA', label: 'Canada',               currency: 'cad', stripeCountry: 'ca', locale: 'en-CA', tradingEnabled: true,  platform: 'US' },
  { code: 'CH', label: 'Switzerland',          currency: 'chf', stripeCountry: 'ch', locale: 'en-CH', tradingEnabled: true,  platform: 'US' },
  { code: 'CY', label: 'Cyprus',               currency: 'eur', stripeCountry: 'cy', locale: 'en-IE', tradingEnabled: true,  platform: 'US' },
  { code: 'CZ', label: 'Czechia',              currency: 'czk', stripeCountry: 'cz', locale: 'en-GB', tradingEnabled: true,  platform: 'US' },
  { code: 'DE', label: 'Germany',              currency: 'eur', stripeCountry: 'de', locale: 'en-IE', tradingEnabled: true,  platform: 'US' },
  { code: 'DK', label: 'Denmark',              currency: 'dkk', stripeCountry: 'dk', locale: 'en-GB', tradingEnabled: true,  platform: 'US' },
  { code: 'EE', label: 'Estonia',              currency: 'eur', stripeCountry: 'ee', locale: 'en-IE', tradingEnabled: true,  platform: 'US' },
  { code: 'ES', label: 'Spain',                currency: 'eur', stripeCountry: 'es', locale: 'en-IE', tradingEnabled: true,  platform: 'US' },
  { code: 'FI', label: 'Finland',              currency: 'eur', stripeCountry: 'fi', locale: 'en-IE', tradingEnabled: true,  platform: 'US' },
  { code: 'FR', label: 'France',               currency: 'eur', stripeCountry: 'fr', locale: 'en-IE', tradingEnabled: true,  platform: 'US' },
  { code: 'GB', label: 'United Kingdom',       currency: 'gbp', stripeCountry: 'gb', locale: 'en-GB', tradingEnabled: true,  platform: 'US' },
  { code: 'GR', label: 'Greece',               currency: 'eur', stripeCountry: 'gr', locale: 'en-IE', tradingEnabled: true,  platform: 'US' },
  // Croatia adopted the euro on 2023-01-01; the kuna is retired.
  { code: 'HR', label: 'Croatia',              currency: 'eur', stripeCountry: 'hr', locale: 'en-IE', tradingEnabled: true,  platform: 'US' },
  // Held closed while the rest of the EEA opens: Stripe treats HUF as two-decimal for
  // charges but requires payout amounts divisible by 100, which our integer model does
  // not enforce. Open it once that rule is handled at the seam.
  { code: 'HU', label: 'Hungary',              currency: 'huf', stripeCountry: 'hu', locale: 'en-GB', tradingEnabled: false, platform: 'US' },
  { code: 'IE', label: 'Ireland',              currency: 'eur', stripeCountry: 'ie', locale: 'en-IE', tradingEnabled: true,  platform: 'US' },
  { code: 'IT', label: 'Italy',                currency: 'eur', stripeCountry: 'it', locale: 'en-IE', tradingEnabled: true,  platform: 'US' },
  // The ONLY zero-decimal currency in this table. See ZERO_DECIMAL_CURRENCIES.
  { code: 'JP', label: 'Japan',                currency: 'jpy', stripeCountry: 'jp', locale: 'en-JP', tradingEnabled: false, platform: 'JP' },
  { code: 'LI', label: 'Liechtenstein',        currency: 'chf', stripeCountry: 'li', locale: 'en-CH', tradingEnabled: true,  platform: 'US' },
  { code: 'LT', label: 'Lithuania',            currency: 'eur', stripeCountry: 'lt', locale: 'en-IE', tradingEnabled: true,  platform: 'US' },
  { code: 'LU', label: 'Luxembourg',           currency: 'eur', stripeCountry: 'lu', locale: 'en-IE', tradingEnabled: true,  platform: 'US' },
  { code: 'LV', label: 'Latvia',               currency: 'eur', stripeCountry: 'lv', locale: 'en-IE', tradingEnabled: true,  platform: 'US' },
  { code: 'MT', label: 'Malta',                currency: 'eur', stripeCountry: 'mt', locale: 'en-MT', tradingEnabled: true,  platform: 'US' },
  { code: 'MX', label: 'Mexico',               currency: 'mxn', stripeCountry: 'mx', locale: 'en-GB', tradingEnabled: false, platform: 'MX' },
  { code: 'MY', label: 'Malaysia',             currency: 'myr', stripeCountry: 'my', locale: 'en-MY', tradingEnabled: false, platform: 'MY' },
  { code: 'NL', label: 'Netherlands',          currency: 'eur', stripeCountry: 'nl', locale: 'en-IE', tradingEnabled: true,  platform: 'US' },
  { code: 'NO', label: 'Norway',               currency: 'nok', stripeCountry: 'no', locale: 'en-GB', tradingEnabled: true,  platform: 'US' },
  { code: 'NZ', label: 'New Zealand',          currency: 'nzd', stripeCountry: 'nz', locale: 'en-NZ', tradingEnabled: false, platform: 'NZ' },
  { code: 'PL', label: 'Poland',               currency: 'pln', stripeCountry: 'pl', locale: 'en-GB', tradingEnabled: true,  platform: 'US' },
  { code: 'PT', label: 'Portugal',             currency: 'eur', stripeCountry: 'pt', locale: 'en-IE', tradingEnabled: true,  platform: 'US' },
  { code: 'RO', label: 'Romania',              currency: 'ron', stripeCountry: 'ro', locale: 'en-GB', tradingEnabled: true,  platform: 'US' },
  { code: 'SE', label: 'Sweden',               currency: 'sek', stripeCountry: 'se', locale: 'en-GB', tradingEnabled: true,  platform: 'US' },
  { code: 'SG', label: 'Singapore',            currency: 'sgd', stripeCountry: 'sg', locale: 'en-SG', tradingEnabled: false, platform: 'SG' },
  { code: 'SI', label: 'Slovenia',             currency: 'eur', stripeCountry: 'si', locale: 'en-IE', tradingEnabled: true,  platform: 'US' },
  { code: 'SK', label: 'Slovakia',             currency: 'eur', stripeCountry: 'sk', locale: 'en-IE', tradingEnabled: true,  platform: 'US' },
  { code: 'US', label: 'United States',        currency: 'usd', stripeCountry: 'us', locale: 'en-US', tradingEnabled: true,  platform: 'US' },
] as const;

/**
 * The region used when nothing else resolves.
 *
 * A hard-coded constant rather than an env read, because `domain/` must stay
 * pure. `lib/location/resolveRegion.ts` layers `DEFAULT_REGION` over it.
 */
export const FALLBACK_REGION: RegionCode = 'AU';

const BY_CODE = new Map<RegionCode, RegionDefinition>(
  REGIONS.map((region) => [region.code, region]),
);

/**
 * Coerce arbitrary input to a region code, or null.
 *
 * Accepts any casing and surrounding whitespace, because the sources are a URL
 * param, a cookie, a database column and a provider header. Anything that is not
 * a known region becomes null — an unrecognised code must never fall through as
 * though it were valid, or the catalog would silently return nothing.
 */
export function normalizeRegionCode(value: unknown): RegionCode | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return null;
  return BY_CODE.has(code) ? code : null;
}

/** Look up a region, or null when unknown. */
export function findRegion(code: unknown): RegionDefinition | null {
  const normalized = normalizeRegionCode(code);
  return normalized ? (BY_CODE.get(normalized) ?? null) : null;
}

/** Member-facing name for a code, falling back to the raw code. */
export function regionLabel(code: unknown): string {
  const region = findRegion(code);
  if (region) return region.label;
  const normalized = typeof code === 'string' ? code.trim().toUpperCase() : '';
  return normalized || 'Unknown';
}

/**
 * The presentment currency for a region, lowercase, or null when unknown.
 *
 * This is the ONLY place a region is turned into a currency. `cash_sales.currency`
 * and `trades.currency` are written from it at creation and then frozen, because a
 * contract's denomination must not move if this table is later corrected.
 */
export function regionCurrency(code: unknown): string | null {
  return findRegion(code)?.currency ?? null;
}

/** The locale a region's money is formatted in, or null when unknown. */
export function regionLocale(code: unknown): string | null {
  return findRegion(code)?.locale ?? null;
}

/**
 * The region whose Stripe platform account serves `code`, or null when unknown.
 *
 * This is the ONE place a member's region becomes a platform. Credentials, the
 * settlement currency and the contract guard all key off it.
 */
export function platformRegion(code: unknown): RegionCode | null {
  return findRegion(code)?.platform ?? null;
}

/**
 * The currency a platform's balance settles in: its own region's currency.
 *
 * A contract in any other currency is converted into this one when the buyer is
 * charged and back out of it when the seller is paid.
 */
export function settlementCurrency(platform: unknown): string | null {
  const code = platformRegion(platform);
  return code ? regionCurrency(code) : null;
}

/**
 * Whether a contract in `currency` on `platform` crosses currencies, so the
 * Currency_Conversion fee applies. False when either side is unknown.
 */
export function needsCurrencyConversion(currency: unknown, platform: unknown): boolean {
  const settles = settlementCurrency(platform);
  const code = typeof currency === 'string' ? currency.trim().toLowerCase() : '';
  return Boolean(settles && code && code !== settles);
}

/** Whether the region exists AND product intent allows contracts in it. */
export function isTradingRegion(code: unknown): boolean {
  return findRegion(code)?.tradingEnabled ?? false;
}

/**
 * Regions a member may pick as their own, by product intent alone.
 *
 * Callers that gate MONEY must use the runtime list (`operationalRegions()`),
 * which additionally requires a configured Stripe platform binding.
 */
export function tradingRegions(): readonly RegionDefinition[] {
  return REGIONS.filter((region) => region.tradingEnabled);
}

// ---------------------------------------------------------------------------
// Minor units
// ---------------------------------------------------------------------------

/**
 * The ISO 4217 currencies whose minor unit is a THOUSANDTH, not a hundredth.
 *
 * Named explicitly so `minorUnitDigits` can report 3 for them, which is what makes
 * {@link assertMinorUnitSupported} able to fire. Before this set existed, that
 * function could not: `minorUnitDigits` returned only 0 or 2, so its
 * `digits !== 0 && digits !== 2` condition was unsatisfiable, and the documented
 * "crash at the seam rather than a rounding error in production" did not exist. A
 * three-decimal currency would simply have been treated as two-decimal — every amount
 * understated tenfold, silently.
 */
const THREE_DECIMAL_CURRENCIES = new Set(['bhd', 'iqd', 'jod', 'kwd', 'lyd', 'omr', 'tnd']);

/**
 * How many decimal places a currency's smallest unit implies.
 *
 * @returns 2 for ordinary currencies, 0 for the zero-decimal ones, 3 for the
 *   thousandth-unit ones — which this codebase's integer model cannot represent, so
 *   callers on a money path must screen them with {@link assertMinorUnitSupported}
 * @throws Error for anything that is not an ISO 4217 code at all
 */
export function minorUnitDigits(currency: string): number {
  const code = currency.trim().toLowerCase();
  if (!/^[a-z]{3}$/.test(code)) {
    throw new Error(`Not an ISO 4217 currency code: ${currency}`);
  }
  if (ZERO_DECIMAL_CURRENCIES.has(code)) return 0;
  if (THREE_DECIMAL_CURRENCIES.has(code)) return 3;
  return 2;
}

/**
 * Refuse a currency whose minor unit this codebase cannot represent.
 *
 * WHY THIS THROWS RATHER THAN ASSUMING 2. Every amount here is an integer in the
 * smallest unit and is named `...Cents`. Assuming two decimals for a currency that
 * has three (BHD, JOD, KWD, OMR, TND) understates every amount by a factor of ten,
 * and the failure is silent — the number is plausible, the charge is wrong, and
 * nothing in the system can detect it afterwards. A money path must fail loudly on
 * an input it cannot represent.
 *
 * None of the currently supported regions use a three-decimal currency, so this does
 * not fire today; it exists so that adding one is a crash at the seam rather than a
 * rounding error in production.
 *
 * IT CAN NOW ACTUALLY FIRE, WHICH IT COULD NOT BEFORE. `minorUnitDigits` used to
 * return only 0 or 2 — a currency it did not recognise fell through to 2 — so this
 * function's condition was unsatisfiable and it had no call site either. It was a
 * comment describing a protection, not a protection. `THREE_DECIMAL_CURRENCIES` makes
 * the digit count truthful, and `readStripeConfig` calls this on every payment
 * configuration it builds.
 */
export function assertMinorUnitSupported(currency: string): void {
  const digits = minorUnitDigits(currency);
  if (digits !== 0 && digits !== 2) {
    throw new Error(
      `Currency ${currency} has ${digits} minor-unit digits, which the integer-cents ` +
        'money model does not represent. Add explicit handling before enabling it.',
    );
  }
}

/**
 * Convert an integer minor-unit amount to its major-unit value for display.
 *
 * `12345` AUD → `123.45`; `12345` JPY → `12345`, because the yen has no minor
 * unit. Never use this for arithmetic — it is the last step before formatting.
 */
export function minorToMajor(minorUnits: number, currency: string): number {
  const safe = Number.isFinite(minorUnits) ? Math.round(minorUnits) : 0;
  return safe / 10 ** minorUnitDigits(currency);
}

// ---------------------------------------------------------------------------
// Browse-region provenance
// ---------------------------------------------------------------------------

/**
 * Where a resolved BROWSE region came from.
 *
 * Lives here, in the pure module, rather than beside the resolver in
 * `lib/location/resolveRegion.ts`, because client components need it to decide
 * whether to explain the active scope — and that module is `server-only`, so
 * importing even a type from it puts a throwing module one erasure rule away from
 * the browser bundle.
 *
 * The distinction it carries is a product rule, not an implementation detail: a
 * scope the visitor CHOSE (`param`, `cookie`, `profile`, `all`) needs no
 * justification, while one that was GUESSED (`geo`, `default`) must be disclosed or
 * a filtered catalog reads as an empty marketplace.
 */
export type RegionSource =
  /** The member's own trading region. */
  | 'profile'
  /** An explicit `?region=` in the URL. */
  | 'param'
  /** A previous explicit choice, remembered. */
  | 'cookie'
  /** Guessed from the request IP. Worth telling the visitor. */
  | 'geo'
  /** Nothing resolved; the configured default. Also worth telling them. */
  | 'default'
  /** The visitor explicitly asked for every region. */
  | 'all';

// ---------------------------------------------------------------------------
// The contract precondition
// ---------------------------------------------------------------------------

/**
 * Why two parties may not transact.
 *
 * `null` means they may. Returned as a value rather than thrown, per the
 * errors-are-values convention.
 */
export type RegionMismatch =
  /** One side has no region on file at all. */
  | { reason: 'UNKNOWN_REGION'; buyerRegion: RegionCode | null; sellerRegion: RegionCode | null }
  /** Both known, but served by different Stripe platforms (e.g. AU and DE). */
  | { reason: 'CROSS_REGION'; buyerRegion: RegionCode; sellerRegion: RegionCode }
  /** One side's region is not open for contracts yet. */
  | {
      reason: 'REGION_NOT_ENABLED';
      buyerRegion: RegionCode;
      sellerRegion: RegionCode;
      /** Whichever side is closed; the seller's when both are. */
      closedRegion: RegionCode;
    };

/**
 * The region precondition for opening a contract.
 *
 * Both parties' regions must be enabled AND served by the SAME Stripe platform. Two
 * countries on one platform may trade (a UK buyer and a German seller both sit on the
 * US platform); two platforms may not, because the money is collected into one
 * platform's balance and a platform cannot pay a seller registered on another. This
 * is the single place that question is answered — the Cash_Sale orchestrator and
 * the trade negotiation action both call it, exactly as the Identity_Gate is only
 * ever evaluated through `satisfiesIdentityGate`.
 *
 * WHY THIS IS A CONTRACT GUARD AND NOT A BROWSE FILTER. Filtering the catalog is
 * bypassed by a shared link, a watchlist entry, a saved search, or opening
 * `/listings/[id]` directly. Without this check a Buyer in one jurisdiction can
 * still open a contract against a Seller in another, and the failure surfaces at
 * transfer time with money already collected.
 *
 * @param buyerRegion  the initiating party's trading region
 * @param sellerRegion the counterparty's trading region
 * @param enabledRegions the regions that are ACTUALLY operational — normally
 *   `operationalRegions()`, which requires a configured Stripe platform binding on
 *   top of product intent. Injected rather than read, because whether a provider
 *   credential exists is a runtime fact and this module is pure. Omit it and the
 *   registry's own `tradingEnabled` is used, which is the right default for tests
 *   but too permissive for a money path.
 * @returns `null` when the contract may proceed, otherwise the reason it may not
 */
export function checkRegionCompatibility(
  buyerRegion: unknown,
  sellerRegion: unknown,
  enabledRegions?: ReadonlySet<RegionCode>,
): RegionMismatch | null {
  const buyer = normalizeRegionCode(buyerRegion);
  const seller = normalizeRegionCode(sellerRegion);

  if (!buyer || !seller) {
    return { reason: 'UNKNOWN_REGION', buyerRegion: buyer, sellerRegion: seller };
  }
  const enabled = (code: RegionCode) =>
    enabledRegions ? enabledRegions.has(code) : isTradingRegion(code);
  // The seller's side is checked first: "deals in Germany are not open" is the more
  // useful sentence when the listing is the thing that cannot be transacted.
  if (!enabled(seller) || !enabled(buyer)) {
    return {
      reason: 'REGION_NOT_ENABLED',
      buyerRegion: buyer,
      sellerRegion: seller,
      closedRegion: enabled(seller) ? buyer : seller,
    };
  }
  if (platformRegion(buyer) !== platformRegion(seller)) {
    return { reason: 'CROSS_REGION', buyerRegion: buyer, sellerRegion: seller };
  }
  return null;
}

/**
 * Member-facing explanation of a mismatch.
 *
 * Says which regions are involved, because "not available in your region" with no
 * further detail leaves a member unable to tell a fixable problem from a permanent
 * one (the seller is overseas).
 *
 * A BUYER WITH NO REGION IS ON THE WAITLIST. While onboarding offered a waitlist
 * option (0118 until 2026-10-22, when the picker was cut to open countries only), the
 * only way to finish it without a trading region was to say you were somewhere
 * NoDitto is not open (`region_waitlist`); every earlier member was backfilled to AU
 * by 0067. Those members still exist, so the honest sentence is about their region
 * not being open — not "set your region in your profile", which named a control that
 * does not exist and a step they could not have taken.
 */
export function regionMismatchMessage(mismatch: RegionMismatch): string {
  switch (mismatch.reason) {
    case 'UNKNOWN_REGION':
      return !mismatch.buyerRegion
        ? 'Deals are not open in your region yet. You can browse listings, but not buy, sell or trade until NoDitto opens there.'
        : 'This seller has not set a region yet, so a contract cannot be opened.';
    case 'CROSS_REGION':
      return (
        `This listing is in ${regionLabel(mismatch.sellerRegion)} and you are trading in ` +
        `${regionLabel(mismatch.buyerRegion)}. Deals between those two regions are not ` +
        'possible yet, because payments for each are handled separately.'
      );
    case 'REGION_NOT_ENABLED':
      return (
        `Deals in ${regionLabel(mismatch.closedRegion)} are not open yet. You can browse ` +
        'listings there, but contracts cannot be opened.'
      );
  }
}
