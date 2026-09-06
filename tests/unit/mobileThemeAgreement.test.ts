// Agreement-harness fixtures for the mobile visual-parity token parsers.
// Req 15.2, 15.4, 15.5, 15.9; P1, P2, P12, P13.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  argbToHsl,
  bundledFontFamilies,
  compareElevation,
  comparePalette,
  compareRadius,
  compareSpacing,
  compareTypeScale,
  contrastRatio,
  dartCallSiteLiterals,
  dartColorConstants,
  dartColorSchemeSlots,
  dartAdvisoryPorts,
  dartAppliedFontWeights,
  dartContrastExceptions,
  dartContrastPairs,
  dartElevations,
  dartFontFamilyConstant,
  dartFontFamilyReferences,
  dartMigrationAliases,
  dartPortSurplusSymbols,
  dartRadiusValues,
  dartRetiredVocabularySurfaces,
  dartSpacingSteps,
  dartTextRoles,
  dartTints,
  dartTypeLevels,
  dartWebHandoffCallSites,
  hslToArgb,
  pubspecDependencyNames,
  resolveRoleLevels,
  webColorTokens,
  webFontSizeLevels,
  webRadiusBase,
  webRadiusValues,
  webRootDeclarations,
  webShadowTokens,
  webSpacingSteps,
  type DartContrastPair,
  type DartTypeLevel,
  type TokenFinding,
} from '../../scripts/lib/mobileContract';

// This file is the slowest in the `domain` project because nearly every property
// re-walks `flutter_app/**` from disk: measured alone the file takes ~2.4s with its
// heaviest property (P12, which asks ~20 live parsers for a non-empty set) at ~0.8s,
// but inside the full `domain` project — 63 files across 11 workers — the same file
// takes ~7s and P12 alone ~2.3s. That is within Vitest's 5s default only until the
// machine is busier, and task 17.1 saw P12 time out on one run of three.
//
// The timeout belongs to the FILE, not to the command line: Req 13.3 names a bare
// `npx vitest --run --project domain`, so a budget that only exists when Req 13.11's
// `--testTimeout=30000` flag is passed makes the command Req 13.3 names unreliable.
// Setting it here makes the bare command correct and leaves that flag as a harmless
// belt-and-braces. It changes NO assertion: every property, `numRuns` and forbidden
// list is untouched, and a genuine hang still fails, just later.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const FIXTURES = path.join(process.cwd(), 'tests', 'unit', 'fixtures', 'mobileTheme');
const fixture = (name: string) => path.join(FIXTURES, name);
const temporaryDirectories: string[] = [];

// `edges` element type is irrelevant — only `edges.length` and the map index are read,
// so the generator supplies N placeholder elements. Do not narrow this to `number[]`.
function writeAliasGraph(edges: readonly unknown[], cycleAt: number | null): string {
  const declarations = edges.map((_, index) => {
    const token = `--token-${index}`;
    const target = index === edges.length - 1
      ? cycleAt === null ? '275 34% 58%' : `var(--token-${cycleAt})`
      : `var(--token-${index + 1})`;
    return `  ${token}: ${target};`;
  });
  return `:root {\n${declarations.join('\n')}\n}\n`;
}

// Same as `writeAliasGraph`: only the length of `edges` matters, never its values.
function parseGeneratedAliasGraph(edges: readonly unknown[], cycleAt: number | null): void {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'noditto-mobile-theme-'));
  temporaryDirectories.push(directory);
  const file = path.join(directory, 'aliases.css');
  writeFileSync(file, writeAliasGraph(edges, cycleAt), 'utf8');
  webColorTokens(file);
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

