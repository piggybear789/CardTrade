/**
 * `deriveItemTitle` — the short label the platform generates now that a seller writes
 * only a description.
 *
 * These tests exist because the derived value feeds places that CANNOT take a long or
 * malformed string: `items.title` is `not null`, `cash_sales.item_title` snapshots it
 * under the same constraint at the Commitment_Point, and migration 0064 records that
 * arbitration reads that snapshot "and NOTHING else - no join back to `items`". A
 * regression here is not a cosmetic one — it is a failed insert on a contract, or an
 * unreadable case list for whoever has to adjudicate it.
 */
import { describe, expect, it } from 'vitest';

import {
  deriveItemTitle,
  itemSubmissionSchema,
  TITLE_DERIVED_MAX_LENGTH,
  TITLE_MAX_LENGTH,
  validateItemSubmission,
} from '@/domain/validation';

describe('deriveItemTitle', () => {
  it('returns a short description unchanged', () => {
    expect(deriveItemTitle('1999 Charizard holo, near mint')).toBe(
      '1999 Charizard holo, near mint',
    );
  });

  it('collapses newlines and runs of whitespace to single spaces', () => {
    // The label is rendered on ONE line everywhere it appears, and a raw newline in
    // an email subject is a header-injection shape rather than a formatting quirk.
    expect(deriveItemTitle('1999 Charizard\n\nholo,   near    mint\r\ngraded')).toBe(
      '1999 Charizard holo, near mint graded',
    );
  });

  it('trims leading and trailing whitespace', () => {
    expect(deriveItemTitle('   spaced out   ')).toBe('spaced out');
  });

  it('cuts a long description at a word boundary and marks the truncation', () => {
    const description =
      'A genuinely long listing description that keeps going well past the budget ' +
      'allowed for a label and therefore has to be cut somewhere sensible';

    const title = deriveItemTitle(description);

    expect(title.endsWith('…')).toBe(true);
    // Cut at a boundary, so the character before the ellipsis is not mid-word.
    expect(title).not.toMatch(/\s…$/);
    expect(title.slice(0, -1)).toBe(title.slice(0, -1).trimEnd());
    // Every word kept is a whole word from the original.
    const kept = title.slice(0, -1).split(' ');
    const original = description.split(' ');
    expect(original.slice(0, kept.length)).toEqual(kept);
  });

  it('never exceeds the derived budget plus its ellipsis', () => {
    const title = deriveItemTitle('word '.repeat(200));
    expect(title.length).toBeLessThanOrEqual(TITLE_DERIVED_MAX_LENGTH + 1);
  });

  it('hard-cuts a single word longer than the budget rather than returning it whole', () => {
    // No boundary exists to cut at, so the fallback must still bound the result —
    // otherwise one pathological "word" defeats the budget entirely.
    const title = deriveItemTitle('x'.repeat(500));

    expect(title.length).toBeLessThanOrEqual(TITLE_DERIVED_MAX_LENGTH + 1);
    expect(title.endsWith('…')).toBe(true);
  });

  it('falls back to a placeholder rather than an empty label', () => {
    // Unreachable through the action path because the schema refuses a blank
    // description, but the fallback is what stands between that and a `not null`
    // violation on a contract snapshot.
    expect(deriveItemTitle('   ')).toBe('Untitled listing');
    expect(deriveItemTitle('')).toBe('Untitled listing');
  });

  it('always produces a value the item schema accepts', () => {
    // THE INVARIANT THAT MATTERS: whatever the seller types, the derived label must
    // satisfy the same bounds `items.title` is declared with. If this fails, the
    // listing cannot be inserted at all.
    const descriptions = [
      'a',
      'Short one',
      '   ',
      'z'.repeat(2000),
      'word '.repeat(400),
      'Multi\nline\n\ndescription with   odd spacing',
      '1909–1911 T206 Ty Cobb (Red Portrait) SGC 3 — beautiful centring, strong colour',
    ];

    for (const description of descriptions) {
      const title = deriveItemTitle(description);

      expect(title.length).toBeGreaterThanOrEqual(1);
      expect(title.length).toBeLessThanOrEqual(TITLE_MAX_LENGTH);

      const parsed = itemSubmissionSchema.shape.title.safeParse(title);
      expect(parsed.success).toBe(true);
    }
  });
});

describe('item submission with a derived title', () => {
  const base = {
    category: 'Trading Cards',
    condition: 'Near Mint',
    fmvCents: 12_345,
    images: ['path/one.jpg'],
  };

  it('accepts a submission whose title came from the description', () => {
    const description = 'Charizard ex 199/165 SAR 151 Japanese, near mint, ungraded';

    const result = validateItemSubmission({
      ...base,
      description,
      title: deriveItemTitle(description),
    });

    expect(result.ok).toBe(true);
  });

  it('refuses a whitespace-only description', () => {
    // `min(1)` alone passed " ", which then derived an empty label for a listing, a
    // contract and an email subject. The description is now the only prose a seller
    // writes, so blank has to be refused at the schema.
    const result = validateItemSubmission({
      ...base,
      description: '    ',
      title: 'anything',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe('description');
    }
  });

  it('still accepts a long description, because only the LABEL is bounded', () => {
    const description = 'd'.repeat(2000);

    const result = validateItemSubmission({
      ...base,
      description,
      title: deriveItemTitle(description),
    });

    expect(result.ok).toBe(true);
  });
});
