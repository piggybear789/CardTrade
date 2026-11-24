// tests/e2e/audit/pathway.ts
//
// THE PATHWAY DSL (design, "Pathway DSL"). A migrated spec declares each Pathway once:
//
//   pathway(
//     { id: 'cash-sale.pay.card-3ds', title: '…', area: 'cash-sale', kind: 'happy',
//       provider: 'stripe', members: { buyer: BOB, seller: ALICE }, viewports: 'both' },
//     async ({ step, simulated, arrange, assertState, refusal, forced }) => { … },
//   );
//
// Keep `id` as the FIRST key of an object literal written inline in the call:
// `pathwayUniverse.ts` finds Pathways by scanning the specs for `pathway({ id: '…'`.
//
// `pathway()` registers one Playwright test over `test` from `support/fixtures.ts`, so
// the Places stub and the instrumented `browser` stay automatic. Before the body runs it
// validates the declaration (`core/pathwayDeclaration.ts`), skips a viewport the Pathway
// does not run on with its recorded reason, and opens one labelled, recorded,
// instrumented context per declared member (`members` fixture, `audit/members.ts`).
//
// The primitives, each wrapped in `test.step` so the trace and the HTML report use the
// same names, and each recorded as one StepRecord in call order (Req 6.2):
//
//   step(name, member | member[], fn, opts?)   an action a member takes
//   simulated(name, { mechanism, reason? }, fn) the ONLY place `rewind`, a signed Stripe
//                                               or Ship24 fixture, a cron body or the mock
//                                               provider may be driven (Req 4.7)
//   arrange(name, fn)                           service-role setup no member could click to
//   assertState(name, { db?, ui, member, expect })  the type demands `ui` beside `db` (Req 6.7)
//   refusal(name, member, fn, { code?, message?, toastIn? })  Req 6.5, 30.7
//   forced(locator, reason, action)             the ONLY allowed `force: true` /
//                                               `dispatchEvent`, listed in the report (Req 34.4)
//
// After every member-facing primitive the DSL reads the collectors and the copy rules on
// every app-origin page of the members involved, screenshots each member's active page
// full-size (Masker coverage checked first, Req 32.2), and THEN raises the step's
// blocking observations as soft assertions, so the evidence exists before the Pathway
// fails (Req 30.8). On a throw it still screenshots, marks the step failed, and every
// later primitive is recorded as skipped. Console output is saved per member by
// `MemberSet.close()`; the Playwright trace (config `trace: 'retain-on-failure'`) is
// copied to the record's `tracePath` by the audit reporter, because the runner only
// writes it after the test ends.
//
// At the end, pass or fail, the member contexts are closed, one video per page is saved
// as `video.<member>.<n>.webm` (Req 29.2), and the scrubbed record is attached as
// `audit-pathway` for `audit/reporter.ts`.

import { mkdirSync } from 'node:fs';
import path from 'node:path';

import type { Locator, Page, TestInfo } from '@playwright/test';

import { expect, test } from '../support/fixtures';
import { runId as currentRunId } from '../support/marker';
import { appServerUrl, isPersonaSpec, isSeedUser, type PathwayMember } from '../support/users';
import { requireSeed } from './backend/seed';
import {
  buildStepRecords,
  SIM_MECHANISMS,
  type PathwayDeclaration,
  type PathwayRecord,
  type SimMechanism,
  type StepDraft,
  type StepRecord,
} from './core/aggregate';
import { artifactPath, type Viewport } from './core/artifactPaths';
import { dialogStabilityFinding, type Box } from './core/dialogStability';
import {
  assertValidDeclaration,
  mechanismAllowed,
  pathwayTags,
  recordDeclaration,
  type SuppressionInput,
} from './core/pathwayDeclaration';
import { isFailingObservation, type Observation, type RawObservation } from './core/uxPolicy';
import { clearMaskMarks, prepareScreenshot, scrubberFor } from './masker';
import {
  SEED_LEGAL_NAMES,
  viewportForProject,
  type MemberContext,
  type MemberDeclarations,
  type MemberSet,
  type OpenMembersOptions,
} from './members';
import { scrubDeep, PATHWAY_ATTACHMENT } from './reporter';
import { collectPage, finaliseObservations, resetPageCollectors, type StepCopyDeclaration } from './ux';

