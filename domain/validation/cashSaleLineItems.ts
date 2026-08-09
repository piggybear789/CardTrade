// domain/validation/cashSaleLineItems.ts
//
// Validation for the line items of a Cash_Sale contract (0064).
//
// A SHOPFRONT listing is a browsable inventory — a binder, a bulk lot — so the
// listing cannot say what any one contract covers. These line items are that
// statement: authored during negotiation, frozen at the Commitment_Point, and
// the sole basis for `agreed_price_cents`.
//
// They are not presentational. Arbitration reads the contract, never the
// listing, so without them a disputed binder sale gives staff one title and a
// dollar figure with no way to tell which card was owed.
//
// Bounds mirror the CHECK constraints in migration 0064 exactly. Keep them in
// step: the database is the authority and a mismatch here only changes whether
// the member gets a field-level message or a persistence error.

import { z } from 'zod';
import { runSchema, type ValidationResult } from './result';

/**
 * Description length bounds for one line, inclusive.
 *
 * 1000, not 200 (0080), because a binder request is written as prose rather than
 * named card by card: "the three Charizards on page 2, both Blastoise, any NM
 * Pikachu". A truncated statement of what a contract covers is the one thing this
 * field must never be, since arbitration reads it verbatim.
 */
export const LINE_DESCRIPTION_MIN_LENGTH = 1;
export const LINE_DESCRIPTION_MAX_LENGTH = 1000;

/** Condition label length bounds for one line, inclusive. Optional per line. */
export const LINE_CONDITION_MAX_LENGTH = 60;

/** Quantity bounds for one line, inclusive. */
export const LINE_QUANTITY_MIN = 1;
export const LINE_QUANTITY_MAX = 999;

/**
 * Unit price bounds as integer AUD cents.
 *
 * Zero is deliberately allowed so a Seller can throw in a card at no charge
 * without inventing a price for it. The contract as a whole still cannot be
 * worth nothing — see {@link MIN_CONTRACT_TOTAL_CENTS}, which mirrors the
 * `cash_sales_agreed_price_positive` constraint.
 */
export const LINE_UNIT_PRICE_MIN_CENTS = 0;
export const LINE_UNIT_PRICE_MAX_CENTS = 99_999_999_999;

/** How many distinct lines one contract may carry, inclusive. */
export const LINES_MIN = 1;
export const LINES_MAX = 50;

/** A contract must be worth something; the DB agrees via a CHECK constraint. */
export const MIN_CONTRACT_TOTAL_CENTS = 1;

/** One negotiated line of a Cash_Sale contract. */
export interface CashSaleLineItemInput {
  /** What the buyer is getting, e.g. "Charizard ex 199/165 — SV 151". */
  description: string;
  /** Per-line condition grade, because a binder is not one grade. */
  condition?: string | null;
  quantity: number;
  unitPriceCents: number;
  /** Storage path already attached to the listing; no new upload surface. */
  imagePath?: string | null;
}

const optionalTrimmed = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .nullish()
    .transform((value) => {
      const trimmed = value?.trim();
      return trimmed ? trimmed : null;
    });

/** Zod schema for a single line. Exported for direct testing. */
export const cashSaleLineItemSchema = z.object({
  description: z
    .string({ error: 'Describe what the buyer is getting' })
    .trim()
    .min(LINE_DESCRIPTION_MIN_LENGTH, 'Describe what the buyer is getting')
    .max(
      LINE_DESCRIPTION_MAX_LENGTH,
      `Description must be at most ${LINE_DESCRIPTION_MAX_LENGTH} characters`,
    ),
  condition: optionalTrimmed(LINE_CONDITION_MAX_LENGTH, 'Condition'),
  quantity: z
    .number({ error: 'Quantity is required' })
    .int('Quantity must be a whole number')
    .min(LINE_QUANTITY_MIN, `Quantity must be at least ${LINE_QUANTITY_MIN}`)
    .max(LINE_QUANTITY_MAX, `Quantity must be at most ${LINE_QUANTITY_MAX}`),
  unitPriceCents: z
    .number({ error: 'Price is required' })
    .int('Price must be an integer number of cents')
    .min(LINE_UNIT_PRICE_MIN_CENTS, 'Price cannot be negative')
    .max(LINE_UNIT_PRICE_MAX_CENTS, 'Price is too large'),
  imagePath: optionalTrimmed(400, 'Image reference'),
});

/**
 * Zod schema for a complete set of contract line items.
 *
 * The total is checked here rather than left to the database so the member sees
 * "a contract needs a price" against the form instead of a constraint violation.
 */
export const cashSaleLineItemsSchema = z
  .array(cashSaleLineItemSchema, { error: 'Add at least one item' })
  .min(LINES_MIN, 'Add at least one item')
  .max(LINES_MAX, `A contract may cover at most ${LINES_MAX} lines`)
  .refine(
    (lines) => lineItemsTotalCents(lines) >= MIN_CONTRACT_TOTAL_CENTS,
    { message: 'The contract total must be more than zero' },
  );

export type CashSaleLineItems = z.infer<typeof cashSaleLineItemsSchema>;

/**
 * Total price of a set of lines, in integer AUD cents.
 *
 * This is the ONLY definition of a shopfront contract's price. The
 * `replace_cash_sale_items` RPC re-derives the same sum in SQL and rejects the
 * call if the two disagree, so a caller cannot bill a total the lines do not
 * add up to.
 */
export function lineItemsTotalCents(
  lines: readonly { quantity: number; unitPriceCents: number }[],
): number {
  return lines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0);
}

/**
 * Validates a set of contract line items, returning a discriminated result.
 *
 * On failure `field` is the dotted path of the offending line, e.g.
 * `1.unitPriceCents` for the second row, so a form can highlight the row that is
 * wrong rather than reporting a single error against the whole set.
 */
export function validateCashSaleLineItems(
  input: unknown,
): ValidationResult<CashSaleLineItems> {
  return runSchema(cashSaleLineItemsSchema, input);
}
