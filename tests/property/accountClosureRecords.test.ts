// tests/property/accountClosureRecords.test.ts
//
// Properties of what closure KEEPS and what it takes away (Req 7.4, 7.5, 7.6).
//
// `tests/property/accountClosure.test.ts` pins the eligibility rule. These two
// properties pin the other half: closure must be survivable by the record trail and
// fatal to the public identity, at the same time. Those pull in opposite directions,
// which is why they are asserted together on one run rather than separately.
//
// EXERCISED THROUGH `closeAccount` AGAINST AN IN-MEMORY FAKE, the way every other
// orchestrator in this repo is tested. No live database, and migration 0111 is not
// applied anywhere.
//
// THE FAKE MODELS 0111'S PROJECTION, NOT A FRIENDLIER ONE. `cardtrade.public_profiles`
// substitutes the anonymous label and nulls the avatar, bio and social links from
// `closed_at` ALONE — it does not read the base-table write the orchestrator performs
// — and `cardtrade.discoverable_profiles` drops closed rows entirely. Both are
// reproduced below from the migration text. A fake that simply returned the base row
// would test a friendlier product than the one that ships: it would pass even if the
// projection were removed, which is the single change most likely to leak a name.
//
// The generators build a member who HAS history but holds nothing in flight, because
// that is the only member closure ever acts on. A member with an open contract is
// refused, and that refusal is Property 1's subject, not this one's.

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  closeAccount,
  type AccountClosureRepository,
} from '@/domain/orchestrator/accountClosureOrchestrator';
import type { MoneyInFlightSnapshot } from '@/domain/account/accountClosure';

const RUNS = { numRuns: 100 };

/** The label 0111's projection substitutes for a closed profile's display name. */
const CLOSED_ACCOUNT_DISPLAY_NAME = 'Closed account';

// ---------------------------------------------------------------------------
// The fake tables
// ---------------------------------------------------------------------------

/** `cardtrade.profiles`, narrowed to the columns closure reads or writes. */
interface ProfileRow {
  id: string;
  display_name: string;
  avatar_path: string | null;
  bio: string | null;
  social_links: Record<string, string> | null;
  /** Req 7.4/7.6 retain these. Closure must not touch either. */
  identity_check_name: string | null;
  merchant_legal_entity_name: string | null;
  identity_check_status: string | null;
  merchant_ref: string | null;
  closed_at: string | null;
}

/** A record that references `profiles.id` and that Req 7.4 protects. */
interface RecordRow {
  id: string;
  /** Which table it stands for, so a failure names the trail that was lost. */
  table: 'cash_sales' | 'trades' | 'reviews' | 'arbitration_notes' | 'cash_sale_payouts';
  profile_id: string;
}

/** `cardtrade.identity_person_keys` (0105): the fraud blocklist. */
interface PersonKeyRow {
  /** HMAC of a government ID. Never the raw number. */
  fingerprint: string;
  profile_id: string;
}

/** `auth.users`, narrowed to what the detach step touches. */
interface AuthUserRow {
  id: string;
  email: string;
  password: string;
  banned_until: string | null;
  user_metadata: Record<string, unknown>;
}

interface FakeDb {
  profiles: Map<string, ProfileRow>;
  records: RecordRow[];
  personKeys: PersonKeyRow[];
  authUsers: Map<string, AuthUserRow>;
  /** What the money check will report. Held here so a run can set it. */
  moneyInFlight: MoneyInFlightSnapshot;
}

// ---------------------------------------------------------------------------
// The public read paths, reproduced from migration 0111
// ---------------------------------------------------------------------------

/** What `cardtrade.public_profiles` exposes. */
interface PublicProfileRow {
  id: string;
  display_name: string;
  avatar_path: string | null;
  social_links: Record<string, string> | null;
  bio: string | null;
  closed_at: string | null;
}

/**
 * `cardtrade.public_profiles`.
 *
 * A closed account still returns a ROW — a counterparty or arbitrator on a completed
 * contract must still see someone — with the display name replaced and the avatar,
 * bio and social links dropped. Keyed off `closed_at` only, exactly as the migration
 * writes it.
 */
function publicProfiles(db: FakeDb): PublicProfileRow[] {
  return [...db.profiles.values()].map((p) => ({
    id: p.id,
    display_name: p.closed_at === null ? p.display_name : CLOSED_ACCOUNT_DISPLAY_NAME,
    avatar_path: p.closed_at === null ? p.avatar_path : null,
    social_links: p.closed_at === null ? p.social_links : null,
    bio: p.closed_at === null ? p.bio : null,
    closed_at: p.closed_at,
  }));
}