export { declarationProblems, pathwayTags } from './core/pathwayDeclaration';

/** The repository root: the base every `artifactPath` is relative to. */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

/** How long a state assertion polls by default before failing. */
export const ASSERT_STATE_TIMEOUT_MS = 30_000;

/** How long a refusal waits for its message or toast by default. */
export const REFUSAL_TIMEOUT_MS = 15_000;

/** The toaster's toast element (sonner). */
const TOAST_SELECTOR = '[data-sonner-toast]';

/** Longest error text a step record keeps. */
const MAX_ERROR_LENGTH = 4_000;

/** The colour codes `expect` puts in its messages. Built from a char code to keep the regex literal-free. */
const ANSI_COLOUR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

// ---------------------------------------------------------------------------
// Declaration
// ---------------------------------------------------------------------------

/** A Pathway as a spec declares it (design: `PathwayDeclaration`), typed by its members. */
export interface PathwaySpec<M extends MemberDeclarations>
  extends Omit<PathwayDeclaration, 'members' | 'suppress'> {
  members: M;
  /** A suppression's `url` may be written as a RegExp; the record stores its source. */
  suppress?: SuppressionInput[];
  /** How to create each Persona, by member label (`createPersona` options). */
  personaOptions?: OpenMembersOptions['personaOptions'];
  /** Extra context options for every member. */
  contextOptions?: OpenMembersOptions['contextOptions'];
  /** The test's timeout in ms. Defaults to the config's. */
  timeout?: number;
}

/** What a `step` checks besides the defaults. */
export interface StepOptions {
  /** Copy rules this step's pages must satisfy (design, "Copy rules"). */
  copy?: StepCopyDeclaration;
  /** Where money is shown, for `copy-currency` severity. Defaults from the URL. */
  moneySurface?: 'browse' | 'contract';
  /**
   * Run axe on this step's pages. Unset: once per route per member within the Pathway
   * (`routeKey`). `true` forces it on every step; `false` skips it.
   */
  axe?: boolean;
}

/** A state the member SEES; optionally also the database's (then `ui` is required). */
export type StateAssertion<L extends string, T> = {
  /** The member whose page `ui` reads, and who is screenshotted. */
  member: L;
  /** Reads what the member sees. Required whenever `db` is given (Req 6.7). */
  ui: (page: Page) => Promise<T>;
  /** Reads the database through the service role. */
  db?: () => Promise<T>;
  /** What both reads must equal (deep equality). */
  expect: T;
  /** How long each read is polled. Default {@link ASSERT_STATE_TIMEOUT_MS}. */
  timeout?: number;
};

/** What a refusal's action may report it observed, e.g. a mobile API's `error` field. */
export interface RefusalObserved {
  code?: string;
  message?: string;
}

/** What a refusal must show (Req 6.5): the code, the exact member-facing message, or both. */
export interface RefusalExpectation {
  /** The error code; the action must return it (`{ code }` or the code as a string). */
  code?: string;
  /** The exact member-facing message, which must be visible on the member's page. */
  message?: string;
  /**
   * The dialog the failing request ran in. The failure must arrive as a toast and the
   * dialog must not resize (Req 30.7). Read before the action and again after it.
   */
  toastIn?: (page: Page) => Locator;
  /**
   * Where a message shown WITHOUT a toast is read from, e.g. a dialog that opens as the
   * refusal (the in-room ID check). Searched alongside the alerts and toasts.
   */
  messageIn?: (page: Page) => Locator;
  /** How long to wait for the message and the toast. Default {@link REFUSAL_TIMEOUT_MS}. */
  timeout?: number;
}

