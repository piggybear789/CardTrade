// components/onboarding/providerReturn.ts
//
// What the return markers on a URL say about where a member has just come back from.
//
// Stripe's hosted flows send a member back with a marker: `?identity=complete` from an
// identity check, `?payouts=complete` from Connect onboarding, `?payouts=refresh` when
// the Connect link expired mid-flow. The marker is read in two places — the route,
// which picks a screen from it, and `UnifiedOnboardingSurface`, which shows the step it
// names as "confirming with Stripe" instead of offering its button again — and both
// have to agree on what counts, so the reading lives here once.
//
// NO `'use client'`, deliberately: the Server Component pages call this while resolving
// their search params, and a client module's exports are references that throw when a
// server file calls them (see `components/account/account-tabs-config.ts`).
//
// A MARKER IS NOT EVIDENCE. Anyone can type `?payouts=complete`. It says which step to
// look at; the provider read-back decides whether that step passed.

/** Which hosted flow the member is returning from, if any. */
export type ProviderReturn =
  /** Back from a hosted identity check. The result may still be pending. */
  | 'identity'
  /** Back from Connect onboarding. `payouts_enabled` may still be false. */
  | 'payout'
  /** Connect's single-use link expired before they finished; nothing was submitted. */
  | 'payout-expired';

type SearchParamValue = string | string[] | undefined;

function first(value: SearchParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Read the return markers off a page's search params.
 *
 * Identity wins if both are somehow present: it is the earlier step, and a surface
 * confirming the wrong one would sit a spinner on a step the member has not reached.
 */
export function resolveProviderReturn(
  params: Record<string, SearchParamValue>,
): ProviderReturn | null {
  if (first(params.identity) === 'complete') return 'identity';
  const payouts = first(params.payouts);
  if (payouts === 'complete') return 'payout';
  if (payouts === 'refresh') return 'payout-expired';
  return null;
}
