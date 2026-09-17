// tests/e2e/specs/screenshots.spec.ts
//
// A COMPREHENSIVE VISUAL SWEEP, not a functional test. It visits every user-facing
// surface once per Playwright project (desktop Chrome + mobile WebKit) and writes a
// full-page PNG to `ux-review/captures/`. The point is the artefacts: it exists to
// answer the question ux-audit-findings.md has been unable to answer since Round 1 —
// "how does any of this look rendered, on a phone or otherwise" — so a human can page
// through the images and file findings against the F#/R# backlog.
//
// WHY IT IS A SPEC AND NOT A STANDALONE SCRIPT. Everything a sweep needs already lives
// in this harness and nowhere else: the seeded sessions (auth.setup.ts), the rotated-
// token repair (ensureFreshSessions), the Google Places stub (fixtures.ts), the mock
// payment provider and the production server wiring (playwright.config.ts). Reusing
// the projects also gives desktop and mobile for free — the two viewports the review
// most needs to compare — under the same real WebKit engine several findings are
// specific to.
//
// IT DOES NOT ASSERT ON APPEARANCE. There is no golden image and no pixel diff: a
// sweep whose job is to surface unknown problems cannot know in advance what "correct"
// looks like. Each capture makes exactly one liveness assertion — that the surface
// rendered a heading rather than an error boundary — so a 500 fails loudly here
// instead of producing a screenshot of a crash that reads as "reviewed, fine". Layout
// judgement is left to the human looking at the images.
//
// NAMING: `<surface>.<project>.png`. The project suffix (`desktop` / `mobile`) is what
// keeps the two viewports from overwriting each other, and sorts them adjacent for
// side-by-side review.

import { test, expect } from '../support/fixtures';
import type { ConsoleMessage, Page, TestInfo } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  ALICE,
  BOB,
  FRANK_ADMIN,
  GRACE_SUPPORT,
  storageStatePath,
} from '../support/users';
import { ensureFreshSessions } from '../support/auth';
import {
  provisionAuditFixtures,
  type AuditFixtures,
} from '../support/auditFixtures';
import { markedEmail } from '../support/marker';
import { COLD_ROUTE, RENDERED } from '../support/waiting';

// ─── Output directory ──────────────────────────────────────────────────────────
//
// `ux-review/captures/` is gitignored and, unlike test-results/, is meant to survive
// a run for review. It is emptied ONCE per run in tests/e2e/support/globalSetup.ts,
// NOT here. A `beforeAll` clear in this spec ran once per WORKER PROCESS, and
// Playwright puts the desktop and mobile projects in separate workers — so the mobile
// worker wiped the desktop worker's freshly-written PNGs and a completed run left only
// half the images on disk. globalSetup runs exactly once before any worker starts,
// which is the only safe place to empty a directory shared across projects.
// `page.screenshot` recreates the directory as it writes, so nothing here needs to.
const CAPTURES_DIR = path.resolve(__dirname, '..', '..', '..', 'ux-review', 'captures');

test.describe.configure({ mode: 'serial' });

let auditFixtures: AuditFixtures;

interface RuntimeDiagnostics {
  consoleErrors: string[];
  pageErrors: string[];
}

const runtimeByPage = new WeakMap<Page, RuntimeDiagnostics>();

/**
 * Console messages that are the BROWSER's opinion rather than the app's defect.
 *
 * Kept short and specific on purpose: a noise filter that grows into a habit stops the
 * diagnostics being worth reading. Every entry needs to say why it is not a finding.
 */
const BENIGN_CONSOLE = [
  // WebKit does not implement `interactive-widget` in the viewport meta and says so
  // once per page load. The declaration is deliberate — it is how Chromium is told to
  // resize the layout rather than the visual viewport when the keyboard opens — and
  // Safari's default already matches what it asks for. It appeared on 40+ of the 54
  // mobile surfaces, which is exactly the volume that trains a reader to skip the
  // field.
  'Viewport argument key "interactive-widget" not recognized',
];

