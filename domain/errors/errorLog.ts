// domain/errors/errorLog.ts
//
// The pure half of error logging (0123): what an `error_logs` row may contain, how it
// is grouped, and which failures are a guard doing its job rather than a breakage.
// The server-only writer in `lib/errors/errorLog.ts` applies these and does the insert.
//
// Pure, so every rule here runs in the Node-only Vitest project without a database:
// the bounds mirror the table's CHECK constraints, and the fingerprint has to be
// stable across deploys or a fixed error would reopen as a "new" group every release.

import { OPAQUE_CHILD_OF, toRouteTemplate } from '../analytics/uxEvent';

/** Where a row came from. Mirrors `cardtrade.error_log_source`. */
export type ErrorLogSource = 'SERVER' | 'CLIENT' | 'ACTION' | 'BACKGROUND' | 'REPORT';

/** Column bounds, mirroring the CHECK constraints in 0123. */
export const ERROR_MESSAGE_MAX = 2000;
export const ERROR_STACK_MAX = 8000;
export const ERROR_NOTE_MAX = 2000;
export const ERROR_PATH_MAX = 512;
const NAME_MAX = 128;
const CODE_MAX = 64;
const CONTEXT_MAX_KEYS = 12;
const CONTEXT_STRING_MAX = 120;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

// ---------------------------------------------------------------------------
// Field normalisers — each returns null rather than a value the column would refuse
// ---------------------------------------------------------------------------

/** Trim and cap free text; empty becomes null. */
export function boundText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed.slice(0, max);
}

/** A Next.js digest or a browser-minted id, or null if it is not that shape. */
export function normalizeReference(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(trimmed) ? trimmed : null;
}

/** An action or job name (`cashSale.initiateCashSale`, `job.cash-sale-payouts`). */
export function normalizeErrorName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/[^A-Za-z0-9_.:/-]+/g, '-').slice(0, NAME_MAX);
  return cleaned.length > 0 ? cleaned : null;
}

/** A machine error code (`STALE_TERMS`, `persistence-error`). */
export function normalizeErrorCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/[^A-Za-z0-9_.:-]+/g, '-').slice(0, CODE_MAX);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * A path fit to store: query string and hash dropped, invite tokens redacted.
 *
 * KEEPS UUIDS, unlike `toRouteTemplate`. Resolving an error usually starts with "which
 * sale", and an id is not sensitive in a table only admins can read. A `/t/<token>`
 * invite token is different: it is a capability, so it is redacted exactly as 0121
 * redacts it. Accepts an absolute URL (a `referer` header) and keeps only its path.
 */