/** The primitives a Pathway body receives. `L` is the declared member labels. */
export interface PathwayContext<L extends string> {
  /** The open member contexts. */
  members: MemberSet;
  /** A member's active page (its first page, opened when it has none). */
  page(member: L): Promise<Page>;
  testInfo: TestInfo;
  viewport: Viewport;
  step<T>(
    name: string,
    member: L | readonly L[],
    fn: (page: Page, pages: Readonly<Record<L, Page>>) => Promise<T>,
    options?: StepOptions,
  ): Promise<T>;
  simulated<T>(name: string, how: { mechanism: SimMechanism; reason?: string }, fn: () => Promise<T>): Promise<T>;
  arrange<T>(name: string, fn: () => Promise<T>): Promise<T>;
  assertState<T>(name: string, assertion: StateAssertion<L, T>): Promise<void>;
  refusal(
    name: string,
    member: L,
    fn: (page: Page) => Promise<RefusalObserved | string | void>,
    expectation: RefusalExpectation,
  ): Promise<void>;
  forced(locator: Locator, reason: string, action: (locator: Locator) => Promise<void>): Promise<void>;
}

/** Thrown by every primitive called after an earlier step failed. */
export class PathwayAbortedError extends Error {
  constructor(readonly step: string) {
    super(`Pathway aborted: "${step}" was skipped because an earlier step failed.`);
    this.name = 'PathwayAbortedError';
  }
}

/** How a member is described in the record. Never the account object: it holds a password. */
export function describeMember(member: unknown): string {
  const m = member as PathwayMember;
  if (m === 'guest') return 'guest';
  if (typeof m === 'object' && m !== null && isPersonaSpec(m)) return `persona:${m.label}`;
  if (typeof m === 'object' && m !== null && isSeedUser(m)) return `seed:${m.email.split('@')[0]}`;
  return 'unknown';
}

const declaredIds = new Set<string>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A UUID in a route, replaced so `/sales/<id>` is one route whatever the sale. */
const UUID_IN_PATH = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/**
 * The route a page is on, with its ids removed (`/sales/:id`). Axe runs once per route per
 * member within a Pathway; a later step on the same route is not audited again.
 */
export function routeKey(url: string): string {
  try {
    return new URL(url).pathname.replace(UUID_IN_PATH, ':id');
  } catch {
    return url;
  }
}

/**
 * What a page shows, for deciding whether a screenshot would repeat the last one: the URL
 * and a hash of the visible text. Two equal signatures mean the same picture. Null when the
 * page cannot be read (mid-navigation), so the caller captures anyway.
 */
