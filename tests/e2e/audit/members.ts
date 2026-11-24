// tests/e2e/audit/members.ts
//
// MEMBER CONTEXTS for the e2e UX audit suite (design, "Member contexts and video").
// A Pathway declares its members by role (`{ buyer: BOB, seller: ALICE }`), and this
// module turns each one into its own BrowserContext:
//
//   1. a fresh session: `ensureFreshSession` for a seed member (F14), `createPersona`
//      plus a form sign-in for a Persona, nothing for a guest;
//   2. a context at the project device, from that session, with `recordVideo` into the
//      Pathway's run directory and, on the aux server, a `x-forwarded-for` of its own
//      from 203.0.113.0/24 below `AUX_SIGN_IN_HOST_BASE`;
//   3. the Places stub, the Masker and the UX collectors, all installed BEFORE the first
//      page loads, so the first video frame is masked and the first document observed;
//   4. a label: the role name, carried by screenshots, observations, the console log
//      and the videos (`video.<member>.<n>.webm`).
//
// `instrumentContext` is the shared part of step 3. `support/fixtures.ts` applies it to
// the built-in context and to every context a spec opens with `browser.newContext`,
// so unmigrated specs get the same Masker, collectors and upload ledger.
//
// Requirements:
//   3.4   a Pathway needing a member state no seed member has creates a marked Persona
//   6.6   every context is labelled with its member, and every artifact carries it
//   29.2  one video per page each member opened, saved whether the Pathway passed or not
//   29.3  videos are recorded at the project's viewport
//   29.4  the Masker is installed before the first navigation of every member context

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Page,
  TestInfo,
} from '@playwright/test';

import { ensureFreshSession, signInThroughForm } from '../support/auth';
import { stubGooglePlaces } from '../support/places';
import { runId as currentRunId } from '../support/marker';
import {
  AUX_PERSONAS,
  AUX_SIGN_IN_HOST_BASE,
  SEED_CHECK_USERS,
  appServerUrl,
  isPersonaSpec,
  storageStatePath,
  type AppServer,
  type PathwayMember,
  type PersonaSpec,
  type SeedUser,
} from '../support/users';
import { createPersona, personaProfileRow, type CreatePersonaOptions, type Persona } from './backend/seed';
import {
  artifactPath,
  isMemberLabel,
  isPathwayId,
  runDirectory,
  type Viewport,
} from './core/artifactPaths';
import { installMasker, scrubberFor, type MaskerOptions } from './masker';
import { attachRuntime, installCollectors, type RuntimeCollector } from './ux';

/** The repository root: the base every `artifactPath` is relative to. */
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const LABELS = new WeakMap<BrowserContext, string>();

/** Labels `context` with its member (Req 6.6). */
export function labelContext(context: BrowserContext, member: string): void {
  LABELS.set(context, member);
}

/** The member a context belongs to, or null for a context nobody labelled. */
export function memberLabelOf(context: BrowserContext): string | null {
  return LABELS.get(context) ?? null;
}

// ---------------------------------------------------------------------------
// Aux-server addresses
// ---------------------------------------------------------------------------

/** The first host number member contexts use. `203.0.113.0` is the network address. */
export const AUX_MEMBER_HOST_MIN = 1;

/** Addresses each worker owns. A Pathway with more members than this reuses its block. */
export const AUX_MEMBER_SLOTS_PER_WORKER = 8;

/** How many workers get a block of their own before blocks are shared. */
export const AUX_MEMBER_WORKER_BLOCKS = Math.floor(
  (AUX_SIGN_IN_HOST_BASE - AUX_MEMBER_HOST_MIN) / AUX_MEMBER_SLOTS_PER_WORKER,
);

/**
 * The `x-forwarded-for` of a member context on the aux server: a TEST-NET-3 address
 * (RFC 5737) below `203.0.113.200`, the range setup signs in from, so a Pathway and
 * setup never share a limiter bucket. Each worker (`parallelIndex`) owns a block of
 * {@link AUX_MEMBER_SLOTS_PER_WORKER} hosts, so two concurrent Pathways never share one
 * either. Pure.
 *
 * @throws RangeError for a negative or non-integer index or slot
 */
