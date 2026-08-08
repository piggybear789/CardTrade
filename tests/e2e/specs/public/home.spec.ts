// tests/e2e/specs/public/home.spec.ts
//
// Trivial harness smoke test — proves the webServer boots on :3100 with
// PAYMENTS_PROVIDER=mock, and that Playwright can reach it, before any real
// coverage gets built on top.
import { test, expect } from '@playwright/test';

test('landing page loads', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('NoDitto');
});