function monitorPage(page: Page): RuntimeDiagnostics {
  const existing = runtimeByPage.get(page);
  if (existing) return existing;
  const diagnostics: RuntimeDiagnostics = { consoleErrors: [], pageErrors: [] };
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (BENIGN_CONSOLE.some((pattern) => text.includes(pattern))) return;
    diagnostics.consoleErrors.push(text);
  });
  // MESSAGE PLUS STACK. A bare message is enough to know a surface is broken and not
  // enough to fix it: `listing-detail-owner`'s "Slot failed to slot onto its children"
  // named neither the component nor the file, and the owner branch of that page has
  // five `asChild` call sites. The stack is what turns a finding into a location.
  page.on('pageerror', (error: Error) =>
    diagnostics.pageErrors.push(
      error.stack && error.stack.includes(error.message)
        ? error.stack
        : `${error.message}\n${error.stack ?? '(no stack)'}`,
    ),
  );
  runtimeByPage.set(page, diagnostics);
  return diagnostics;
}

async function settleVisuals(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const root = document.documentElement;
    if (!root) return;
    const startY = window.scrollY;
    const step = Math.max(window.innerHeight, 1);
    const bottom = Math.max(root.scrollHeight - window.innerHeight, 0);
    for (let y = 0; y <= bottom; y += step) {
      window.scrollTo(0, y);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    window.scrollTo(0, bottom);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    window.scrollTo(0, startY);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

    await document.fonts?.ready;
    const images = Array.from(document.images);
    await Promise.race([
      Promise.all(images.map((image) => image.decode().catch(() => undefined))),
      new Promise<void>((resolve) => window.setTimeout(resolve, 8_000)),
    ]);
  });
}

async function settleStableVisuals(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await settleVisuals(page);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const transient =
        /Execution context was destroyed|navigation|Cannot read properties of null/i.test(
          message,
        );
      if (!transient || attempt === 2) throw error;
      await page.waitForLoadState('domcontentloaded');
      await page.locator('body').waitFor({ state: 'attached' });
    }
  }
}

interface PageAudit {
  url: string;
  title: string;
  viewport: { width: number; height: number };
  document: { width: number; height: number; horizontalOverflow: number };
  overflowElements: string[];
  duplicateIds: string[];
  unlabeledControls: string[];
  unnamedInteractive: string[];
  tinyText: string[];
  obscuredByMobileNav: string[];
  consoleErrors: string[];
  pageErrors: string[];
}

async function collectPageAudit(page: Page): Promise<PageAudit> {
  const runtime = monitorPage(page);
  const dom = await page.evaluate(async () => {
    const visible = (element: Element): element is HTMLElement => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0'
      );
    };
    const describe = (element: Element): string => {
      const html = element as HTMLElement;
      const id = html.id ? `#${html.id}` : '';
      const role = html.getAttribute('role');
      const name =
        html.getAttribute('aria-label') ||
        html.getAttribute('name') ||
        html.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) ||
        '';
      return `${html.tagName.toLowerCase()}${id}${role ? `[role=${role}]` : ''}${name ? ` “${name}”` : ''}`;
    };
    // Deliberately hidden inputs (a file picker driven by a labelled button) are
    // correct and must not be reported: flagging them buries the real gaps.
    const hiddenFromAssistiveTech = (element: HTMLElement): boolean =>
      element.getAttribute('aria-hidden') === 'true' ||
      Boolean(element.closest('[aria-hidden="true"]'));
    const hasLabel = (control: HTMLElement): boolean => {
      const labelledBy = control.getAttribute('aria-labelledby');
      const aria = control.getAttribute('aria-label');
      const title = control.getAttribute('title');
      const labels = 'labels' in control ? (control as HTMLInputElement).labels : null;
      return Boolean(aria || labelledBy || title || labels?.length || control.closest('label'));
    };

    const root = document.documentElement;
    const all = Array.from(document.body.querySelectorAll('*')).filter(visible);
    const overflowElements = all
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.right > window.innerWidth + 1 || rect.left < -1;
      })
      .slice(0, 40)
      .map(describe);

    const idCounts = new Map<string, number>();
    for (const element of document.querySelectorAll('[id]')) {
      idCounts.set(element.id, (idCounts.get(element.id) ?? 0) + 1);
    }
    const duplicateIds = Array.from(idCounts.entries())
      .filter(([, count]) => count > 1)
      .map(([id, count]) => `${id} (${count})`);

    const controls = Array.from(
      document.querySelectorAll('input:not([type=hidden]), textarea, select'),
    ).filter(visible) as HTMLElement[];
    const unlabeledControls = controls
      .filter((control) => !hiddenFromAssistiveTech(control))
      .filter((control) => !hasLabel(control))
      .map(describe);

    const interactive = Array.from(
      document.querySelectorAll(
        'button, a[href], [role=button], [role=link], [role=tab], [role=combobox]',
      ),
    ).filter(visible) as HTMLElement[];
    const unnamedInteractive = interactive
      .filter((element) => !hiddenFromAssistiveTech(element))
      .filter((element) => {
        const text = element.textContent?.trim();
        // A `<label for>` is a real accessible name too — a combobox input that has
        // one is correctly named, so it must not be reported as anonymous.
        return !(
          text ||
          element.getAttribute('aria-label') ||
          element.getAttribute('aria-labelledby') ||
          element.getAttribute('title') ||
          hasLabel(element)
        );
      })
      .map(describe);

    const tinyText = all
      .filter((element) => {
        const directText = Array.from(element.childNodes).some(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
        );
        return directText && Number.parseFloat(getComputedStyle(element).fontSize) < 12;
      })
      .slice(0, 40)
      .map((element) => `${describe(element)} (${getComputedStyle(element).fontSize})`);

    const startY = window.scrollY;
    window.scrollTo(0, Math.max(root.scrollHeight - window.innerHeight, 0));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const mobileNav = document.querySelector('[aria-label="Marketplace hubs"]');
    const navRect = mobileNav && visible(mobileNav) ? mobileNav.getBoundingClientRect() : null;
    const obscuredByMobileNav = navRect
      ? interactive
          .filter((element) => !mobileNav?.contains(element))
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            return (
              rect.bottom > navRect.top + 1 &&
              rect.top < navRect.bottom - 1 &&
              rect.right > navRect.left &&
              rect.left < navRect.right
            );
          })
          .map(describe)
      : [];
    window.scrollTo(0, startY);

    return {
      url: window.location.href,
      title: document.title,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      document: {
        width: root.scrollWidth,
        height: root.scrollHeight,
        horizontalOverflow: Math.max(root.scrollWidth - root.clientWidth, 0),
      },
      overflowElements,
      duplicateIds,
      unlabeledControls,
      unnamedInteractive,
      tinyText,
      obscuredByMobileNav,
    };
  });

  return {
    ...dom,
    consoleErrors: runtime.consoleErrors,
    pageErrors: runtime.pageErrors,
  };
}

