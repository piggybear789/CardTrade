// tests/e2e/audit/ux/runtime.ts
//
// THE RUNTIME COLLECTOR: console errors, uncaught exceptions, failed and 5xx requests
// (Req 30.6), and the Storage upload ledger (Req 2.4). Unlike the other collectors this
// one lives on the Node side, as Playwright event listeners on a BrowserContext, so it
// sees every page and popup the context opens, and every frame inside them.
//
// Readings are raw (`RawObservation`); `uxPolicy.ts` classifies them, and its
// `BENIGN_CONSOLE` (moved there from `specs/screenshots.spec.ts`, re-exported below) is
// the ONLY console filter. A message on it is still written to the console log, so
// nothing the browser said is lost, but it never becomes an observation. The browser's
// "Failed to load resource" echo is not filtered but ROUTED to the network check that
// owns it (`RESOURCE_ECHO` below), so a 4xx is advisory there rather than a blocking
// console error, and a 5xx is reported once.
//
// Checks run only on app-origin pages (design, "UX checks"): an event on a page whose
// URL is not the App_Server's (Stripe's hosted onboarding, a 3-D Secure page) is logged
// but not observed. Within an app page, a third-party script's console error or a
// third-party request is still observed, and `uxPolicy.ts` makes it advisory.
//
// THE UPLOAD LEDGER. Every POST or PUT a page makes to `/storage/v1/object/<bucket>/<path>`
// (including the signed-upload form) is appended to
// `audit-artifacts/.uploads/<runId>.jsonl` as soon as the REQUEST is made, not when it
// succeeds: a crash between the two must not leave an object cleanup cannot name, and
// deleting a path that was never written is harmless. Cleanup deletes exact paths only.
//
// Messages are recorded as the browser gave them. The caller scrubs (`scrubberFor` in
// `masker.ts`) before anything is written to a report, an attachment or a log file.

import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import type { BrowserContext, ConsoleMessage, Page, Request, Response } from '@playwright/test';

import { artifactPath, parseStorageUploadUrl, type UploadLedgerEntry } from '../core/artifactPaths';
import { BENIGN_CONSOLE, isBenignConsole, type RawObservation } from '../core/uxPolicy';

export { BENIGN_CONSOLE, isBenignConsole };

/** The repository root: the base every `artifactPath` is relative to. */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

/**
 * `requestfailed` reasons that mean the CLIENT gave up on the request, not that it
 * failed: the App Router cancels an RSC fetch or a prefetch when a newer navigation
 * supersedes it, and a page unloading cancels its in-flight requests. Each engine
 * spells it differently. Kept as short as `BENIGN_CONSOLE`, for the same reason.
 */
export const CANCELLED_REQUEST_ERRORS: readonly string[] = [
  // Chromium
  'net::ERR_ABORTED',
  // Firefox
  'NS_BINDING_ABORTED',
  // WebKit
  'cancelled',
  'Load request cancelled',
];

/** True when a `requestfailed` reason is a client-side cancellation. */
export function isCancelledRequest(errorText: string): boolean {
  return CANCELLED_REQUEST_ERRORS.some((reason) => errorText === reason || errorText.startsWith(`${reason} `));
}

/**
 * The console line Chromium and WebKit print for every resource that failed to load.
 * It is the browser's ECHO of a network outcome, not a second defect: the network
 * listeners own that outcome. So an echo is never a `console` observation. A 5xx echo is
 * already a `network` observation from the response listener, and a `net::` echo from
 * the `requestfailed` listener; a 4xx echo becomes a `network` observation with its
 * status, which `uxPolicy.ts` makes advisory (a 4xx is often an expected answer, such
 * as PostgREST's 406 for `.single()` on zero rows). Every echo stays in the log.
 */
const RESOURCE_ECHO = /^Failed to load resource: (?:the server responded with a status of (\d{3})|net::)/;

