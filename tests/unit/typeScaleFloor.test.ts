// tests/unit/typeScaleFloor.test.ts
//
// The type scale in `tailwind.config.ts` floors `meta` at 0.75rem/12px: nothing
// in the app is meant to render below it, because `--muted-foreground` stops
// being readable copy under 12px and starts being decoration. The scale tokens
// (meta/body/nav/lead/subhead/head/display) are the ONLY place a text size is
// decided, so a raw `text-[..]` bracket size in app or component source is both
// off-scale AND — when it resolves under 12px — below the floor the project set
// for itself. `ux-audit-findings.md` F6/F7/F32 record why: eyebrow labels and
// permanent mobile chrome kept re-inlining 10px and 11px values that bypassed
// the scale, and `meta` was floored precisely so F7 could not silently return.
//
// This is a source-absence guard in the style of `mobileReleaseSourceAbsence`:
// it PARSES the swept surfaces and throws on source it cannot read, rather than
// returning an empty set that would pass vacuously. A check that scans nothing
// is worse than no check.
//
// SCOPE. It scans the surfaces this sweep touched plus the shared field/chrome
// primitives — the sites F32 named — not all 181 UI files. A codebase-wide
// bracket-size ban was deliberately NOT taken on (F6's "what shipped, and what
// did not"), so widening the net here would fail on arbitrary sizes this task
// never claimed to remove and turn a passing guard into a false alarm.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const REPO = process.cwd();

// The surfaces swept for the sub-12px sweep, plus the primitives F32 pointed at.
// Each must exist and be read; a path that has moved makes this check read
// nothing, which the parser refuses to pass on.
const SWEPT_SOURCES = [
  'app/globals.css',
  'components/layout/mobile-chrome/variants.tsx',
  'components/layout/MobileBottomNav.tsx',
  'components/messages/InboxThreadList.tsx',
  'components/listings/ListingActionIcon.tsx',
  'components/listings/ListingBuyerBar.tsx',
] as const;

interface BracketFontSize {
  /** The raw match, e.g. `text-[0.6875rem]`. */
  raw: string;
  /** Its computed size in px, for the failure message and the floor test. */
  px: number;
}

/**
 * Convert a bracket font-size argument to pixels.
 *
 * Handles the two units these surfaces have ever used — `rem` (×16) and `px`.
 * Throws on a unit it does not understand rather than skipping it: an
 * unrecognised size is a size this check did not evaluate, and silently
 * dropping it is the vacuous-pass failure mode this file exists to avoid.
 */
function bracketSizeToPx(argument: string): number {
  const rem = /^(\d*\.?\d+)rem$/.exec(argument);
  if (rem) return Number(rem[1]) * 16;
  const px = /^(\d*\.?\d+)px$/.exec(argument);
  if (px) return Number(px[1]);
  throw new Error(
    `bracketSizeToPx: cannot read the unit of "${argument}"; teach this parser ` +
      'the unit rather than letting an unevaluated size pass.',
  );
}

/** Every `text-[..]` bracket font-size in a source file, with its px value. */
function bracketFontSizes(relative: string): BracketFontSize[] {
  const full = path.join(REPO, relative);
  const source = readFileSync(full, 'utf8');
  const findings: BracketFontSize[] = [];
  // `text-[<arg>]` where <arg> is a length. Guards against matching
  // `text-[color:...]` or `text-[var(--x)]` — only a bare length is a size.
  for (const match of source.matchAll(/text-\[((?:\d*\.?\d+)(?:rem|px))\]/g)) {
    findings.push({ raw: match[0], px: bracketSizeToPx(match[1]) });
  }
  return findings;
}

const MIN_FONT_PX = 12; // `meta` = 0.75rem.

describe('type-scale floor (F6/F7/F32)', () => {
  it('has no swept surface using a font size below the 12px meta floor', () => {
    const offenders = SWEPT_SOURCES.flatMap((relative) =>
      bracketFontSizes(relative)
        .filter((size) => size.px < MIN_FONT_PX)
        .map((size) => `${relative}: ${size.raw} (${size.px}px)`),
    );

    expect(
      offenders,
      'F7/F32: `meta` is floored at 0.75rem/12px so no text renders smaller — ' +
        'below it `text-muted-foreground` stops being readable copy. These ' +
        'sites bypass the scale with a raw bracket size under the floor; use a ' +
        'scale token (`text-meta` for chrome, badges, counts and eyebrows).',
    ).toEqual([]);
  });

  // The counterpart to the check above: it must be READING the files it claims
  // to check. `.market-label` is the eyebrow utility F6 named, defined once in
  // globals.css; if this stops finding it, the check has been pointed at a file
  // that moved and would pass on an empty scan.
  it('reads the surfaces it claims to check', () => {
    const css = readFileSync(path.join(REPO, 'app/globals.css'), 'utf8');
    expect(
      css.includes('.market-label'),
      'app/globals.css no longer defines `.market-label`; fix the file list ' +
        'rather than accepting the empty scan.',
    ).toBe(true);

    for (const relative of SWEPT_SOURCES) {
      const source = readFileSync(path.join(REPO, relative), 'utf8');
      expect(source.length, `${relative} is empty or unreadable`).toBeGreaterThan(0);
    }
  });

  it('detects a sub-floor bracket size wherever the unit', () => {
    // Feeds the px converter the shapes a regression would use, so a green run
    // means the parser looked and understood rather than skipped.
    expect(bracketSizeToPx('0.6875rem')).toBeCloseTo(11);
    expect(bracketSizeToPx('10px')).toBe(10);
    expect(bracketSizeToPx('0.75rem')).toBe(12);
    expect(() => bracketSizeToPx('1.2em')).toThrow(/cannot read the unit/);
  });
});