export function auxMemberAddress(parallelIndex: number, slot: number): string {
  if (!Number.isSafeInteger(parallelIndex) || parallelIndex < 0) {
    throw new RangeError(`auxMemberAddress: invalid parallel index ${parallelIndex}`);
  }
  if (!Number.isSafeInteger(slot) || slot < 0) {
    throw new RangeError(`auxMemberAddress: invalid slot ${slot}`);
  }
  const block = parallelIndex % AUX_MEMBER_WORKER_BLOCKS;
  const host = AUX_MEMBER_HOST_MIN + block * AUX_MEMBER_SLOTS_PER_WORKER + (slot % AUX_MEMBER_SLOTS_PER_WORKER);
  return `203.0.113.${host}`;
}

/**
 * Rolls across a worker's block from one Pathway to the next, rather than restarting
 * at slot 0, so the member after the auth rate-limit Pathway (which spends its
 * address's whole budget on purpose) does not inherit an exhausted bucket.
 */
let nextAuxSlot = 0;

function takeAuxSlot(): number {
  const slot = nextAuxSlot;
  nextAuxSlot = (nextAuxSlot + 1) % AUX_MEMBER_SLOTS_PER_WORKER;
  return slot;
}

// ---------------------------------------------------------------------------
// The unpatched `newContext`
// ---------------------------------------------------------------------------

/**
 * Where `support/fixtures.ts` keeps the browser's own `newContext` while its patch is
 * installed. Member contexts are instrumented here, with their own label, video path
 * and ledger, so they must not pass through the patch as well (it would install a
 * second Masker and a second runtime collector).
 */
export const ORIGINAL_NEW_CONTEXT: unique symbol = Symbol.for('noditto.e2e-audit.originalNewContext');

type NewContext = Browser['newContext'];

/** The browser's own `newContext`, bypassing the fixture patch when it is installed. */
export function unpatchedNewContext(browser: Browser): NewContext {
  const original = (browser as Browser & { [ORIGINAL_NEW_CONTEXT]?: NewContext })[ORIGINAL_NEW_CONTEXT];
  return original ?? browser.newContext.bind(browser);
}

