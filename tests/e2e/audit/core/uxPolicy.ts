// tests/e2e/audit/core/uxPolicy.ts
//
// UX OBSERVATION POLICY for the e2e UX audit suite. Pure: no I/O, no Playwright, no
// `node:fs`, no network. The in-page collectors (`audit/ux/*`) and the copy rules hand
// their raw readings in here; this module decides whether each one is BLOCKING (fails
// the Pathway) or ADVISORY (shown in the report only), drops the console noise listed
// in `BENIGN_CONSOLE`, and annotates observations a Pathway's declared suppressions
// match.
//
// Requirements:
//   30.6  console errors, uncaught exceptions and failed or 5xx requests are recorded
//         (`BENIGN_CONSOLE` is the only filter, and every entry says why)
//   30.8  every UX_Observation is classified blocking or advisory; a blocking one fails
//         the Pathway (`aggregate.ts` `pathwayStatus` reads the class set here)
//   30.9  a suppression names the check, a URL pattern and a written reason, and the
//         suppressed observation is KEPT with that reason so the report can show it
//
// Default classes (design, "UX checks"):
//
//   cls, shift-outside-region, motion                      advisory
//   overflow, skeleton, toast, unmasked                    blocking
//   a11y        critical / serious blocking; moderate / minor advisory
//   console     pageerror and app-origin console errors blocking; third-party advisory
//   network     5xx and app-origin request failures blocking; 4xx and third-party advisory
//   copy-forbidden, -shopfront, -collateral, -fee          blocking
//   copy-currency  blocking in contract rooms and the Pay dialog, advisory elsewhere

/** Every UX check an observation can come from (design: `UxCheck`). */
export const UX_CHECKS = [
  'cls',
  'shift-outside-region',
  'overflow',
  'skeleton',
  'motion',
  'a11y',
  'console',
  'network',
  'toast',
  'copy-forbidden',
  'copy-currency',
  'copy-shopfront',
  'copy-collateral',
  'copy-fee',
  'unmasked',
] as const;

/** A UX check (design: `UxCheck`). */
export type UxCheck = (typeof UX_CHECKS)[number];

/** Blocking fails the Pathway (Req 30.8); advisory is shown in the report only. */
export type ObservationSeverity = 'blocking' | 'advisory';

/** One UX_Observation as recorded on a step (design: `Observation`). */
export interface Observation {
  check: UxCheck;
  severity: ObservationSeverity;
  member: string;
  /** Scrubbed by the caller. */
  url: string;
  /** Scrubbed by the caller. */
  message: string;
  detail?: Record<string, string | number>;
  /** The matching suppression's written reason, when one matched (Req 30.9). */
  suppressedBy?: string;
  source: 'automated' | 'reviewer';
}

/** A declared suppression: check, URL pattern (regex source) and reason (design: `Suppression`). */
export interface Suppression {
  check: UxCheck;
  /** Regular-expression SOURCE tested against the observation's URL. */
  url: string;
  reason: string;
}

/**
 * A collector's reading before it is classified: an `Observation` without its severity
 * or suppression. `detail` carries what the classifier reads:
 *
 * - `a11y`: `impact` (`critical` | `serious` | `moderate` | `minor`), as axe reports it
 * - `console`: `kind` (`console` | `pageerror`, default `console`) and optionally
 *   `sourceUrl`, the script that logged it
 * - `network`: `status` (the HTTP status; absent for a request that failed outright),
 *   `kind` (`response` | `requestfailed`) and optionally `requestUrl`
 */
export type RawObservation = Omit<Observation, 'severity' | 'suppressedBy' | 'source'> & {
  source?: Observation['source'];
};

/** What the classifier needs to know about where the step ran. */
export interface ClassifyContext {
  /** The App_Server origin, e.g. `http://localhost:3100`. Anything else is third-party. */
  appOrigin: string;
  /**
   * Where a money figure appeared, for `copy-currency`. `contract` (a contract room or
   * the Pay dialog) is blocking, `browse` (catalog tiles and the like) advisory. When
   * absent, a URL under `/sales/<id>` or `/trades/<id>` counts as a contract room.
   */
  moneySurface?: 'browse' | 'contract';
}

/**
 * Console messages that are the BROWSER's opinion rather than the app's defect, matched
 * as substrings of the message. Moved here from `specs/screenshots.spec.ts` so the
 * runtime collector and the classifier share one list.
 *
 * Kept short and specific on purpose: a noise filter that grows into a habit stops the
 * diagnostics being worth reading. Every entry needs to say why it is not a finding.
 */
