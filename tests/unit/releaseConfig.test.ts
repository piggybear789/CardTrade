// tests/unit/releaseConfig.test.ts
//
// Pins the Android release configuration of `flutter_app/` to what
// `.kiro/specs/mobile-release-readiness/` decided it must be.
//
// Req 1.1, 1.2, 1.4, 2.4, 2.5, 3.1, 3.4, 4.1, 4.2, 5.6, 6.6, 9.1, 11.2.
//
// WHY THIS EXISTS. `build.gradle.kts`, `AndroidManifest.xml`, `pubspec.yaml`, the
// `.gitignore` files and `BUILD.md` are TEXT. Nothing type-checks any of them, and
// none of the work in that spec is covered by an existing guard. Every failure mode
// here is silent at build time and expensive afterwards:
//
//   - `applicationId` is immutable after the first Play upload, so a wrong value is
//     not a bug to fix later — it is a permanent one.
//   - A mistyped `intent-filter` attribute compiles. The filter simply never matches
//     and the link falls through to the browser with no error anywhere.
//   - `android:label` on the wrong element is valid XML and puts the scaffold name
//     back on a member's launcher.
//   - A debug-signed release Bundle is rejected at upload, after the build.
//   - A declared asset directory with nothing in it ships bytes for no glyph.
//
// This file is the only automated defence against the whole release configuration
// regressing, and the design says so ("Gradle and manifest are text, so assert
// them … it costs one file").
//
// PARSER DISCIPLINE (.kiro/steering/flutter.md). Every parser below THROWS on source
// it cannot understand rather than returning an empty set, and each one is exercised
// against malformed fixtures in the first `describe`. A check that passes vacuously is
// worse than no check — the first run of the union parser in `mobileContract.ts` read a
// semicolon inside a `//` comment as the end of a declaration, dropped five members,
// and reported it as drift.
//
// Node-only, so it runs in the Vitest `domain` project alongside the other guards. It
// reads files and shells out to `git`; it needs no Flutter, no Gradle and no browser.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

/** Temp fixture directories written by the parser-discipline tests below. */
const temporaryDirectories: string[] = [];

afterAll(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true });
});

const ROOT = process.cwd();
const FLUTTER = path.join(ROOT, 'flutter_app');
const GRADLE_FILE = path.join(FLUTTER, 'android', 'app', 'build.gradle.kts');
const MANIFEST_FILE = path.join(FLUTTER, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const PUBSPEC_FILE = path.join(FLUTTER, 'pubspec.yaml');
const BUILD_DOCS_FILE = path.join(FLUTTER, 'BUILD.md');
const IOS_DIR = path.join(FLUTTER, 'ios');

/** The one member-facing application id (Req 1.1, 1.2, design D1). */
const APPLICATION_ID = 'app.noditto';
/** The one member-facing display name (Req 1.4). */
const DISPLAY_NAME = 'NoDitto';
/** The App Links host (Req 4.1). */
const APP_LINK_HOST = 'noditto.app';
/** The custom scheme reserved to NoDitto (Req 4.2). */
const CUSTOM_SCHEME = 'noditto';

// ─── Kotlin / Gradle DSL ─────────────────────────────────────────────────────
//
// Brace matching is done over a MASKED copy: comments are blanked entirely, and
// inside string literals only `{` and `}` are blanked. That keeps `create("release")`
// searchable — the block names this file cares about live inside string literals —
// while a brace in a comment or a string can never move a block boundary. Indices
// into the mask are indices into the original, so values are always read from the
// real text.

/**
 * Blanks comments, and braces inside string literals, preserving length and newlines.
 *
 * @throws if a comment or string literal is unterminated, which means the file is not
 *   the Kotlin it claims to be and no assertion below could be trusted.
 */
function maskKotlin(source: string, where: string): string {
  const out = source.split('');
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k += 1) if (out[k] !== '\n') out[k] = ' ';
  };
  const blankBraces = (from: number, to: number): void => {
    for (let k = from; k < to; k += 1) if (out[k] === '{' || out[k] === '}') out[k] = ' ';
  };
  let i = 0;
  while (i < source.length) {
    if (source.startsWith('//', i)) {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i);
      if (end === -1) throw new Error(`${where}: unterminated block comment at offset ${i}`);
      blank(i, end + 2);
      i = end + 2;
      continue;
    }
    if (source.startsWith('"""', i)) {
      const end = source.indexOf('"""', i + 3);
      if (end === -1) throw new Error(`${where}: unterminated raw string at offset ${i}`);
      blankBraces(i, end + 3);
      i = end + 3;
      continue;
    }
    if (source[i] === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== '"' && source[j] !== '\n') {
        j += source[j] === '\\' ? 2 : 1;
      }
      if (j >= source.length || source[j] !== '"') {
        throw new Error(`${where}: unterminated string literal at offset ${i}`);
      }
      blankBraces(i, j + 1);
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

