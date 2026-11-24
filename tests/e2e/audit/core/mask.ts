// tests/e2e/audit/core/mask.ts
//
// THE MASKER'S RULES for the e2e UX audit suite. Pure: no I/O, no Playwright, no
// `node:fs`, no network. The callers (the in-page overlay and screenshot mask in
// `support/masker.ts`, console and network capture, the trace rewriter in
// `globalTeardown`, and `audit-report.ts`) hand text and paths in; this module only
// decides what is secret, what is personal and what may never be published.
//
// Requirements:
//   32.1  every env value whose name contains KEY, SECRET, TOKEN or PASSWORD is
//         replaced with a fixed placeholder in logs, traces and the report
//   32.2  on-screen emails, Stripe client secrets, invite tokens and full legal
//         names are found so screenshots and video can cover them
//   32.3  report generation scans every text artifact for those env values and
//         fails, naming the variable and never the value
//   32.4  `.env*` files and storage-state cookie jars never enter the report or
//         its archive
//
// Secret values never leave this module through `findLeaks`: it returns variable
// NAMES only.

import { maskEmail } from './preflight';

/** The fixed placeholder a secret value is replaced with (Req 32.1). */
export const MASK_PLACEHOLDER = '[MASKED]';

/** A variable is secret when its name contains one of these (case-insensitive). */
const SECRET_NAME = /KEY|SECRET|TOKEN|PASSWORD/i;

/** Shorter values are too likely to occur by chance (`true`, `mock`, a port). */
export const MIN_SECRET_LENGTH = 8;

/** Bounds the fixpoint loop in `scrubText`; real inputs settle in one or two passes. */
const MAX_SCRUB_PASSES = 16;

/** One secret variable: its name, and the value to look for. */
export interface SecretEntry {
  name: string;
  value: string;
}

/** What kind of personal value a PII range covers. */
export type PiiKind = 'email' | 'clientSecret' | 'inviteToken' | 'legalName';

/** A personal value found in text, as a half-open `[start, end)` range. */
export interface PiiRange {
  kind: PiiKind;
  start: number;
  end: number;
}

/** Optional PII handling for `scrubText` and the matcher. */
export interface PiiOptions {
  /** Full legal names of the run's members (seed names, personas' `identity_check_name`). */
  legalNames?: readonly string[];
}

/**
 * The on-screen PII patterns (Req 32.2). Each is global; copy it (`new RegExp(p.source,
 * p.flags)`) before `exec`-looping so shared `lastIndex` state cannot leak between calls.
 *
 * - `email`: an address with a dotted domain.
 * - `clientSecret`: a Stripe client secret, `<prefix>_<id>_secret_<suffix>`
 *   (`pi_…`, `seti_…`, `vs_…`).
 * - `inviteToken`: a private-deal invite, either the join path `/t/<token>` or the
 *   host page's `?link=<token>`; tokens are 16–64 URL-safe characters (0103).
 */
export const PII_PATTERNS: { email: RegExp; clientSecret: RegExp; inviteToken: RegExp } = {
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
  clientSecret: /\b[a-z]{2,6}_[A-Za-z0-9]+_secret_[A-Za-z0-9]+/g,
  inviteToken: /(?:\/t\/|[?&]link=)[A-Za-z0-9_-]{16,64}/g,
};

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Collects the secret variables in `env`: names containing KEY, SECRET, TOKEN or
 * PASSWORD with a value of at least `MIN_SECRET_LENGTH` characters. A padded value is
 * also listed trimmed, so either spelling is caught. Sorted longest value first, so a
 * secret that contains another is replaced whole.
 */
export function secretEntries(env: Record<string, string | undefined>): SecretEntry[] {
  const entries: SecretEntry[] = [];
  const seen = new Set<string>();
  for (const name of Object.keys(env).sort()) {
    const raw = env[name];
    if (raw === undefined || !SECRET_NAME.test(name)) continue;
    for (const value of new Set([raw, raw.trim()])) {
      const key = `${name}\u0000${value}`;
      if (value.length < MIN_SECRET_LENGTH || seen.has(key)) continue;
      seen.add(key);
      entries.push({ name, value });
    }
  }
  return entries.sort((a, b) => b.value.length - a.value.length || a.name.localeCompare(b.name));
}

/**
 * The secret VALUES in `env` (see `secretEntries`), de-duplicated, longest first
 * (Req 32.1). Pass the result to `scrubText`.
 */
export function secretValues(env: Record<string, string | undefined>): string[] {
  return [...new Set(secretEntries(env).map((entry) => entry.value))];
}

/**
 * Builds the on-screen PII matchers: the three fixed patterns plus, when legal names
 * are given, one for those names. The in-page overlay serialises their `source` and
 * `flags`, so every matcher is a plain global RegExp.
 */
export function piiMatchers(options: PiiOptions = {}): Array<{ kind: PiiKind; pattern: RegExp }> {
  const matchers: Array<{ kind: PiiKind; pattern: RegExp }> = [
    { kind: 'clientSecret', pattern: new RegExp(PII_PATTERNS.clientSecret.source, 'g') },
    { kind: 'inviteToken', pattern: new RegExp(PII_PATTERNS.inviteToken.source, 'g') },
    { kind: 'email', pattern: new RegExp(PII_PATTERNS.email.source, 'g') },
  ];
  const names = legalNameMatcher(options.legalNames ?? []);
  if (names) matchers.push({ kind: 'legalName', pattern: names });
  return matchers;
}