/** `cardtrade.discoverable_profiles`: the same shape, closed accounts omitted. */
function discoverableProfiles(db: FakeDb): PublicProfileRow[] {
  return publicProfiles(db).filter((p) => p.closed_at === null);
}

/**
 * Every value any public read path would hand out, flattened.
 *
 * Both views are included, plus the base row itself — the orchestrator's own
 * anonymising write is supposed to make the base table safe too, and asserting only
 * against the views would pass on a repository that wrote nothing at all.
 */
function everyPubliclyReachableValue(db: FakeDb): unknown[] {
  const values: unknown[] = [];
  for (const row of [...publicProfiles(db), ...discoverableProfiles(db)]) {
    values.push(row.display_name, row.avatar_path, row.bio, row.social_links);
  }
  for (const p of db.profiles.values()) {
    values.push(p.display_name, p.avatar_path, p.bio, p.social_links);
  }
  return values;
}

// ---------------------------------------------------------------------------
// The fake repository
// ---------------------------------------------------------------------------

/**
 * An {@link AccountClosureRepository} over {@link FakeDb}, mirroring what
 * `supabaseAccountClosureRepository` does: replace four profile fields, stamp
 * `closed_at`, ban the auth user so live sessions cannot refresh, and rotate the
 * email and credentials to a deterministic non-routable address.
 *
 * It has no delete of any kind, because the interface it implements has none.
 */
function fakeRepository(db: FakeDb): AccountClosureRepository {
  return {
    async loadMoneyInFlight() {
      return db.moneyInFlight;
    },

    async anonymiseProfile(profileId) {
      const profile = db.profiles.get(profileId);
      if (!profile) throw new Error('no such profile');
      profile.display_name = CLOSED_ACCOUNT_DISPLAY_NAME;
      profile.avatar_path = null;
      profile.bio = null;
      profile.social_links = null;
    },

    async markClosed(profileId, at) {
      const profile = db.profiles.get(profileId);
      if (!profile) throw new Error('no such profile');
      profile.closed_at = at.toISOString();
    },

    async revokeSessions(profileId) {
      const user = db.authUsers.get(profileId);
      if (!user) throw new Error('no such auth user');
      user.banned_until = '2125-01-01T00:00:00.000Z';
    },

    async detachAuthIdentity(profileId) {
      const user = db.authUsers.get(profileId);
      if (!user) throw new Error('no such auth user');
      user.email = `closed+${profileId}@accounts.invalid`;
      user.password = `rotated-${db.records.length}-${profileId}`;
      user.user_metadata = { full_name: null, name: null, avatar_url: null, picture: null };
    },
  };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** A display name a member could plausibly have chosen, never the closed label. */
const displayName = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0 && s !== CLOSED_ACCOUNT_DISPLAY_NAME);

const avatarPath = fc.option(
  fc.uuid().map((id) => `${id}/${id}.png`),
  { nil: null },
);

const bio = fc.option(fc.string({ minLength: 1, maxLength: 200 }), { nil: null });

const socialLinks = fc.option(
  fc.dictionary(fc.constantFrom('instagram', 'x', 'youtube', 'tiktok'), fc.webUrl(), {
    minKeys: 1,
    maxKeys: 4,
  }),
  { nil: null },
);

/** The tables whose rows Req 7.4 protects. */
const recordTable = fc.constantFrom<RecordRow['table']>(
  'cash_sales',
  'trades',
  'reviews',
  'arbitration_notes',
  'cash_sale_payouts',
);

/**
 * A member with history: at least one record referencing them, and nothing in flight.
 *
 * "At least one" is the point of the property — a member with no records cannot
 * demonstrate that records survive.
 */
interface Scenario {
  profile: ProfileRow;
  records: RecordRow[];
  personKeys: PersonKeyRow[];
  /** A second member, so a run can prove closure touched only one row. */
  bystander: ProfileRow;
}

/**
 * The closing member's values that Property 3 asserts are UNREACHABLE afterwards,
 * as plain strings, nulls dropped.
 *
 * Named so the generator's collision filter and the property's assertions are
 * demonstrably reading the same four fields rather than two drifting lists.
 * `social_links` is deliberately absent: it is the only one compared structurally
 * (`toContainEqual`), and the only other object anywhere in
 * {@link everyPubliclyReachableValue} is the bystander's, which is null by
 * construction — so it cannot collide with a string.
 */