/** `browser`, with `newContext` replaced by the unpatched one. For helpers that take a Browser. */
function unpatchedBrowser(browser: Browser): Browser {
  const newContext = unpatchedNewContext(browser);
  return new Proxy(browser, {
    get(target, property) {
      if (property === 'newContext') return newContext;
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}

// ---------------------------------------------------------------------------
// Instrumentation
// ---------------------------------------------------------------------------

/**
 * Legal names every context masks: each seed member's (the seed sets
 * `identity_check_name` to the display name, as `playwright.config.ts` notes). Every
 * seed name, not only the Pathway's own members, because a counterparty's verified
 * name is disclosed on the contract pages.
 */
export const SEED_LEGAL_NAMES: readonly string[] = SEED_CHECK_USERS.map((user) => user.displayName);

/** Options for {@link instrumentContext}. */
export interface InstrumentOptions {
  /** The member label the context belongs to. */
  member: string;
  /** The App_Server origin, e.g. `http://localhost:3100`. */
  appOrigin: string;
  /** Full legal names to mask. Defaults to {@link SEED_LEGAL_NAMES}. */
  legalNames?: readonly string[];
  /** The upload ledger to record Storage writes in. Omit to keep none. */
  ledger?: { runId: string; pathwayId: string };
}

/** What {@link instrumentContext} installed. */
export interface Instrumentation {
  masker: MaskerOptions;
  runtime: RuntimeCollector;
}

/**
 * Installs, in order, the Places stub, the Masker and the UX collectors on `context`,
 * attaches the runtime collector, and labels the context. Call it before the context's
 * first page loads (Req 29.4): init scripts only reach documents created afterwards.
 * The runtime collector detaches itself when the context closes.
 */
export async function instrumentContext(context: BrowserContext, options: InstrumentOptions): Promise<Instrumentation> {
  const masker: MaskerOptions = { legalNames: [...(options.legalNames ?? SEED_LEGAL_NAMES)] };
  await stubGooglePlaces(context);
  await installMasker(context, masker);
  await installCollectors(context);
  const runtime = attachRuntime(context, {
    member: options.member,
    appOrigin: options.appOrigin,
    ...(options.ledger ? { ledger: options.ledger } : {}),
  });
  context.once('close', () => runtime.detach());
  labelContext(context, options.member);
  return { masker, runtime };
}

// ---------------------------------------------------------------------------
// Project defaults
// ---------------------------------------------------------------------------

/** The App_Server a project addresses: aux when its baseURL is the aux server's. */
export function serverForProject(testInfo: Pick<TestInfo, 'project'>): AppServer {
  return testInfo.project.use.baseURL === appServerUrl('aux') ? 'aux' : 'main';
}

/** The viewport profile of a project: `phone` for the phone projects, else `desktop`. */
export function viewportForProject(testInfo: Pick<TestInfo, 'project'>): Viewport {
  return testInfo.project.name.startsWith('phone') ? 'phone' : 'desktop';
}

/** The device options of a project (`use`), so a member context matches it exactly. */
function projectDeviceOptions(testInfo: Pick<TestInfo, 'project'>): BrowserContextOptions {
  const use = testInfo.project.use;
  const options: BrowserContextOptions = {};
  if (use.viewport !== undefined) options.viewport = use.viewport;
  if (use.userAgent !== undefined) options.userAgent = use.userAgent;
  if (use.deviceScaleFactor !== undefined) options.deviceScaleFactor = use.deviceScaleFactor;
  if (use.isMobile !== undefined) options.isMobile = use.isMobile;
  if (use.hasTouch !== undefined) options.hasTouch = use.hasTouch;
  if (use.locale !== undefined) options.locale = use.locale;
  if (use.timezoneId !== undefined) options.timezoneId = use.timezoneId;
  if (use.colorScheme !== undefined) options.colorScheme = use.colorScheme;
  return options;
}

/** The size videos are recorded at: the context's viewport, else Playwright's default. */
export function videoSize(viewport: BrowserContextOptions['viewport']): { width: number; height: number } {
  return viewport ? { width: viewport.width, height: viewport.height } : { width: 1280, height: 720 };
}

// ---------------------------------------------------------------------------
// Member contexts
// ---------------------------------------------------------------------------

/** A Pathway's members by role, e.g. `{ buyer: BOB, seller: ALICE, visitor: 'guest' }`. */
export type MemberDeclarations = Readonly<Record<string, PathwayMember>>;

/** One member's context and everything installed on it. */
export interface MemberContext {
  /** The role name, which labels every artifact (Req 6.6). */
  readonly label: string;
  readonly kind: 'seed' | 'persona' | 'guest';
  /** The account signed in, or null for a guest. A Persona is also a SeedUser. */
  readonly user: SeedUser | null;
  /** The created Persona, or null. */
  readonly persona: Persona | null;
  readonly server: AppServer;
  /** The App_Server origin, for the collectors' app-origin check. */
  readonly appOrigin: string;
  /** The `x-forwarded-for` the context sends (aux server only), else null. */
  readonly forwardedFor: string | null;
  readonly context: BrowserContext;
  readonly runtime: RuntimeCollector;
  /** Pass to `prepareScreenshot` / `checkMask`. */
  readonly masker: MaskerOptions;
  /** The member's first open page, opening one if there is none. */
  page(): Promise<Page>;
  /** Opens another page in the member's context. */
  newPage(): Promise<Page>;
  /** Every page the member opened, in order, including closed ones. */
  pages(): readonly Page[];
}

/** A video saved by {@link MemberSet.close}. */
export interface SavedVideo {
  member: string;
  /** 0-based, in the order the member's pages were opened. */
  n: number;
  /** Relative to the repository root, as `artifactPath` spells it. */
  path: string;
}

/** The open members of one Pathway run. */
export interface MemberSet {
  readonly members: Readonly<Record<string, MemberContext>>;
  /** Every legal name the Masker covers in this run's contexts. */
  readonly legalNames: readonly string[];
  /** The member labelled `label`. Throws for an undeclared label. */
  get(label: string): MemberContext;
  /**
   * Closes every context, then saves one video per page as `video.<member>.<n>.webm`
   * (Req 29.2) and the scrubbed console log as `console.<member>.jsonl`. Idempotent:
   * a second call returns the first call's videos.
   */
  close(): Promise<SavedVideo[]>;
}

/** Options for {@link openMembers}. */
export interface OpenMembersOptions {
  pathwayId: string;
  testInfo: TestInfo;
  /** Defaults to the project's server (`serverForProject`). */
  server?: AppServer;
  /** Defaults to the project's profile (`viewportForProject`). */
  viewport?: Viewport;
  /** Defaults to the current run id. */
  runId?: string;
  /** Extra context options for every member, applied under the ones this module sets. */
  contextOptions?: BrowserContextOptions;
  /** How to create each Persona, by member label. */
  personaOptions?: Readonly<Record<string, CreatePersonaOptions>>;
}

/** The verified legal name a Persona's profile carries, or null when it is unverified. Pure. */
export function personaLegalName(spec: PersonaSpec): string | null {
  const name = personaProfileRow(spec, '00000000-0000-0000-0000-000000000000', 'e2e@example.com').identity_check_name;
  return typeof name === 'string' ? name : null;
}

/** Validates a declaration's labels and members. Pure. */
export function validateMemberDeclarations(declared: MemberDeclarations): void {
  const labels = Object.keys(declared);
  if (labels.length === 0) throw new Error('openMembers: a Pathway declares at least one member');
  for (const label of labels) {
    if (!isMemberLabel(label)) {
      throw new RangeError(`openMembers: invalid member label ${JSON.stringify(label)} (lowercase word, hyphens allowed)`);
    }
  }
  const seen = new Map<string, string>();
  for (const [label, member] of Object.entries(declared)) {
    if (member === 'guest' || isPersonaSpec(member)) continue;
    const other = seen.get(member.id);
    if (other) {
      // One account in two contexts replays one rotating refresh token (F14).
      throw new Error(`openMembers: ${label} and ${other} are the same account (${member.email.split('@')[0]})`);
    }
    seen.set(member.id, label);
  }
}

function absolute(relative: string): string {
  return path.resolve(REPO_ROOT, relative);
}

/** A session state for an aux seed member, which only {@link AUX_PERSONAS} have. */
function requireAuxSession(user: SeedUser, label: string): void {
  if (!AUX_PERSONAS.some((persona) => persona.user.id === user.id)) {
    throw new Error(
      `openMembers: ${label} (${user.email.split('@')[0]}) has no aux-server session; ` +
        'add the member to AUX_PERSONAS in tests/e2e/support/users.ts so auth.setup.ts signs it in on port 3101',
    );
  }
}

type StorageState = Exclude<BrowserContextOptions['storageState'], string | undefined>;

/** Signs a Persona in on `server` in a throwaway, unrecorded context and returns its session. */
async function personaSession(
  browser: Browser,
  persona: Persona,
  server: AppServer,
  forwardedFor: string | null,
  device: BrowserContextOptions,
): Promise<StorageState> {
  const context = await unpatchedNewContext(browser)({
    ...device,
    baseURL: appServerUrl(server),
    storageState: { cookies: [], origins: [] },
    ...(forwardedFor ? { extraHTTPHeaders: { 'x-forwarded-for': forwardedFor } } : {}),
  });
  try {
    const page = await context.newPage();
    await signInThroughForm(page, persona);
    return await context.storageState();
  } finally {
    await context.close();
  }
}

/**
 * Opens one context per declared member (design, "Member contexts and video"). Seed
 * members' jars are repaired first (`ensureFreshSession`), Personas are created and
 * signed in, guests get an empty session. Every context records video into the
 * Pathway's run directory at the project viewport and is fully instrumented before
 * this returns, i.e. before any page exists.
 *
 * On a failure part-way, the contexts already opened are closed (and their videos
 * kept) before the error is rethrown.
 */
export async function openMembers(
  browser: Browser,
  declared: MemberDeclarations,
  options: OpenMembersOptions,
): Promise<MemberSet> {
  validateMemberDeclarations(declared);
  if (!isPathwayId(options.pathwayId)) {
    throw new RangeError(`openMembers: invalid pathway id ${JSON.stringify(options.pathwayId)}`);
  }
  const testInfo = options.testInfo;
  const server = options.server ?? serverForProject(testInfo);
  const viewport = options.viewport ?? viewportForProject(testInfo);
  const run = options.runId ?? currentRunId();
  const appOrigin = appServerUrl(server);
  const runDir = runDirectory({ pathwayId: options.pathwayId, viewport, runId: run });
  const device: BrowserContextOptions = { ...projectDeviceOptions(testInfo), ...(options.contextOptions ?? {}) };
  const raw = unpatchedBrowser(browser);
  const newContext = unpatchedNewContext(browser);

  // 1. Sessions and addresses, before any recorded context exists.
  const prepared: Array<{
    label: string;
    kind: MemberContext['kind'];
    user: SeedUser | null;
    persona: Persona | null;
    forwardedFor: string | null;
  }> = [];
  for (const [label, member] of Object.entries(declared)) {
    const forwardedFor = server === 'aux' ? auxMemberAddress(testInfo.parallelIndex, takeAuxSlot()) : null;
    if (member === 'guest') {
      prepared.push({ label, kind: 'guest', user: null, persona: null, forwardedFor });
    } else if (isPersonaSpec(member)) {
      const persona = await createPersona(member, options.personaOptions?.[label]);
      prepared.push({ label, kind: 'persona', user: persona, persona, forwardedFor });
    } else {
      if (server === 'aux') requireAuxSession(member, label);
      await ensureFreshSession(raw, member, { server });
      prepared.push({ label, kind: 'seed', user: member, persona: null, forwardedFor });
    }
  }

  const legalNames = [
    ...new Set([
      ...SEED_LEGAL_NAMES,
      ...prepared.flatMap((m) => (m.persona ? [personaLegalName(m.persona.spec)].filter((n): n is string => !!n) : [])),
    ]),
  ];

  // 2–4. One recorded, instrumented, labelled context per member.
  const members: Record<string, MemberContext> = {};
  const opened: Array<{ label: string; context: BrowserContext; pages: Page[]; runtime: RuntimeCollector; rawDir: string }> = [];

  const closeAll = async (): Promise<SavedVideo[]> => {
    const saved: SavedVideo[] = [];
    const scrub = scrubberFor(process.env, { legalNames });
    for (const entry of opened) {
      await entry.context.close().catch(() => undefined);
      for (const [n, page] of entry.pages.entries()) {
        const video = page.video();
        if (!video) continue;
        const relative = artifactPath({ kind: 'video', pathwayId: options.pathwayId, viewport, runId: run, member: entry.label, n });
        try {
          await video.saveAs(absolute(relative));
          await video.delete();
          saved.push({ member: entry.label, n, path: relative });
        } catch {
          // A page closed before it painted a frame has no video file; nothing to keep.
        }
      }
      const log = entry.runtime.log();
      if (log.length > 0) {
        const relative = artifactPath({ kind: 'console', pathwayId: options.pathwayId, viewport, runId: run, member: entry.label });
        mkdirSync(path.dirname(absolute(relative)), { recursive: true });
        writeFileSync(absolute(relative), log.map((line) => scrub(JSON.stringify(line))).join('\n') + '\n', 'utf8');
      }
      rmSync(entry.rawDir, { recursive: true, force: true });
    }
    return saved;
  };

  try {
    for (const member of prepared) {
      const rawDir = absolute(`${runDir}/.video-raw/${member.label}`);
      mkdirSync(rawDir, { recursive: true });

      let storageState: BrowserContextOptions['storageState'];
      if (member.kind === 'guest') storageState = { cookies: [], origins: [] };
      else if (member.persona) storageState = await personaSession(browser, member.persona, server, member.forwardedFor, device);
      else storageState = storageStatePath(member.user as SeedUser, server);

      const extraHTTPHeaders = {
        ...(device.extraHTTPHeaders ?? {}),
        ...(member.forwardedFor ? { 'x-forwarded-for': member.forwardedFor } : {}),
      };
      const context = await newContext({
        ...device,
        baseURL: appOrigin,
        storageState,
        extraHTTPHeaders,
        recordVideo: { dir: rawDir, size: videoSize(device.viewport) },
      });
      const pages: Page[] = [];
      context.on('page', (page) => pages.push(page));
      const { masker, runtime } = await instrumentContext(context, {
        member: member.label,
        appOrigin,
        legalNames,
        ledger: { runId: run, pathwayId: options.pathwayId },
      });
      opened.push({ label: member.label, context, pages, runtime, rawDir });

      members[member.label] = {
        label: member.label,
        kind: member.kind,
        user: member.user,
        persona: member.persona,
        server,
        appOrigin,
        forwardedFor: member.forwardedFor,
        context,
        runtime,
        masker,
        async page() {
          return context.pages()[0] ?? (await context.newPage());
        },
        newPage() {
          return context.newPage();
        },
        pages() {
          return pages;
        },
      };
    }
  } catch (error) {
    await closeAll();
    throw error;
  }

  let closing: Promise<SavedVideo[]> | null = null;
  return {
    members,
    legalNames,
    get(label) {
      const member = members[label];
      if (!member) {
        throw new Error(`MemberSet: no member ${JSON.stringify(label)}; declared: ${Object.keys(members).join(', ')}`);
      }
      return member;
    },
    close() {
      closing ??= closeAll();
      return closing;
    },
  };
}