interface KotlinBlock {
  /** The block body, read from the ORIGINAL source (comments and strings intact). */
  readonly text: string;
  /** The same body read from the mask, for nested block searches. */
  readonly mask: string;
  /** Absolute offset of the body's first character in the file. */
  readonly start: number;
}

/**
 * Extracts the body of the single block whose header matches `header`, searching within
 * `scope`. The header pattern must be global and must include the opening brace.
 *
 * @throws if the header matches zero times or more than once, or if the braces do not
 *   balance. "Not found" must never degrade to "nothing to check".
 */
function kotlinBlock(scope: KotlinBlock, header: RegExp, where: string, label: string): KotlinBlock {
  if (!header.global) throw new Error(`${label}: header pattern must be global`);
  header.lastIndex = 0;
  const first = header.exec(scope.mask);
  if (!first) throw new Error(`${where}: no ${label} block matching ${header}`);
  if (header.exec(scope.mask)) throw new Error(`${where}: ${label} block matches ${header} more than once`);
  const open = first.index + first[0].length - 1;
  if (scope.mask[open] !== '{') throw new Error(`${where}: ${label} header does not end at an opening brace`);
  let depth = 0;
  for (let i = open; i < scope.mask.length; i += 1) {
    if (scope.mask[i] === '{') depth += 1;
    else if (scope.mask[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        return {
          text: scope.text.slice(open + 1, i),
          mask: scope.mask.slice(open + 1, i),
          start: scope.start + open + 1,
        };
      }
    }
  }
  throw new Error(`${where}: ${label} block starting at offset ${scope.start + open} is never closed`);
}

/** The whole file as a block, so nested lookups share one code path. */
function kotlinFile(file: string): KotlinBlock {
  const text = readFileSync(file, 'utf8');
  return { text, mask: maskKotlin(text, path.basename(file)), start: 0 };
}

/**
 * Reads the single capture of `pattern` within `block`.
 *
 * @throws if the pattern matches zero times or more than once — two answers to one
 *   question is the bug shape, not a thing to pick from.
 */
function soleCapture(block: KotlinBlock, pattern: RegExp, where: string, what: string): string {
  if (!pattern.global) throw new Error(`${what}: value pattern must be global`);
  pattern.lastIndex = 0;
  const first = pattern.exec(block.mask);
  if (!first) throw new Error(`${where}: no ${what} matching ${pattern}`);
  if (pattern.exec(block.mask)) throw new Error(`${where}: ${what} is declared more than once`);
  // Read the value out of the ORIGINAL text: the mask blanks nothing inside a string
  // except braces, but reading the original is the habit that keeps that true.
  const value = block.text.slice(first.index, first.index + first[0].length).match(new RegExp(pattern.source));
  if (!value || value[1] === undefined) throw new Error(`${where}: ${what} matched no capture group`);
  return value[1];
}

interface GradleFacts {
  readonly applicationId: string;
  readonly namespace: string;
  readonly releaseBody: string;
  readonly releaseSigningConfigDeclared: boolean;
  readonly releaseSigningConfigApplied: boolean;
  readonly debugSigningReferences: number;
  readonly isMinifyEnabled: string;
  readonly isShrinkResources: string;
}

