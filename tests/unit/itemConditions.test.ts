/**
 * The condition scale (`lib/catalog/conditions.ts`) and everything that has to agree with it.
 *
 * The listing form, the unlisted-card fields and the catalog rail each used to carry their
 * own copy of the list, and the Flutter app had drifted to a different vocabulary entirely
 * (Mint / Near Mint / Good / Fair / Poor) that the web could neither filter on nor offer.
 * The list now lives in one module and the validator enforces it; the Dart copy is parsed
 * here because Node cannot import it.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { validateItemSubmission } from '@/domain/validation';
import { ITEM_CONDITIONS, normalizeConditionFilter } from '@/lib/catalog/conditions';

const FLUTTER_CONSTANTS = path.join(process.cwd(), 'flutter_app', 'lib', 'core', 'constants.dart');

/** The string literals inside Dart's `static const List<String> conditions = [ ... ];`. */
function dartConditions(): string[] {
  const source = readFileSync(FLUTTER_CONSTANTS, 'utf8');
  const block = /static const List<String> conditions = \[([\s\S]*?)\];/.exec(source);
  if (!block) throw new Error(`No conditions list found in ${FLUTTER_CONSTANTS}`);
  return [...block[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
}

describe('condition scale', () => {
  it("is TCGplayer's scale for singles, topped by Near Mint, plus the two buckets", () => {
    expect(ITEM_CONDITIONS).toEqual([
      'Graded',
      'Unopened',
      'Near Mint',
      'Lightly Played',
      'Moderately Played',
      'Heavily Played',
      'Damaged',
    ]);
  });

  it('is the list the Flutter app offers, in the same order', () => {
    expect(dartConditions()).toEqual([...ITEM_CONDITIONS]);
  });
});

describe('normalizeConditionFilter', () => {
  it('maps the retired Mint grade to Near Mint', () => {
    expect(normalizeConditionFilter(['Mint'])).toEqual(['Near Mint']);
  });

  it('drops values that are not on the scale instead of filtering on them', () => {
    // An unknown value would filter the grid while matching no control in the rail.
    expect(normalizeConditionFilter(['Good', 'Poor', ''])).toEqual([]);
  });

  it('trims, and collapses a retired grade onto a grade already asked for', () => {
    expect(normalizeConditionFilter([' Damaged ', 'Mint', 'Near Mint'])).toEqual([
      'Damaged',
      'Near Mint',
    ]);
  });
});

describe('item submission condition', () => {
  const base = {
    title: 'Charizard Base Set Holo',
    description: 'Unlimited print, light whitening on the back corners.',
    category: 'Pokémon',
    fmvCents: 12_345,
    images: ['path/one.jpg'],
  };

  it('refuses Mint, which is no longer a grade', () => {
    const result = validateItemSubmission({ ...base, condition: 'Mint' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe('condition');
    }
  });

  it('accepts Moderately Played, which the scale now includes', () => {
    expect(validateItemSubmission({ ...base, condition: 'Moderately Played' }).ok).toBe(true);
  });
});