async function pageSignature(page: Page): Promise<string | null> {
  try {
    return await page.evaluate(() => {
      const text = document.body?.innerText ?? '';
      let hash = 2166136261;
      for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return `${location.href}|${text.length}|${hash >>> 0}`;
    });
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const plain = text.replace(ANSI_COLOUR, '');
  return plain.length > MAX_ERROR_LENGTH ? `${plain.slice(0, MAX_ERROR_LENGTH)}…` : plain;
}

/** The member's open pages, oldest first. */
function openPages(member: MemberContext): Page[] {
  return member.context.pages().filter((page) => !page.isClosed());
}

/** The page a step's screenshot shows: the member's most recently opened open page. */
function activePage(member: MemberContext): Page | null {
  const pages = openPages(member);
  return pages.length > 0 ? pages[pages.length - 1] : null;
}

function asList<L extends string>(member: L | readonly L[]): L[] {
  return typeof member === 'string' ? [member] : [...member];
}

// ---------------------------------------------------------------------------
// pathway()
// ---------------------------------------------------------------------------

/**
 * Declares one Pathway as one Playwright test, tagged from its declaration (Req 35.3).
 * Throws at load time for an invalid or repeated declaration, so `--list` refuses it.
 */
export function pathway<const M extends MemberDeclarations>(
  spec: PathwaySpec<M>,
  body: (context: PathwayContext<keyof M & string>) => Promise<void>,
): void {
  type L = keyof M & string;
  assertValidDeclaration(spec);
  if (declaredIds.has(spec.id)) throw new Error(`Pathway "${spec.id}" is declared twice.`);
  declaredIds.add(spec.id);

  const declaration = recordDeclaration(spec, describeMember);
  const suppressions = declaration.suppress ?? [];
  const server = spec.provider === 'mock' ? 'aux' : 'main';

  test(spec.title, { tag: pathwayTags(spec) }, async ({ members: roster }, testInfo) => {
    if (spec.timeout !== undefined) test.setTimeout(spec.timeout);
    const viewport = viewportForProject(testInfo);
    const run = currentRunId();
    const drafts: StepDraft[] = [];
    const forcedList: PathwayRecord['forced'] = [];
    let set: MemberSet | null = null;
    let aborted = false;
    let active: { index: number; name: string } | null = null;
    let scrub = scrubberFor(process.env, { legalNames: SEED_LEGAL_NAMES });

    const record = (videos: PathwayRecord['videos'], failed: boolean): PathwayRecord => {
      const steps: StepRecord[] = buildStepRecords(drafts);
      return {
        declaration,
        viewport,
        runId: run,
        // Provisional: the reporter decides the status from these steps, Playwright's
        // own status and the retry count.
        status: failed ? 'failed' : 'passed',
        retries: testInfo.retry,
        steps,
        videos,
        forced: forcedList,
        ...(failed && process.env.E2E_TRACE === '1'
          ? { tracePath: artifactPath({ kind: 'trace', pathwayId: spec.id, viewport, runId: run }) }
          : {}),
        paymentsMode: spec.provider === 'mock' ? 'mock' : 'stripe-test',
        simulated: steps.some((s) => s.kind === 'simulated'),
      };
    };

    const attach = async (value: PathwayRecord): Promise<void> => {
      await testInfo.attach(PATHWAY_ATTACHMENT, {
        body: JSON.stringify(scrubDeep(value, scrub)),
        contentType: 'application/json',
      });
    };

    // Viewport-specific Pathways skip the other profile with their reason (Req 29.1).
    if (spec.viewports !== 'both' && spec.viewports.only !== viewport) {
      await attach({ ...record([], false), status: 'skipped' });
      test.skip(true, `Runs on ${spec.viewports.only} only: ${spec.viewports.reason}`);
      return;
    }

    const members = (): MemberSet => {
      if (!set) throw new Error('Pathway members are not open.');
      return set;
    };
    const member = (label: string): MemberContext => members().get(label);

    // -- observation plumbing ------------------------------------------------

    const finalise = (raw: readonly RawObservation[], moneySurface?: StepOptions['moneySurface']): Observation[] =>
      finaliseObservations(raw, {
        context: { appOrigin: appServerUrl(server), ...(moneySurface ? { moneySurface } : {}) },
        suppressions,
        scrub,
      });

    /** Runtime readings (console, page errors, network) from every member since the last step. */
    const takeRuntime = (): RawObservation[] =>
      set ? Object.values(set.members).flatMap((m) => m.runtime.take()) : [];

    /** Each member's last capture in this Pathway: its page signature and file. */
    const lastCapture = new Map<string, { signature: string; path: string }>();
    /** The `member|route` pairs axe has already run on in this Pathway. */
    const axedRoutes = new Set<string>();

    const screenshot = async (label: string, index: number): Promise<{
      shot: { member: string; path: string } | null;
      raw: RawObservation | null;
    }> => {
      const m = member(label);
      const page = activePage(m);
      if (!page) return { shot: null, raw: null };
      // The same page as this member's last capture is the same picture: the step reuses
      // that file instead of capturing it again (Req 29.2 keeps a screenshot per step).
      const signature = await pageSignature(page);
      const previous = lastCapture.get(label);
      if (signature !== null && previous !== undefined && previous.signature === signature) {
        return { shot: { member: label, path: previous.path }, raw: null };
      }
      const relative = artifactPath({ kind: 'step-screenshot', pathwayId: spec.id, viewport, runId: run, step: index, member: label });
      const absolute = path.resolve(REPO_ROOT, relative);
      mkdirSync(path.dirname(absolute), { recursive: true });
      let raw: RawObservation | null = null;
      try {
        const prepared = await prepareScreenshot(page, { member: label }, m.masker);
        raw = prepared.observation;
        await page.screenshot({
          path: absolute,
          fullPage: true,
          mask: prepared.mask,
          maskColor: prepared.maskColor,
          animations: 'disabled',
          timeout: 15_000,
        });
        if (signature !== null) lastCapture.set(label, { signature, path: relative });
        return { shot: { member: label, path: relative }, raw };
      } catch (error) {
        // A page mid-navigation or closed by the step: no screenshot, the video still has it.
        console.warn(scrub(`pathway ${spec.id}: no screenshot for ${label} at step ${index}: ${errorMessage(error)}`));
        return { shot: null, raw };
      } finally {
        await clearMaskMarks(page);
      }
    };

    /** Collectors, copy rules and screenshots for the members of a finished step. */
    const evidence = async (
      labels: readonly string[],
      index: number,
      options: StepOptions & { judge: boolean },
    ): Promise<{ screenshots: StepRecord['screenshots']; raw: RawObservation[] }> => {
      const raw: RawObservation[] = [];
      const screenshots: StepRecord['screenshots'] = [];
      for (const label of labels) {
        const m = member(label);
        if (options.judge) {
          for (const page of openPages(m)) {
            try {
              // Axe runs once per route per member in this Pathway (an accessibility scan
              // of an unchanged route teaches nothing new). A step that declares `axe`
              // overrides that either way.
              const route = `${label}|${routeKey(page.url())}`;
              const runAxe = options.axe ?? !axedRoutes.has(route);
              if (runAxe) axedRoutes.add(route);
              const collected = await collectPage(page, {
                member: label,
                appOrigin: m.appOrigin,
                url: scrub(page.url()),
                ...(options.copy ? { copy: options.copy } : {}),
                axe: runAxe,
              });
              raw.push(...collected.observations);
            } catch (error) {
              console.warn(scrub(`pathway ${spec.id}: collectors failed for ${label} at step ${index}: ${errorMessage(error)}`));
            }
          }
        }
        const { shot, raw: unmasked } = await screenshot(label, index);
        if (shot) screenshots.push(shot);
        if (unmasked) raw.push(unmasked);
      }
      return { screenshots, raw };
    };

    /** Raises a finished step's failing observations, AFTER its screenshots exist (Req 30.8). */
    const raiseBlocking = (name: string, index: number, observations: readonly Observation[]): void => {
      const failing = observations
        .filter(isFailingObservation)
        .map((o) => {
          // The excerpt (copy rules) says WHERE on the page a figure or phrase is, which
          // the message alone does not; it was scrubbed with the rest of the observation.
          const excerpt = typeof o.detail?.excerpt === 'string' ? ` [in: "${o.detail.excerpt}"]` : '';
          return `${o.check} (${o.member}) ${o.url}: ${o.message}${excerpt}`;
        });
      expect.soft(failing, `Blocking UX observations on step ${index} "${name}"`).toEqual([]);
    };

    // -- the step runner -----------------------------------------------------

    interface RunSpec<T> {
      name: string;
      kind: StepRecord['kind'];
      labels: readonly string[];
      simulated?: { mechanism: SimMechanism; reason?: string };
      options?: StepOptions;
      /** Collect UX observations and copy rules (member-facing steps). */
      judge: boolean;
      /** Screenshot the members' pages. */
      shoot: boolean;
      fn: () => Promise<T>;
      /** Extra raw observations the primitive gathered (the toast check). */
      extra?: () => RawObservation[];
    }

    const runStep = async <T>(spec_: RunSpec<T>): Promise<T> => {
      if (active) {
        throw new Error(`Pathway "${spec.id}": "${spec_.name}" was called inside step "${active.name}"; primitives do not nest.`);
      }
      const index = drafts.length + 1;
      const startedAt = new Date();
      const base: Omit<StepDraft, 'status' | 'durationMs' | 'screenshots' | 'observations'> = {
        name: spec_.name,
        kind: spec_.kind,
        ...(spec_.simulated ? { simulated: spec_.simulated } : {}),
        members: [...spec_.labels],
        startedAt: startedAt.toISOString(),
      };
      if (aborted) {
        drafts.push({ ...base, status: 'skipped', durationMs: 0, screenshots: [], observations: [] });
        throw new PathwayAbortedError(spec_.name);
      }

      active = { index, name: spec_.name };
      try {
        for (const label of spec_.labels) {
          for (const page of openPages(member(label))) await resetPageCollectors(page);
        }
        let failure: unknown = null;
        let value: T | undefined;
        await test.step(spec_.name, async () => {
          try {
            value = await spec_.fn();
          } catch (error) {
            failure = error;
          }
        });

        const ok = failure === null;
        const gathered = spec_.shoot
          ? await evidence(spec_.labels, index, { ...(spec_.options ?? {}), judge: spec_.judge && ok })
          : { screenshots: [], raw: [] };
        const raw = [...takeRuntime(), ...gathered.raw, ...(ok && spec_.extra ? spec_.extra() : [])];
        const observations = finalise(raw, spec_.options?.moneySurface);
        drafts.push({
          ...base,
          status: ok ? 'passed' : 'failed',
          durationMs: Date.now() - startedAt.getTime(),
          screenshots: gathered.screenshots,
          observations,
          ...(ok ? {} : { error: scrub(errorMessage(failure)) }),
        });
        if (!ok) {
          aborted = true;
          throw failure;
        }
        raiseBlocking(spec_.name, index, observations);
        return value as T;
      } finally {
        active = null;
      }
    };

    const pagesFor = async (labels: readonly string[]): Promise<Record<string, Page>> => {
      const pages: Record<string, Page> = {};
      for (const label of labels) pages[label] = await member(label).page();
      return pages;
    };

    // -- primitives ----------------------------------------------------------

    const context: PathwayContext<L> = {
      get members() {
        return members();
      },
      page: (label) => member(label).page(),
      testInfo,
      viewport,

      step(name, who, fn, options) {
        const labels = asList(who);
        if (labels.length === 0) throw new Error(`Pathway "${spec.id}": step "${name}" names no member.`);
        return runStep({
          name,
          kind: 'action',
          labels,
          options,
          judge: true,
          shoot: true,
          fn: async () => {
            const pages = (await pagesFor(labels)) as Record<L, Page>;
            return fn(pages[labels[0]], pages);
          },
        });
      },

      simulated(name, how, fn) {
        if (!(SIM_MECHANISMS as readonly string[]).includes(how.mechanism)) {
          throw new Error(`Pathway "${spec.id}": simulated step "${name}" has an unknown mechanism ${JSON.stringify(how.mechanism)}.`);
        }
        if (!mechanismAllowed(how.mechanism, spec.provider)) {
          throw new Error(`Pathway "${spec.id}": "${name}" uses the mock provider, which needs provider "mock" and a mockReason.`);
        }
        return runStep({
          name,
          kind: 'simulated',
          labels: [],
          simulated: how.reason === undefined ? { mechanism: how.mechanism } : { mechanism: how.mechanism, reason: how.reason },
          judge: false,
          shoot: false,
          fn,
        });
      },

      arrange(name, fn) {
        return runStep({ name, kind: 'arrange', labels: [], judge: false, shoot: false, fn });
      },

      async assertState(name, assertion) {
        const timeout = assertion.timeout ?? ASSERT_STATE_TIMEOUT_MS;
        await runStep({
          name,
          kind: 'assert',
          labels: [assertion.member],
          judge: true,
          shoot: true,
          fn: async () => {
            const page = await member(assertion.member).page();
            if (assertion.db) {
              await expect.poll(assertion.db, { message: `${name}: database state`, timeout }).toEqual(assertion.expect);
            }
            await expect
              .poll(() => assertion.ui(page), { message: `${name}: what ${assertion.member} sees`, timeout })
              .toEqual(assertion.expect);
          },
        });
      },

      async refusal(name, who, fn, expectation) {
        if (expectation.code === undefined && expectation.message === undefined) {
          throw new Error(`Pathway "${spec.id}": refusal "${name}" must expect a code or an exact message (Req 6.5).`);
        }
        const timeout = expectation.timeout ?? REFUSAL_TIMEOUT_MS;
        const toast: RawObservation[] = [];
        await runStep({
          name,
          kind: 'assert',
          labels: [who],
          judge: true,
          shoot: true,
          extra: () => toast,
          fn: async () => {
            const page = await member(who).page();
            const dialog = expectation.toastIn?.(page) ?? null;
            let before: Box | null = null;
            if (dialog) {
              await expect(dialog, `${name}: the dialog is open before the request`).toBeVisible({ timeout });
              before = await dialog.boundingBox();
            }

            const returned = await fn(page);
            const observed: RefusalObserved = typeof returned === 'string' ? { code: returned } : (returned ?? {});

            if (expectation.code !== undefined) {
              expect(observed.code, `${name}: refusal code`).toBe(expectation.code);
            }
            if (expectation.message !== undefined) {
              if (observed.message !== undefined) {
                expect(observed.message, `${name}: refusal message`).toBe(expectation.message);
              } else {
                // The member sees a refusal in an alert (an inline validation message) or a
                // toast, and only visible copy counts: the same sentence can also sit hidden
                // elsewhere on the page (the listing's region notice).
                const alerts = page.locator(`[role="alert"], ${TOAST_SELECTOR}`);
                const scope = expectation.messageIn ? expectation.messageIn(page).or(alerts) : alerts;
                await expect(
                  scope
                    .getByText(expectation.message, { exact: true })
                    .filter({ visible: true })
                    .first(),
                  `${name}: the member sees the refusal message`,
                ).toBeVisible({ timeout });
              }
            }

            if (dialog && before) {
              const toastLocator = page.locator(TOAST_SELECTOR).first();
              const toastShown = await toastLocator
                .waitFor({ state: 'visible', timeout })
                .then(() => true, () => false);
              const after = (await dialog.boundingBox()) ?? { width: 0, height: 0 };
              const finding = dialogStabilityFinding(before, after, toastShown);
              if (finding) toast.push({ ...finding, member: who, url: scrub(page.url()) });
            }
          },
        });
      },

      async forced(locator, reason, action) {
        if (reason.trim() === '') throw new Error(`Pathway "${spec.id}": a forced interaction needs a written reason (Req 34.4).`);
        if (!active) {
          throw new Error(`Pathway "${spec.id}": forced() must be called inside a step, so the report can place it.`);
        }
        forcedList.push({ step: active.index, locator: scrub(String(locator)), reason });
        await action(locator);
      },
    };

    // -- run -----------------------------------------------------------------

    let failed = false;
    let videos: PathwayRecord['videos'] = [];
    try {
      set = await roster.open(spec.members, {
        pathwayId: spec.id,
        server,
        viewport,
        runId: run,
        ...(spec.personaOptions ? { personaOptions: spec.personaOptions } : {}),
        ...(spec.contextOptions ? { contextOptions: spec.contextOptions } : {}),
      });
      scrub = scrubberFor(process.env, { legalNames: set.legalNames });
      if (spec.requiresSeed?.length) {
        const names = spec.requiresSeed;
        await context.arrange(`Seed records present: ${names.join(', ')}`, () => requireSeed(names));
      }
      await body(context);
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      failed ||= drafts.some((d) => d.status === 'failed');
      if (set) {
        const saved = await set.close();
        // Suppressed or not, an uncovered region means the video showed it.
        const unmasked = new Set(
          drafts.flatMap((d) => d.observations).filter((o) => o.check === 'unmasked').map((o) => o.member),
        );
        videos = saved.map((v) => ({ member: v.member, path: v.path, masked: !unmasked.has(v.member) }));
      }
      await attach(record(videos, failed));
    }
  });
}
