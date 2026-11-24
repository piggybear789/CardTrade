// tests/e2e/support/users.ts
//
// Fixed seed data from supabase/seed.sql, typed for reuse across specs.
// Never edit a row referenced here without updating seed.sql to match.

import { envValue } from './db';

export interface SeedUser {
  id: string;
  email: string;
  displayName: string;
  password: string;
}

/**
 * The seeded accounts' password. In the dev sandbox these accounts live in the
 * production project's `auth.users`, so `scripts/dev/resetDevSchema.mjs` gives them
 * E2E_SEED_PASSWORD from `.env.local` instead of seed.sql's public one.
 */
export const PASSWORD = envValue('E2E_SEED_PASSWORD') ?? 'password123';

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

/**
 * Every seeded account the run signs in as, for the preflight seed check and its
 * account-flag check (Req 2.2, 2.3): {@link SEED_USERS} plus {@link HEIDI_SIGNOUT}.
 *
 * Heidi is kept OUT of `SEED_USERS` on purpose. `auth.setup.ts` signs that list in and
 * stores a shared jar per member, and the sign-out Pathway signs Heidi in itself and
 * revokes her session; a stored jar for her would be revoked under any other spec
 * that loaded it. She is still a Sandbox_Account the suite signs in as, so the seed
 * checks must cover her.
 */
export const SEED_CHECK_USERS: readonly SeedUser[] = [...SEED_USERS, HEIDI_SIGNOUT];

// ---------------------------------------------------------------------------
// App servers and aux-server personas
// ---------------------------------------------------------------------------

/** The two App_Servers (design, "Servers"). */
export type AppServer = 'main' | 'aux';

/** Port of each App_Server. */
export const APP_SERVER_PORTS: Readonly<Record<AppServer, number>> = { main: 3100, aux: 3101 };

/** Base URL of an App_Server. */
export function appServerUrl(server: AppServer): string {
  return `http://localhost:${APP_SERVER_PORTS[server]}`;
}

/**
 * A seeded member signed in on the AUX server (mock payments, default auth limit).
 *
 * WHY A SECOND JAR, not the main one. Cookies do not separate by port, but sessions
 * do rotate (F14): a main-server context and an aux-server context replaying one
 * refresh token would revoke each other's token family. Each server gets its own
 * sign-in, so its own token family and its own file.
 *
 * WHY AN ADDRESS. The aux server keeps the production limit of 5 sign-ins a minute,
 * keyed by IP (`rateLimitIdentifier`), because the rate-limit Pathway runs there.
 * Each persona signs in from its own `x-forwarded-for` in TEST-NET-3
 * (203.0.113.0/24, RFC 5737), so setup never spends that budget.
 */
export interface AuxPersona {
  user: SeedUser;
  /** The `x-forwarded-for` this persona signs in from on the aux server. */
  signInAddress: string;
}

/**
 * The first host number used for aux sign-in addresses. Setup takes
 * `203.0.113.200` upwards; member contexts on the aux server take addresses below it,
 * so the two never share a limiter bucket.
 */
export const AUX_SIGN_IN_HOST_BASE = 200;

/**
 * Members the `provider: 'mock'` Pathways sign in as on the aux server: two buyer /
 * seller pairs for cash sales and trades, and the admin who resolves their disputes.
 */
export const AUX_PERSONAS: readonly AuxPersona[] = [ALICE, BOB, CAROL, DAVE, FRANK_ADMIN].map(
  (user, i) => ({ user, signInAddress: `203.0.113.${AUX_SIGN_IN_HOST_BASE + i}` }),
);

// ---------------------------------------------------------------------------
// Per-Pathway members
// ---------------------------------------------------------------------------

/**
 * A member a Pathway CREATES because no seed member is in the state it needs: no
 * saved card, unverified, another region, a shared card (design, "Stripe bindings").
 * `createPersona()` in `audit/backend/seed.ts` turns this into a marked account with
 * `app_metadata.sandbox = true` set at creation (Req 2.1).
 */
export interface PersonaSpec {
  kind: 'persona';
  /** Lowercase word used in the marked email and display name, e.g. `no-card-buyer`. */
  label: string;
  /** Trading region (`profiles.region_code`). Defaults to `AU`. */
  regionCode?: string;
  /** Whether the Identity_Gate is satisfied. Defaults to false. */
  identityVerified?: boolean;
  /** Whether onboarding is finished. Defaults to true. */
  onboarded?: boolean;
  /** Whether the persona has a saved card. Defaults to false. */
  savedCard?: boolean;
}

/** A Pathway member: a seed member, a persona to create, or a signed-out guest. */
export type PathwayMember = SeedUser | PersonaSpec | 'guest';

const PERSONA_LABEL = /^[a-z][a-z0-9-]*$/;

/**
 * A {@link PersonaSpec}, with its label checked against the member-label grammar
 * (`MEMBER_LABEL_PATTERN` in `audit/core/artifactPaths.ts`), so the persona's name can
 * appear in artifact paths and marked emails as is.
 */
export function persona(label: string, options: Omit<PersonaSpec, 'kind' | 'label'> = {}): PersonaSpec {
  if (!PERSONA_LABEL.test(label)) {
    throw new RangeError(`persona: invalid label ${JSON.stringify(label)}`);
  }
  return { kind: 'persona', label, ...options };
}

/** True when a Pathway member is a persona to create. */
export function isPersonaSpec(member: PathwayMember): member is PersonaSpec {
  return typeof member === 'object' && 'kind' in member && member.kind === 'persona';
}

/** True when a Pathway member is a seeded account. */
export function isSeedUser(member: PathwayMember): member is SeedUser {
  return typeof member === 'object' && !isPersonaSpec(member);
}

/** Equal-FMV AVAILABLE item pair (Pair A, $250.00) — Alice's side, Bob's side. */
export const TRADE_PAIR_A = {
  aliceItemId: 'aaaaaaa1-0000-0000-0000-000000000001',
  bobItemId: 'aaaaaaa2-0000-0000-0000-000000000002',
};

/**
 * The stored session for `user` on `server`. The main server's path is unchanged
 * (`playwright/.auth/<name>.json`); the aux server's sits in `playwright/.auth/aux/`.
 */
export function storageStatePath(user: SeedUser, server: AppServer = 'main'): string {
  const name = user.email.split('@')[0];
  return server === 'aux' ? `playwright/.auth/aux/${name}.json` : `playwright/.auth/${name}.json`;
}
