// tests/e2e/audit/core/copyRules.ts
//
// THE MEMBER-FACING COPY RULES for the e2e UX audit suite. Pure: no Playwright, no DOM,
// no `lib/` import, no I/O. `audit/copy.ts` reads a page's visible text
// (`document.body.innerText`) and hands it in; this module only decides, returning one
// `CopyObservation` per problem. An empty array means the text passes.
//
// Severity, the member, the URL and suppressions are the caller's business
// (`uxPolicy.ts`, the DSL), because the same rule is advisory on one surface and blocking
// on another (a bare "$12" on a browse tile versus in the Pay dialog).
//
// Requirements:
//   31.1      a Multiple items listing or contract says "Multiple items" (or "a listing
//             with multiple items") and that nothing is held            (checkShopfrontCopy)
//   31.2      trade collateral is called "trade collateral", explained as a "temporary
//             card hold", and "escrow" never describes it                (checkCollateralCopy)
//   31.3      the buyer protection fee's rate label is exactly the domain rate for the currency and
//             payment method, and is never "about" a rate                (checkFeeLabel)
//   31.4      retired or internal vocabulary and raw driver errors never reach a member
//                                                                         (checkForbiddenTerms)
//   31.5, 9.5 every displayed amount carries its ISO currency code      (checkCurrencyCodes)
//
// `checkFeeLabel` takes the expected label as an ARGUMENT. The Playwright side computes it
// with `processingFeeRateLabel(currency, method)` from `lib/fees/feeLabels.ts`, whose
// numbers come from `domain/fees/processingFee.ts`; importing `lib/` here would make this
// module depend on the framework layer it is meant to judge.

/** The copy checks this module implements (a subset of the suite's `UxCheck`). */
export type CopyCheck =
  | 'copy-forbidden'
  | 'copy-currency'
  | 'copy-shopfront'
  | 'copy-collateral'
  | 'copy-fee';

/** One copy problem. The caller adds member, URL, severity and scrubs the message. */
export interface CopyObservation {
  check: CopyCheck;
  message: string;
  detail?: Record<string, string | number>;
}

/**
 * Words and phrases that must never be shown to a member, matched as whole words in any
 * letter case. Internal names (`shopfront`, `binder`, `Friction_Tax`), retired vocabulary
 * (`DittoBond`, the Police Evidence Pack, KYC), retired fee copy (`open beta`, `waived`)
 * and a raw PostgREST error (`Cannot coerce`, from `.single()` on zero rows).
 */
export const FORBIDDEN_TERMS: readonly string[] = [
  'shopfront',
  'binder',
  'DittoBond',
  'Friction_Tax',
  'friction tax',
  'open beta',
  'waived',
  'Cannot coerce',
  'Police Evidence Pack',
  'KYC',
];

/** Characters that make a match part of a longer word. Underscore counts: `Friction_Tax`. */
const WORD_CHAR = '[\\p{L}\\p{N}_]';

/** Whitespace `innerText` produces between words, including NBSP and narrow NBSP. */
const SPACE = '[\\s\\u00a0\\u202f]';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A whole-word, case-insensitive pattern for a term; inner spaces match any run of whitespace. */
function wholeWordPattern(term: string): RegExp {
  const body = term.trim().split(/\s+/).map(escapeRegExp).join(`${SPACE}+`);
  return new RegExp(`(?<!${WORD_CHAR})${body}(?!${WORD_CHAR})`, 'giu');
}

const FORBIDDEN_PATTERNS = FORBIDDEN_TERMS.map((term) => ({ term, pattern: wholeWordPattern(term) }));

/** Collapse every whitespace run (newlines, NBSP, narrow NBSP) to one ASCII space. */
export function normaliseWhitespace(text: string): string {
  return text.replace(/[\s\u00a0\u202f]+/g, ' ').trim();
}

/** Up to `radius` characters either side of a match, whitespace-normalised. */
function excerpt(text: string, start: number, end: number, radius = 30): string {
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, end + radius);
  return `${from > 0 ? '…' : ''}${normaliseWhitespace(text.slice(from, to))}${to < text.length ? '…' : ''}`;
}

/**
 * Report every forbidden term in `text` (Req 31.4). One observation per term found, with
 * how many times it occurs and the first occurrence in context. A term inside a longer
 * word (`binders`, `shopfronts`, `ewaived`) is not a match.
 */
export function checkForbiddenTerms(text: string): CopyObservation[] {
  const observations: CopyObservation[] = [];
  for (const { term, pattern } of FORBIDDEN_PATTERNS) {
    const matches = [...text.matchAll(pattern)];
    if (matches.length === 0) continue;
    const first = matches[0];
    const start = first.index ?? 0;
    observations.push({
      check: 'copy-forbidden',
      message: `Member-facing text contains the forbidden term "${term}".`,
      detail: {
        term,
        count: matches.length,
        excerpt: excerpt(text, start, start + first[0].length),
      },
    });
  }
  return observations;
}

// ---------------------------------------------------------------------------------------
// Currency codes
// ---------------------------------------------------------------------------------------