/**
 * A case-insensitive matcher for the run's full legal names, or `null` when there are
 * none. Whitespace between name parts matches any run of whitespace (a name wrapped
 * across lines is still found), and a name only matches as whole words, so "Ann Lee"
 * does not match inside "Joann Leeds". Blank names are ignored.
 */
export function legalNameMatcher(names: readonly string[]): RegExp | null {
  const parts = [...new Set(names.map((name) => name.trim()).filter((name) => name !== ''))]
    .sort((a, b) => b.length - a.length)
    .map((name) => name.split(/\s+/).map(escapeRegExp).join('\\s+'));
  if (parts.length === 0) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${parts.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
}

/**
 * Finds every personal value in `text` (Req 32.2): emails, Stripe client secrets,
 * invite tokens and the given legal names. Ranges are sorted by start and merged
 * where they overlap, so each character is covered at most once; the earlier
 * matcher's kind wins on overlap (client secret, invite, email, legal name).
 */
export function findPii(text: string, options: PiiOptions = {}): PiiRange[] {
  const found: PiiRange[] = [];
  for (const { kind, pattern } of piiMatchers(options)) {
    for (const match of text.matchAll(pattern)) {
      if (match[0] === '') continue;
      const start = match.index ?? 0;
      found.push({ kind, start, end: start + match[0].length });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: PiiRange[] = [];
  for (const range of found) {
    const last = merged[merged.length - 1];
    if (last && range.start < last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function replaceSecrets(text: string, secrets: readonly string[]): string {
  const values = [...new Set(secrets)]
    .filter((value) => value.length >= MIN_SECRET_LENGTH)
    .sort((a, b) => b.length - a.length);
  if (values.length === 0) return text;
  const pattern = new RegExp(values.map(escapeRegExp).join('|'), 'g');
  return text.replace(pattern, MASK_PLACEHOLDER);
}

function replacePii(text: string, options: PiiOptions): string {
  const ranges = findPii(text, options);
  if (ranges.length === 0) return text;
  let out = '';
  let cursor = 0;
  for (const range of ranges) {
    out += text.slice(cursor, range.start);
    const value = text.slice(range.start, range.end);
    // An email keeps its domain, which is what a reader needs to tell accounts apart.
    out += range.kind === 'email' ? maskEmail(value) : MASK_PLACEHOLDER;
    cursor = range.end;
  }
  return out + text.slice(cursor);
}

/**
 * Replaces every occurrence of each secret value with `[MASKED]` (Req 32.1). With
 * `pii`, it also masks emails (`a***@example.com`, via `maskEmail`), client secrets,
 * invite tokens and the given legal names. Idempotent: it repeats until nothing
 * changes, so a value formed across a placeholder's edge is caught too, and scrubbing
 * twice equals scrubbing once. Text containing nothing to mask is returned unchanged.
 * Values shorter than `MIN_SECRET_LENGTH` are ignored.
 */
export function scrubText(text: string, secrets: readonly string[], pii?: PiiOptions): string {
  let current = text;
  for (let pass = 0; pass < MAX_SCRUB_PASSES; pass += 1) {
    let next = replaceSecrets(current, secrets);
    if (pii) next = replacePii(next, pii);
    if (next === current) return current;
    current = next;
  }
  return current;
}

/**
 * Names every secret variable whose value occurs in `text` (Req 32.3). Accepts the
 * environment itself or its `secretEntries`. Returns sorted, de-duplicated variable
 * NAMES and never a value, so the report generator can fail naming the file and the
 * variable without printing the secret.
 */
export function findLeaks(
  text: string,
  secrets: readonly SecretEntry[] | Record<string, string | undefined>,
): string[] {
  const entries = Array.isArray(secrets)
    ? (secrets as readonly SecretEntry[])
    : secretEntries(secrets as Record<string, string | undefined>);
  const names = new Set<string>();
  for (const { name, value } of entries) {
    if (value.length >= MIN_SECRET_LENGTH && text.includes(value)) names.add(name);
  }
  return [...names].sort();
}

/**
 * True for a path that must never be copied into the report or its archive
 * (Req 32.4): any `.env` file (`.env`, `.env.local`, its backups), anything under a
 * `playwright/.auth/` directory, and any storage-state file (`*.storageState.json`,
 * `storage-state.json`, …). Either path separator, any directory prefix, any case.
 */
export function isForbiddenArtifact(relativePath: string): boolean {
  const segments = relativePath
    .replace(/\\/g, '/')
    .toLowerCase()
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');
  if (segments.length === 0) return false;
  if (segments.some((segment) => segment.startsWith('.env'))) return true;
  for (let i = 0; i < segments.length - 1; i += 1) {
    if (segments[i] === 'playwright' && segments[i + 1] === '.auth') return true;
  }
  const base = segments[segments.length - 1];
  return /storage[-_.]?state/.test(base);
}
