// tests/property/identityGate.test.ts
//
// Property tests for the single Identity_Gate (Req 21).
//
// The point of these is to make the two-gate contradiction unrepresentable. The
// app previously answered "is this member verified" from `kyc_status` on some
// surfaces and from `merchant_status` on others, so a member could be badged
// verified in the rail and unverified on their profile. These properties assert
// there is one source, that every surface agrees with it, and that no retired
// column can influence it.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  satisfiesIdentityGate,
  showsVerifiedBadge,
  verificationState,
  type IdentityGateInput,
  type MerchantStatus,
} from '@/domain/identity/identityGate';

const MERCHANT_STATUSES: MerchantStatus[] = ['NONE', 'PENDING', 'APPROVED', 'REJECTED'];

const gateInput: fc.Arbitrary<IdentityGateInput> = fc.record({
  merchantStatus: fc.constantFrom(...MERCHANT_STATUSES),
  settlementsEnabled: fc.boolean(),
});

/** A retired payer-gate row, which must never influence the answer. */
const retiredColumns = fc.record({
  kyc_status: fc.constantFrom('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED'),
  kyc_reason: fc.option(fc.string(), { nil: null }),
  identity_verified_name: fc.option(fc.string(), { nil: null }),
  identity_verified_first_name: fc.option(fc.string(), { nil: null }),
  identity_verified_at: fc.option(fc.string(), { nil: null }),
  identity_is_adult: fc.option(fc.boolean(), { nil: null }),
  identity_session_id: fc.option(fc.string(), { nil: null }),
});

describe('satisfiesIdentityGate', () => {
  it('requires BOTH approval and active transfers, for every input', () => {
    fc.assert(
      fc.property(gateInput, (input) => {
        expect(satisfiesIdentityGate(input)).toBe(
          input.merchantStatus === 'APPROVED' && input.settlementsEnabled,
        );
      }),
    );
  });

  it('never treats a Connect account shell without active transfers as verified', () => {
    // The 0060 regression: creating the account is the START of onboarding. A member
    // in this state has completed nothing on Stripe's pages, so they must not be able
    // to list, sell, or enter trade escrow.
    expect(satisfiesIdentityGate({ merchantStatus: 'APPROVED', settlementsEnabled: false })).toBe(false);
  });

  it('is unaffected by any retired payer-gate value (independence property)', () => {
    fc.assert(
      fc.property(gateInput, retiredColumns, (input, retired) => {
        // The retired columns are spread in to prove the predicate cannot read
        // them even when they are present on the same object.
        const polluted = { ...retired, ...input } as IdentityGateInput;
        expect(satisfiesIdentityGate(polluted)).toBe(satisfiesIdentityGate(input));
      }),
    );
  });
});

describe('verificationState', () => {
  it('agrees with the gate on VERIFIED (consistency property)', () => {
    fc.assert(
      fc.property(gateInput, (input) => {
        expect(verificationState(input) === 'VERIFIED').toBe(satisfiesIdentityGate(input));
      }),
    );
  });

  it('reports approval without active transfers as still in progress', () => {
    // Deliberately not a distinct state: from the member's point of view there is one
    // thing left to happen, and surfacing "approved but not payable" as its own status
    // is how the two-gate confusion started.
    expect(
      verificationState({ merchantStatus: 'APPROVED', settlementsEnabled: false }),
    ).toBe('IN_PROGRESS');
  });

  it('maps every status to exactly one state', () => {
    fc.assert(
      fc.property(gateInput, (input) => {
        expect(['NOT_STARTED', 'IN_PROGRESS', 'NOT_APPROVED', 'VERIFIED']).toContain(
          verificationState(input),
        );
      }),
    );
  });

  it('reports NOT_STARTED only when nothing was submitted', () => {
    fc.assert(
      fc.property(gateInput, (input) => {
        if (verificationState(input) !== 'NOT_STARTED') return;
        expect(input.merchantStatus).toBe('NONE');
      }),
    );
  });

  it('reports NOT_APPROVED only when the provider declined', () => {
    fc.assert(
      fc.property(gateInput, (input) => {
        if (verificationState(input) !== 'NOT_APPROVED') return;
        expect(input.merchantStatus).toBe('REJECTED');
      }),
    );
  });
});