export function sanitizeErrorPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let raw = value.trim();
  if (/^https?:\/\//i.test(raw)) {
    try {
      raw = new URL(raw).pathname;
    } catch {
      return null;
    }
  }
  if (!raw.startsWith('/')) return null;

  const path = raw.split(/[?#]/, 1)[0] ?? '';
  const segments = path.split('/');
  const redacted = segments.map((segment, index) => {
    const parent = index > 0 ? segments[index - 1] : '';
    return segment && parent && OPAQUE_CHILD_OF.includes(parent) ? '[token]' : segment;
  });
  const joined = redacted.join('/').slice(0, ERROR_PATH_MAX);
  return joined.length > 0 ? joined : '/';
}

// ---------------------------------------------------------------------------
// Context: identifiers only
// ---------------------------------------------------------------------------

type ContextValue = string | number | boolean;

/**
 * Keep a small object of identifiers and codes, dropping anything else.
 *
 * For background callers, which pass context explicitly (`{ cashSaleId, region }`).
 * Strings are capped short on purpose: this column is for ids, regions and codes, and
 * a long string is almost certainly prose that belongs nowhere near it.
 */
export function boundContext(value: unknown): Record<string, ContextValue> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const out: Record<string, ContextValue> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(out).length >= CONTEXT_MAX_KEYS) break;
    if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(key)) continue;
    if (typeof raw === 'string' && raw.length > 0 && raw.length <= CONTEXT_STRING_MAX) {
      out[key] = raw;
    } else if (typeof raw === 'number' && Number.isFinite(raw)) {
      out[key] = raw;
    } else if (typeof raw === 'boolean') {
      out[key] = raw;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Pull the identifiers out of a Server Action's arguments, and nothing else.
 *
 * WHY NOT STORE THE ARGUMENTS. They carry addresses, messages, notes and prices. What
 * resolving a failure needs is WHICH contract it was, so this keeps UUID-valued fields
 * whose key names an id (`cashSaleId`, `tradeId`, `id`), integer `…Version` fields
 * (which terms version was stale), and a bare UUID argument. Reads plain objects and
 * FormData, the two shapes an action receives.
 */
export function extractIdContext(args: readonly unknown[]): Record<string, ContextValue> | null {
  const out: Record<string, ContextValue> = {};
  const add = (key: string, value: ContextValue) => {
    if (Object.keys(out).length < CONTEXT_MAX_KEYS && !(key in out)) out[key] = value;
  };

  args.slice(0, 4).forEach((arg, index) => {
    if (typeof arg === 'string') {
      if (UUID.test(arg)) add(`arg${index}`, arg);
      return;
    }
    if (!arg || typeof arg !== 'object' || Array.isArray(arg)) return;

    const entries: Iterable<[string, unknown]> =
      typeof FormData !== 'undefined' && arg instanceof FormData
        ? (arg.entries() as Iterable<[string, unknown]>)
        : Object.entries(arg as Record<string, unknown>);

    let seen = 0;
    for (const [key, value] of entries) {
      if (++seen > 50) break;
      if (!/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(key)) continue;
      if (typeof value === 'string' && /(^id$|Id$|_id$)/.test(key) && UUID.test(value)) {
        add(key, value);
      } else if (typeof value === 'number' && Number.isInteger(value) && /Version$/.test(key)) {
        add(key, value);
      }
    }
  });

  return Object.keys(out).length > 0 ? out : null;
}

// ---------------------------------------------------------------------------
// Expected vs unexpected action failures
// ---------------------------------------------------------------------------

/**
 * Codes that mean a guard did its job. Normalised: lower case, `_` as `-`, because the
 * action layer spells the same idea both ways (`NOT_AUTHENTICATED`, `not-authenticated`).
 */
const EXPECTED_CODES = new Set([
  'unauthenticated',
  'unauthorized',
  'validation',
  'validation-error',
  'rate-limited',
  'stale',
  'stale-terms',
  'claimed',
  'revoked',
  'expired',
  'wrong-kind',
  'concurrent-modification',
  'nothing-to-refund',
  'money-in-flight',
  'side-unvalued',
  'duplicate-account',
  'demo-disabled',
  'email-not-confirmed',
  'account-banned',
  'buyer-no-payment-method',
  'seller-not-payable',
  'seller-fraud-banned',
  'item-not-available',
  'region-mismatch',
]);

/**
 * Whether a returned action failure is a guard doing its job (true) or a breakage
 * (false).
 *
 * UNRECOGNISED MEANS UNEXPECTED. A code this list has never seen is surfaced on the
 * console's default view rather than filed with the refusals, because the failure mode
 * worth finding is the one nobody anticipated. The patterns cover the conventions the
 * action layer already follows: `not-…`, `invalid-…`, `self-…` and `…-required` are
 * refusals, `…-failed` and `…-error` are breakages.
 */
export function isExpectedFailureCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const normalized = code.trim().toLowerCase().replace(/_/g, '-');
  if (EXPECTED_CODES.has(normalized)) return true;
  if (/(^|-)(failed|failure|error|errored|incomplete|unreadable)$/.test(normalized)) return false;
  if (/^(not-|invalid-|self-|already-|cannot-|no-)/.test(normalized)) return true;
  if (
    /-(not-found|required|unverified|mismatch|immutable|unavailable|not-available|limited|changed|confirmation-required)$/.test(
      normalized,
    )
  ) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Browser noise
// ---------------------------------------------------------------------------

/**
 * Whether a browser error is noise that nothing in this codebase can fix.
 *
 * Deliberately short. Each entry is a well-known false alarm: the ResizeObserver loop
 * warning browsers raise as an error, "Script error." from a cross-origin script that
 * hides its details, a request the page itself aborted, Next's own redirect and
 * not-found signals, and anything thrown entirely from a browser extension.
 */
export function isIgnorableClientError(input: {
  message?: string | null;
  stack?: string | null;
  filename?: string | null;
}): boolean {
  const message = (input.message ?? '').trim();
  const stack = (input.stack ?? '').trim();
  if (!message && !stack) return true;
  if (/^ResizeObserver loop/i.test(message)) return true;
  if (/^Script error\.?$/i.test(message) && !stack) return true;
  if (/NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK/.test(message)) return true;
  if (/^AbortError\b|The (operation|user) (was )?aborted/i.test(message)) return true;

  const where = `${input.filename ?? ''}\n${stack}`;
  if (/(chrome|moz|safari(-web)?)-extension:\/\//.test(where) && !/\/_next\//.test(where)) {
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

/**
 * Reduce a message to its shape: the first line, with ids, numbers and quoted values
 * replaced, so "Cannot find sale 3f…" and "Cannot find sale 9a…" group together.
 */
export function normalizeErrorMessage(message: string | null | undefined): string {
  const firstLine = (message ?? '').split('\n', 1)[0] ?? '';
  return firstLine
    .replace(UUID_ANYWHERE, ':id')
    .replace(/(["'`])(?:(?!\1).){0,200}\1/g, '…')
    .replace(/\b0x[0-9a-f]+\b/gi, 'N')
    .replace(/\d+/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/**
 * cyrb53: a fast, well-distributed 53-bit string hash. Not cryptographic, and does not
 * need to be: a fingerprint only has to group, and it is computed from values the
 * writer already holds.
 */
function cyrb53(value: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * The group key for a row: WHAT failed, never who or when.
 *
 * - ACTION: the action and its code. The message is left out because it often carries
 *   the specifics ("…for $12.00"), and one code from one action is one problem.
 * - BACKGROUND: the job and its code, or its normalised message when it has no code.
 * - SERVER / CLIENT: the route and the normalised message.
 * - REPORT: its reference. Only used when the error it points at was never captured;
 *   otherwise the writer copies that error's fingerprint.
 */
export function computeErrorFingerprint(input: {
  source: ErrorLogSource;
  name?: string | null;
  errorCode?: string | null;
  message?: string | null;
  path?: string | null;
  routePath?: string | null;
  reference?: string | null;
}): string {
  const route = input.routePath || toRouteTemplate(input.path) || '';
  let key: string;
  switch (input.source) {
    case 'ACTION':
      key = `ACTION|${input.name ?? ''}|${input.errorCode ?? ''}`;
      break;
    case 'BACKGROUND':
      key = `BACKGROUND|${input.name ?? ''}|${input.errorCode ?? normalizeErrorMessage(input.message)}`;
      break;
    case 'REPORT':
      key = `REPORT|${input.reference ?? ''}`;
      break;
    default:
      key = `${input.source}|${route}|${normalizeErrorMessage(input.message)}`;
  }
  return cyrb53(key).toString(36);
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/** What a caller hands the writer. Everything is untrusted and bounded here. */
export interface ErrorLogInput {
  source: ErrorLogSource;
  reference?: unknown;
  name?: unknown;
  errorCode?: unknown;
  message?: unknown;
  stack?: unknown;
  path?: unknown;
  routePath?: unknown;
  routeType?: unknown;
  method?: unknown;
  context?: unknown;
  note?: unknown;
  profileId?: string | null;
  /** Set only for a REPORT whose error was found: group it with that error. */
  fingerprint?: string | null;
}

/** A row that satisfies every constraint in 0123. */
export interface ErrorLogRecord {
  source: ErrorLogSource;
  fingerprint: string;
  expected: boolean;
  reference: string | null;
  name: string | null;
  errorCode: string | null;
  message: string | null;
  stack: string | null;
  path: string | null;
  routePath: string | null;
  routeType: string | null;
  method: string | null;
  context: Record<string, ContextValue> | null;
  note: string | null;
  profileId: string | null;
}

/**
 * Bound every field, fill what the table requires, and compute the group key.
 *
 * Never throws and never returns a row the constraints would reject: an ACTION or
 * BACKGROUND row missing its name or code gets a placeholder rather than being dropped,
 * because a failure recorded imperfectly is still worth more than one not recorded.
 */
export function buildErrorLogRecord(input: ErrorLogInput): ErrorLogRecord {
  const source = input.source;
  const reference = normalizeReference(input.reference);
  const path = sanitizeErrorPath(input.path);
  const routePath = boundText(input.routePath, ERROR_PATH_MAX);

  let name = normalizeErrorName(input.name);
  let errorCode = normalizeErrorCode(input.errorCode);
  if (source === 'ACTION') {
    name ??= 'unknown-action';
    errorCode ??= 'unknown';
  }
  if (source === 'BACKGROUND') name ??= 'unknown-job';

  const rawMessage = boundText(input.message, ERROR_MESSAGE_MAX);
  // Every non-report row must say what went wrong. An error with an empty message
  // still happened, so it is recorded as such.
  const message = source === 'REPORT' ? rawMessage : (rawMessage ?? '(no message)');

  const routeType =
    typeof input.routeType === 'string' && /^[a-z-]{1,32}$/.test(input.routeType)
      ? input.routeType
      : null;
  const method =
    typeof input.method === 'string' && /^[A-Za-z]{1,10}$/.test(input.method)
      ? input.method.toUpperCase()
      : null;

  const fingerprint =
    input.fingerprint && /^[0-9a-z]{1,32}$/.test(input.fingerprint)
      ? input.fingerprint
      : computeErrorFingerprint({ source, name, errorCode, message, path, routePath, reference });

  return {
    source,
    fingerprint,
    expected: source === 'ACTION' && isExpectedFailureCode(errorCode),
    reference,
    name,
    errorCode,
    message,
    stack: boundText(input.stack, ERROR_STACK_MAX),
    path,
    routePath,
    routeType,
    method,
    context: boundContext(input.context),
    note: boundText(input.note, ERROR_NOTE_MAX),
    profileId: input.profileId ?? null,
  };
}