test.beforeAll(async ({ browser }, testInfo) => {
  // Provisioning drives the real UI: three listings, a saved card, a Cash_Sale, a
  // Trade and an invite. On mobile WebKit a single listing publish is ~45s, so this
  // hook needs a budget measured in minutes rather than the per-test default.
  testInfo.setTimeout(25 * 60_000);
  auditFixtures = await provisionAuditFixtures(browser, testInfo.project.name);
});

/**
 * Capture the current page as a full-page PNG named for the surface and project.
 *
 * The liveness check lives here so every caller gets it: `expect(...heading...)`
 * auto-waits (see support/waiting.ts) and fails the capture if the surface rendered
 * an error boundary or nothing at all, rather than quietly saving a picture of a
 * broken page.
 */
interface CaptureOptions {
  /**
   * When true, this surface is EXPECTED to be the not-found page (only `/not-found`).
   * Inverts the 404 guard so the intentional 404 screen is captured as a pass rather
   * than flagged. Every other surface must NOT show it.
   */
  expect404?: boolean;
}

async function capture(
  page: Page,
  testInfo: TestInfo,
  surface: string,
  { expect404 = false }: CaptureOptions = {},
): Promise<void> {
  monitorPage(page);
  // At least one VISIBLE heading proves the surface rendered rather than blank/500ing.
  //
  // `.filter({ visible: true })`, NOT `.first()`. Every page's shell renders an
  // `<h1 class="sr-only md:hidden">` — a screen-reader-only page title hidden on
  // desktop widths by design. `.first()` matched that hidden node and waited for it to
  // become visible, which it never does above `md`, so the check timed out on pages
  // that had rendered perfectly (desktop failed, mobile passed the same surfaces).
  // Not scoped to `<main>` either: the (marketing) pages render their body in an
  // `<article>`, so a `main`-scoped query found nothing there.
  await expect(
    page.locator(':is(h1, h2, h3)').filter({ visible: true }).first(),
  ).toBeVisible({ timeout: RENDERED });

  // THE 404 GUARD. A capture that shoots the not-found screen and reports a pass is
  // worse than a failure — it launders a broken route as "reviewed, fine". The
  // not-found page renders a stable "Error 404" eyebrow. For the deliberate
  // `/not-found` surface we REQUIRE it; everywhere else we forbid it, so a
  // data-dependent route that 404s is a real signal, not a silent pass.
  const notFound = page.getByText('Error 404', { exact: true });
  if (expect404) {
    await expect(notFound, `${surface} should be the 404 page`).toHaveCount(1);
  } else {
    await expect(notFound, `${surface} rendered the 404 page`).toHaveCount(0);
  }

  await settleStableVisuals(page);
  let audit: PageAudit | null = null;
  for (let attempt = 0; attempt < 3 && !audit; attempt += 1) {
    try {
      audit = await collectPageAudit(page);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        !/Execution context was destroyed|navigation|Cannot read properties of null/i.test(
          message,
        ) || attempt === 2
      ) {
        throw error;
      }
      await page.waitForLoadState('domcontentloaded');
      await settleStableVisuals(page);
    }
  }
  if (!audit) throw new Error(`Could not collect diagnostics for ${surface}`);
  mkdirSync(CAPTURES_DIR, { recursive: true });

  const stem = `${surface}.${testInfo.project.name}`;
  const auditFile = path.join(CAPTURES_DIR, `${stem}.json`);
  writeFileSync(auditFile, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  await testInfo.attach(`${surface} diagnostics (${testInfo.project.name})`, {
    path: auditFile,
    contentType: 'application/json',
  });

  const file = path.join(CAPTURES_DIR, `${stem}.png`);
  // `caret: 'initial'`: Playwright's default hides the caret by MUTATING the DOM,
  // which React then reports as a hydration attribute mismatch on any focusable
  // field. That is a harness artifact and it masks real mismatches.
  await page.screenshot({
    path: file,
    fullPage: true,
    animations: 'disabled',
    caret: 'initial',
  });
  await testInfo.attach(`${surface} (${testInfo.project.name})`, {
    path: file,
    contentType: 'image/png',
  });
}

