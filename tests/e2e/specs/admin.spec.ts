// tests/e2e/specs/admin.spec.ts
//
// Admin and arbitration access control + content loading.
//
// Three personas exercise the two admin surfaces:
//   Frank (is_admin) — full access to /admin and /admin/arbitration.
//   Grace (is_support) — arbitration only, refused by /admin.
//   Alice (regular member) — refused by both.
//   Unauthenticated — redirected to sign-in by middleware.
//
// See lib/staffGate.ts: `requireStaff` = is_support OR is_admin;
// the admin page itself reads `is_admin` from the profile row.
import { test, expect } from '../support/fixtures';
import { ALICE, FRANK_ADMIN, GRACE_SUPPORT, storageStatePath } from '../support/users';
import { ensureFreshSessions } from '../support/auth';

// Repair any stored cookie jar this file relies on before its first test.
// Refresh-token rotation retires the token a jar holds as soon as another context
// uses it, so a shared snapshot goes stale on its own during a long run. See
// tests/e2e/support/auth.ts for the full reasoning.
test.beforeAll(async ({ browser }) => {
  await ensureFreshSessions(browser, [ALICE, FRANK_ADMIN, GRACE_SUPPORT]);
});

// ---------------------------------------------------------------------------
// 1. Access control
// ---------------------------------------------------------------------------

test.describe('Admin access control', () => {
  test('Frank (is_admin) can access /admin', async ({ browser }) => { const context = await browser.newContext({ storageState: storageStatePath(FRANK_ADMIN) });
  const page = await context.newPage();
  await page.goto('/admin');
  
  // The page renders its title heading — no redirect, no "Not Authorized".
  await expect(page.getByRole('heading', { name: 'Operations' }).first()).toBeVisible();
  
  await context.close(); });

  test('Grace (is_support) can access /admin/arbitration', async ({ browser }) => { const context = await browser.newContext({ storageState: storageStatePath(GRACE_SUPPORT) });
  const page = await context.newPage();
  await page.goto('/admin/arbitration');
  
  // The arbitration queue renders its title heading.
  await expect(page.getByRole('heading', { name: 'Cases' }).first()).toBeVisible();
  
  await context.close(); });

  test('Alice (regular user) sees "Not Authorized" on /admin', async ({ browser }) => { const context = await browser.newContext({ storageState: storageStatePath(ALICE) });
  const page = await context.newPage();
  await page.goto('/admin');
  
  await expect(page.getByRole('heading', { name: /not authorized/i })).toBeVisible();
  // Should not show any admin content.
  await expect(page.getByRole('heading', { name: 'Operations' }).first()).not.toBeVisible();
  
  await context.close(); });

  test('Alice (regular user) sees "Not Authorized" on /admin/arbitration', async ({ browser }) => { const context = await browser.newContext({ storageState: storageStatePath(ALICE) });
  const page = await context.newPage();
  await page.goto('/admin/arbitration');
  
  await expect(page.getByRole('heading', { name: /not authorized/i })).toBeVisible();
  // Should not show any case data.
  await expect(page.getByText('Cases are limited to NoDitto support staff.')).toBeVisible();
  
  await context.close(); });

  test('Unauthenticated user visiting /admin is redirected to /sign-in', async ({ browser }) => { // Fresh context with no stored session.
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/admin');
  
  // Middleware or the page itself redirects to sign-in.
  await expect(page).toHaveURL(/\/sign-in/);
  
  await context.close(); });

  test('Unauthenticated user visiting /admin/arbitration is redirected to /sign-in', async ({ browser }) => { const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/admin/arbitration');
  
  await expect(page).toHaveURL(/\/sign-in/);
  
  await context.close(); });
});

// ---------------------------------------------------------------------------
// 2. Admin dashboard content
// ---------------------------------------------------------------------------