describe('the mobile theme parsers are not lying', () => {
  it('parses valid :root colours, aliases, lengths, durations, and ignores .dark', () => {
    const declarations = webRootDeclarations(fixture('valid-root.css'));
    const colours = webColorTokens(fixture('valid-root.css'));

    expect(declarations).toHaveLength(5);
    expect(declarations.map(({ token, kind }) => [token, kind])).toEqual([
      ['--background', 'hsl'],
      ['--foreground', 'hsl'],
      ['--ring', 'alias'],
      ['--radius', 'length'],
      ['--duration-exit', 'duration'],
    ]);
    expect(colours).toEqual(expect.arrayContaining([
      expect.objectContaining({ token: '--background', camel: 'background', hsl: [0, 0, 100], aliasOf: null }),
      expect.objectContaining({ token: '--ring', camel: 'ring', hsl: [275, 10, 10], aliasOf: '--foreground' }),
    ]));
    expect(colours).toHaveLength(3);
  });

  it('rejects an unrecognised CSS declaration instead of skipping it', () => {
    expect(() => webRootDeclarations(fixture('malformed-root.css')))
      .toThrow(/unrecognised :root declaration --unsupported/);
  });

  it('rejects a circular alias fixture with the complete chain', () => {
    expect(() => webColorTokens(fixture('circular-aliases.css')))
      .toThrow(/circular var\(\) chain: --first → --second → --first/);
  });

  /** Validates: Requirements 15.2; P12 */
  it('P12: every live parser reports a non-empty set from both sides', () => {
    expect(webRootDeclarations()).not.toHaveLength(0);
    expect(webColorTokens()).not.toHaveLength(0);
    expect(webFontSizeLevels()).not.toHaveLength(0);
    expect(webSpacingSteps()).not.toHaveLength(0);
    expect(webRadiusValues()).not.toHaveLength(0);
    expect(webShadowTokens()).not.toHaveLength(0);
    expect(dartCallSiteLiterals(['colorLiteral', 'fontSize', 'spacing'])).not.toHaveLength(0);

    // The Dart side is asked too, now that the generated theme layer exists.
    expect(dartColorConstants()).not.toHaveLength(0);
    expect(dartTypeLevels()).not.toHaveLength(0);
    expect(dartTextRoles()).not.toHaveLength(0);
    expect(dartSpacingSteps()).not.toHaveLength(0);
    expect(dartRadiusValues()).not.toHaveLength(0);
    expect(dartElevations()).not.toHaveLength(0);
    expect(dartTints()).not.toHaveLength(0);
    expect(dartContrastPairs()).not.toHaveLength(0);
    expect(dartColorSchemeSlots()).not.toHaveLength(0);
    // The live alias set is legitimately EMPTY now (task 12.1 deleted the last one,
    // Req 1.11), so the canary asks the reader to read a fixture marker instead. A
    // parser that silently read nothing would fail here, which is the point.
    expect(dartMigrationAliases(fixture('alias-marker.dart'))).toHaveLength(1);
    expect(webRadiusBase().px).toBeGreaterThan(0);

    // The scope-boundary parsers are asked here too. Each one's assertion below is
    // an EMPTY-SET expectation, so a parser that silently read nothing would make
    // all of them pass — the exact vacuous pass Req 15.2 exists to forbid.
    expect(dartAdvisoryPorts()).not.toHaveLength(0);
    expect(dartWebHandoffCallSites()).not.toHaveLength(0);

    // The typeface parsers are asked here for the same reason. P11's assertions below
    // include EMPTY-SET expectations (no unbundled weight, no second family), so a
    // parser that read nothing would pass every one of them — and the face it failed
    // to read is the face that would be synthesised on a device.
    expect(bundledFontFamilies()).not.toHaveLength(0);
    expect(pubspecDependencyNames()).not.toHaveLength(0);
    expect(dartFontFamilyReferences()).not.toHaveLength(0);
    expect(dartAppliedFontWeights()).not.toHaveLength(0);
    expect(dartFontFamilyConstant().family.length).toBeGreaterThan(0);

    // The vocabulary scan's own assertion expects an EMPTY set, so a scanner that
    // reached only some of the five surfaces would still pass it — and the surface
    // it silently dropped would be the one a retired word came back on. Each term
    // here is a word the tree DOES use on exactly one surface, so the assertion is
    // that all five are read: `binder` as an identifier and as copy,
    // `/listings/mine` as a route, `.gitkeep` as a bundled asset, `shell_guest` as a
    // golden case name.
    const canary = dartRetiredVocabularySurfaces(['binder', 'listings mine', 'gitkeep', 'shell guest']);
    expect(
      [...new Set(canary.map((hit) => hit.surface))].sort(),
      'the vocabulary scan did not reach every surface Req 14.4 names',
    ).toEqual(['asset', 'golden', 'identifier', 'route', 'string']);
  });
});

// ─── Stage 1: live theme agreement ───────────────────────────────────────────
//
// Activated with the generated `flutter_app/lib/core/theme/` layer (task 2.4).
// Everything below compares two parsed sources to each other; the only literals
// are the RECORDED BASELINES for the call-site scans, which the migration is
// permitted to lower and never to raise.
//
// Keep the whole file Node-only in the Vitest `domain` project: it reads source
// text and must not require Flutter or a browser.

/**
 * Call-site scan baselines measured on the Stage 1 tree, before Stage 2 begins
 * migrating `features/**` and `widgets/**`. Req 2.8, 3.5, 3.13, 13.3; P6, P7.
 *
 * These are a RATCHET, not a target. Each assertion is `<=`, so a stage that
 * clears literals tightens the bound and a stage that adds one fails. Stage 9
 * drives every entry to zero.
 */
