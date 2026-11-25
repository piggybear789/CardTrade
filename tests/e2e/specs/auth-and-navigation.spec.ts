// tests/e2e/specs/auth-and-navigation.spec.ts
//
// AUTHENTICATION, RESET, CONFIRMATION, RATE LIMIT & SIGN-OUT PATHWAYS
// (Task 12.1, Req 7.1–7.10).

import { expect } from '../support/fixtures';
import { pathway } from '../audit/pathway';
import { passwordResetLink } from '../audit/backend/authLinks';
import { deleteRows, profileIdByEmail, selectRows, updateRows } from '../support/db';
import { markedEmail } from '../support/marker';
import { ALICE, ERIN, persona } from '../support/users';

// ---------------------------------------------------------------------------
// 1. Sign-up provisioning (Req 7.1)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'auth.signup.provisions-profile',
    title: 'Signing up with email and password provisions a profile and lands on onboarding',
    area: 'auth',
    kind: 'happy',
    provider: 'stripe',
    members: { visitor: 'guest' },
    viewports: 'both',
  },
  async (ctx) => {
    const email = markedEmail('signup');

    await ctx.step('Visitor creates an account', 'visitor', async (page) => {
      await page.goto('/sign-up');
      await page.waitForLoadState('load');
      await page.getByLabel('Email').fill(email);
      await page.getByLabel('Password', { exact: true }).fill('TestPassword123!');
      await page.getByRole('checkbox', { name: /accept the Terms/i }).check();
      await page.getByRole('button', { name: 'Create account' }).click();
      await expect(page).toHaveURL(/\/onboarding/, { timeout: 25_000 });
    });

    await ctx.assertState('Profile is provisioned in DB and onboarding wizard is visible', {
      member: 'visitor',
      db: async () => Boolean(await profileIdByEmail(email)),
      ui: async (page) => page.getByRole('heading', { name: 'Welcome to NoDitto' }).isVisible(),
      expect: true,
    });
  },
);

// ---------------------------------------------------------------------------
// 2. Duplicate account & invalid credentials refusals (Req 7.2, 7.3)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'auth.signup.duplicate-account-refused',
    title: 'Signing up with an existing email refuses with DUPLICATE_ACCOUNT',
    area: 'auth',
    kind: 'refusal',
    provider: 'stripe',
    members: { visitor: 'guest' },
    viewports: 'both',
  },
  async (ctx) => {
    await ctx.refusal(
      'Visitor signs up using Alice email',
      'visitor',
      async (page) => {
        await page.goto('/sign-up');
        await page.waitForLoadState('load');
        await page.getByLabel('Email').fill(ALICE.email);
        await page.getByLabel('Password', { exact: true }).fill('TestPassword123!');
        await page.getByRole('checkbox', { name: /accept the Terms/i }).check();
        await page.getByRole('button', { name: 'Create account' }).click();
        return {};
      },
      { message: 'An account with this email already exists.' },
    );
  },
);

pathway(
  {
    id: 'auth.signin.invalid-credentials-refused',
    title: 'Signing in with a wrong password refuses with INVALID_CREDENTIALS',
    area: 'auth',
    kind: 'refusal',
    provider: 'stripe',
    members: { visitor: 'guest' },
    viewports: 'both',
  },
  async (ctx) => {
    await ctx.refusal(
      'Visitor submits wrong password for Alice',
      'visitor',
      async (page) => {
        await page.goto('/sign-in');
        await page.waitForLoadState('load');
        await page.getByLabel('Email').fill(ALICE.email);
        await page.getByLabel('Password', { exact: true }).fill('WrongPassword999!');
        await page.getByRole('button', { name: 'Sign in' }).click();
        await expect(page).not.toHaveURL(/[?&]password=/);
        return {};
      },
      { message: 'Invalid email or password.' },
    );
  },
);

// ---------------------------------------------------------------------------
// 3. Banned account (@isolated, Req 7.5)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'auth.signin.banned-account',
    title: 'Fraud-banned member is redirected to /account-suspended',
    area: 'auth',
    kind: 'refusal',
    provider: 'stripe',
    isolated: true,
    members: {
      banned: persona('auth-banned', { regionCode: 'AU', identityVerified: true }),
    },
    viewports: { only: 'desktop', reason: 'Isolated fraud-ban redirect check; desktop suffices' },
  },
  async (ctx) => {
    const user = ctx.members.get('banned').user!;
    await ctx.arrange('Mark member as fraud-banned', () =>
      updateRows('profiles', `id=eq.${user.id}`, { fraud_banned_at: new Date().toISOString() }),
    );

    await ctx.refusal(
      'Banned member visits catalog and is redirected to /account-suspended',
      'banned',
      async (page) => {
        await page.goto('/');
        await expect(page).toHaveURL(/\/account-suspended/, { timeout: 15_000 });
        return { code: 'ACCOUNT_BANNED' };
      },
      { code: 'ACCOUNT_BANNED' },
    );
  },
);