export const BENIGN_CONSOLE: readonly string[] = [
  // WebKit does not implement `interactive-widget` in the viewport meta and says so
  // once per page load. The declaration is deliberate: it is how Chromium is told to
  // resize the layout rather than the visual viewport when the keyboard opens, and
  // Safari's default already matches what it asks for. It appeared on 40+ of the 54
  // mobile surfaces, which is exactly the volume that trains a reader to skip the field.
  'Viewport argument key "interactive-widget" not recognized',
  // Vercel Web Analytics and Speed Insights load `/_vercel/*/script.js`, which only the
  // Vercel platform serves. The harness runs `next start` locally, where those paths
  // 404 as text/plain and the browser refuses to execute them. A property of the
  // harness, not of the deployed app.
  "'http://localhost:3100/_vercel/insights/script.js' because its MIME type",
  "'http://localhost:3100/_vercel/speed-insights/script.js' because its MIME type",
  "'http://localhost:3101/_vercel/insights/script.js' because its MIME type",
  "'http://localhost:3101/_vercel/speed-insights/script.js' because its MIME type",
  // WebKit's wording of the same refusal.
  'Refused to execute http://localhost:3100/_vercel/insights/script.js as script',
  'Refused to execute http://localhost:3100/_vercel/speed-insights/script.js as script',
  'Refused to execute http://localhost:3101/_vercel/insights/script.js as script',
  'Refused to execute http://localhost:3101/_vercel/speed-insights/script.js as script',
  // Inline-style, stylesheet-hash and data:-image CSP violations cannot come from the
  // app's own document: next.config.ts sends `style-src 'self' 'unsafe-inline'` and an
  // `img-src` that allows `data:`, so the app's policy permits all three. They are the
  // policies of Stripe's iframes (Stripe.js's controller, Elements, the 3-D Secure and
  // hCaptcha frames), whose console Chromium reports on the parent page with no source
  // URL, so the third-party rule cannot see where they came from. If the app's CSP ever
  // drops 'unsafe-inline' or `data:`, remove these entries in the same change.
  'Applying inline style violates the following Content Security Policy directive',
  "Refused to apply a stylesheet because its hash, its nonce, or 'unsafe-inline' does not appear",
  "Loading the image 'data:image/",
  // WebKit prints this to the console / pageerror whenever an in-flight `fetch()` is
  // aborted by a page navigation (e.g. Next.js `<Link>` prefetch or Supabase unread
  // polling mid-flight during `router.push` / `page.goto`), equivalent to Chromium's
  // `net::ERR_ABORTED`. Next.js also logs the RSC payload fallback when that happens.
  'due to access control checks.',
  'Falling back to browser navigation. TypeError: Load failed',
  'Unhandled Promise Rejection: TypeError: Load failed',
  'TypeError: Load failed',
  // WebKit logs this when a page navigates away while Supabase Realtime is still opening its WebSocket.
  'WebSocket is closed before the connection is established.',
];

/** True when a console message is on the `BENIGN_CONSOLE` list. */
export function isBenignConsole(message: string): boolean {
  return BENIGN_CONSOLE.some((pattern) => message.includes(pattern));
}

/** Checks that are always blocking, whatever the detail. */
const ALWAYS_BLOCKING: ReadonlySet<UxCheck> = new Set<UxCheck>([
  'overflow',
  'skeleton',
  'toast',
  'unmasked',
  'copy-forbidden',
  'copy-shopfront',
  'copy-collateral',
  'copy-fee',
]);

/** Checks that are always advisory, whatever the detail. */
const ALWAYS_ADVISORY: ReadonlySet<UxCheck> = new Set<UxCheck>(['cls', 'shift-outside-region', 'motion']);

