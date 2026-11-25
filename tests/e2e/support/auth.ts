// tests/e2e/support/auth.ts
//
// Keeping a stored session usable for the length of a full run.
//
// THE PROBLEM. `auth.setup.ts` signs each seeded member in once and saves a cookie
// jar. Specs load that jar instead of re-submitting the sign-in form a hundred
// times, which is the right trade — but the jar is a SNAPSHOT of a rotating
// credential. This project has `refresh_token_rotation_enabled = true` with a
// `security_refresh_token_reuse_interval` of 10 seconds (read from the project's auth
// config). When `@supabase/ssr` refreshes, the used refresh token is retired and its
// replacement is written to that ONE browser context — the file on disk still holds
// the old one. Every later context replays the retired token, and a replay outside
// the 10-second window is treated as theft, which revokes the whole token family.
//
// The symptom is nasty because it is time-dependent rather than logical: nineteen
// tests across six files failed in a ~15 minute full run and every one of those files
// passed on its own, because a per-file run re-authenticates seconds beforehand. It
// cost two wrong diagnoses — `next dev` degrading under load (disproved: identical
// failures against a production build) and a sign-out test revoking the shared
// session (disproved: fixing it changed nothing).
//
// THE FIX is not to explain every revocation but to stop depending on the jar staying
// valid. `ensureFreshSession` checks it and re-signs-in if it has gone stale,
// rewriting the file. Cheap when the jar is good (one navigation), self-healing when
// it is not, and it covers every cause — rotation, expiry, an accidental sign-out, a
// member deleted and reseeded.