function identityShapedValues(r: {
  display_name: string;
  avatar_path: string | null;
  bio: string | null;
}): string[] {
  return [r.display_name, r.avatar_path, r.bio].filter((v): v is string => v !== null);
}

const scenario: fc.Arbitrary<Scenario> = fc
  .record({
    id: fc.uuid(),
    bystanderId: fc.uuid(),
    display_name: displayName,
    avatar_path: avatarPath,
    bio,
    social_links: socialLinks,
    identity_check_name: fc.option(fc.string({ minLength: 1, maxLength: 40 }), { nil: null }),
    merchant_legal_entity_name: fc.option(fc.string({ minLength: 1, maxLength: 40 }), {
      nil: null,
    }),
    merchant_ref: fc.option(fc.uuid().map((r) => `acct_${r}`), { nil: null }),
    bystanderName: displayName,
    tables: fc.array(recordTable, { minLength: 1, maxLength: 12 }),
    fingerprints: fc.array(fc.hexaString({ minLength: 16, maxLength: 64 }), {
      minLength: 0,
      maxLength: 3,
    }),
  })
  .filter((r) => r.id !== r.bystanderId)
  // WHY THIS FILTER EXISTS — DO NOT "SIMPLIFY" IT AWAY.
  //
  // Property 3 asserts that no value in `everyPubliclyReachableValue(db)` equals one
  // of the closing member's four identity fields. That helper flattens EVERY profile,
  // including the untouched bystander, and it is right to: a value reachable through
  // ANY public read path is reachable, so narrowing it would stop the property
  // noticing a closure that copied a name onto some other row.
  //
  // The consequence is that the SCENARIO, not the assertion, has to rule out the two
  // ways a value can be present for a reason that has nothing to do with closure:
  //
  //   1. The bystander's display name happening to equal the closing member's
  //      display name, avatar path or bio. Closure never touches the bystander, so
  //      the value is still there and the property reports a leak that is really a
  //      coincidence. Observed on seed -1200536590, where both were the string "key".
  //   2. One of the closing member's values happening to equal 'Closed account'. The
  //      anonymised row now carries that label BY DESIGN, so the assertion fires on
  //      the very substitution it is meant to be checking for. `displayName` already
  //      excludes it; `bio` is a free string and did not.
  //
  // A `.filter` rather than a disjoint alphabet, because a disjoint alphabet would
  // mean constraining the MEMBER's fields too — the bystander's name and the
  // member's bio are both arbitrary strings, so restricting only one of them does
  // not separate them — and that would narrow exactly the inputs most likely to find
  // an escaping-and-quoting leak. The filter is cheap in a way an ordinary
  // `.filter` on generated strings often is not: a collision needs two independently
  // drawn strings to be identical, so the discard rate is ~0 outside fast-check's
  // small-value bias, and no draw is discarded for being INTERESTING, only for being
  // ambiguous.
  .filter((r) => {
    const closing = identityShapedValues(r);
    return (
      !closing.includes(CLOSED_ACCOUNT_DISPLAY_NAME) && !closing.includes(r.bystanderName)
    );
  })
  .map((r) => ({
    profile: {
      id: r.id,
      display_name: r.display_name,
      avatar_path: r.avatar_path,
      bio: r.bio,
      social_links: r.social_links,
      identity_check_name: r.identity_check_name,
      merchant_legal_entity_name: r.merchant_legal_entity_name,
      identity_check_status: 'VERIFIED',
      merchant_ref: r.merchant_ref,
      closed_at: null,
    },
    records: r.tables.map((table, i) => ({ id: `rec-${i}`, table, profile_id: r.id })),
    personKeys: r.fingerprints.map((fingerprint) => ({ fingerprint, profile_id: r.id })),
    bystander: {
      id: r.bystanderId,
      display_name: r.bystanderName,
      avatar_path: null,
      bio: null,
      social_links: null,
      identity_check_name: null,
      merchant_legal_entity_name: null,
      identity_check_status: null,
      merchant_ref: null,
      closed_at: null,
    },
  }));