test.describe('Admin dashboard', () => {
  test.use({ storageState: storageStatePath(FRANK_ADMIN) });

  test('Frank sees the operations console with tabs', async ({ page }) => {
    await page.goto('/admin');

    // Page title renders.
    await expect(page.getByRole('heading', { name: 'Operations' }).first()).toBeVisible();

    // The three queue tabs are present.
    await expect(page.getByRole('link', { name: /payouts/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /reports/i }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /reconciliation/i }).first()).toBeVisible();

    // The arbitration hand-off link exists.
    await expect(page.getByRole('link', { name: /cases/i }).first()).toBeVisible();
  });

  test('Payouts tab shows seller releases section', async ({ page }) => {
    await page.goto('/admin?tab=payouts');

    await expect(page.getByRole('heading', { name: /seller releases owed/i }).first()).toBeVisible();
  });

  test('Reports tab shows community reports section', async ({ page }) => {
    await page.goto('/admin?tab=reports');

    await expect(page.getByRole('heading', { name: /community reports/i }).first()).toBeVisible();
  });

  test('Reconciliation tab shows flagged trades section', async ({ page }) => {
    await page.goto('/admin?tab=reconciliation');

    await expect(page.getByRole('heading', { name: /flagged trades/i }).first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 3. Arbitration workspace
// ---------------------------------------------------------------------------

test.describe('Arbitration workspace', () => {
  test('Grace sees the arbitration case list', async ({ browser }) => { const context = await browser.newContext({ storageState: storageStatePath(GRACE_SUPPORT) });
  const page = await context.newPage();
  await page.goto('/admin/arbitration');
  
  // The queue page renders.
  await expect(page.getByRole('heading', { name: 'Cases' }).first()).toBeVisible();
  
  // Summary stats are visible (the dl with open cases, critical, etc.).
  await expect(page.getByText(/open cases/i)).toBeVisible();
  await expect(page.getByText(/money at stake/i)).toBeVisible();
  
  // Filter tabs are present.
  await expect(page.getByRole('link', { name: /all open/i }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /mine/i }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /unassigned/i }).first()).toBeVisible();
  
  await context.close(); });

  test('Frank (is_admin) also has access to /admin/arbitration', async ({ browser }) => { const context = await browser.newContext({ storageState: storageStatePath(FRANK_ADMIN) });
  const page = await context.newPage();
  await page.goto('/admin/arbitration');
  
  await expect(page.getByRole('heading', { name: 'Cases' }).first()).toBeVisible();
  await expect(page.getByText(/open cases/i)).toBeVisible();
  
  await context.close(); });

  test('Frank sees the "Operations" link on arbitration page (admin-only)', async ({ browser }) => { const context = await browser.newContext({ storageState: storageStatePath(FRANK_ADMIN) });
  const page = await context.newPage();
  await page.goto('/admin/arbitration');
  
  // viewerIsAdmin renders the "Operations" button — admin-only UI element.
  await expect(page.getByRole('link', { name: /operations/i }).first()).toBeVisible();
  
  await context.close(); });
});

// ---------------------------------------------------------------------------
// 4. Staff capabilities distinction
// ---------------------------------------------------------------------------

test.describe('Staff capabilities distinction', () => {
  test('Grace (is_support) is refused by /admin (admin-only surface)', async ({ browser }) => { const context = await browser.newContext({ storageState: storageStatePath(GRACE_SUPPORT) });
  const page = await context.newPage();
  await page.goto('/admin');
  
  // Grace is authenticated but not is_admin, so she sees "Not Authorized".
  await expect(page.getByRole('heading', { name: /not authorized/i })).toBeVisible();
  await expect(page.getByText(/don't have permission/i)).toBeVisible();
  
  await context.close(); });

  test('Grace does NOT see the "Operations" link on arbitration page', async ({ browser }) => { const context = await browser.newContext({ storageState: storageStatePath(GRACE_SUPPORT) });
  const page = await context.newPage();
  await page.goto('/admin/arbitration');
  
  // Only viewerIsAdmin renders the Operations button.
  await expect(page.getByRole('heading', { name: 'Cases' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: /operations/i }).first()).not.toBeVisible();
  
  await context.close(); });

  test('Frank (is_admin) sees the "Operations" link — can navigate between surfaces', async ({ browser }) => { const context = await browser.newContext({ storageState: storageStatePath(FRANK_ADMIN) });
  const page = await context.newPage();
  await page.goto('/admin/arbitration');
  
  // Frank has both capabilities: the arbitration page shows the admin hand-off.
  const opsLink = page.getByRole('link', { name: /operations/i }).first();
  await expect(opsLink).toBeVisible();
  
  // Clicking navigates to /admin.
  await opsLink.click();
  await expect(page.getByRole('heading', { name: 'Operations' }).first()).toBeVisible();
  await expect(page).toHaveURL(/\/admin(?:\?|$)/);
  
  await context.close(); });
});
