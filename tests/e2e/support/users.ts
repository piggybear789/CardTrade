// tests/e2e/support/users.ts
//
// Fixed seed data from supabase/seed.sql, typed for reuse across specs.
// Never edit a row referenced here without updating seed.sql to match.

export interface SeedUser {
  id: string;
  email: string;
  displayName: string;
  password: string;
}

export const PASSWORD = 'password123';

export const ALICE: SeedUser = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'alice@example.com',
  displayName: 'Alice Nguyen',
  password: PASSWORD,
};

export const BOB: SeedUser = {
  id: '22222222-2222-2222-2222-222222222222',
  email: 'bob@example.com',
  displayName: 'Bob Carter',
  password: PASSWORD,
};

export const CAROL: SeedUser = {
  id: '33333333-3333-3333-3333-333333333333',
  email: 'carol@example.com',
  displayName: 'Carol Diaz',
  password: PASSWORD,
};

export const DAVE: SeedUser = {
  id: '44444444-4444-4444-4444-444444444444',
  email: 'dave@example.com',
  displayName: 'Dave Ellis',
  password: PASSWORD,
};

export const ERIN: SeedUser = {
  id: '55555555-5555-5555-5555-555555555555',
  email: 'erin@example.com',
  displayName: 'Erin Frost',
  password: PASSWORD,
};

/** is_admin capability (moderate + arbitrate) — see lib/staffGate.ts. */
export const FRANK_ADMIN: SeedUser = {
  id: '66666666-6666-6666-6666-666666666666',
  email: 'frank@example.com',
  displayName: 'Frank Ito',
  password: PASSWORD,
};

/** is_support capability only (arbitrate, not moderate) — see lib/staffGate.ts. */
export const GRACE_SUPPORT: SeedUser = {
  id: '77777777-7777-7777-7777-777777777777',
  email: 'grace@example.com',
  displayName: 'Grace Oduya',
  password: PASSWORD,
};

/** Dedicated user for sign-out specs so Alice's shared session is never revoked. */
export const HEIDI_SIGNOUT: SeedUser = {
  id: '88888888-8888-8888-8888-888888888888',
  email: 'heidi@example.com',
  displayName: 'Heidi Signout',
  password: PASSWORD,
};

/**
 * US-region members (0122). Every other seeded user trades in AU.
 *
 * A SECOND REGION NEEDS ITS OWN PAIR, not a flipped flag on an existing one.
 * `profiles.region_code` is read by every contract guard, so moving Alice to US would
 * silently re-point the whole AU suite; and a US seller needs a US counterparty because
 * `checkRegionCompatibility` refuses a cross-region contract by design — that refusal is
 * itself one of the things worth testing.
 *
 * NAMESPACED IDS deliberately. The obvious next sequential ids (`8888…`, `9999…`) are
 * reserved: `8888…` is {@link HEIDI_SIGNOUT}, which `auth-and-navigation.spec.ts` signs
 * in as. Taking it swapped her email out from under that spec.
 */
export const UMA_US_SELLER: SeedUser = {
  id: 'bbbbbbb1-0000-0000-0000-000000000001',
  email: 'uma@example.com',
  displayName: 'Uma Patel',
  password: PASSWORD,
};

export const VICTOR_US_BUYER: SeedUser = {
  id: 'bbbbbbb2-0000-0000-0000-000000000002',
  email: 'victor@example.com',
  displayName: 'Victor Reyes',
  password: PASSWORD,
};

export const SEED_USERS = [
  ALICE,
  BOB,
  CAROL,
  DAVE,
  ERIN,
  FRANK_ADMIN,
  GRACE_SUPPORT,
  UMA_US_SELLER,
  VICTOR_US_BUYER,
];

/** Equal-FMV AVAILABLE item pair (Pair A, $250.00) — Alice's side, Bob's side. */
export const TRADE_PAIR_A = {
  aliceItemId: 'aaaaaaa1-0000-0000-0000-000000000001',
  bobItemId: 'aaaaaaa2-0000-0000-0000-000000000002',
};

export function storageStatePath(user: SeedUser): string {
  return `playwright/.auth/${user.email.split('@')[0]}.json`;
}