/** Go to a route, wait for it to be parseable, and capture it. */
async function shoot(
  page: Page,
  testInfo: TestInfo,
  surface: string,
  route: string,
  options: CaptureOptions = {},
): Promise<void> {
  monitorPage(page);
  await page.goto(route);
  await page.waitForLoadState('domcontentloaded');
  // Redirect routes (`/profile/payouts`, `/deals/new`) replace the document after
  // the first paint. Settle on a stable URL so diagnostics run against the page a
  // member actually lands on rather than the one being torn down.
  let previous = '';
  for (let attempt = 0; attempt < 5 && previous !== page.url(); attempt += 1) {
    previous = page.url();
    await page.waitForTimeout(250);
    await page.waitForLoadState('domcontentloaded');
  }
  await page.locator('body').waitFor({ state: 'attached' });
  await capture(page, testInfo, surface, options);
}

// Dynamic pages below use records created by the top-level audit fixture. They are
// known-good UI-created rows rather than arbitrary scratch-database records.

// ═══ PUBLIC SURFACES (no auth) ═══════════════════════════════════════════════════
//
// A fresh context with no storageState is a guest. These are what an unauthenticated
// visitor — the top of the acquisition funnel — actually sees.

test.describe('public surfaces', () => {
  // Static routes that never depend on seed data.
  const PUBLIC: ReadonlyArray<readonly [surface: string, route: string]> = [
    ['home-catalog', '/'],
    ['sign-in', '/sign-in'],
    ['sign-up', '/sign-up'],
    ['forgot-password', '/forgot-password'],
    ['update-password-no-session', '/auth/update-password'],
    ['help', '/help'],
    ['terms', '/terms'],
    ['privacy', '/privacy'],
    ['account-suspended', '/account-suspended'],
  ];

  for (const [surface, route] of PUBLIC) {
    test(`capture ${surface}`, async ({ page }, testInfo) => {
      await shoot(page, testInfo, surface, route);
    });
  }

  // The not-found page is the one surface that SHOULD show "Error 404" — capture it
  // with the guard inverted so it is documented rather than flagged.
  test('capture not-found', async ({ page }, testInfo) => {
    await shoot(page, testInfo, 'not-found', '/this-route-does-not-exist', {
      expect404: true,
    });
  });

  test('capture listing-detail', async ({ page }, testInfo) => {
    await shoot(
      page,
      testInfo,
      'listing-detail',
      `/listings/${auditFixtures.alicePublicItemId}`,
    );
  });

  for (const [surface, query] of [
    ['seller-profile', ''],
    ['seller-profile-sold', '?tab=sold'],
    ['seller-profile-reviews', '?tab=reviews'],
  ] as const) {
    test(`capture ${surface}`, async ({ page }, testInfo) => {
      await shoot(page, testInfo, surface, `/sellers/${ALICE.id}${query}`);
    });
  }

  test('capture private-invite-guest', async ({ page }, testInfo) => {
    await shoot(page, testInfo, 'private-invite-guest', auditFixtures.invitePath);
  });

  test('capture oauth-error-return', async ({ page }, testInfo) => {
    await shoot(
      page,
      testInfo,
      'oauth-error-return',
      '/auth/callback?error=access_denied&error_description=The%20request%20was%20cancelled',
    );
  });

  test('capture confirm-link-invalid', async ({ page }, testInfo) => {
    await shoot(page, testInfo, 'confirm-link-invalid', '/auth/confirm');
  });
});

