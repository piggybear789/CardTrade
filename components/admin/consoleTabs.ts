// components/admin/consoleTabs.ts
//
// The Operations console's tab vocabulary, shared by the page and its loading
// boundary. Kept in a plain module (no `server-only`, no React) so the client-side
// skeleton switch can resolve `?tab=` through the SAME function the page does — two
// copies of "which tab does this URL mean" is how a placeholder ends up drawing the
// wrong queue.

/** Which queue the operator is looking at. */
export type ConsoleTab = 'payouts' | 'reports' | 'feedback' | 'errors' | 'reconciliation';

/**
 * Narrow an arbitrary `?tab=` value.
 *
 * Defaults to Payouts, not Reports: it is the only queue holding money that belongs to
 * somebody else, so it is the one whose backlog costs trust rather than tidiness.
 */
export function resolveConsoleTab(value: string | string[] | null | undefined): ConsoleTab {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === 'reports' || raw === 'feedback' || raw === 'errors' || raw === 'reconciliation'
    ? raw
    : 'payouts';
}