/** Build the fake database for a scenario. Nothing is in flight. */
function dbFor(s: Scenario): FakeDb {
  return {
    profiles: new Map([
      [s.profile.id, { ...s.profile }],
      [s.bystander.id, { ...s.bystander }],
    ]),
    records: s.records.map((r) => ({ ...r })),
    personKeys: s.personKeys.map((k) => ({ ...k })),
    authUsers: new Map([
      [
        s.profile.id,
        {
          id: s.profile.id,
          email: `${s.profile.id}@example.test`,
          password: 'the-member-knows-this',
          banned_until: null,
          user_metadata: { full_name: s.profile.display_name, avatar_url: s.profile.avatar_path },
        },
      ],
    ]),
    moneyInFlight: {
      activeCashSaleCount: 0,
      activeTradeCollateralCount: 0,
      pendingPayoutCount: 0,
      openDisputeCount: 0,
    },
  };
}

const CLOSED_AT = new Date('2026-09-06T04:00:00.000Z');

/** Close the scenario's own account, asserting it succeeded. */
async function close(db: FakeDb, profileId: string) {
  const result = await closeAccount(fakeRepository(db), {
    callerProfileId: profileId,
    targetProfileId: profileId,
    at: CLOSED_AT,
  });
  expect(result.ok).toBe(true);
  return result;
}

// ---------------------------------------------------------------------------
// Property 3
// ---------------------------------------------------------------------------

describe('Feature: mobile-release-readiness, Property 3: Closure retains the records that arbitration and accounting read', () => {
  // Validates: Requirements 7.4, 7.5
  it('leaves the record count unchanged while no public read path returns the old identity', async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        const db = dbFor(s);

        const before = db.records.length;
        const countsByTable = new Map<string, number>();
        for (const r of db.records) {
          countsByTable.set(r.table, (countsByTable.get(r.table) ?? 0) + 1);
        }
        const previous = {
          display_name: s.profile.display_name,
          avatar_path: s.profile.avatar_path,
          bio: s.profile.bio,
          social_links: s.profile.social_links,
        };

        await close(db, s.profile.id);

        // RETAINED (Req 7.4): the same number of rows, table by table. A total that
        // matched while one table had been emptied and another duplicated would be
        // the exact failure this property exists to catch.
        expect(db.records.length).toBe(before);
        for (const [table, count] of countsByTable) {
          expect(db.records.filter((r) => r.table === table).length).toBe(count);
        }
        // And each row still points at the profile it always did — a record whose
        // owner had been rewritten would be retained in name only.
        for (const r of db.records) {
          expect(r.profile_id).toBe(s.profile.id);
        }

        // GONE (Req 7.5): not from the views, and not from the base row either.
        const reachable = everyPubliclyReachableValue(db);
        expect(reachable).not.toContain(previous.display_name);
        if (previous.avatar_path !== null) {
          expect(reachable).not.toContain(previous.avatar_path);
        }
        if (previous.bio !== null) {
          expect(reachable).not.toContain(previous.bio);
        }
        if (previous.social_links !== null) {
          expect(reachable).not.toContainEqual(previous.social_links);
        }

        // The row still EXISTS on the contract read path, carrying the anonymous
        // label. A closed counterparty must render as someone, not as nobody.
        const publicRow = publicProfiles(db).find((p) => p.id === s.profile.id);
        expect(publicRow).toBeDefined();
        expect(publicRow?.display_name).toBe(CLOSED_ACCOUNT_DISPLAY_NAME);
        expect(publicRow?.avatar_path).toBeNull();
        expect(publicRow?.bio).toBeNull();
        expect(publicRow?.social_links).toBeNull();

        // And is absent from discovery.
        expect(discoverableProfiles(db).some((p) => p.id === s.profile.id)).toBe(false);
      }),
      RUNS,
    );
  });

  it('keeps the identity disclosure and provider state that Req 7.4 retains', async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        const db = dbFor(s);
        await close(db, s.profile.id);

        const row = db.profiles.get(s.profile.id);
        // The provider-verified legal name IS the seller identity disclosure an
        // arbitrator reads on a completed contract. Blanking it would strip the
        // counterparty record off every sale the member ever fronted.
        expect(row?.identity_check_name).toBe(s.profile.identity_check_name);
        expect(row?.merchant_legal_entity_name).toBe(s.profile.merchant_legal_entity_name);
        expect(row?.identity_check_status).toBe('VERIFIED');
        expect(row?.merchant_ref).toBe(s.profile.merchant_ref);
      }),
      RUNS,
    );
  });

  it('touches nobody else', async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        const db = dbFor(s);
        await close(db, s.profile.id);

        const bystander = db.profiles.get(s.bystander.id);
        expect(bystander?.display_name).toBe(s.bystander.display_name);
        expect(bystander?.closed_at).toBeNull();
        expect(discoverableProfiles(db).some((p) => p.id === s.bystander.id)).toBe(true);
      }),
      RUNS,
    );
  });

  it('is idempotent: a retried closure changes nothing further', async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        const db = dbFor(s);
        await close(db, s.profile.id);
        const afterFirst = JSON.stringify({
          profile: db.profiles.get(s.profile.id),
          records: db.records,
          personKeys: db.personKeys,
          email: db.authUsers.get(s.profile.id)?.email,
        });

        await close(db, s.profile.id);

        expect(
          JSON.stringify({
            profile: db.profiles.get(s.profile.id),
            records: db.records,
            personKeys: db.personKeys,
            email: db.authUsers.get(s.profile.id)?.email,
          }),
        ).toBe(afterFirst);
      }),
      RUNS,
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4
// ---------------------------------------------------------------------------