const SCAN_BASELINE = {
  /**
   * `Color(0x…)` + `Colors.<name>` references; `Colors.transparent` is allowed.
   * Stage 1 measured 64. Stage 2 (`widgets/common`) cleared 21: the avatar's
   * eight-colour ramp and its white ink, the condition badge's four grade
   * colours, the shimmer block's white fill, and the image viewer's seven
   * black/white surround references. Stage 4's catalog half cleared 5 more: the
   * listing card's white scrim ink, binder-marker ink and heart tint, and the
   * catalog screen's white FAB foreground. Stage 4's detail half cleared 4 more
   * from the listing detail screen's own overlay controls and carousel
   * placeholders. Stage 5's contract rooms cleared 9 more: between them the sale
   * and trade status banners printed white ink on four saturated fills, and the
   * trade rail drew its tick and its active core as white discs. Both banners are
   * now a `StatusBadge` tint and every rail marker is a named tint. Stage 6's forms
   * cleared 15 more: the two listing screens between them drew a white spinner, a
   * white publish label, three white close glyphs on hand-rolled discs, a
   * `Colors.black` fullscreen preview and its `white70` indicator, and the message
   * composer painted a white send glyph on an alpha-tuned muted disc. Every one of
   * them is now `--obsidian`/`--mist`, a named tint, or a themed control. Stage 6's
   * message half cleared the last of them outside the auth and profile screens: the
   * conversation row painted its unread marker's count in `Colors.white` on a
   * `danger` disc, which is now `--primary-foreground` on `--primary`.
   *
   * Stage 7's profile half cleared 3 more: the account hub and the edit screen each
   * drew a white camera glyph on a hand-rolled `--primary` disc for an avatar picker
   * that was a `TODO`, and the edit screen's save button substituted a white spinner
   * FOR its label. The pickers are gone and the save control is `AppButton.busy`,
   * which keeps its own bounds. Every remaining one is a white spinner inside a
   * button on the auth, offers or purchase screens — the same substitution, in the
   * three places Stage 7 does not touch.
   */
  colorLiteral: 6,
  /**
   * Spacing literals that are not members of the six-step scale. Stage 1
   * measured 82; Stage 4's catalog half cleared 10 from the listing card's
   * hand-tuned 2/3/6/8/9/18-pixel rows, and its detail half cleared 12 more from
   * the listing detail screen's 350-pixel carousel, 44-pixel rows and 80-pixel
   * bar reservation. Stage 5 cleared 8 more: the two rooms' hand-set 54 and
   * 60-pixel rail heights, the price row's 3-pixel inset and four 2-pixel gaps.
   * The rail's own geometry is now `AppMetrics.railMarker` / `railConnector`.
   * Stage 6 cleared 7 more from the form screens: two 0.5-pixel hairlines, three
   * hand-set control sizes (48, 44, 40), a 36-pixel icon-button constraint and a
   * 2-pixel gap under a photo counter. Stage 6's message half cleared 10 more from the
   * conversation row's 1/2/5-pixel badge insets, its two hand-stacked 44-in-48 avatar
   * boxes and their 2-pixel offset, and the contract card's 28-pixel button and
   * 2-pixel subtitle gap. The row's leading column is now one `cozy` step and the
   * card's button is a themed control at its own drawn height.
   * Stage 7's profile half cleared 7 more, and with them the last of these outside
   * the auth, catalog-form, notification, offers and sales screens: the hub's three
   * hand-set 4 and 18-pixel rows under the avatar and the rating, the identity
   * screen's 2-pixel gap under a status banner, the payout screen's 28-pixel step
   * numeral and its 2-pixel gaps, and the edit screen's 6-pixel camera inset. The
   * banners are `StatusBadge`, the step numerals are gone with the hand-rolled
   * sequence, and the rest are named steps.
   */
  offScaleSpacing: 22,
  /**
   * Numeric `fontSize:` arguments that bypass the Type_Scale. Stage 1 measured 12.
   * Stage 5 cleared the trade room's 16-pixel "vs" divider with the terms region
   * that carried it. Stage 6 cleared 4 more: the create screen's 18-pixel price
   * field and its prefix and hint, and the propose-trade item tile's 11-pixel
   * caption, which is now `meta`. Its message half cleared 2 more: the conversation
   * contract card's 12-pixel title, which is `rowName`, and the unread marker's
   * 9-pixel count, which is `badgeText` — a count nobody can read is not a signal.
   */
  fontSize: 2,
  /**
   * `blurRadius:` literals that bypass `AppElevation.blurFromCss`. Stage 5 cleared
   * the trade rail's glow around the active marker, which is now a shape and a
   * tint rather than a shadow; Stage 6 cleared the last one, the create screen's
   * hand-tuned publish-bar shadow, which is now `AppElevation.market`.
   */
  shadowBlur: 0,
  /**
   * Hand-written minor-unit divisors under `features/**` and `widgets/**`. Req 14.5.
   *
   * Stage 1 measured ONE, and named it rather than leaving it as a number:
   * `features/listings/screens/edit_listing_screen.dart` prefilled the price field
   * with `(item.fmvCents / 100).toStringAsFixed(2)`. That divisor is wrong for a
   * zero-decimal currency — the reason `Money.minorUnitDigits` exists — so it was a
   * recorded defect and not a tolerated idiom. Stage 6 cleared it: both listing forms
   * now read and write the field through `Money.amountText` / `Money.parseAmountText`,
   * which ask `minorUnitDigits` how many digits the currency has. At zero the ratchet
   * is what stops the idiom coming back.
   */
  minorUnitDivisor: 0,
} as const;

/** The six-step Spacing_Scale plus zero, which is the absence of a step rather than one. P6. */
function spacingScale(): Set<number> {
  return new Set([0, ...dartSpacingSteps().map((step) => step.value)]);
}

/** Text below the Large_Text_Threshold needs 4.5:1; everything else in Req 13.2 needs 3:1. */
function contrastFloor(pair: DartContrastPair, levels: DartTypeLevel[]): number {
  if (pair.role !== 'text') return 3;
  if (pair.level === null) throw new Error(`text pair ${pair.fg}/${pair.bg} declares no Type_Scale level`);
  const level = levels.find((candidate) => candidate.identifier === pair.level);
  if (!level) throw new Error(`text pair ${pair.fg}/${pair.bg} names unknown level ${pair.level}`);
  return level.px >= 24 ? 3 : 4.5;
}

function paletteByName(): Map<string, number> {
  return new Map(webColorTokens().map((token) => [token.camel, hslToArgb(token.hsl)]));
}

function describeFindings(findings: TokenFinding[]): string[] {
  return findings.map((entry) => `${entry.criterion} ${entry.kind} ${entry.token}: web=${entry.webValue} dart=${entry.dartValue} (${entry.dart?.file ?? entry.web?.file}:${entry.dart?.line ?? entry.web?.line})`);
}

describe('the palette agrees', () => {
  /** Validates: Requirements 1.2, 1.3, 1.4 */
  it('P4: every web colour has exactly one equal Dart constant, and no Dart colour is surplus', () => {
    const web = webColorTokens();
    const dart = dartColorConstants();
    expect(describeFindings(comparePalette(web, dart))).toEqual([]);
    expect(dart).toHaveLength(web.length);
  });

  /** Validates: Requirements 1.10 */
  it('declares each colour exactly once', () => {
    const identifiers = dartColorConstants().map((entry) => entry.identifier);
    expect([...new Set(identifiers)]).toHaveLength(identifiers.length);
  });
});

