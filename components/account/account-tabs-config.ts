// components/account/account-tabs-config.ts
//
// The Account tab glossary, in a module with NO `'use client'` directive, so the
// Server Component page and the client tab strip can both import it.
//
// WHY THIS FILE EXISTS. `resolveAccountTab` used to live in `AccountTabs.tsx`, which
// is `'use client'`. Next.js replaces every export of a client module with a client
// reference, so `AccountTabs.tsx` exporting a plain function does not give the server
// a plain function — it gives it a proxy that throws the moment it is called:
//
//     Error: Attempted to call resolveAccountTab() from the server but
//     resolveAccountTab is on the client.
//
// `app/(workspace)/profile/page.tsx` called it while resolving `?tab=`, which it does
// BEFORE it checks for a session. So the throw beat the guest redirect and every
// single request to `/profile` — signed in or not — rendered the root error boundary
// instead of the page. It is invisible in local development against a warm cache and
// deterministic in production.
//
// The rule this encodes: a `'use client'` module may export COMPONENTS and HOOKS for a
// server file to render, never a function for it to call. Anything shared as a value
// belongs in a plain module like this one.

export const ACCOUNT_TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'verification', label: 'Verification' },
  { id: 'payouts', label: 'Payouts' },
] as const;

export type AccountTabId = (typeof ACCOUNT_TABS)[number]['id'];

/** Shared with the page so the server's first paint and the strip cannot disagree. */
export function resolveAccountTab(raw: string | null | undefined): AccountTabId {
  return raw === 'verification' || raw === 'payouts' ? raw : 'profile';
}

/** Profile is the bare path, so the landing tab has one canonical URL rather than two. */
export function accountTabHref(id: AccountTabId): string {
  return id === 'profile' ? '/profile' : `/profile?tab=${id}`;
}