describe('Feature: mobile-release-readiness, Property 4: Closure preserves the fraud blocklist key', () => {
  // Validates: Requirements 7.6
  it('leaves every blocklist key the member held present after closure', async () => {
    await fc.assert(
      fc.asyncProperty(
        scenario.filter((s) => s.personKeys.length > 0),
        async (s) => {
          const db = dbFor(s);
          const before = db.personKeys.map((k) => `${k.fingerprint}:${k.profile_id}`).sort();

          await close(db, s.profile.id);

          // Same fingerprints, still attributed to the same profile. Closure being a
          // way to shed the key would make it a way to launder a ban: the next
          // account that verifies as the same person would be let through.
          expect(db.personKeys.map((k) => `${k.fingerprint}:${k.profile_id}`).sort()).toEqual(
            before,
          );
        },
      ),
      RUNS,
    );
  });

  it('keeps the key even for a member who held nothing else identifying', async () => {
    const db: FakeDb = {
      profiles: new Map([
        [
          'a0000000-0000-4000-8000-000000000001',
          {
            id: 'a0000000-0000-4000-8000-000000000001',
            display_name: 'Scammer',
            avatar_path: null,
            bio: null,
            social_links: null,
            identity_check_name: null,
            merchant_legal_entity_name: null,
            identity_check_status: 'VERIFIED',
            merchant_ref: null,
            closed_at: null,
          },
        ],
      ]),
      records: [],
      personKeys: [
        { fingerprint: 'deadbeefdeadbeef', profile_id: 'a0000000-0000-4000-8000-000000000001' },
      ],
      authUsers: new Map([
        [
          'a0000000-0000-4000-8000-000000000001',
          {
            id: 'a0000000-0000-4000-8000-000000000001',
            email: 'scammer@example.test',
            password: 'known',
            banned_until: null,
            user_metadata: {},
          },
        ],
      ]),
      moneyInFlight: {
        activeCashSaleCount: 0,
        activeTradeCollateralCount: 0,
        pendingPayoutCount: 0,
        openDisputeCount: 0,
      },
    };

    await close(db, 'a0000000-0000-4000-8000-000000000001');

    expect(db.personKeys).toHaveLength(1);
    expect(db.personKeys[0].fingerprint).toBe('deadbeefdeadbeef');
  });
});

// ---------------------------------------------------------------------------
// The detach step, asserted alongside because Property 3 depends on it
// ---------------------------------------------------------------------------

describe('closure detaches the auth identity without deleting it', () => {
  it('rotates the email to a deterministic non-routable address and keeps the user row', async () => {
    await fc.assert(
      fc.asyncProperty(scenario, async (s) => {
        const db = dbFor(s);
        const originalEmail = db.authUsers.get(s.profile.id)?.email;

        await close(db, s.profile.id);

        const user = db.authUsers.get(s.profile.id);
        // The row survives: `profiles.id` references it, and Req 7.4 protects the
        // records that reference the profile.
        expect(user).toBeDefined();
        expect(user?.email).not.toBe(originalEmail);
        expect(user?.email).toBe(`closed+${s.profile.id}@accounts.invalid`);
        // RFC 2606 reserves `.invalid`, so the address can never resolve.
        expect(user?.email.endsWith('.invalid')).toBe(true);
        expect(user?.password).not.toBe('the-member-knows-this');
        expect(user?.banned_until).not.toBeNull();
        // The OAuth display fields are cleared: two provisioning paths read them to
        // set a profile display name, so leaving them is a route by which the real
        // name gets written back onto an anonymised row.
        expect(user?.user_metadata.full_name).toBeNull();
        expect(user?.user_metadata.avatar_url).toBeNull();
      }),
      RUNS,
    );
  });
});