// ---------------------------------------------------------------------------
// 4. Enumeration-safe reset + Admin reset/confirmation links (Req 7.6, 7.7)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'auth.password-reset.enumeration-safe-and-admin-link',
    title: 'Forgot-password is enumeration-safe and Admin reset link updates password',
    area: 'auth',
    kind: 'happy',
    provider: 'stripe',
    members: {
      member: persona('reset-member', { regionCode: 'AU', identityVerified: true }),
      visitor: 'guest',
    },
    viewports: 'both',
  },
  async (ctx) => {
    const memberUser = ctx.members.get('member').user!;

    await ctx.step('Visitor requests reset for unknown email without enumeration', 'visitor', async (page) => {
      await page.goto('/forgot-password');
      await page.waitForLoadState('load');
      await page.getByLabel('Email').fill('nobody-known-here@example.com');
      await page.getByRole('button', { name: /Send reset|Reset password/i }).click();
      await expect(page.getByText(/check your email|reset link/i).first()).toBeVisible({ timeout: 15_000 });
    });

    let resetHref = '';
    await ctx.arrange('Generate Admin password reset link', async () => {
      const link = await passwordResetLink(memberUser.id, { server: 'main' });
      resetHref = link.url;
    });

    await ctx.step('Member follows reset link and sets new password', 'visitor', async (page) => {
      await page.goto(resetHref);
      await expect(page).toHaveURL(/\/(reset-password|auth\/update-password)/, { timeout: 20_000 });
      await page.waitForLoadState('networkidle');
      const newPw = page.getByLabel('New password', { exact: true });
      const confirmPw = page.getByLabel('Confirm new password', { exact: true });
      await newPw.fill('NewPassword456!');
      await confirmPw.fill('NewPassword456!');
      await expect(newPw).toHaveValue('NewPassword456!');
      await expect(confirmPw).toHaveValue('NewPassword456!');
      await page.getByRole('button', { name: /Save new password|Update password|Save password/i }).click();
      await expect(page).toHaveURL(/\/($|sign-in|profile)/, { timeout: 20_000 });
    });

    await ctx.assertState('Reset link points to sandbox origin and new password signs in', {
      member: 'visitor',
      db: async () => resetHref.startsWith('http://localhost:3100/'),
      ui: async (page) => {
        await page.goto('/sign-in');
        await page.waitForLoadState('load');
        await page.getByLabel('Email').fill(memberUser.email);
        await page.getByLabel('Password', { exact: true }).fill('NewPassword456!');
        await page.getByRole('button', { name: 'Sign in' }).click();
        await expect(page).toHaveURL(/\/($|onboarding|profile)/, { timeout: 20_000 });
        return resetHref.startsWith('http://localhost:3100/');
      },
      expect: true,
    });
  },
);

// ---------------------------------------------------------------------------
// 5. Aux rate limit & sign-out redirect (Req 7.8, 7.10)
// ---------------------------------------------------------------------------

pathway(
  {
    id: 'auth.signin.rate-limit-on-aux',
    title: 'Aux server enforces 5/min sign-in rate limit',
    area: 'auth',
    kind: 'refusal',
    provider: 'mock',
    mockReason: 'Main server raises AUTH_RATE_LIMIT_PER_MINUTE=100; aux keeps the 5/min limit',
    members: { visitor: 'guest' },
    viewports: { only: 'desktop', reason: 'Server-side IP rate limiter is viewport-independent' },
  },
  async (ctx) => {
    await ctx.refusal(
      'Visitor hits sign-in 6 times and triggers rate limit',
      'visitor',
      async (page) => {
        await page.goto('/sign-in');
        await page.waitForLoadState('load');
        await page.getByLabel('Email').fill(ALICE.email);
        await page.getByLabel('Password', { exact: true }).fill('WrongPassword!');
        for (let i = 0; i < 6; i += 1) {
          await page.getByRole('button', { name: 'Sign in' }).click();
          const limited = await page.getByRole('alert').filter({ hasText: /too many attempts/i }).isVisible().catch(() => false);
          if (limited) break;
        }
        return {};
      },
      { message: 'Too many attempts. Please wait a minute and try again.' },
    );
  },
);

pathway(
  {
    id: 'auth.signout.redirects-to-catalog',
    title: 'Signing out clears session and redirects away from protected routes',
    area: 'auth',
    kind: 'happy',
    provider: 'stripe',
    members: { member: ERIN },
    viewports: 'both',
  },
  async (ctx) => {
    await ctx.step('Member signs out from account menu', 'member', async (page) => {
      await page.goto('/profile');
      await page.getByRole('button', { name: /Sign out/i }).first().click();
      const confirm = page.getByRole('dialog').getByRole('button', { name: /Sign out everywhere/i });
      if (await confirm.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await confirm.click();
      }
      await expect(page).toHaveURL(/\/($|sign-in)/, { timeout: 15_000 });
    });

    await ctx.assertState('Protected route bounces signed-out visitor to /sign-in', {
      member: 'member',
      db: async () => true,
      ui: async (page) => {
        await page.goto('/profile');
        return /\/sign-in/.test(page.url());
      },
      expect: true,
    });
  },
);
