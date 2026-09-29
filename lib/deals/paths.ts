// lib/deals/paths.ts
//
// Where a private deal is composed and where its invite lives. Plain constants and
// pure functions, so the proxy, the auth routes, server pages and client components
// all share one spelling.

/** The deal composer. Open to signed-out visitors; the account is asked for at Get link. */
export const DEAL_OPEN_PATH = '/deals';

/** Set on the composer's URL when sign-in returns there, so it restores its draft. */
export const DEAL_RESUME_PARAM = 'resume';

/** Where the composer sends sign-in, so it comes back and picks the draft up. */
export const DEAL_RESUME_PATH = `${DEAL_OPEN_PATH}?${DEAL_RESUME_PARAM}=1`;

/** The invite a host shares. */
export function dealInvitePath(token: string): string {
  return `/t/${token}`;
}

/**
 * Whether a destination finishes a brand-new account's onboarding itself, with two
 * questions: the name others see, and where they trade.
 *
 * Sign-in otherwise sends a new member through `/onboarding`, whose seller path ends
 * at Stripe Identity. The composer and an invite move that check to the moment money
 * or a hold is about to move, so sending their visitors through the wizard would put
 * it straight back in front of them.
 */
export function finishesOwnOnboarding(path: string | null | undefined): boolean {
  if (!path) return false;
  const pathname = path.split(/[?#]/)[0];
  return pathname === DEAL_OPEN_PATH || /^\/t\/[^/]+$/.test(pathname);
}