describe('every verification surface answers from one source', () => {
  it('badge and gate never disagree (consistency property)', () => {
    fc.assert(
      fc.property(gateInput, (input) => {
        expect(showsVerifiedBadge(input)).toBe(satisfiesIdentityGate(input));
      }),
    );
  });

  // Buy-only members hold no Connected_Account, so the gate is false for them and
  // every gated action must be refused while buying stays open. The gate itself
  // carries no notion of "buyer": that exemption is expressed by simply not
  // consulting it on buyer paths, which this asserts is safe to rely on.
  it('a member with no connected account is never verified (buyer-exemption property)', () => {
    fc.assert(
      fc.property(fc.boolean(), (settlementsEnabled) => {
        expect(satisfiesIdentityGate({ merchantStatus: 'NONE', settlementsEnabled })).toBe(
          false,
        );
        expect(verificationState({ merchantStatus: 'NONE', settlementsEnabled })).toBe(
          'NOT_STARTED',
        );
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Req 21.6 — the denormalisation-agreement property.
//
// `domain/identity/identityGate.ts` claimed this property existed for a long time
// before it did. That is not a paperwork problem: it is exactly how migration 0060
// changed `public_profiles.is_verified` and both `seller_identity_verified` trigger
// functions to an APPROVED-only expression while the module header went on
// describing the settlement-backed one. Two answers to one question, which the
// header itself names as the bug that silently broke buying.
//
// So this reads the effective SQL out of `supabase/migrations/` and evaluates it
// against `satisfiesIdentityGate` over every input. It is deliberately strict about
// the FORM of the expression: an expression it cannot interpret throws rather than
// passing, because a silent pass here is worse than no test at all.
// ---------------------------------------------------------------------------

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

/** Migration file contents, newest first. */
function migrationsNewestFirst(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .reverse()
    .map((name) => readFileSync(join(MIGRATIONS_DIR, name), 'utf8'));
}

/**
 * The effective definition of a SQL expression: the one in the highest-numbered
 * migration that defines it, since later migrations replace earlier ones.
 */
function effectiveExpression(pattern: RegExp, label: string): string {
  for (const sql of migrationsNewestFirst()) {
    const match = sql.match(pattern);
    if (match?.[1]) return match[1];
  }
  throw new Error(`No migration defines ${label}`);
}

/**
 * Turn a SQL boolean expression into a predicate over {@link IdentityGateInput}.
 *
 * Only a conjunction of the two known column tests is accepted. Anything else —
 * an OR, a negation, a third column, a different comparison — throws, so a
 * change in the SQL that this test cannot reason about fails loudly.
 */
function sqlPredicate(expression: string): (input: IdentityGateInput) => boolean {
  const APPROVED = /^(new\.)?merchant_status\s*=\s*'APPROVED'::cardtrade\.merchant_status$/;
  const SETTLEMENTS = /^(new\.)?merchant_settlements_enabled$/;

  const terms = expression
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\(|\)$/g, '')
    .split(/\s+and\s+/i)
    .map((term) => term.trim());

  const checks = terms.map((term) => {
    if (APPROVED.test(term)) {
      return (input: IdentityGateInput) => input.merchantStatus === 'APPROVED';
    }
    if (SETTLEMENTS.test(term)) return (input: IdentityGateInput) => input.settlementsEnabled;
    throw new Error(`Uninterpretable SQL term in the Identity_Gate expression: ${term}`);
  });

  return (input) => checks.every((check) => check(input));
}

describe('SQL/TypeScript denormalisation agreement (Req 21.6)', () => {
  const sources: Array<[string, RegExp]> = [
    ['public_profiles.is_verified', /\(([^()]*?)\)\s+as is_verified/],
    [
      'set_item_seller_identity_verified()',
      /select\s*\(([\s\S]*?)\)\s*into new\.seller_identity_verified/,
    ],
    ['sync_items_seller_identity_verified()', /verified\s*:=\s*\(([\s\S]*?)\);/],
  ];

  for (const [label, pattern] of sources) {
    it(`${label} computes exactly what satisfiesIdentityGate computes`, () => {
      const predicate = sqlPredicate(effectiveExpression(pattern, label));
      fc.assert(
        fc.property(gateInput, (input) => {
          expect(predicate(input)).toBe(satisfiesIdentityGate(input));
        }),
      );
    });
  }

  it('propagates on both gate columns, so the denormalisation cannot go stale', () => {
    // 0060 narrowed this to `after update of merchant_status`. With the gate depending
    // on settlements, a report flipping only settlements — the transition that MEANS
    // onboarding finished — would not fire, and every item row would freeze. Nothing
    // reads the column yet, so it would have failed silently and indefinitely.
    const trigger = effectiveExpression(
      /create trigger profiles_sync_items_seller_identity_verified\s*\n\s*after update of ([^\n]*)\n/,
      'the seller_identity_verified propagation trigger',
    );
    const columns = trigger.split(',').map((column) => column.trim());
    expect(columns).toEqual(['merchant_status', 'merchant_settlements_enabled']);
  });
});