/** A figure: digits with optional grouping/decimal separators, ending on a digit. */
const NUMBER = "\\d(?:[\\d.,'’\\u00a0\\u202f]*\\d)?";

/**
 * A symbol written BEFORE the figure: any Unicode currency symbol with an optional
 * letter prefix (`A$`, `US$`, `CA$`, `NZ$`, `R$`, `MX$`), or the Malaysian `RM`.
 */
const PREFIX_SYMBOL = '(?<!\\p{L})(?:\\p{Lu}{0,3}\\p{Sc}|RM(?=[\\s\\u00a0\\u202f]?\\d))';

/** A symbol written AFTER the figure: a currency symbol, or a lettered one (`kr`, `zł`). */
const SUFFIX_SYMBOL = '(?:\\p{Sc}|kr\\.?|zł|Kč|Ft|lei)(?!\\p{L})';

/** A suffix symbol must not open the NEXT figure: "2 $5.00" is a count and a price. */
const NOT_BEFORE_FIGURE = '(?![\\s\\u00a0\\u202f]?[-−]?\\d)';

/** An ISO 4217 code standing on its own. */
const ISO_CODE = '(?<!\\p{L})\\p{Lu}{3}(?!\\p{L})';

const MONEY_PATTERN = new RegExp(
  `(${PREFIX_SYMBOL})${SPACE}?[-−]?${NUMBER}|${NUMBER}${SPACE}?(${SUFFIX_SYMBOL})${NOT_BEFORE_FIGURE}`,
  'gu',
);
const CODE_AFTER = new RegExp(`^${SPACE}*${ISO_CODE}`, 'u');
const CODE_BEFORE = new RegExp(`${ISO_CODE}${SPACE}*[-−]?$`, 'u');

/**
 * Flag every money figure written with a currency symbol and no three-letter code beside
 * it (Req 31.5, 9.5): `$12.00` and `12,00 €` are flagged, `$12.00 AUD`, `A$0.60 AUD`,
 * `USD 1,234.56` and `12,00 € EUR` are not. One observation per offending figure.
 *
 * A figure with no symbol at all (`CHF 12.00` with the code removed is just `12.00`) is
 * indistinguishable from any other number and is not flagged.
 */
export function checkCurrencyCodes(text: string): CopyObservation[] {
  const observations: CopyObservation[] = [];
  for (const match of text.matchAll(MONEY_PATTERN)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    const before = text.slice(Math.max(0, start - 8), start);
    const after = text.slice(end, end + 8);
    if (CODE_AFTER.test(after) || CODE_BEFORE.test(before)) continue;
    // A lettered prefix that is itself a code ("CHF" never matches \p{Sc}, so this only
    // guards odd forms like "AUD$12"): three capitals before the symbol name the currency.
    if (match[1] && /^\p{Lu}{3}\p{Sc}$/u.test(match[1])) continue;
    observations.push({
      check: 'copy-currency',
      message: `Money figure "${normaliseWhitespace(match[0])}" has no ISO currency code.`,
      detail: { figure: normaliseWhitespace(match[0]), excerpt: excerpt(text, start, end) },
    });
  }
  return observations;
}

// ---------------------------------------------------------------------------------------
// Multiple items (shopfront) wording
// ---------------------------------------------------------------------------------------

/**
 * The label "Multiple items", or the phrase "a listing with multiple items" (which
 * contains it). Any case: `innerText` applies CSS `text-transform`, so an uppercase
 * badge reads "MULTIPLE ITEMS" and is still the right wording.
 */
const MULTIPLE_ITEMS = /(?<!\p{L})multiple items(?!\p{L})/iu;
/**
 * "Nothing is held", "Nothing in this listing is held", and "Nothing in the listing is
 * held", which is the wording the contract's AGREEMENT_CREATED event has carried since
 * 0175. Any case.
 */
export const NOTHING_HELD_STATEMENT = /(?<!\p{L})nothing(?: in (?:this|the) listing)? is held(?!\p{L})/iu;

/**
 * A page showing a Multiple items listing or contract must name it ("Multiple items" or
 * "a listing with multiple items") and say that nothing is held (Req 31.1). Passes (empty
 * array) exactly when both are present.
 */
export function checkShopfrontCopy(text: string): CopyObservation[] {
  const flat = normaliseWhitespace(text);
  const observations: CopyObservation[] = [];
  if (!MULTIPLE_ITEMS.test(flat)) {
    observations.push({
      check: 'copy-shopfront',
      message: 'A Multiple items listing is shown without "Multiple items" or "a listing with multiple items".',
    });
  }
  if (!NOTHING_HELD_STATEMENT.test(flat)) {
    observations.push({
      check: 'copy-shopfront',
      message: 'A Multiple items listing is shown without saying that nothing is held.',
    });
  }
  return observations;
}

// ---------------------------------------------------------------------------------------
// Trade collateral wording
// ---------------------------------------------------------------------------------------

const TRADE_COLLATERAL = /(?<!\p{L})trade collateral/iu;
const TEMPORARY_CARD_HOLD = /(?<!\p{L})temporary card hold/iu;
const ESCROW = /(?<!\p{L})escrow/iu;
const COLLATERAL_OR_HOLD = /(?<!\p{L})(?:collateral|hold)/iu;

