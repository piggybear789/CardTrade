// lib/identity/identityStart.ts
//
// The link that starts an identity check and brings the member back to the page they
// came from. Pure, so the share dialog (client) and the claim route (server) build the
// same address. The route itself is `app/api/identity/start`.

/** The route that starts the identity check. */
export const IDENTITY_START_PATH = '/api/identity/start';

/** The link that starts the identity check and returns to `returnPath` afterwards. */
export function identityStartHref(returnPath: string): string {
  return `${IDENTITY_START_PATH}?returnPath=${encodeURIComponent(returnPath)}`;
}