describe('the type scale agrees', () => {
  /** Validates: Requirements 2.3 */
  it('P4: the seven Tailwind levels are the seven Dart levels, size and line height', () => {
    const web = webFontSizeLevels();
    const dart = dartTypeLevels();
    expect(describeFindings(compareTypeScale(web, dart))).toEqual([]);
    expect(dart).toHaveLength(web.length);
  });

  /** Validates: Requirements 2.4, 2.16 */
  it('keeps weight and colour off the levels themselves', () => {
    expect(dartTypeLevels().filter((level) => level.hasWeight || level.hasColor).map((level) => level.identifier)).toEqual([]);
  });

  /** Validates: Requirements 2.5, 2.6, 2.7 */
  it('P5: every semantic role resolves to exactly one level', () => {
    expect(describeFindings(resolveRoleLevels(dartTypeLevels(), dartTextRoles()))).toEqual([]);
  });

  /** Validates: Requirements 2.12 */
  it('gives every money role tabular and lining figures', () => {
    const money = dartTextRoles().filter((role) => role.identifier.startsWith('price'));
    expect(money.length).toBeGreaterThan(0);
    for (const role of money) {
      expect(role.fontFeatures, `${role.identifier} at ${role.file}:${role.line}`)
        .toEqual(expect.arrayContaining(['tabularFigures', 'liningFigures']));
    }
  });
});

// ─── Typeface delivery — Property P11 (Req 12.5–12.7, 12.10) ─────────────────
//
// Flutter reports NEITHER of the two ways this can be wrong. A `fontFamily` it
// cannot resolve falls back to the platform face; a `FontWeight` with no bundled
// asset is synthesised from the nearest one it does have. Both render text that
// looks approximately correct, on a device, after shipping. So the four bundled
// faces, the one family name, and every weight the tree applies are pinned to each
// other here, where a mismatch is a failing test instead of a shipped regression.

/** The four weights Req 12.5 bundles, and the only weights P11 permits. */
const BUNDLED_WEIGHTS = [400, 500, 600, 700] as const;

/** Writes a `flutter: fonts:` pubspec fixture and returns its path. */
function pubspecFixture(body: string): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'noditto-pubspec-'));
  temporaryDirectories.push(directory);
  const file = path.join(directory, 'pubspec.yaml');
  writeFileSync(file, body, 'utf8');
  return file;
}

const VALID_PUBSPEC = [
  'name: cardtrade',
  'dependencies:',
  '  flutter:',
  '    sdk: flutter',
  '  intl: ^0.20.2',
  'dev_dependencies:',
  '  flutter_lints: ^6.0.0',
  'flutter:',
  '  uses-material-design: true',
  '  assets:',
  '    - assets/images/',
  '  fonts:',
  '    - family: Plus Jakarta Sans',
  '      fonts:',
  '        - asset: assets/fonts/PlusJakartaSans-Regular.ttf',
  '          weight: 400',
  '        - asset: assets/fonts/PlusJakartaSans-Bold.ttf',
  '          weight: 700',
  '',
].join('\n');

describe('the typeface parsers are not lying', () => {
  /** Validates: Requirements 15.2; P12 */
  it('reads every family, face and weight out of a valid fonts block', () => {
    const families = bundledFontFamilies(pubspecFixture(VALID_PUBSPEC));
    expect(families.map((entry) => entry.family)).toEqual(['Plus Jakarta Sans']);
    expect(families[0].faces.map((face) => [face.asset, face.weight])).toEqual([
      ['assets/fonts/PlusJakartaSans-Regular.ttf', 400],
      ['assets/fonts/PlusJakartaSans-Bold.ttf', 700],
    ]);
    // The fixture directory holds no font files, so the existence check has to be
    // reporting absence rather than assuming presence.
    expect(families[0].faces.map((face) => face.assetExists)).toEqual([false, false]);
  });

  /** Validates: Requirements 15.2 */
  it('rejects a line inside the fonts block it cannot understand', () => {
    const broken = VALID_PUBSPEC.replace('          weight: 400', '          wieght: 400');
    expect(() => bundledFontFamilies(pubspecFixture(broken))).toThrow(/unrecognised line/);
  });

  /** Validates: Requirements 15.2 */
  it('rejects a face declared before any family instead of dropping it', () => {
    const orphan = VALID_PUBSPEC.replace('    - family: Plus Jakarta Sans\n', '');
    expect(() => bundledFontFamilies(pubspecFixture(orphan))).toThrow(/before any `- family:`/);
  });

  /** Validates: Requirements 15.2 */
  it('rejects a pubspec with no flutter section rather than reporting no fonts', () => {
    expect(() => bundledFontFamilies(pubspecFixture('name: cardtrade\n')))
      .toThrow(/no top-level `flutter:` section/);
  });

  /** Validates: Requirements 15.2 */
  it('reads dependency names from both blocks and stops at the flutter section', () => {
    const names = pubspecDependencyNames(pubspecFixture(VALID_PUBSPEC));
    expect(names).toEqual(['flutter', 'intl', 'flutter_lints']);
  });
});