// ═══ BUYER / MEMBER SURFACES (Alice) ═════════════════════════════════════════════
//
// Alice is a seller in the seed but every member-facing list route renders for her.
// The catalog is also worth a second capture while signed in — the header and its
// affordances differ from the guest view (F3 current-page indicator lives here).

test.describe('member surfaces', () => {
  test.use({ storageState: storageStatePath(ALICE) });

  test.beforeAll(async ({ browser }) => {
    await ensureFreshSessions(browser, [ALICE]);
  });

  test.afterEach(async ({ context }) => {
    await context.storageState({ path: storageStatePath(ALICE) });
  });

  const MEMBER: ReadonlyArray<readonly [surface: string, route: string]> = [
    ['home-catalog-authed', '/'],
    ['profile', '/profile'],
    ['profile-verification', '/profile?tab=verification'],
    ['profile-payouts-tab', '/profile?tab=payouts'],
    ['payouts-dashboard', '/profile/payouts'],
    ['listing-new', '/listings/new'],
    ['listings-mine', '/listings/mine'],
    ['sales', '/sales'],
    ['sales-past', '/sales?show=past'],
    ['purchases', '/purchases'],
    ['purchases-past', '/purchases?show=past'],
    ['trades', '/trades'],
    ['trades-past', '/trades?show=past'],
    ['offers', '/offers'],
    ['offers-past', '/offers?show=past'],
    ['saved', '/saved'],
    ['messages', '/messages'],
    ['notifications', '/notifications'],
  ];

  for (const [surface, route] of MEMBER) {
    test(`capture ${surface}`, async ({ page }, testInfo) => {
      await shoot(page, testInfo, surface, route);
    });
  }

  // The state a seller lands on immediately after publishing: owner actions,
  // edit/delete controls, no buy path. A crash here was observed in the console
  // during fixture creation, so it is captured as its own surface.
  test('capture listing-detail-owner', async ({ page }, testInfo) => {
    await shoot(
      page,
      testInfo,
      'listing-detail-owner',
      `/listings/${auditFixtures.alicePublicItemId}`,
    );
  });

  test('capture listing-edit', async ({ page }, testInfo) => {
    await shoot(
      page,
      testInfo,
      'listing-edit',
      `/listings/${auditFixtures.alicePublicItemId}/edit`,
    );
  });

  test('capture trade-new-targeted', async ({ page }, testInfo) => {
    await shoot(
      page,
      testInfo,
      'trade-new-targeted',
      `/trades/new?counterpartItemId=${auditFixtures.bobTradeItemId}`,
    );
  });

  test('capture private-deal-compose', async ({ page }, testInfo) => {
    await shoot(page, testInfo, 'private-deal-compose', '/deals/new');
    await expect(page.getByRole('heading', { name: 'Start a Private Deal' })).toBeVisible();
  });

  test('capture private-invite-host', async ({ page }, testInfo) => {
    await shoot(page, testInfo, 'private-invite-host', auditFixtures.invitePath);
  });
});