/** Parses the facts Req 1.1, 1.2, 2.5 and 9.1 turn on out of `app/build.gradle.kts`. */
function gradleFacts(file: string = GRADLE_FILE): GradleFacts {
  const where = path.relative(ROOT, file).replace(/\\/g, '/');
  const root = kotlinFile(file);
  const android = kotlinBlock(root, /\bandroid\s*\{/g, where, 'android');
  const defaultConfig = kotlinBlock(android, /\bdefaultConfig\s*\{/g, where, 'defaultConfig');
  const signingConfigs = kotlinBlock(android, /\bsigningConfigs\s*\{/g, where, 'signingConfigs');
  const buildTypes = kotlinBlock(android, /\bbuildTypes\s*\{/g, where, 'buildTypes');
  const release = kotlinBlock(buildTypes, /\brelease\s*\{/g, where, 'release buildType');

  return {
    applicationId: soleCapture(defaultConfig, /\bapplicationId\s*=\s*"([^"]*)"/g, where, 'applicationId'),
    namespace: soleCapture(android, /\bnamespace\s*=\s*"([^"]*)"/g, where, 'namespace'),
    releaseBody: release.text,
    releaseSigningConfigDeclared: /\bcreate\(\s*"release"\s*\)\s*\{/.test(signingConfigs.mask),
    releaseSigningConfigApplied: /\bsigningConfig\s*=\s*signingConfigs\.getByName\(\s*"release"\s*\)/.test(release.mask),
    // Counted over the MASK of the whole file, so a comment that merely mentions the
    // debug config is not a finding while a live reference anywhere is.
    debugSigningReferences: (root.mask.match(/signingConfigs\.getByName\(\s*"debug"\s*\)/g) ?? []).length,
    isMinifyEnabled: soleCapture(release, /\bisMinifyEnabled\s*=\s*(\S+)/g, where, 'isMinifyEnabled'),
    isShrinkResources: soleCapture(release, /\bisShrinkResources\s*=\s*(\S+)/g, where, 'isShrinkResources'),
  };
}

// ─── AndroidManifest.xml ─────────────────────────────────────────────────────
//
// Parsed into a tree rather than substring-matched. An attribute in the wrong element
// is exactly the mistake this guards — `android:autoVerify` on a `<data>` instead of
// the `<intent-filter>`, `android:label` on the activity instead of the application —
// and every substring check would pass on all of them.

interface XmlElement {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: XmlElement[];
  readonly line: number;
}

/**
 * A small strict XML reader: elements, attributes, comments, prolog. Text nodes are
 * ignored (this manifest has none), and anything it cannot account for is an error.
 *
 * @throws on unbalanced tags, an unterminated comment, an attribute it cannot read, or
 *   a second root element.
 */
function parseXml(source: string, where: string): XmlElement {
  const lineAt = (index: number): number => source.slice(0, index).split('\n').length;
  const fail = (index: number, message: string): never => {
    throw new Error(`${where}:${lineAt(index)}: ${message}`);
  };
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;
  let i = 0;

  while (i < source.length) {
    const next = source.indexOf('<', i);
    if (next === -1) {
      if (source.slice(i).trim() !== '') fail(i, 'trailing text after the root element');
      break;
    }
    if (stack.length === 0 && source.slice(i, next).trim() !== '') fail(i, 'text outside the root element');
    i = next;

    if (source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i);
      if (end === -1) fail(i, 'unterminated comment');
      i = end + 3;
      continue;
    }
    if (source.startsWith('<?', i)) {
      const end = source.indexOf('?>', i);
      if (end === -1) fail(i, 'unterminated processing instruction');
      i = end + 2;
      continue;
    }
    if (source.startsWith('<!', i)) {
      const end = source.indexOf('>', i);
      if (end === -1) fail(i, 'unterminated declaration');
      i = end + 1;
      continue;
    }
    if (source.startsWith('</', i)) {
      const end = source.indexOf('>', i);
      if (end === -1) fail(i, 'unterminated closing tag');
      const name = source.slice(i + 2, end).trim();
      const open = stack.pop();
      if (!open) fail(i, `closing tag </${name}> with no open element`);
      if (open && open.name !== name) fail(i, `closing tag </${name}> does not match <${open.name}>`);
      i = end + 1;
      continue;
    }

    // An open tag. Find its `>`, skipping any inside a quoted attribute value.
    let cursor = i + 1;
    let quote: string | null = null;
    while (cursor < source.length) {
      const character = source[cursor];
      if (quote) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") quote = character;
      else if (character === '>') break;
      cursor += 1;
    }
    if (cursor >= source.length) fail(i, 'unterminated opening tag');
    let inner = source.slice(i + 1, cursor);
    const selfClosing = inner.trimEnd().endsWith('/');
    if (selfClosing) inner = inner.trimEnd().slice(0, -1);

    const nameMatch = /^([A-Za-z_][\w.:-]*)/.exec(inner);
    if (!nameMatch) fail(i, `cannot read an element name from <${inner.slice(0, 24)}`);
    const name = nameMatch![1];

    const attributes: Record<string, string> = {};
    let rest = inner.slice(name.length);
    const attributePattern = /^\s+([A-Za-z_][\w.:-]*)\s*=\s*"([^"]*)"/;
    for (;;) {
      if (rest.trim() === '') break;
      const attribute = attributePattern.exec(rest);
      if (!attribute) fail(i, `cannot read an attribute from \`${rest.trim().slice(0, 40)}\` on <${name}>`);
      if (attribute![1] in attributes) fail(i, `<${name}> declares ${attribute![1]} twice`);
      attributes[attribute![1]] = attribute![2];
      rest = rest.slice(attribute![0].length);
    }

    const element: XmlElement = { name, attributes, children: [], line: lineAt(i) };
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(element);
    else if (root) fail(i, `second root element <${name}>`);
    else root = element;
    if (!selfClosing) stack.push(element);
    i = cursor + 1;
  }

  if (stack.length > 0) throw new Error(`${where}: <${stack[stack.length - 1].name}> is never closed`);
  if (!root) throw new Error(`${where}: no elements at all`);
  return root;
}

/** Direct children named `name`. Scoping is the whole point: parentage is the assertion. */
function childrenNamed(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((child) => child.name === name);
}

/** The single direct child named `name`. @throws if there is not exactly one. */
function soleChild(element: XmlElement, name: string, where: string): XmlElement {
  const matches = childrenNamed(element, name);
  if (matches.length !== 1) {
    throw new Error(`${where}: expected exactly one <${name}> inside <${element.name}>, found ${matches.length}`);
  }
  return matches[0];
}

/** Reads the manifest and returns the launcher activity together with the root. */
function manifest(file: string = MANIFEST_FILE): { root: XmlElement; application: XmlElement; mainActivity: XmlElement } {
  const where = path.relative(ROOT, file).replace(/\\/g, '/');
  const root = parseXml(readFileSync(file, 'utf8'), where);
  if (root.name !== 'manifest') throw new Error(`${where}: root element is <${root.name}>, not <manifest>`);
  const application = soleChild(root, 'application', where);
  const activities = childrenNamed(application, 'activity');
  const launchers = activities.filter((activity) =>
    childrenNamed(activity, 'intent-filter').some((filter) =>
      childrenNamed(filter, 'action').some((action) => action.attributes['android:name'] === 'android.intent.action.MAIN'),
    ),
  );
  if (launchers.length !== 1) {
    throw new Error(`${where}: expected exactly one MAIN/LAUNCHER activity, found ${launchers.length}`);
  }
  return { root, application, mainActivity: launchers[0] };
}

/** True when the filter carries the VIEW action and the BROWSABLE category a link needs. */
function isLinkFilter(filter: XmlElement): boolean {
  const hasView = childrenNamed(filter, 'action').some(
    (action) => action.attributes['android:name'] === 'android.intent.action.VIEW',
  );
  const hasBrowsable = childrenNamed(filter, 'category').some(
    (category) => category.attributes['android:name'] === 'android.intent.category.BROWSABLE',
  );
  return hasView && hasBrowsable;
}

// ─── .gitignore coverage, asserted as an EFFECT ──────────────────────────────

/**
 * Asks git whether a path is ignored, and returns the `file:line:pattern` that decided
 * it. Asserting the effect rather than the contents of any one `.gitignore` is
 * deliberate: task 2.2 put the signing entries in `flutter_app/.gitignore` while
 * `flutter_app/android/.gitignore` already had its own, and reorganising those two
 * files must not fail this test while the behaviour is unchanged.
 *
 * `--no-index` is what lets an absent path be tested; nothing here creates a file.
 *
 * @returns the deciding pattern, or `null` when the path is not ignored.
 * @throws if git is unavailable or reports anything other than "ignored"/"not ignored".
 */
function ignoreReason(relativePath: string): string | null {
  const run = (flags: string[]): ReturnType<typeof spawnSync> =>
    spawnSync('git', ['check-ignore', '--no-index', ...flags, '--', relativePath], { cwd: ROOT, encoding: 'utf8' });

  // The DECISION comes from the quiet form. `-v` deliberately reports NEGATED patterns
  // too and exits 0 when it printed one, so `!config/prod.env.example` would read as
  // "ignored" — the exact inversion this helper exists to get right.
  const decision = run(['-q']);
  if (decision.error) throw new Error(`git check-ignore could not run: ${decision.error.message}`);
  if (decision.status === 1) return null;
  if (decision.status !== 0) {
    throw new Error(`git check-ignore exited ${decision.status}: ${String(decision.stderr).trim()}`);
  }

  // Ignored. The verbose form is asked only for the `file:line:pattern` that decided it,
  // so a failure names the rule to open rather than only the path.
  const verbose = run(['-v']);
  const reason = String(verbose.stdout ?? '').trim();
  return reason === '' ? `${relativePath} is ignored (pattern unavailable)` : reason;
}

// ─── pubspec.yaml asset declarations ─────────────────────────────────────────

interface AssetDeclaration {
  readonly value: string;
  readonly line: number;
}

/**
 * Reads the `flutter: assets:` list.
 *
 * @returns the declared entries, or `null` when there is no `assets:` block at all —
 *   which the caller asserts against, so "the parser read nothing" and "nothing is
 *   declared" can never be confused.
 * @throws if there is no top-level `flutter:` section, or if a line inside the block is
 *   neither blank, a comment, nor a `- path` entry.
 */
function declaredAssets(file: string = PUBSPEC_FILE): AssetDeclaration[] | null {
  const where = path.relative(ROOT, file).replace(/\\/g, '/');
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const flutterIndex = lines.findIndex((line) => /^flutter:\s*$/.test(line));
  if (flutterIndex === -1) throw new Error(`${where}: no top-level \`flutter:\` section`);

  let assetsIndex = -1;
  let assetsIndent = 0;
  for (let i = flutterIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    const indent = line.length - line.trimStart().length;
    if (indent === 0) break; // out of the flutter section
    if (/^\s*assets:\s*$/.test(line)) {
      assetsIndex = i;
      assetsIndent = indent;
      break;
    }
  }
  if (assetsIndex === -1) return null;

  const entries: AssetDeclaration[] = [];
  for (let i = assetsIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.trim() === '' || /^\s*#/.test(line)) continue;
    const indent = line.length - line.trimStart().length;
    if (indent <= assetsIndent) break;
    const entry = /^\s*-\s+(\S+)\s*$/.exec(line);
    if (!entry) throw new Error(`${where}:${i + 1}: unrecognised line inside \`assets:\`: ${line.trim()}`);
    entries.push({ value: entry[1], line: i + 1 });
  }
  return entries;
}

/**
 * What a declared asset entry resolves to on disk. A directory declaration bundles the
 * files DIRECTLY inside it, non-recursively, which is what Flutter does; `.gitkeep` is
 * not counted, because a placeholder is the thing Req 5.6 exists to catch.
 */
function resolveAssetEntry(entry: AssetDeclaration): { kind: 'directory' | 'file'; assets: string[] } {
  const target = path.join(FLUTTER, entry.value);
  if (entry.value.endsWith('/')) {
    if (!existsSync(target) || !statSync(target).isDirectory()) return { kind: 'directory', assets: [] };
    const assets = readdirSync(target, { withFileTypes: true })
      .filter((child) => child.isFile() && child.name !== '.gitkeep')
      .map((child) => child.name);
    return { kind: 'directory', assets };
  }
  const present = existsSync(target) && statSync(target).isFile();
  return { kind: 'file', assets: present ? [entry.value] : [] };
}

// ─── BUILD.md ────────────────────────────────────────────────────────────────

/**
 * Finds COMMAND-shaped `build ipa` occurrences: inside a fenced code block, inside
 * backticks, or written after `flutter`. Prose that discusses an iOS archive without
 * offering a command to run is not a finding — task 15.1 worded Req 11.3's section
 * deliberately to describe iOS requirements, and a bare substring scan would fail on it.
 */
function commandShapedIpaMentions(source: string): string[] {
  const hits: string[] = [];
  let inFence = false;
  source.split(/\r?\n/).forEach((line, index) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (!/build\s+ipa\b/i.test(line)) return;
    const commandShaped =
      inFence || /`[^`]*build\s+ipa\b/i.test(line) || /\bflutter\s+build\s+ipa\b/i.test(line);
    if (commandShaped) hits.push(`${index + 1}: ${line.trim()}`);
  });
  return hits;
}