describe('the typeface is bundled, single and complete', () => {
  /** Validates: Requirements 12.5, 12.6 */
  it('P11: declares exactly one family, bundling exactly the four web weights', () => {
    const families = bundledFontFamilies();
    expect(families.map((entry) => entry.family)).toEqual(['Plus Jakarta Sans']);
    const weights = families[0].faces.map((face) => face.weight).sort((a, b) => Number(a) - Number(b));
    expect(weights).toEqual([...BUNDLED_WEIGHTS]);
  });

  /** Validates: Requirements 12.5 */
  it('P11: every declared face names a file that is actually on disk', () => {
    const missing = bundledFontFamilies()
      .flatMap((entry) => entry.faces)
      .filter((face) => !face.assetExists)
      .map((face) => `${face.file}:${face.line} ${face.asset}`);
    expect(missing, 'a declared face with no asset is the platform default at runtime').toEqual([]);
  });

  /** Validates: Requirements 12.5 */
  it('P11: declares no italic or otherwise styled face, which the web does not use', () => {
    const styled = bundledFontFamilies()
      .flatMap((entry) => entry.faces)
      .filter((face) => face.style !== null)
      .map((face) => `${face.file}:${face.line} style=${face.style}`);
    expect(styled).toEqual([]);
  });

  /** Validates: Requirements 12.6 */
  it('P11: names the family in exactly one place, and the theme uses that name', () => {
    const declared = bundledFontFamilies()[0].family;
    expect(dartFontFamilyConstant().family).toBe(declared);

    const references = dartFontFamilyReferences();
    expect(references).toHaveLength(1);
    expect(references[0].text, `${references[0].file}:${references[0].line}`)
      .toMatch(/fontFamily\s*:\s*AppType\.family/);
  });

  /** Validates: Requirements 12.6 */
  it('P11: declares no monospace or second family anywhere', () => {
    const families = bundledFontFamilies().map((entry) => entry.family);
    expect(families).toHaveLength(1);
    expect(families[0].toLowerCase()).not.toMatch(/mono|courier|consolas|menlo/);

    // A fallback list is a second family by another name: it is what renders when the
    // first does not, and the web declares none.
    const fallbacks = dartFontFamilyReferences().filter((entry) => /fontFamilyFallback/.test(entry.text));
    expect(fallbacks.map((entry) => `${entry.file}:${entry.line}`)).toEqual([]);
  });

  /** Validates: Requirements 12.10 */
  it('P11: applies no weight the four faces do not bundle', () => {
    // Derived from what pubspec.yaml actually BUNDLES, not from the constant: the
    // question is whether an applied weight has a face behind it, and answering it
    // from a hard-coded list would keep passing if a face were dropped.
    const bundled = bundledFontFamilies().flatMap((entry) => entry.faces).map((face) => face.weight);
    expect([...bundled].sort((a, b) => Number(a) - Number(b))).toEqual([...BUNDLED_WEIGHTS]);
    const permitted = new Set<number>(bundled.filter((weight): weight is number => weight !== null));
    const uses = dartAppliedFontWeights();
    const offending = uses
      .filter((use) => use.weight === null || !permitted.has(use.weight))
      .map((use) => `${use.file}:${use.line} ${use.text} → ${use.weight ?? 'unresolved'}`);
    expect(
      offending,
      'Req 12.10: an unbundled weight is SYNTHESISED from the nearest bundled face, not refused',
    ).toEqual([]);

    // Every bundled face has to be earning its place in the binary, too: a face
    // nothing applies is bytes shipped for no rendered glyph, which is the reason the
    // web dropped Geist Mono.
    const applied = new Set(uses.map((use) => use.weight));
    for (const weight of BUNDLED_WEIGHTS) {
      expect(applied.has(weight), `no Dart source applies bundled weight ${weight}`).toBe(true);
    }
  });

  /** Validates: Requirements 12.5, 11.2 */
  it('depends on no runtime font fetcher and no travelling-gradient skeleton', () => {
    const dependencies = pubspecDependencyNames();
    // `google_fonts` fetches at runtime, which is the opposite of Req 12.5's bundling.
    expect(dependencies).not.toContain('google_fonts');
    // `shimmer` cannot hold static under reduce-motion, which Req 11.2 requires.
    expect(dependencies).not.toContain('shimmer');
  });

  /** Validates: Requirements 12.7 */
  it('P11: gets tabular figures from a font FEATURE, never from a second family', () => {
    const money = dartTextRoles().filter((role) => role.identifier.startsWith('price'));
    expect(money.length).toBeGreaterThan(0);
    for (const role of money) {
      expect(role.fontFeatures, `${role.identifier} at ${role.file}:${role.line}`)
        .toEqual(expect.arrayContaining(['tabularFigures', 'liningFigures']));
    }
  });
});

describe('spacing, radius and elevation agree', () => {
  /** Validates: Requirements 3.1, 3.2 */
  it('P4: the six named spacing steps agree in both directions', () => {
    const web = webSpacingSteps();
    const dart = dartSpacingSteps();
    expect(describeFindings(compareSpacing(web, dart))).toEqual([]);
    expect(dart).toHaveLength(web.length);
  });

  /** Validates: Requirements 3.6, 3.7 */
  it('P4: radii derive from the live --radius, and the pill radius is not a step', () => {
    expect(describeFindings(compareRadius(webRadiusValues(), webRadiusBase(), dartRadiusValues()))).toEqual([]);
  });

  /** Validates: Requirements 3.8, 3.12 */
  it('P4: every elevation matches its web shadow layer for layer', () => {
    const web = webShadowTokens();
    const dart = dartElevations();
    expect(describeFindings(compareElevation(web, dart))).toEqual([]);
    expect(dart).toHaveLength(web.length);
  });

  /** Validates: Requirements 3.9, 3.13 */
  it('P8: no elevation blur exceeds the largest blur the web declares', () => {
    const webMax = Math.max(...webShadowTokens().flatMap((shadow) => shadow.layers.map((layer) => layer.blur)));
    const dartBlurs = dartElevations().flatMap((shadow) => shadow.layers.map((layer) => ({ blur: layer.cssBlur, at: `${shadow.identifier} ${shadow.file}:${shadow.line}` })));
    expect(dartBlurs.length).toBeGreaterThan(0);
    expect(dartBlurs.filter((layer) => layer.blur > webMax)).toEqual([]);
  });
});

