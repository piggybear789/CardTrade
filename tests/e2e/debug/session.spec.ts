// tests/e2e/debug/session.spec.ts
//
// DEVELOPMENT TOOL. Answers one question: does signing a member in again revoke the
// session that `auth.setup.ts` stored for them?
//
// That matters because nineteen tests across six files fail in a full run and pass
// per-file, all of them Alice-dependent, all of them running after the file that
// signs Alice in interactively. Two guesses at the cause were already wrong, so this
// measures instead.
import { test, expect } from '../support/fixtures';
import { ALICE, storageStatePath } from '../support/users';

test('does a fresh sign-in revoke the stored session?', async ({ browser }) => {
  // A. The stored session works right now.
  const stored = await browser.newContext({ storageState: storageStatePath(ALICE) });
  const storedPage = await stored.newPage();
  await storedPage.goto('/profile');
  const beforeUrl = new URL(storedPage.url()).pathname;
  console.log(`--- stored session BEFORE another sign-in: ${beforeUrl}`);

  // B. Sign the same member in from a separate context.
  const fresh = await browser.newContext();
  const freshPage = await fresh.newPage();
  await freshPage.goto('/sign-in');
  await freshPage.waitForLoadState('load');
  await freshPage.getByLabel('Email').fill(ALICE.email);
  await freshPage.getByLabel('Password').fill(ALICE.password);
  await freshPage.getByRole('button', { name: 'Sign in' }).click();
  await freshPage.waitForURL(/\/(listings|onboarding)/, { timeout: 30_000 });
  console.log('--- second sign-in completed');

  // C. Is the stored session still good?
  await storedPage.goto('/profile');
  const afterUrl = new URL(storedPage.url()).pathname;
  console.log(`--- stored session AFTER another sign-in: ${afterUrl}`);
  console.log(
    afterUrl.startsWith('/sign-in')
      ? '--- VERDICT: a fresh sign-in REVOKES the stored session'
      : '--- VERDICT: sessions coexist; the cause is something else',
  );

  // D. And does simply REUSING the stored jar in a third context break it? That is
  //    refresh-token reuse detection, the other candidate.
  const twin = await browser.newContext({ storageState: storageStatePath(ALICE) });
  const twinPage = await twin.newPage();
  await twinPage.goto('/profile');
  console.log(`--- second context on the SAME jar: ${new URL(twinPage.url()).pathname}`);
  await storedPage.goto('/profile');
  console.log(`--- original jar after the twin loaded it: ${new URL(storedPage.url()).pathname}`);

  await stored.close();
  await fresh.close();
  await twin.close();
  expect(true).toBe(true);
});
