// tests/e2e/audit/ux/index.ts
//
// One entry point over the UX collectors, for `members.ts` (install on each context
// before the first page loads) and the Pathway DSL (reset as a step starts, collect and
// classify when it ends).
//
//   installCollectors(context)       the init scripts: cls, skeleton, motion
//   attachRuntime(context, …)        console / pageerror / network / upload ledger (runtime.ts)
//   resetPageCollectors(page)        start of a step
//   collectPage(page, …)             end of a step: every in-page reading, axe and the
//                                    copy rules, as raw observations
//   finaliseObservations(raw, …)     scrub, classify (`uxPolicy.ts`), apply suppressions
//
// Every check runs only on a page whose origin is the App_Server's (design, "UX checks").

import type { BrowserContext, Page } from '@playwright/test';

import {
  applySuppressions,
  classifyObservations,
  type ClassifyContext,
  type Observation,
  type RawObservation,
  type Suppression,
} from '../core/uxPolicy';
import { checkPageCopy, type StepCopyDeclaration } from '../copy';
import { axeObservations, runAxe } from './axe';
import { clsInitScript, clsObservations, readShifts, resetShifts } from './cls';
import { motionInitScript, motionObservations, readAnimations, resetAnimations } from './motion';
import { overflowObservations, readOverflow } from './overflow';
import { readPlaceholders, resetPlaceholders, skeletonInitScript, skeletonObservations } from './skeleton';

export { attachRuntime, type RuntimeCollector, type RuntimeLogEntry, type RuntimeOptions } from './runtime';
export type { StepCopyDeclaration } from '../copy';

/** Installs the in-page collectors (layout shift, placeholders, motion) on `context`. */
export async function installCollectors(context: BrowserContext): Promise<void> {
  await context.addInitScript({ content: `${clsInitScript()}\n${skeletonInitScript()}\n${motionInitScript()}` });
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** Clears the page's step-scoped readings. Safe on a closed or non-app page. */
export async function resetPageCollectors(page: Page): Promise<void> {
  if (page.isClosed()) return;
  await Promise.all([resetShifts(page), resetPlaceholders(page), resetAnimations(page)]).catch(() => undefined);
}

/** Options for `collectPage`. */
export interface CollectPageOptions {
  member: string;
  appOrigin: string;
  /** The page URL to record, already scrubbed. Defaults to `page.url()`. */
  url?: string;
  copy?: StepCopyDeclaration;
  /** Run axe (Req 30.5). Default true. */
  axe?: boolean;
}

/** What one page contributed to a step. */
export interface PageCollection {
  /** False when the page was not on the app origin and nothing was judged. */
  judged: boolean;
  /** The step's cumulative layout shift, or null where the engine reports none. */
  cls: number | null;
  observations: RawObservation[];
}

/**
 * Reads every collector on `page` at the end of a step and returns raw observations
 * (Req 30.1–30.5, 31.1–31.5). The page's step-scoped readings are left in place; call
 * `resetPageCollectors` when the next step starts.
 */
export async function collectPage(page: Page, options: CollectPageOptions): Promise<PageCollection> {
  if (page.isClosed() || originOf(page.url()) !== originOf(options.appOrigin)) {
    return { judged: false, cls: null, observations: [] };
  }
  const where = { member: options.member, url: options.url ?? page.url() };
  const [shifts, overflow, placeholders, animations] = await Promise.all([
    readShifts(page),
    readOverflow(page),
    readPlaceholders(page),
    readAnimations(page),
  ]);
  const cls = clsObservations(shifts, where);
  const observations: RawObservation[] = [
    ...cls.observations,
    ...overflowObservations(overflow, where),
    ...skeletonObservations(placeholders, where),
    ...motionObservations(animations, where),
  ];
  if (options.axe !== false) {
    observations.push(...axeObservations(await runAxe(page, options.appOrigin), where));
  }
  observations.push(...(await checkPageCopy(page, { appOrigin: options.appOrigin, where, copy: options.copy })));
  return { judged: true, cls: cls.total, observations };
}

function scrubDetail(
  detail: RawObservation['detail'],
  scrub: (text: string) => string,
): RawObservation['detail'] {
  if (!detail) return detail;
  return Object.fromEntries(
    Object.entries(detail).map(([key, value]) => [key, typeof value === 'string' ? scrub(value) : value]),
  );
}

/**
 * Turns a step's raw observations into recorded ones (Req 30.6, 30.8, 30.9): scrubs the
 * URL, message and string details with `scrub`, classifies (dropping only
 * `BENIGN_CONSOLE` messages), and annotates those a declared suppression matches.
 * Classification reads the UNSCRUBBED URLs, so a scrubbed origin cannot turn an app
 * request into a third-party one.
 */
export function finaliseObservations(
  raw: readonly RawObservation[],
  options: { context: ClassifyContext; suppressions?: readonly Suppression[]; scrub?: (text: string) => string },
): Observation[] {
  const scrub = options.scrub ?? ((text: string) => text);
  const classified = classifyObservations(raw, options.context).map((observation) => ({
    ...observation,
    url: scrub(observation.url),
    message: scrub(observation.message),
    detail: scrubDetail(observation.detail, scrub),
  }));
  return applySuppressions(classified, options.suppressions ?? []);
}