describe('no screen hard-codes a value', () => {
  /** Validates: Requirements 1.7, 13.3 */
  it('P7: hard-coded colour references only ever fall', () => {
    const hits = dartCallSiteLiterals(['colorLiteral']);
    expect(hits.map((hit) => `${hit.file}:${hit.line} ${hit.text}`).length).toBeLessThanOrEqual(SCAN_BASELINE.colorLiteral);
  });

  /** Validates: Requirements 3.4, 3.5 */
  it('P6: spacing literals off the six-step scale only ever fall', () => {
    const scale = spacingScale();
    const offScale = dartCallSiteLiterals(['spacing'])
      .filter((hit) => hit.value === null || !scale.has(hit.value))
      .map((hit) => `${hit.file}:${hit.line} ${hit.value}`);
    expect(offScale.length, offScale.slice(0, 20).join('\n')).toBeLessThanOrEqual(SCAN_BASELINE.offScaleSpacing);
  });

  /** Validates: Requirements 2.8 */
  it('numeric fontSize arguments only ever fall', () => {
    const hits = dartCallSiteLiterals(['fontSize']).map((hit) => `${hit.file}:${hit.line} ${hit.value}`);
    expect(hits.length, hits.join('\n')).toBeLessThanOrEqual(SCAN_BASELINE.fontSize);
  });

  /** Validates: Requirements 3.13 */
  it('call-site shadow blurs only ever fall', () => {
    const hits = dartCallSiteLiterals(['shadowBlur']).map((hit) => `${hit.file}:${hit.line} ${hit.value}`);
    expect(hits.length, hits.join('\n')).toBeLessThanOrEqual(SCAN_BASELINE.shadowBlur);
  });
});