// A completed seed member redirects away from onboarding, so create a real
// unfinished account and capture both the welcome and first counted step.
test.describe('onboarding wizard (new member)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('capture onboarding welcome and username', async ({ page }, testInfo) => {
    monitorPage(page);
    await page.goto('/sign-up');
    await page.waitForLoadState('domcontentloaded');
    await page.getByLabel('Email').fill(markedEmail(`visual-${testInfo.project.name}`));
    await page.getByLabel('Password').fill('TestPassword123!');
    await page.getByRole('checkbox', { name: /accept the Terms/i }).check();
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/onboarding/, { timeout: COLD_ROUTE });
    await capture(page, testInfo, 'onboarding-welcome');

    await page.getByRole('button', { name: 'Get started' }).click();
    await expect(
      page.getByRole('heading', { name: 'Choose your username' }),
    ).toBeVisible({ timeout: RENDERED });
    await capture(page, testInfo, 'onboarding-username');
  });
});

// ═══ STAFF SURFACES ══════════════════════════════════════════════════════════════
//
// /admin is is_admin (Frank); /admin/arbitration is is_support-or-admin (Grace). Two
// capabilities, not a hierarchy (lib/staffGate.ts), so each is shot as the persona
// that actually holds it.

test.describe('admin console (Frank)', () => {
  test.use({ storageState: storageStatePath(FRANK_ADMIN) });

  test.beforeAll(async ({ browser }) => {
    await ensureFreshSessions(browser, [FRANK_ADMIN]);
  });

  test.afterEach(async ({ context }) => {
    await context.storageState({ path: storageStatePath(FRANK_ADMIN) });
  });

  for (const [surface, route] of [
    ['admin-console', '/admin'],
    ['admin-reports', '/admin?tab=reports'],
    ['admin-reconciliation', '/admin?tab=reconciliation'],
  ] as const) {
    test(`capture ${surface}`, async ({ page }, testInfo) => {
      await shoot(page, testInfo, surface, route);
    });
  }
});

test.describe('arbitration queue (Grace)', () => {
  test.use({ storageState: storageStatePath(GRACE_SUPPORT) });

  test.beforeAll(async ({ browser }) => {
    await ensureFreshSessions(browser, [GRACE_SUPPORT]);
  });

  test.afterEach(async ({ context }) => {
    await context.storageState({ path: storageStatePath(GRACE_SUPPORT) });
  });

  for (const [surface, route] of [
    ['arbitration-queue', '/admin/arbitration'],
    ['arbitration-mine', '/admin/arbitration?queue=mine'],
    ['arbitration-unassigned', '/admin/arbitration?queue=unassigned'],
  ] as const) {
    test(`capture ${surface}`, async ({ page }, testInfo) => {
      await shoot(page, testInfo, surface, route);
    });
  }

  test('capture arbitration-case-closed', async ({ page }, testInfo) => {
    await shoot(
      page,
      testInfo,
      'arbitration-case-closed',
      '/admin/arbitration/CASH_SALE/00000000-0000-0000-0000-000000000000',
    );
  });
});

// ═══ CONTRACT ROOMS (deterministic UI-created fixtures) ═════════════════════════

test.describe('contract rooms (Alice)', () => {
  test.use({ storageState: storageStatePath(ALICE) });

  test.beforeAll(async ({ browser }) => {
    await ensureFreshSessions(browser, [ALICE]);
  });

  test.afterEach(async ({ context }) => {
    await context.storageState({ path: storageStatePath(ALICE) });
  });

  test('capture cash-sale-room-seller', async ({ page }, testInfo) => {
    await shoot(page, testInfo, 'cash-sale-room-seller', auditFixtures.cashSalePath);
  });

  test('capture trade-room-initiator', async ({ page }, testInfo) => {
    await shoot(page, testInfo, 'trade-room-initiator', auditFixtures.tradePath);
  });
});

test.describe('contract rooms and thread (Bob)', () => {
  test.use({ storageState: storageStatePath(BOB) });

  test.beforeAll(async ({ browser }) => {
    await ensureFreshSessions(browser, [BOB]);
  });

  test.afterEach(async ({ context }) => {
    await context.storageState({ path: storageStatePath(BOB) });
  });

  test('capture cash-sale-room-buyer', async ({ page }, testInfo) => {
    await shoot(page, testInfo, 'cash-sale-room-buyer', auditFixtures.cashSalePath);
  });

  test('capture trade-room-counterpart', async ({ page }, testInfo) => {
    await shoot(page, testInfo, 'trade-room-counterpart', auditFixtures.tradePath);
  });

  test('capture message-thread', async ({ page }, testInfo) => {
    await shoot(page, testInfo, 'message-thread', auditFixtures.conversationPath);
  });
});