/** One line of the console artifact (`console.<member>.jsonl`). Unscrubbed. */
export interface RuntimeLogEntry {
  at: string;
  kind: 'console' | 'pageerror' | 'requestfailed' | 'response';
  /** The console message type (`error`, `warning`, …), for `console` entries. */
  level?: string;
  pageUrl: string;
  message: string;
  sourceUrl?: string;
  requestUrl?: string;
  method?: string;
  status?: number;
  /** True when it was also raised as an observation. */
  observed: boolean;
}

/** Options for `attachRuntime`. */
export interface RuntimeOptions {
  /** The member label the context belongs to. */
  member: string;
  /** The App_Server origin, e.g. `http://localhost:3100`. */
  appOrigin: string;
  /**
   * Where to record Storage uploads. Omit to keep no ledger (a probe that writes nothing).
   * `file` overrides the ledger path, which is otherwise `artifactPath({ kind: 'uploads', runId })`.
   */
  ledger?: { runId: string; pathwayId: string; file?: string };
  /** Console message types that are recorded in the log. Default: every type. */
  logLevels?: readonly string[];
}

/** The collector `attachRuntime` returns. */
export interface RuntimeCollector {
  /** Observations since the last `take()`, oldest first; taking clears them. */
  take(): RawObservation[];
  /** Every entry since attachment, for the console artifact. */
  log(): readonly RuntimeLogEntry[];
  /** Storage objects recorded in the ledger since attachment. */
  uploads(): readonly UploadLedgerEntry[];
  /** Removes the listeners. Idempotent. */
  detach(): void;
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** The error message plus its stack, which is what turns a finding into a location. */
function errorText(error: Error): string {
  if (error.stack && error.stack.includes(error.message)) return error.stack;
  return `${error.message}\n${error.stack ?? '(no stack)'}`;
}

/**
 * Attaches the runtime collector to `context`: every page it has and every page it opens
 * from now on. Call it before the first page loads (`members.ts` does), so the first
 * document's errors are seen.
 */
export function attachRuntime(context: BrowserContext, options: RuntimeOptions): RuntimeCollector {
  const appOrigin = originOf(options.appOrigin);
  if (appOrigin === null) throw new Error(`attachRuntime: appOrigin is not an absolute URL: ${options.appOrigin}`);

  const pending: RawObservation[] = [];
  const entries: RuntimeLogEntry[] = [];
  const recordedUploads: UploadLedgerEntry[] = [];
  const ledgerFile = options.ledger
    ? path.resolve(REPO_ROOT, options.ledger.file ?? artifactPath({ kind: 'uploads', runId: options.ledger.runId }))
    : null;
  const pageListeners = new Map<Page, Array<() => void>>();
  let detached = false;

  const isAppPage = (pageUrl: string): boolean => originOf(pageUrl) === appOrigin;
  const pageUrlOf = (page: Page | null): string => {
    try {
      return page?.url() ?? '';
    } catch {
      return '';
    }
  };

  const log = (entry: Omit<RuntimeLogEntry, 'at'>): void => {
    if (entries.length < 5_000) entries.push({ at: new Date().toISOString(), ...entry });
  };

  const observe = (observation: RawObservation): void => {
    pending.push(observation);
  };

  const onConsole = (page: Page) => (message: ConsoleMessage): void => {
    const level = message.type();
    if (options.logLevels && !options.logLevels.includes(level)) return;
    const pageUrl = pageUrlOf(page);
    const text = message.text();
    const sourceUrl = message.location().url || undefined;
    const echo = RESOURCE_ECHO.exec(text);
    const echoStatus = echo?.[1] ? Number(echo[1]) : null;
    if (echo) {
      const observedEcho = level === 'error' && isAppPage(pageUrl) && echoStatus !== null && echoStatus < 500;
      log({ kind: 'console', level, pageUrl, message: text, sourceUrl, observed: observedEcho });
      if (!observedEcho) return;
      observe({
        check: 'network',
        member: options.member,
        url: pageUrl,
        message: `HTTP ${echoStatus}: ${sourceUrl ?? '(unknown resource)'}`,
        detail: { kind: 'response', status: echoStatus, ...(sourceUrl ? { requestUrl: sourceUrl } : {}) },
      });
      return;
    }
    const observed = level === 'error' && isAppPage(pageUrl) && !isBenignConsole(text);
    log({ kind: 'console', level, pageUrl, message: text, sourceUrl, observed });
    if (!observed) return;
    observe({
      check: 'console',
      member: options.member,
      url: pageUrl,
      message: `Console error: ${text}`,
      detail: { kind: 'console', ...(sourceUrl ? { sourceUrl } : {}) },
    });
  };

  const onPageError = (page: Page) => (error: Error): void => {
    const pageUrl = pageUrlOf(page);
    const text = errorText(error);
    const observed = isAppPage(pageUrl);
    log({ kind: 'pageerror', pageUrl, message: text, observed });
    if (!observed) return;
    observe({
      check: 'console',
      member: options.member,
      url: pageUrl,
      message: `Uncaught exception: ${text}`,
      detail: { kind: 'pageerror' },
    });
  };

  const onRequest = (request: Request): void => {
    if (!ledgerFile || !options.ledger) return;
    const object = parseStorageUploadUrl(request.url(), request.method());
    if (!object) return;
    const entry: UploadLedgerEntry = {
      runId: options.ledger.runId,
      bucket: object.bucket,
      path: object.path,
      member: options.member,
      pathwayId: options.ledger.pathwayId,
    };
    recordedUploads.push(entry);
    mkdirSync(path.dirname(ledgerFile), { recursive: true });
    appendFileSync(ledgerFile, `${JSON.stringify(entry)}\n`, 'utf8');
  };

  const onRequestFailed = (request: Request): void => {
    const reason = request.failure()?.errorText ?? 'failed';
    const page = request.frame()?.page() ?? null;
    const pageUrl = pageUrlOf(page);
    const observed = !isCancelledRequest(reason) && isAppPage(pageUrl);
    log({ kind: 'requestfailed', pageUrl, message: reason, requestUrl: request.url(), method: request.method(), observed });
    if (!observed) return;
    observe({
      check: 'network',
      member: options.member,
      url: pageUrl,
      message: `Request failed (${reason}): ${request.method()} ${request.url()}`,
      detail: { kind: 'requestfailed', requestUrl: request.url(), method: request.method(), error: reason },
    });
  };

  const onResponse = (response: Response): void => {
    const status = response.status();
    if (status < 500) return;
    const request = response.request();
    const page = request.frame()?.page() ?? null;
    const pageUrl = pageUrlOf(page);
    const observed = isAppPage(pageUrl);
    log({ kind: 'response', pageUrl, message: `${status} ${response.statusText()}`, requestUrl: request.url(), method: request.method(), status, observed });
    if (!observed) return;
    observe({
      check: 'network',
      member: options.member,
      url: pageUrl,
      message: `HTTP ${status}: ${request.method()} ${request.url()}`,
      detail: { kind: 'response', status, requestUrl: request.url(), method: request.method() },
    });
  };

  const attachPage = (page: Page): void => {
    if (detached || pageListeners.has(page)) return;
    const consoleListener = onConsole(page);
    const errorListener = onPageError(page);
    page.on('console', consoleListener);
    page.on('pageerror', errorListener);
    pageListeners.set(page, [
      () => page.off('console', consoleListener),
      () => page.off('pageerror', errorListener),
    ]);
  };

  context.pages().forEach(attachPage);
  context.on('page', attachPage);
  context.on('request', onRequest);
  context.on('requestfailed', onRequestFailed);
  context.on('response', onResponse);

  return {
    take() {
      return pending.splice(0, pending.length);
    },
    log() {
      return entries;
    },
    uploads() {
      return recordedUploads;
    },
    detach() {
      if (detached) return;
      detached = true;
      context.off('page', attachPage);
      context.off('request', onRequest);
      context.off('requestfailed', onRequestFailed);
      context.off('response', onResponse);
      for (const removers of pageListeners.values()) removers.forEach((remove) => remove());
      pageListeners.clear();
    },
  };
}