// ─── The parsers are not lying ───────────────────────────────────────────────

describe('the release-config parsers refuse source they cannot understand', () => {
  it('masks Kotlin comments and string braces without moving a block boundary', () => {
    const source = 'android {\n  // } not a brace\n  val s = "a } b"\n  namespace = "x"\n}\n';
    const masked = maskKotlin(source, 'fixture');
    expect(masked).toHaveLength(source.length);
    expect(masked.split('\n')).toHaveLength(source.split('\n').length);
    const block = kotlinBlock({ text: source, mask: masked, start: 0 }, /\bandroid\s*\{/g, 'fixture', 'android');
    expect(soleCapture(block, /\bnamespace\s*=\s*"([^"]*)"/g, 'fixture', 'namespace')).toBe('x');
  });

  it('throws on an unterminated comment or string rather than reading half a file', () => {
    expect(() => maskKotlin('android { /* open', 'fixture')).toThrow(/unterminated block comment/);
    expect(() => maskKotlin('val s = "open\n', 'fixture')).toThrow(/unterminated string literal/);
  });

  it('throws on a missing block instead of reporting nothing to check', () => {
    const source = 'android {\n}\n';
    const scope = { text: source, mask: maskKotlin(source, 'fixture'), start: 0 };
    expect(() => kotlinBlock(scope, /\bbuildTypes\s*\{/g, 'fixture', 'buildTypes')).toThrow(/no buildTypes block/);
    expect(() => soleCapture(scope, /\bnamespace\s*=\s*"([^"]*)"/g, 'fixture', 'namespace')).toThrow(/no namespace/);
  });

  it('throws on a duplicated block or value rather than picking one', () => {
    const source = 'a {\n  release { x = 1 }\n  release { x = 2 }\n}\n';
    const scope = { text: source, mask: maskKotlin(source, 'fixture'), start: 0 };
    expect(() => kotlinBlock(scope, /\brelease\s*\{/g, 'fixture', 'release')).toThrow(/more than once/);
  });

  it('throws on an unclosed block', () => {
    const source = 'android {\n  buildTypes {\n';
    const scope = { text: source, mask: maskKotlin(source, 'fixture'), start: 0 };
    expect(() => kotlinBlock(scope, /\bandroid\s*\{/g, 'fixture', 'android')).toThrow(/never closed/);
  });

  it('reads an XML tree with attributes, comments and self-closing elements', () => {
    const root = parseXml(
      '<manifest>\n<!-- c -->\n<application android:label="X">\n<activity android:name=".M"/>\n</application>\n</manifest>\n',
      'fixture',
    );
    expect(root.name).toBe('manifest');
    const application = soleChild(root, 'application', 'fixture');
    expect(application.attributes['android:label']).toBe('X');
    expect(childrenNamed(application, 'activity').map((a) => a.attributes['android:name'])).toEqual(['.M']);
    // The tree is what makes parentage assertable: the label is on <application>, so
    // <manifest> must not appear to carry it.
    expect(root.attributes['android:label']).toBeUndefined();
  });

  it('throws on mismatched tags, an unterminated comment and an unreadable attribute', () => {
    expect(() => parseXml('<a><b></a>', 'fixture')).toThrow(/does not match <b>/);
    expect(() => parseXml('<a><!-- open</a>', 'fixture')).toThrow(/unterminated comment/);
    expect(() => parseXml('<a x=y></a>', 'fixture')).toThrow(/cannot read an attribute/);
    expect(() => parseXml('<a></a><b></b>', 'fixture')).toThrow(/second root element/);
    expect(() => parseXml('<a>', 'fixture')).toThrow(/never closed/);
  });

  it('finds a command-shaped ipa build and ignores prose about iOS archives', () => {
    expect(commandShapedIpaMentions('Run `flutter build ipa --release`.')).toHaveLength(1);
    expect(commandShapedIpaMentions('```\nflutter build ipa\n```\n')).toHaveLength(1);
    expect(
      commandShapedIpaMentions('An iOS release would need a mac host before any archive could be produced.'),
    ).toHaveLength(0);
  });

  it('reads the git ignore effect in both directions', () => {
    // Two paths with opposite expected answers, so a helper that always said "ignored"
    // or always said "not ignored" fails here rather than making every assertion below
    // pass for free.
    expect(ignoreReason('flutter_app/build/')).not.toBeNull();
    expect(ignoreReason('flutter_app/android/app/build.gradle.kts')).toBeNull();
  });

  it('throws on a pubspec with no flutter section and on a line it cannot read', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'noditto-release-config-'));
    temporaryDirectories.push(directory);
    const write = (body: string): string => {
      const file = path.join(directory, 'pubspec.yaml');
      writeFileSync(file, body, 'utf8');
      return file;
    };
    expect(() => declaredAssets(write('name: cardtrade\n'))).toThrow(/no top-level `flutter:` section/);
    expect(() => declaredAssets(write('flutter:\n  assets:\n    - a/\n    b/\n'))).toThrow(/unrecognised line/);
    expect(declaredAssets(write('flutter:\n  uses-material-design: true\n'))).toBeNull();
    expect(declaredAssets(write('flutter:\n  assets:\n    # a comment\n    - a/b.txt\n'))).toEqual([
      { value: 'a/b.txt', line: 4 },
    ]);
  });
});

// ─── App identity (Req 1.1, 1.2, 1.4) ────────────────────────────────────────

describe('the app names itself NoDitto', () => {
  const gradle = gradleFacts();

  /** Validates: Requirements 1.1 */
  it('sets applicationId to app.noditto', () => {
    expect(
      gradle.applicationId,
      'Req 1.1: applicationId is IMMUTABLE after the first Play upload. If this fails before ' +
        'an upload, fix build.gradle.kts and the Kotlin package directory; if it fails after ' +
        'one, the id can no longer be corrected and this test is the least of the problems.',
    ).toBe(APPLICATION_ID);
  });

  /** Validates: Requirements 1.2 */
  it('sets the Gradle namespace to the same value', () => {
    expect(
      gradle.namespace,
      'Req 1.2: namespace and applicationId must agree, or the generated R class and the ' +
        'MainActivity package diverge and the build stops compiling. Fix build.gradle.kts.',
    ).toBe(gradle.applicationId);
  });

  /** Validates: Requirements 1.4 */
  it('labels the application NoDitto, on the application element', () => {
    const { root, application } = manifest();
    expect(
      application.attributes['android:label'],
      'Req 1.4: android:label is the name on a member\'s launcher. Fix AndroidManifest.xml — ' +
        'the product is NoDitto and CardTrade is the repo, the package and the schema.',
    ).toBe(DISPLAY_NAME);
    expect(
      root.attributes['android:label'],
      'a label on <manifest> is not the launcher name; it belongs on <application>',
    ).toBeUndefined();
  });
});

// ─── Release signing and shrinking (Req 2.5, 9.1) ────────────────────────────

describe('the release build is signed with the upload key and shrunk', () => {
  const gradle = gradleFacts();

  /** Validates: Requirements 2.5 */
  it('references no debug signing config anywhere in live Gradle code', () => {
    expect(
      gradle.debugSigningReferences,
      'Req 2.5: Play rejects a debug-signed App Bundle, and it rejects it at UPLOAD, after ' +
        'the build. Restore signingConfigs.getByName("release") on the release buildType ' +
        'rather than relaxing this count.',
    ).toBe(0);
    expect(gradle.releaseBody).not.toMatch(/getByName\(\s*"debug"\s*\)/);
  });

  /** Validates: Requirements 2.5 */
  it('declares a release signing config and applies it to the release buildType', () => {
    expect(
      gradle.releaseSigningConfigDeclared,
      'Req 2.1, 2.2: the release signing config is what reads the untracked key.properties. ' +
        'Without it there is nothing for the release buildType to point at.',
    ).toBe(true);
    expect(
      gradle.releaseSigningConfigApplied,
      'Req 2.1: a declared-but-unapplied signing config silently leaves the release buildType ' +
        'on the default debug key. Re-apply it in build.gradle.kts.',
    ).toBe(true);
  });

  /** Validates: Requirements 9.1 */
  it('enables code and resource shrinking on release', () => {
    expect(
      gradle.isMinifyEnabled,
      'Req 9.1: code shrinking is off, so the artifact tested is not the artifact shipped. ' +
        'Turn it back on and fix the keep rules in proguard-rules.pro if something breaks.',
    ).toBe('true');
    expect(
      gradle.isShrinkResources,
      'Req 9.1: resource shrinking is off. It requires isMinifyEnabled, so these two move ' +
        'together — fix build.gradle.kts, not this assertion.',
    ).toBe('true');
  });
});

// ─── Manifest completeness (Req 3.1, 3.4) ────────────────────────────────────

describe('the manifest declares what the shipped capabilities need', () => {
  /** Validates: Requirements 3.1 */
  it('declares POST_NOTIFICATIONS as a direct child of manifest', () => {
    const { root } = manifest();
    const permissions = childrenNamed(root, 'uses-permission').map((element) => element.attributes['android:name']);
    expect(
      permissions,
      'Req 3.1: Android 13+ posts no local notification without this permission, and it must ' +
        'sit on <manifest> — a uses-permission nested inside <application> is ignored ' +
        'silently. Restore it in AndroidManifest.xml.',
    ).toContain('android.permission.POST_NOTIFICATIONS');
    expect(permissions, 'Req 3.6: the app cannot reach Supabase or Stripe without INTERNET').toContain(
      'android.permission.INTERNET',
    );
  });

  /** Validates: Requirements 3.4 */
  it('declares the uCrop activity image_cropper starts by name', () => {
    const { application } = manifest();
    const activities = childrenNamed(application, 'activity').map((element) => element.attributes['android:name']);
    expect(
      activities,
      'Req 3.4: image_cropper starts com.yalantis.ucrop.UCropActivity BY NAME, so without this ' +
        'declaration the avatar crop dies with ActivityNotFoundException in release AND debug. ' +
        'Restore the <activity> entry in AndroidManifest.xml.',
    ).toContain('com.yalantis.ucrop.UCropActivity');
  });
});

// ─── Deep links (Req 4.1, 4.2) ───────────────────────────────────────────────

describe('the manifest claims the links the app can serve', () => {
  /** Validates: Requirements 4.1 */
  it('declares an autoVerify https filter on the NoDitto host', () => {
    const { mainActivity } = manifest();
    const filters = childrenNamed(mainActivity, 'intent-filter').filter(isLinkFilter);
    const https = filters.filter((filter) =>
      childrenNamed(filter, 'data').some(
        (data) => data.attributes['android:scheme'] === 'https' && data.attributes['android:host'] === APP_LINK_HOST,
      ),
    );
    expect(
      https.length,
      `Req 4.1: without an https intent-filter on ${APP_LINK_HOST}, an invite link and the ` +
        'identity/payout return markers have no native path back into the app — they open the ' +
        'browser instead. Restore the filter in AndroidManifest.xml.',
    ).toBeGreaterThan(0);
    for (const filter of https) {
      expect(
        filter.attributes['android:autoVerify'],
        `Req 4.1: android:autoVerify belongs on the <intent-filter> at line ${filter.line}, not on ` +
          'a <data> child. Without it Android never checks assetlinks.json, App Link ' +
          'verification never completes, and every https link falls through to the browser ' +
          'with no error anywhere.',
      ).toBe('true');
    }
  });

  /** Validates: Requirements 4.2 */
  it('declares the custom scheme reserved to NoDitto', () => {
    const { mainActivity } = manifest();
    const custom = childrenNamed(mainActivity, 'intent-filter')
      .filter(isLinkFilter)
      .filter((filter) =>
        childrenNamed(filter, 'data').some((data) => data.attributes['android:scheme'] === CUSTOM_SCHEME),
      );
    expect(
      custom.length,
      `Req 4.2: the ${CUSTOM_SCHEME}:// filter is the fallback that carries deep links while App ` +
        'Link verification has not completed, which is the state this release ships in. ' +
        'Restore it in AndroidManifest.xml.',
    ).toBeGreaterThan(0);
  });

  /** Validates: Requirements 4.1, 4.2 */
  it('hands incoming VIEW intents to the router through the embedding flag', () => {
    const { mainActivity } = manifest();
    const flags = childrenNamed(mainActivity, 'meta-data').filter(
      (element) => element.attributes['android:name'] === 'flutter_deeplinking_enabled',
    );
    expect(
      flags.map((element) => element.attributes['android:value']),
      'the intent-filters above are inert without flutter_deeplinking_enabled: the embedding ' +
        'drops the VIEW intent instead of passing the Uri to go_router and resolveDeepLink. ' +
        'Restore the meta-data on the launcher activity in AndroidManifest.xml.',
    ).toEqual(['true']);
  });
});

// ─── Secret hygiene (Req 2.4, 6.6) ───────────────────────────────────────────

describe('git refuses to track a keystore, a key password or a real config', () => {
  /** Validates: Requirements 2.4 */
  it('ignores key.properties, every *.jks and every *.keystore under flutter_app/', () => {
    const paths = [
      'flutter_app/key.properties',
      'flutter_app/android/key.properties',
      'flutter_app/upload.jks',
      'flutter_app/android/app/upload.jks',
      'flutter_app/android/upload.keystore',
      'flutter_app/lib/leaked.keystore',
    ];
    const tracked = paths.filter((candidate) => ignoreReason(candidate) === null);
    expect(
      tracked,
      'Req 2.4, 2.7: every path listed here would be STAGEABLE, which is how an upload key or ' +
        'its password reaches the history — and a leaked upload key cannot be fixed locally. ' +
        'Fix the ignore rules, not this list. The EFFECT is asserted rather than any one ' +
        '.gitignore, so moving an entry between flutter_app/.gitignore and ' +
        'flutter_app/android/.gitignore is free.',
    ).toEqual([]);
  });

  /** Validates: Requirements 6.6 */
  it('ignores config/prod.env while keeping the example tracked', () => {
    expect(
      ignoreReason('flutter_app/config/prod.env'),
      'Req 6.6: config/prod.env holds the real Supabase and Stripe publishable values for a ' +
        'release build. It must never be committable.',
    ).not.toBeNull();
    expect(
      ignoreReason('flutter_app/config/prod.env.example'),
      'Req 6.6: the template must stay TRACKED — it is the only record of which ' +
        'Required_Config_Keys a release needs. Keep the `!config/prod.env.example` negation.',
    ).toBeNull();
  });
});

// ─── Declared assets (Req 5.6) ───────────────────────────────────────────────

describe('every declared asset ships something', () => {
  /** Validates: Requirements 5.6 */
  it('resolves each pubspec asset declaration to at least one real file', () => {
    const entries = declaredAssets();
    expect(entries, 'the pubspec `assets:` block was not found; the parser or the pubspec moved').not.toBeNull();
    expect(
      entries!.length,
      'no asset is declared at all. If that is genuinely intended, this canary is what has to ' +
        'change — but it exists so a parser that silently read nothing cannot make the ' +
        'assertion below pass for free.',
    ).toBeGreaterThan(0);

    const empty = entries!
      .map((entry) => ({ entry, resolved: resolveAssetEntry(entry) }))
      .filter(({ resolved }) => resolved.assets.length === 0)
      .map(({ entry, resolved }) => `pubspec.yaml:${entry.line} ${entry.value} (${resolved.kind})`);
    expect(
      empty,
      'Req 5.6: a declared directory that ships no asset bundles a placeholder into the binary ' +
        'for nothing — task 6.3 removed assets/images/ and assets/images/empty_states/ for ' +
        'exactly that. Either add the artwork and the widget that reads it, or remove the ' +
        'declaration. Note .gitkeep is not counted as an asset, deliberately.',
    ).toEqual([]);
  });
});

// ─── Build docs truthfulness (Req 11.2) ──────────────────────────────────────

describe('BUILD.md documents only commands that can run', () => {
  const docs = readFileSync(BUILD_DOCS_FILE, 'utf8');

  /** Validates: Requirements 11.2 */
  it('documents no ipa build while flutter_app/ios/ is absent', () => {
    if (existsSync(IOS_DIR)) {
      // An iOS platform folder exists, so Req 11.2's condition no longer holds and this
      // assertion deliberately does not fire. What it becomes then is a question for
      // whichever spec adds the folder.
      expect(statSync(IOS_DIR).isDirectory()).toBe(true);
      return;
    }
    expect(
      commandShapedIpaMentions(docs),
      'Req 11.2: there is no flutter_app/ios/, so a documented `flutter build ipa` is a command ' +
        'that cannot run against this tree at all — and the build host is Windows besides. ' +
        'Either remove the command or add the platform folder; describing what iOS WOULD ' +
        'require is fine and is not matched here.',
    ).toEqual([]);
  });

  /** Validates: Requirements 2.3, 2.6 */
  it('keeps the Release signing heading that Gradle and key.properties.example point at', () => {
    expect(
      /^#{1,6}[ \t]+Release signing[ \t]*$/m.test(docs),
      'build.gradle.kts names "BUILD.md > Release signing" in the GradleException a developer ' +
        'sees when key.properties is missing, and key.properties.example points at it too. ' +
        'Renaming the heading makes both dangling at the exact moment someone is lost. Rename ' +
        'the pointers in the same change, or leave the heading alone.',
    ).toBe(true);
  });
});
