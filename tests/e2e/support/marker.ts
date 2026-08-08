// tests/e2e/support/marker.ts
//
// Every row a spec creates must be identifiable as test data so
// scripts/e2e/cleanup-test-data.ts can find and remove it by this marker alone
// — not by tracking IDs in memory, which a crashed run would lose. The 5+2
// seeded fixture users/items never match this prefix, so cleanup can never
// touch them by mistake.

export const E2E_MARKER = '[E2E]';

/** Prefix a listing title / display name so cleanup can find it later. */
export function marked(base: string): string {
  return `${E2E_MARKER} ${base}`;
}

/** A unique, marked email for specs that sign up a brand-new account. */
export function markedEmail(label: string): string {
  return `e2e-${label}-${Date.now()}@example.com`;
}
