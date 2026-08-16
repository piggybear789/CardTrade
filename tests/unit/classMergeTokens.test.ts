// tests/unit/classMergeTokens.test.ts
//
// `cn()` MUST KNOW EVERY DESIGN TOKEN, and nothing else can catch it when it does not.
//
// tailwind-merge recognises a utility by parsing its VALUE against the scales it ships
// with — Tailwind's, not ours. An unregistered token is not an error: it is silently
// misclassified, and the class is silently discarded. Two failure shapes, both shipped:
//
//   * SPACING — `p-group` read as an unknown class rather than a padding class, so a
//     call site overriding `CardContent`'s `p-6 pt-0` kept BOTH and the element ended
//     up with no top padding at all.
//   * FONT SIZE — worse, because `text-*` is ambiguous. A value that is not a known
//     font size is classified as a COLOUR, so `cn('text-meta … text-muted-foreground')`
//     resolved the size and the colour as one conflict and dropped the size. The
//     contract chat's sender name, message body and timestamp all rendered at the
//     inherited 16px while the source asked for 12px.
//
// This test reads the token names out of `tailwind.config.ts` and asserts each one
// survives `cn()`, so adding a token to the config without registering it in
// `lib/utils.ts` fails here instead of quietly changing a size somewhere.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { cn } from '@/lib/utils';

const CONFIG = readFileSync(resolve(process.cwd(), 'tailwind.config.ts'), 'utf8');

/**
 * Pull the key names out of one `theme.extend` block.
 *
 * Throws on a block it cannot find rather than returning an empty list: a token
 * check that passes vacuously is worse than no check, because it reports the
 * absence of tokens as agreement.
 */
function tokenNames(block: 'spacing' | 'fontSize'): string[] {
  const opener = new RegExp(`^\\s{6}${block}: \\{$`, 'm');
  const start = CONFIG.search(opener);
  if (start === -1) throw new Error(`Could not find theme.extend.${block} in tailwind.config.ts`);
  const end = CONFIG.indexOf('\n      },', start);
  if (end === -1) throw new Error(`Could not find the end of theme.extend.${block}`);
  const body = CONFIG.slice(start, end);
  const names = [...body.matchAll(/^\s{8}([a-z][a-zA-Z0-9]*):/gm)].map((match) => match[1]);
  if (names.length === 0) throw new Error(`Parsed no token names out of theme.extend.${block}`);
  return names;
}

describe('cn() and the design tokens', () => {
  const spacing = tokenNames('spacing');
  const fontSizes = tokenNames('fontSize');

  it('found the tokens it is meant to be checking', () => {
    // Guards the parser itself. If the config is reformatted so these regexes stop
    // matching, the assertions below would all pass against an empty set.
    expect(spacing).toEqual(['tight', 'snug', 'cozy', 'group', 'section', 'region']);
    expect(fontSizes.length).toBeGreaterThanOrEqual(6);
  });

  describe.each(spacing)('spacing token %s', (token) => {
    it('overrides a numeric padding instead of landing beside it', () => {
      expect(cn('p-6 pt-0', `p-${token}`)).toBe(`p-${token}`);
    });
  });

  describe.each(fontSizes)('font-size token %s', (token) => {
    // THE REGRESSION. A size and a colour are different properties and must both
    // survive; misclassifying the size as a colour is what dropped it.
    it('survives being merged with a text colour', () => {
      expect(cn(`text-${token}`, 'text-muted-foreground')).toBe(
        `text-${token} text-muted-foreground`,
      );
    });

    it('is still recognised as a size, so two sizes conflict', () => {
      expect(cn(`text-${token}`, 'text-meta')).toBe('text-meta');
    });
  });
});