/** A contract room: `/sales/<id>` or `/trades/<id>`, which is where the Pay dialog lives. */
const CONTRACT_ROOM_PATH = /^\/(?:sales|trades)\/[^/?#]+/;

/** The origin of `url`, or null when it is not an absolute URL. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** The path of `url`, or null when it is not an absolute URL. */
function pathOf(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

/**
 * True when `url` is on the app's origin. A relative or missing URL counts as the app:
 * the checks only run on app-origin pages, so a message with no source came from one.
 */
function isAppOrigin(url: string | number | undefined, appOrigin: string): boolean {
  if (typeof url !== 'string' || url === '') return true;
  const origin = originOf(url);
  return origin === null || origin === originOf(appOrigin);
}

function a11ySeverity(detail: RawObservation['detail']): ObservationSeverity {
  const impact = String(detail?.impact ?? '').toLowerCase();
  if (impact === 'moderate' || impact === 'minor') return 'advisory';
  // `critical`, `serious`, and an impact axe did not report: a violation with no stated
  // impact is unexpected, so it surfaces as blocking rather than hiding as advisory.
  return 'blocking';
}

function consoleSeverity(detail: RawObservation['detail'], context: ClassifyContext): ObservationSeverity {
  if (detail?.kind === 'pageerror') return 'blocking';
  return isAppOrigin(detail?.sourceUrl, context.appOrigin) ? 'blocking' : 'advisory';
}

function networkSeverity(observation: RawObservation, context: ClassifyContext): ObservationSeverity {
  const status = observation.detail?.status;
  if (typeof status === 'number' && Number.isFinite(status)) {
    if (status >= 500) return 'blocking';
    if (status >= 400) return 'advisory';
  }
  // A request that failed outright (no status): the app's own requests matter, a
  // third-party beacon that a blocker or the test network dropped does not.
  const requestUrl = observation.detail?.requestUrl ?? observation.url;
  return isAppOrigin(requestUrl, context.appOrigin) ? 'blocking' : 'advisory';
}

function currencySeverity(observation: RawObservation, context: ClassifyContext): ObservationSeverity {
  if (context.moneySurface === 'contract') return 'blocking';
  if (context.moneySurface === 'browse') return 'advisory';
  const path = pathOf(observation.url) ?? observation.url;
  return CONTRACT_ROOM_PATH.test(path) ? 'blocking' : 'advisory';
}

/**
 * Classifies one raw reading (Req 30.8). Returns null for a console message on the
 * `BENIGN_CONSOLE` list, which is the only reading this function discards; every other
 * reading comes back as an `Observation` with its default class and `source`
 * `automated` unless the caller set it.
 *
 * @throws on a check outside `UX_CHECKS`: that is a collector bug, not a finding.
 */
export function classifyObservation(observation: RawObservation, context: ClassifyContext): Observation | null {
  const { check } = observation;
  if (!(UX_CHECKS as readonly string[]).includes(check)) {
    throw new Error(`classifyObservation: unknown UX check "${String(check)}".`);
  }
  if (check === 'console' && isBenignConsole(observation.message)) return null;

  let severity: ObservationSeverity;
  if (ALWAYS_BLOCKING.has(check)) severity = 'blocking';
  else if (ALWAYS_ADVISORY.has(check)) severity = 'advisory';
  else if (check === 'a11y') severity = a11ySeverity(observation.detail);
  else if (check === 'console') severity = consoleSeverity(observation.detail, context);
  else if (check === 'network') severity = networkSeverity(observation, context);
  else severity = currencySeverity(observation, context);

  return { ...observation, severity, source: observation.source ?? 'automated' };
}

/**
 * Classifies a batch of readings in order, dropping only `BENIGN_CONSOLE` messages.
 */
export function classifyObservations(
  observations: readonly RawObservation[],
  context: ClassifyContext,
): Observation[] {
  const out: Observation[] = [];
  for (const observation of observations) {
    const classified = classifyObservation(observation, context);
    if (classified) out.push(classified);
  }
  return out;
}

/**
 * Annotates the observations a Pathway's suppressions match (Req 30.9). An observation
 * is suppressed by the FIRST suppression with the same check whose URL pattern matches
 * its URL, and gains that suppression's reason as `suppressedBy`. Nothing is ever
 * dropped: the result has the same length and order as the input, and an observation
 * already carrying `suppressedBy` keeps it. Inputs are not mutated.
 *
 * @throws when a suppression's URL pattern is not a valid regular expression or its
 *   reason is blank: that is a broken Pathway declaration.
 */
export function applySuppressions(
  observations: readonly Observation[],
  suppressions: readonly Suppression[] = [],
): Observation[] {
  const compiled = suppressions.map((suppression) => {
    if (suppression.reason.trim() === '') {
      throw new Error(`applySuppressions: the suppression of "${suppression.check}" has no reason.`);
    }
    let pattern: RegExp;
    try {
      pattern = new RegExp(suppression.url);
    } catch {
      throw new Error(`applySuppressions: invalid URL pattern for "${suppression.check}": ${suppression.url}`);
    }
    return { check: suppression.check, pattern, reason: suppression.reason };
  });

  return observations.map((observation) => {
    if (observation.suppressedBy !== undefined) return { ...observation };
    const match = compiled.find(
      (suppression) => suppression.check === observation.check && suppression.pattern.test(observation.url),
    );
    return match ? { ...observation, suppressedBy: match.reason } : { ...observation };
  });
}

/** True when an observation fails its Pathway: blocking and not suppressed (Req 30.8). */
export function isFailingObservation(observation: Observation): boolean {
  return observation.severity === 'blocking' && observation.suppressedBy === undefined;
}