/**
 * Split visible text into sentences: at `.`, `!` or `?` followed by whitespace, and at
 * line breaks, which `innerText` puts between block elements (a heading and the
 * paragraph under it are not one sentence).
 */
export function splitSentences(text: string): string[] {
  return text
    .split(/\r?\n+|(?<=[.!?])[\s\u00a0\u202f]+/u)
    .map(normaliseWhitespace)
    .filter((sentence) => sentence.length > 0);
}

/**
 * A page showing trade collateral must say "trade collateral" and explain it as a
 * "temporary card hold", and must not call it escrow (Req 31.2). One observation per
 * missing phrase, and one per sentence in which "escrow" appears with "collateral" or
 * "hold". Escrow on its own is allowed: a cash sale's money IS held by the platform.
 */
export function checkCollateralCopy(text: string): CopyObservation[] {
  const flat = normaliseWhitespace(text);
  const observations: CopyObservation[] = [];
  if (!TRADE_COLLATERAL.test(flat)) {
    observations.push({
      check: 'copy-collateral',
      message: 'Trade collateral is shown without the term "trade collateral".',
    });
  }
  if (!TEMPORARY_CARD_HOLD.test(flat)) {
    observations.push({
      check: 'copy-collateral',
      message: 'Trade collateral is shown without explaining it as a "temporary card hold".',
    });
  }
  for (const sentence of splitSentences(text)) {
    if (ESCROW.test(sentence) && COLLATERAL_OR_HOLD.test(sentence)) {
      observations.push({
        check: 'copy-collateral',
        message: '"Escrow" is used in a sentence about collateral or a hold.',
        detail: { sentence },
      });
    }
  }
  return observations;
}

// ---------------------------------------------------------------------------------------
// Buyer protection fee label
// ---------------------------------------------------------------------------------------

/**
 * Any rate label as `processingFeeRateLabel` writes one: "3%", "4.5%", and the older
 * "3% + $0.60 AUD" form a rail with a fixed part would still produce (2026-11-24 dropped
 * every fixed part, but the field remains).
 */
const RATE_LABEL = new RegExp(
  `(?<![\\d.])\\d+(?:\\.\\d+)?%(?:${SPACE}*\\+${SPACE}*(?:(?:${PREFIX_SYMBOL})${SPACE}?${NUMBER}|${NUMBER}${SPACE}?(?:${SUFFIX_SYMBOL}))(?:${SPACE}+${ISO_CODE})?)?`,
  'gu',
);
/** A hedge directly before a rate label. The fee is exact; copy never says "about" a rate. */
const HEDGE_BEFORE = /(?<!\p{L})(?:about|approximately|approx\.?|around|roughly|~)\s*$/iu;

/**
 * The buyer protection fee's rate label on the page must be exactly `expectedLabel`, the
 * `processingFeeRateLabel(currency, method)` for the step's currency and payment method
 * (Req 31.3). Passes when the label appears as a whole label (so "3% + $0.60 AUD" is not
 * satisfied by "13% + $0.60 AUD") and no rate label on the page is hedged with "about".
 *
 * Other rate labels on the page are allowed, because the Pay dialog lists every way of
 * paying with its own rate; they are reported in `detail.shown` when the expected one is
 * missing.
 *
 * @throws when `expectedLabel` is blank: that is a broken step declaration, not a finding.
 */
export function checkFeeLabel(text: string, expectedLabel: string): CopyObservation[] {
  const expected = normaliseWhitespace(expectedLabel);
  if (expected.length === 0) {
    throw new Error('checkFeeLabel: expectedLabel is empty; compute it with processingFeeRateLabel.');
  }
  const flat = normaliseWhitespace(text);
  const observations: CopyObservation[] = [];
  const shown = [...flat.matchAll(RATE_LABEL)];

  const wholeExpected = new RegExp(`(?<![\\d.])${escapeRegExp(expected)}(?![\\p{L}\\p{N}])`, 'u');
  if (!wholeExpected.test(flat)) {
    observations.push({
      check: 'copy-fee',
      message: `Buyer protection fee rate label "${expected}" is not shown.`,
      detail: {
        expected,
        shown: shown.length > 0 ? shown.map((m) => m[0]).join(' | ') : '(none)',
      },
    });
  }

  for (const match of shown) {
    const start = match.index ?? 0;
    // NoDitto's own share IS approximate and the copy says so ("NoDitto keeps about 1%",
    // "about 1% to NoDitto"). That is not a rate the buyer pays.
    const around = flat.slice(Math.max(0, start - 24), start + match[0].length + 12);
    if (/NoDitto keeps about|to NoDitto/i.test(around)) continue;
    if (HEDGE_BEFORE.test(flat.slice(Math.max(0, start - 16), start))) {
      observations.push({
        check: 'copy-fee',
        message: `Buyer protection fee rate "${match[0]}" is hedged; the rate is exact and copy never says "about" a rate.`,
        detail: { label: match[0], excerpt: excerpt(flat, start, start + match[0].length) },
      });
    }
  }
  return observations;
}
