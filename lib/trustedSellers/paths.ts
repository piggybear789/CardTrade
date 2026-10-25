// lib/trustedSellers/paths.ts
//
// The Trusted Seller entry points (0152). Plain constants, safe on server and client.
//
// `/trusted-sellers` is the public page linked from NoDitto's Instagram.
// `/trusted-sellers/apply` is the signed-in form and status page. A new account that
// signs up from the public page carries the apply path as `redirectTo` through sign-up
// and onboarding, and the onboarding wizard reads it to skip the "buy or sell?"
// question: the member has already answered it by applying.

export const TRUSTED_SELLER_APPLY_PATH = '/trusted-sellers/apply';

/** Whether a same-origin path (query and hash allowed) is the apply page. */
export function isTrustedSellerApplyPath(path: string | null | undefined): boolean {
  if (!path) return false;
  const pathname = path.split(/[?#]/)[0].replace(/\/+$/, '');
  return pathname === TRUSTED_SELLER_APPLY_PATH;
}
