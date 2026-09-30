import { z } from 'zod';
import { isCardGameName } from '@/lib/catalog/cardGames';
import { isItemCondition } from '@/lib/catalog/conditions';
import { runSchema, type ValidationResult } from './result';

/**
 * Item title length bounds, inclusive (Req 3.1, 3.3).
 *
 * Typed by the seller again, after a spell of being derived from the
 * description. The bounds still cover both, because when the title is blank the
 * server action derives it from the description — and `items.title` is
 * `not null`, as is the `cash_sales.item_title` snapshot taken at the
 * Commitment_Point.
 */
export const TITLE_MIN_LENGTH = 1;
export const TITLE_MAX_LENGTH = 120;

/**
 * How long a DERIVED title may be before it is cut at a word boundary.
 *
 * Deliberately well under `TITLE_MAX_LENGTH`: this value is a label, shown in
 * notification copy, email subjects, payout rows and arbitration case lists, where
 * something near 120 characters stops being a label and starts being a paragraph.
 */
export const TITLE_DERIVED_MAX_LENGTH = 80;

/** Item description length bounds, inclusive (Req 3.1, 3.3). */
export const DESCRIPTION_MIN_LENGTH = 1;
export const DESCRIPTION_MAX_LENGTH = 2000;

/**
 * The fallback behind a blank title: reduce a description to the short label the
 * rest of the platform needs.
 *
 * WHY A FALLBACK EXISTS AT ALL, when the seller types a title. A contract cannot
 * wait for one. `cash_sales.item_title` is snapshotted `not null` at the
 * Commitment_Point and migration 0064 records that arbitration "reads
 * `cash_sales.item_title` and NOTHING else - no join back to `items`", so the
 * adjudication path needs a stable short label frozen at agreement time. Emails,
 * notifications, offers, message threads and the payout ledger need the same thing.
 * Feeding a 2000-character description into those is not a display problem, it is a
 * broken subject line and an unreadable case list.
 *
 * Newlines collapse to spaces because the label is rendered on one line everywhere
 * it appears, and a raw `\n` in an email subject is a header-injection shape.
 */
export function deriveItemTitle(description: string): string {
  const collapsed = description.replace(/\s+/g, ' ').trim();

  // The schema below refuses a blank description, so this is unreachable through
  // the action path. It is still handled rather than asserted, because the fallback
  // is the difference between a placeholder label and a `not null` violation on a
  // contract snapshot — and this function is the last thing standing between the two.
  if (collapsed.length === 0) {
    return 'Untitled listing';
  }

  if (collapsed.length <= TITLE_DERIVED_MAX_LENGTH) {
    return collapsed;
  }

  // Cut at the last word boundary inside the budget so the label does not end
  // mid-word. `lastIndexOf` on the +1 slice finds a space at the boundary itself.
  const window = collapsed.slice(0, TITLE_DERIVED_MAX_LENGTH + 1);
  const lastSpace = window.lastIndexOf(' ');
  // A single word longer than the budget has no boundary to cut at, so fall back to
  // a hard cut rather than returning the whole run.
  const cut = lastSpace > 0 ? collapsed.slice(0, lastSpace) : collapsed.slice(0, TITLE_DERIVED_MAX_LENGTH);

  return `${cut.trimEnd()}…`;
}

/**
 * Fair Market Value bounds as integer AUD cents, inclusive.
 * 1 cent (0.01 AUD) .. 99,999,999,999 cents (999,999,999.99 AUD) (Req 3.1, 3.2).
 */
export const FMV_MIN_CENTS = 1;
export const FMV_MAX_CENTS = 99_999_999_999;

/** Image count bounds, inclusive (Req 3.1, 3.3). */
export const IMAGES_MIN = 1;
export const IMAGES_MAX = 10;

/**
 * Zod schema for an item submission. Exported for direct testing.
 *
 * `title` is collected from the seller, and validated for the same reason the
 * derivation fallback needs validation: `items.title` and the
 * `cash_sales.item_title` snapshot are `not null` under these bounds, so a value
 * that fails here is one the database would refuse.
 */
export const itemSubmissionSchema = z.object({
  title: z
    .string({ error: 'Title is required' })
    .min(TITLE_MIN_LENGTH, `Title must be at least ${TITLE_MIN_LENGTH} character`)
    .max(TITLE_MAX_LENGTH, `Title must be at most ${TITLE_MAX_LENGTH} characters`),
  description: z
    .string({ error: 'Description is required' })
    .min(DESCRIPTION_MIN_LENGTH, `Description must be at least ${DESCRIPTION_MIN_LENGTH} character`)
    .max(DESCRIPTION_MAX_LENGTH, `Description must be at most ${DESCRIPTION_MAX_LENGTH} characters`)
    // WHITESPACE-ONLY IS REFUSED, which `min(1)` alone does not do. The description
    // is now the only prose a seller writes and the sole source of the derived
    // title, so " " would previously have passed validation and then produced an
    // empty label for a listing, a contract and an email subject.
    .refine(
      (value) => value.trim().length >= DESCRIPTION_MIN_LENGTH,
      'Description is required',
    ),
  category: z
    .string({ error: 'Category is required' })
    .refine(isCardGameName, 'Category is required'),
  condition: z
    .string({ error: 'Condition is required' })
    .min(1, 'Condition is required')
    .refine(isItemCondition, 'Choose a condition from the list'),
  fmvCents: z
    .number({ error: 'Fair market value is required' })
    .int('Fair market value must be an integer number of cents')
    .min(FMV_MIN_CENTS, `Fair market value must be at least ${FMV_MIN_CENTS} cent`)
    .max(FMV_MAX_CENTS, `Fair market value must be at most ${FMV_MAX_CENTS} cents`),
  images: z
    .array(z.string().min(1, 'Image reference must not be empty'), {
      error: 'Images are required',
    })
    .min(IMAGES_MIN, `At least ${IMAGES_MIN} image is required`)
    .max(IMAGES_MAX, `At most ${IMAGES_MAX} images are allowed`),
});

export type ItemSubmission = z.infer<typeof itemSubmissionSchema>;

/**
 * Validates an item submission, returning a discriminated result.
 * On failure the first invalid field (title, description, category, condition,
 * fmvCents, or images) is identified (Req 3.2, 3.3).
 */
export function validateItemSubmission(input: unknown): ValidationResult<ItemSubmission> {
  return runSchema(itemSubmissionSchema, input);
}