describe('the theme is tokenised', () => {
  /** Validates: Requirements 1.9 */
  it('names every populated ColorScheme slot from the generated palette', () => {
    const palette = new Set(dartColorConstants().map((entry) => entry.identifier));
    const slots = dartColorSchemeSlots().filter((slot) => slot.slot !== 'brightness');
    expect(slots.length).toBeGreaterThan(0);
    const untokenised = slots.filter((slot) => slot.colorIdentifier === null || !palette.has(slot.colorIdentifier));
    expect(untokenised.map((slot) => `${slot.slot} at ${slot.file}:${slot.line}`)).toEqual([]);
  });

  /** Validates: Requirements 1.8 */
  it('builds every tint part from a palette token and an explicit alpha', () => {
    const palette = new Set(dartColorConstants().map((entry) => entry.identifier));
    const tints = dartTints();
    expect(tints.length).toBeGreaterThan(0);
    for (const tint of tints) {
      const parts = [tint.fill, tint.edge, tint.ink].filter((part) => part !== null);
      expect(parts.length, `${tint.identifier} declares no parts`).toBeGreaterThan(0);
      for (const part of parts) {
        expect(palette.has(part!.colorIdentifier), `${tint.identifier} at ${tint.file}:${tint.line} uses ${part!.colorIdentifier}`).toBe(true);
        expect(part!.alpha).toBeGreaterThan(0);
        expect(part!.alpha).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('contrast floors hold', () => {
  /** Validates: Requirements 13.4 */
  it('pairs every role colour the parser reads against a surface', () => {
    const pairs = dartContrastPairs();
    expect(pairs.length).toBeGreaterThan(0);
    const foregrounds = new Set(pairs.map((pair) => pair.fg));
    const unpaired = dartTextRoles()
      .filter((role) => role.colorIdentifier !== null && !foregrounds.has(role.colorIdentifier))
      .map((role) => `${role.identifier} -> ${role.colorIdentifier}`);
    expect(unpaired).toEqual([]);
  });

  /** Validates: Requirements 13.1, 13.2, 13.3, 13.5 */
  it('measures every declared pair at or above its floor, and keeps no stale exception', () => {
    const palette = paletteByName();
    const levels = dartTypeLevels();
    const measure = (pair: DartContrastPair) => {
      const fg = palette.get(pair.fg);
      const bg = palette.get(pair.bg);
      if (fg === undefined || bg === undefined) throw new Error(`contrast pair ${pair.fg}/${pair.bg} names a token the web does not declare`);
      return { ratio: contrastRatio(fg, bg), floor: contrastFloor(pair, levels) };
    };

    const failures = dartContrastPairs().flatMap((pair) => {
      const { ratio, floor } = measure(pair);
      return ratio + 1e-9 >= floor ? [] : [`${pair.fg} on ${pair.bg} = ${ratio.toFixed(2)} below ${floor} (${pair.file}:${pair.line})`];
    });
    expect(failures).toEqual([]);

    // A recorded exception that now meets its floor must be deleted, not kept.
    const stale = dartContrastExceptions().flatMap((pair) => {
      const { ratio, floor } = measure(pair);
      return ratio + 1e-9 >= floor ? [`${pair.fg} on ${pair.bg} = ${ratio.toFixed(2)} now meets ${floor}`] : [];
    });
    expect(stale).toEqual([]);
  });
});

describe('the migration ratchet only tightens', () => {
  /** Validates: Requirements 1.6, 1.11, 3.3 */
  it('holds every alias below its recorded count and above zero', () => {
    const aliases = dartMigrationAliases();
    // Task 12.1 drove all fourteen to zero and deleted `migration_aliases.dart`, so
    // an EMPTY set is the finished state Req 1.11 and 14.9 ask for — not a parse
    // failure and not a skipped assertion. The two checks below still run over
    // whatever markers exist, so reintroducing an alias puts it back under ratchet;
    // the reader itself is proved to read by the fixture canary in P12.
    const loosened = aliases
      .filter((alias) => alias.referenceCount > alias.recordedCount)
      .map((alias) => `${alias.identifier}: ${alias.referenceCount} references, recorded ${alias.recordedCount} (${alias.file}:${alias.line})`);
    expect(loosened).toEqual([]);

    // Req 1.11: an alias nobody references must be deleted rather than left behind.
    const unreferenced = aliases
      .filter((alias) => alias.referenceCount === 0)
      .map((alias) => `${alias.identifier} -> ${alias.replacement} has no references and must be deleted (${alias.file}:${alias.line})`);
    expect(unreferenced).toEqual([]);
  });
});

// ─── The scope boundary (Req 14) ──────────────────────────────────────────────
//
// Task 6.1 recorded the Req 7.10 resolution: the contract-room step-plan
// derivation belongs to `.kiro/specs/mobile-parity/` Requirement 11, and this
// spec keeps only presentation. The assertions below are what stop that
// resolution from decaying — a ninth port, a surplus rule symbol or a retired
// word fails here rather than being noticed in review, or not.
//
// These are ADDITIONS. Nothing in `mobileDomainAgreement.test.ts` or
// `mobileRpcContract.test.ts` is deleted, narrowed or skipped (Req 14.2); the
// coarse whole-file scan there still runs, and this file scans the narrower words
// it cannot reach.

/**
 * The nine Advisory_Domain_Port files that exist when this work begins. Req 14.1.
 *
 * Written out rather than counted, because "nine files" would be satisfied by
 * deleting the bond policy and adding a contract step plan — which is precisely
 * the substitution the recorded resolution forbids.
 */
const ADVISORY_PORTS = [
  'flutter_app/lib/core/money.dart',
  'flutter_app/lib/domain/bond/bond_policy.dart',
  'flutter_app/lib/domain/fulfilment/validation.dart',
  'flutter_app/lib/domain/identity/identity_gate.dart',
  'flutter_app/lib/domain/region/regions.dart',
  'flutter_app/lib/domain/state_machine/machine.dart',
  'flutter_app/lib/domain/state_machine/trade_actions.dart',
  'flutter_app/lib/domain/trade/trade_fee.dart',
  'flutter_app/lib/domain/trade/trade_side_values.dart',
] as const;

/**
 * Port symbols the pinned TypeScript does not name, as measured when this work
 * begins. Req 14.11 forbids a port GAINING one, so the recorded set is compared for
 * EQUALITY: a fourteenth entry fails, and clearing one of these thirteen also fails
 * until it is struck from this list. It is a census, not an allowlist.
 *
 * None of the thirteen is a new rule — each is a spelling or an encoding difference
 * in a rule the TypeScript already owns:
 *
 *  - `requiredCashSaleBondCents` / `requiredTradeBondCents` / `isCashSaleBondExempt`
 *    split the TypeScript's single `requiredBondCents(kind, …)` into named entry
 *    points. The exemption asymmetry itself is the TypeScript's.
 *  - `FulfilmentValid` / `FulfilmentInvalid` / `FulfilmentError` are Dart's sealed-class
 *    encoding of the TypeScript's `ValidationResult` discriminated union.
 *  - `RegionMismatchReason` and `allRegions` are `checkRegionCompatibility`'s reason
 *    strings and `REGIONS` under Dart names.
 *  - `tryTransition`, `isTerminal`, `validEvents` read the same `TRANSITIONS` table the
 *    TypeScript exports; `TERMINAL_STATES` lives in `types.ts` beside it.
 *  - `canCancel` reads the transition table for the cancel edge.
 *  - `cashSaleInspectionDays` is the ONE genuine gap: the 7-day cash-sale window is a
 *    web constant that does not live in `domain/fulfilment/`. It is recorded rather
 *    than fixed here, because moving a constant is not a presentation change.
 */
const RECORDED_SURPLUS_SYMBOLS = [
  'flutter_app/lib/domain/bond/bond_policy.dart isCashSaleBondExempt',
  'flutter_app/lib/domain/bond/bond_policy.dart requiredCashSaleBondCents',
  'flutter_app/lib/domain/bond/bond_policy.dart requiredTradeBondCents',
  'flutter_app/lib/domain/fulfilment/validation.dart FulfilmentError',
  'flutter_app/lib/domain/fulfilment/validation.dart FulfilmentInvalid',
  'flutter_app/lib/domain/fulfilment/validation.dart FulfilmentValid',
  'flutter_app/lib/domain/fulfilment/validation.dart cashSaleInspectionDays',
  'flutter_app/lib/domain/region/regions.dart RegionMismatchReason',
  'flutter_app/lib/domain/region/regions.dart allRegions',
  'flutter_app/lib/domain/state_machine/machine.dart isTerminal',
  'flutter_app/lib/domain/state_machine/machine.dart tryTransition',
  'flutter_app/lib/domain/state_machine/machine.dart validEvents',
  'flutter_app/lib/domain/state_machine/trade_actions.dart canCancel',
] as const;

/**
 * `WebHandoff.*` call sites. Req 14.6 lets this rise, never fall, so the floor is
 * raised as the count rises rather than left at the 2 measured when this work began —
 * a floor of 2 against 17 actual sites would pass while fifteen handoffs were
 * replaced by something that reimplements what they hand off to.
 *
 * Stage 7 took it from 3 to 17. The identity and payout screens each held a private
 * `_webAppBaseUrl` const and a bare `launchUrl`, which is the same handoff with a
 * second copy of the web address; both now go through `WebHandoff`, and the affordances
 * name the page they open through `WebHandoff.pageLabel` (Req 10.6). The settings
 * screen's terms and privacy rows were `onTap` callbacks holding a `TODO` — rows that
 * looked like links and did nothing — and the account hub gained the payout-report
 * link, which is reporting the phone deliberately does not approximate.
 */
const RECORDED_WEB_HANDOFF_CALL_SITES = 17;

/**
 * Retired_Vocabulary, and the one member-facing-only term.
 *
 * `Deal` is matched as the BARE word rather than the plural the existing scan uses,
 * which is the widening P9 asks for: `deals_screen.dart` was the original offender
 * and a single `DealScreen` would have slipped past a plural. `shopfront` is checked
 * against copy alone, because it is the internal name for `listing_kind = 'SHOPFRONT'`
 * and `ListingKind.shopfront` is the field that carries it.
 */
const RETIRED_VOCABULARY = ['deal', 'deals', 'ditto bond', 'kyc', 'kyc status', 'police evidence', 'police evidence pack'];
const MEMBER_FACING_ONLY = ['shopfront'];

describe('the scope boundary holds', () => {
  /** Validates: Requirements 14.1 */
  it('holds exactly the nine Advisory_Domain_Ports, each pinned to TypeScript that exists', () => {
    const ports = dartAdvisoryPorts();
    expect(
      ports.map((port) => port.file),
      'a ninth rule module under flutter_app/lib/domain, or a missing one. The ' +
        'contract step-plan derivation belongs to .kiro/specs/mobile-parity/ Req 11, ' +
        'not here.',
    ).toEqual([...ADVISORY_PORTS]);

    // `dartAdvisoryPorts` throws on a port whose header declares no mirror or names
    // a module that does not exist, so reaching this line is itself the assertion
    // that every port is still pinned to something real.
    for (const port of ports) expect(port.mirrors, port.file).toMatch(/^(domain|lib)\//);
  });

  /** Validates: Requirements 14.11 */
  it('adds no exported symbol to a port that the pinned TypeScript does not name', () => {
    const surplus = dartPortSurplusSymbols().map((entry) => `${entry.file} ${entry.symbol}`);
    expect(
      surplus.sort(),
      'a port gained a symbol with no TypeScript counterpart, or cleared a recorded ' +
        'one without striking it from RECORDED_SURPLUS_SYMBOLS. A Mobile_Screen that ' +
        'needs a new rule needs the server to decide it (Req 14.12).',
    ).toEqual([...RECORDED_SURPLUS_SYMBOLS].sort());
  });

  /** Validates: Requirements 14.4; P9 */
  it('P9: names no retired vocabulary in an identifier, a string, a route, an asset or a golden', () => {
    const hits = dartRetiredVocabularySurfaces(RETIRED_VOCABULARY, MEMBER_FACING_ONLY);
    expect(
      hits.map((hit) => `${hit.surface} "${hit.text}" matches ${hit.term} at ${hit.file}:${hit.line}`),
      'Deal went with migration 0055, KYC_Status never had a gate behind it, and the ' +
        'Police Evidence Pack was withdrawn deliberately. Member copy says "trade ' +
        'collateral" and "binder or bulk listing" — never DittoBond, never shopfront.',
    ).toEqual([]);
  });

  /** Validates: Requirements 14.5 */
  it('renders money only through core/money.dart', () => {
    const symbols = dartCallSiteLiterals(['currencySymbol']).map((hit) => `${hit.file}:${hit.line} ${hit.text}`);
    expect(symbols, 'a currency symbol belongs to Money.format, which picks it per currency').toEqual([]);

    const divisors = dartCallSiteLiterals(['minorUnitDivisor']).map((hit) => `${hit.file}:${hit.line} ${hit.text}`);
    expect(divisors.length, divisors.join('\n')).toBeLessThanOrEqual(SCAN_BASELINE.minorUnitDivisor);
  });

  /** Validates: Requirements 14.6 */
  it('keeps every website handoff, styling the affordance rather than replacing it', () => {
    const sites = dartWebHandoffCallSites();
    expect(
      sites.length,
      `web_handoff call sites fell to ${sites.length}. A styled handoff is in scope; ` +
        'implementing what it hands off to is a mobile-parity gap.',
    ).toBeGreaterThanOrEqual(RECORDED_WEB_HANDOFF_CALL_SITES);
  });
});

describe('Colour_Conversion', () => {
  it('matches independent CSS HSL worked vectors', () => {
    expect(hslToArgb([0, 100, 50])).toBe(0xffff0000);
    expect(hslToArgb([60, 100, 50])).toBe(0xffffff00);
    expect(hslToArgb([120, 100, 50])).toBe(0xff00ff00);
    expect(hslToArgb([240, 100, 50])).toBe(0xff0000ff);
    expect(hslToArgb([0, 0, 100])).toBe(0xffffffff);
    expect(hslToArgb([0, 0, 0])).toBe(0xff000000);
  });

  /** Validates: Requirements 1.2 */
  it('P1: round-trips every generated opaque RGB colour through HSL', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0x00ffffff }), (rgb) => {
        const argb = (0xff000000 | rgb) >>> 0;
        expect(hslToArgb(argbToHsl(argb))).toBe(argb);
      }),
      { numRuns: 200 },
    );
  });

  /** Validates: Requirements 13.1, 13.2, 13.3 */
  it('P2: contrast is symmetric, bounded, and one only for equal colours', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0x00ffffff }),
        fc.integer({ min: 0, max: 0x00ffffff }),
        (firstRgb, secondRgb) => {
          const first = (0xff000000 | firstRgb) >>> 0;
          const second = (0xff000000 | secondRgb) >>> 0;
          const ratio = contrastRatio(first, second);
          expect(ratio).toBeCloseTo(contrastRatio(second, first), 12);
          expect(ratio).toBeGreaterThanOrEqual(1);
          expect(ratio).toBeLessThanOrEqual(21);
          expect(ratio === 1).toBe(first === second);
        },
      ),
      { numRuns: 200 },
    );
  });

  /** Validates: Requirements 15.5 */
  it('P13: generated alias chains resolve or throw without looping', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constant(undefined), { minLength: 1, maxLength: 32 }),
        fc.option(fc.integer({ min: 0, max: 31 }), { nil: null }),
        (edges, candidateCycleAt) => {
          const cycleAt = candidateCycleAt === null || candidateCycleAt >= edges.length
            ? null
            : candidateCycleAt;
          if (cycleAt === null) {
            expect(() => parseGeneratedAliasGraph(edges, null)).not.toThrow();
          } else {
            expect(() => parseGeneratedAliasGraph(edges, cycleAt)).toThrow(/circular var\(\) chain/);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