import { existsSync, mkdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { AUX_PERSONAS, appServerUrl, storageStatePath, type AppServer, type SeedUser } from './users';

const SESSION_FRESH_TTL_MS = 15_000;
const inflightSessionChecks = new Map<string, Promise<void>>();

async function writeStorageStateAtomic(
  context: { storageState: (opts?: { path?: string }) => Promise<unknown> },
  statePath: string,
): Promise<void> {
  const state = await context.storageState();
  mkdirSync(path.dirname(statePath), { recursive: true });
  const payload = JSON.stringify(state, null, 2);
  const tmpPath = `${statePath}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  writeFileSync(tmpPath, payload, 'utf8');
  try {
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        renameSync(tmpPath, statePath);
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code;
        if ((code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') && attempt < 5) {
          await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
          continue;
        }
        if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
          writeFileSync(statePath, payload, 'utf8');
          return;
        }
        throw err;
      }
    }
  } finally {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // ignore temp cleanup failure
    }
  }
}

/**
 * Where a successful sign-in lands.
 *
 * `AuthForm`'s `DEFAULT_DESTINATION` is `/` — the catalog moved off `/listings`,
 * and `next.config.ts` now permanently redirects the old path — or `/onboarding`
 * when the member has not finished it. Every sign-in assertion in the suite
 * shares this, so the next move costs one edit rather than a scavenger hunt.
 *
 * A pathname predicate rather than a regex on the whole URL: `/` as a substring
 * matches everything, and matching the bare origin as a string would bake the
 * suite's port into the assertion.
 */
export function isSignedInDestination(url: URL): boolean {
  return url.pathname === '/' || url.pathname.startsWith('/onboarding');
}

/**
 * Make sure the stored cookie jar for `user` still authenticates, re-signing in if
 * it does not.
 *
 * Call from `test.beforeAll` in any spec that authenticates from a stored jar. It
 * rewrites `playwright/.auth/<user>.json`, so contexts created afterwards — whether
 * by `test.use({ storageState })` or `browser.newContext` — pick up the repair.
 *
 * `/profile` is the probe because it is protected, cheap, and has no side effects;
 * middleware bounces an unauthenticated visitor to `/sign-in`, which is the whole
 * signal needed.
 */
export async function ensureFreshSession(
  browser: Browser,
  user: SeedUser,
  options: FreshSessionOptions = {},
): Promise<void> {
  const server = options.server ?? 'main';
  const statePath = storageStatePath(user, server);
  const key = `${server}:${user.id}`;

  const existing = inflightSessionChecks.get(key);
  if (existing) return existing;

  if (process.env.E2E_FORCE_SESSION_PROBE !== '1') {
    try {
      const mtime = statSync(statePath).mtimeMs;
      if (Date.now() - mtime < SESSION_FRESH_TTL_MS) return;
    } catch {
      // File missing or unreadable: fall through to probe/sign-in.
    }
  }

  const run = (async () => {
    // The main server's jar keeps its old behaviour exactly: the project's baseURL and
    // no extra headers. The aux server is addressed explicitly, because a desktop or
    // phone project's baseURL is the main server, and signs in from an address of its
    // own so a repair never spends another caller's limiter budget.
    const forwardedFor = options.forwardedFor ?? (server === 'aux' ? auxSignInAddress(user) : undefined);
    const context = await browser.newContext({
      storageState: statePath,
      ...(server === 'aux' ? { baseURL: appServerUrl('aux') } : {}),
      ...(forwardedFor ? { extraHTTPHeaders: { 'x-forwarded-for': forwardedFor } } : {}),
    });
    const page = await context.newPage();
    try {
      await page.goto('/profile');
      if (!/\/sign-in/.test(page.url())) {
        // Still good. Re-save atomically so this context's freshly rotated token replaces
        // the retired one on disk, which is what stops the next context replaying it.
        await writeStorageStateAtomic(context, statePath);
        return;
      }

      // Stale — sign in again and overwrite the jar atomically.
      await signInThroughForm(page, user);

      await writeStorageStateAtomic(context, statePath);
    } finally {
      await context.close();
    }
  })().finally(() => {
    inflightSessionChecks.delete(key);
  });

  inflightSessionChecks.set(key, run);
  return run;
}

/** Options for {@link ensureFreshSession}. */
export interface FreshSessionOptions {
  /** Which App_Server's jar to check. Defaults to `main` (`playwright/.auth/<name>.json`). */
  server?: AppServer;
  /**
   * The `x-forwarded-for` a repair signs in from. On the aux server it defaults to the
   * member's setup address in {@link AUX_PERSONAS} (203.0.113.200 upwards), so a
   * repair spends the same limiter bucket setup did and never a Pathway's.
   */
  forwardedFor?: string;
}

/** The aux sign-in address setup used for `user`, if it is an aux persona. */
function auxSignInAddress(user: SeedUser): string | undefined {
  return AUX_PERSONAS.find((persona) => persona.user.id === user.id)?.signInAddress;
}

/**
 * Sign `user` in through the real AuthForm on the page's server and wait for the
 * signed-in destination. The page's context then holds the session; save it with
 * `context.storageState()` if it should outlive the context.
 *
 * Shared by {@link ensureFreshSession}'s repair path and the audit's Persona sign-in
 * (`audit/members.ts`), which has no stored jar to repair.
 */
export async function signInThroughForm(page: Page, user: Pick<SeedUser, 'email' | 'password'>): Promise<void> {
  await page.goto('/sign-in');
  // Wait for scripts: the submit is a JS handler and the button is disabled until
  // the form hydrates (see F15).
  await page.waitForLoadState('load');
  const emailField = page.getByLabel('Email');
  await expect(emailField).toBeEditable({ timeout: 15_000 });
  await emailField.fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill(user.password);

  // THE REPAIR PATH IS RATE LIMITED TOO, and it is the one place that hurts most.
  //
  // `authLimiter` (lib/rateLimiters.ts) allows 5 attempts per minute keyed by IP
  // when nobody is signed in yet. This helper runs from `beforeAll` in most spec
  // files, so under `fullyParallel` several workers repair several members at the
  // same moment and trip it — and then the repair itself fails, leaving exactly the
  // stale jar it exists to fix. The spec carries on and its next context loads a
  // signed-out page, which surfaces far away as a missing control: `ensureSavedCard`
  // waiting forever for "Buy now" on a listing page rendered for a guest.
  //
  // `playwright.config.ts` raises the limit to 100/min for the suite's own server
  // (`AUTH_RATE_LIMIT_PER_MINUTE`), so this cooldown should never fire. It stays as
  // the backstop for a run against a server that does not carry that override —
  // recognising the limiter's own message and backing off past its window, rather
  // than widening the limit for everyone.
  const rateLimited = page.getByRole('alert').filter({ hasText: /too many attempts/i });

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await page.getByRole('button', { name: 'Sign in' }).click();

    // Via `isSignedInDestination`, NOT a regex on the path. The catalog moved to
    // `/` and `next.config.ts` permanently redirects `/listings`, so the old
    // `/\/(listings|onboarding)/` test never matches a successful sign-in any
    // more — the poll would sit on 'pending' until it timed out and report a
    // working sign-in as a failure.
    const signedIn = () => isSignedInDestination(new URL(page.url()));

    await expect
      .poll(
        async () =>
          signedIn()
            ? 'signed-in'
            : (await rateLimited.count()) > 0
              ? 'rate-limited'
              : 'pending',
        { timeout: 30_000 },
      )
      .not.toBe('pending');

    if (signedIn()) break;

    expect(
      attempt,
      `session repair for ${user.email} was rate limited twice — the cooldown did not help`,
    ).toBe(1);
    await page.waitForTimeout(65_000); // the limiter's 1m window, plus slack
  }

  await expect(page).toHaveURL(isSignedInDestination, { timeout: 30_000 });
}

/**
 * {@link ensureFreshSession} for several members, in sequence.
 *
 * Raises the calling hook's budget, because a repair may have to sit out the auth
 * limiter's one-minute window (see the loop above) and several members are repaired
 * one after another. At the default 90s a rate-limited repair would be killed
 * mid-cooldown and reported as the hook hanging.
 */
export async function ensureFreshSessions(
  browser: Browser,
  users: readonly SeedUser[],
): Promise<void> {
  test.setTimeout(90_000 + users.length * 100_000);

  await Promise.all(users.map((user) => ensureFreshSession(browser, user)));
}
