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
  type IdentityCheckStatus,
  type IdentityGateInput,
} from '@/domain/identity/identityGate';

const IDENTITY_CHECK_STATUSES: IdentityCheckStatus[] = ['NONE', 'PENDING', 'VERIFIED', 'FAILED'];

const gateInput: fc.Arbitrary<IdentityGateInput> = fc.record({
  identityCheckStatus: fc.constantFrom(...IDENTITY_CHECK_STATUSES),
});

/**
 * Values that must never influence the answer.
 *
 * Two eras of retired state here, both deliberate:
 *
 *  1. The payer gate dropped in 0043 — `kyc_status`, `identity_verified_*`,
 *     `identity_session_id`. Reintroducing any of these names is how the original
 *     two-gate bug would come back.
 *  2. The CONNECT columns, which stopped being the gate in 0069. They still exist
 *     and are still load-bearing for `canReceiveFunds`, so this is the sharper
 *     property now: a member can be APPROVED with settlements active and still not
 *     be verified, and vice versa. The gate must read neither.
 */
const nonGateColumns = fc.record({
  kyc_status: fc.constantFrom('UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED'),
  kyc_reason: fc.option(fc.string(), { nil: null }),
  identity_verified_name: fc.option(fc.string(), { nil: null }),
  identity_verified_first_name: fc.option(fc.string(), { nil: null }),
  identity_verified_at: fc.option(fc.string(), { nil: null }),
  identity_is_adult: fc.option(fc.boolean(), { nil: null }),
  identity_session_id: fc.option(fc.string(), { nil: null }),
  merchantStatus: fc.constantFrom('NONE', 'PENDING', 'APPROVED', 'REJECTED'),
  settlementsEnabled: fc.boolean(),
});

describe('satisfiesIdentityGate', () => {
  it('is exactly "the Identity check was accepted", for every input', () => {
    fc.assert(
      fc.property(gateInput, (input) => {
        expect(satisfiesIdentityGate(input)).toBe(input.identityCheckStatus === 'VERIFIED');
      }),
    );
  });

  it('never treats a started-but-unfinished check as verified', () => {
    // Creating a VerificationSession is the START. A member who has opened Stripe's
    // pages and not finished has proven nothing, so they must not be able to list,
    // sell, or enter trade escrow. Same lesson as the 0060 Connect account shell.
    expect(satisfiesIdentityGate({ identityCheckStatus: 'PENDING' })).toBe(false);
    expect(satisfiesIdentityGate({ identityCheckStatus: 'FAILED' })).toBe(false);
    expect(satisfiesIdentityGate({ identityCheckStatus: 'NONE' })).toBe(false);
  });

  it('is unaffected by any non-gate value, Connect included (independence property)', () => {
    fc.assert(
      fc.property(gateInput, nonGateColumns, (input, other) => {
        // Spread in to prove the predicate cannot read them even when they sit on
        // the same object. Connect state is in here on purpose: since 0069 being
        // payable and being verified are different questions.
        const polluted = { ...other, ...input } as IdentityGateInput;
        expect(satisfiesIdentityGate(polluted)).toBe(satisfiesIdentityGate(input));
      }),
    );
  });

  it('does not read Connect approval as verification (two-step property)', () => {
    // The precise thing 0069 changed: a member fully set up for payouts is NOT
    // verified unless they also passed the document check.
    const payableButUnverified = {
      merchantStatus: 'APPROVED',
      settlementsEnabled: true,
      identityCheckStatus: 'NONE',
    } as unknown as IdentityGateInput;
    expect(satisfiesIdentityGate(payableButUnverified)).toBe(false);

    // And the converse: verified with no payout account at all.
    const verifiedNotPayable = {
      merchantStatus: 'NONE',
      settlementsEnabled: false,
      identityCheckStatus: 'VERIFIED',
    } as unknown as IdentityGateInput;
    expect(satisfiesIdentityGate(verifiedNotPayable)).toBe(true);
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

  it('reports a created-but-unfinished session as still in progress', () => {
    expect(verificationState({ identityCheckStatus: 'PENDING' })).toBe('IN_PROGRESS');
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

  it('reports NOT_STARTED only when no check was ever created', () => {
    fc.assert(
      fc.property(gateInput, (input) => {
        if (verificationState(input) !== 'NOT_STARTED') return;
        expect(input.identityCheckStatus).toBe('NONE');
      }),
    );
  });

  it('reports NOT_APPROVED only when the check failed', () => {
    fc.assert(
      fc.property(gateInput, (input) => {
        if (verificationState(input) !== 'NOT_APPROVED') return;
        expect(input.identityCheckStatus).toBe('FAILED');
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

  // Buy-only members never verify, so the gate is false for them and every gated
  // action must be refused while buying stays open. The gate itself carries no
  // notion of "buyer": that exemption is expressed by simply not consulting it on
  // buyer paths, which this asserts is safe to rely on.
  it('a member who never verified is never verified (buyer-exemption property)', () => {
    expect(satisfiesIdentityGate({ identityCheckStatus: 'NONE' })).toBe(false);
    expect(verificationState({ identityCheckStatus: 'NONE' })).toBe('NOT_STARTED');
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
 * Only the one known column test is accepted. Anything else — an OR, a negation, a
 * Connect column, a different comparison — throws, so a change in the SQL that this
 * test cannot reason about fails loudly rather than passing silently.
 *
 * The Connect terms are NOT accepted any more. That is the point of 0069: if a
 * future migration reintroduces `merchant_settlements_enabled` into a gate
 * expression, this throws rather than quietly agreeing, because the TypeScript no
 * longer reads it and the two would have diverged.
 */
function sqlPredicate(expression: string): (input: IdentityGateInput) => boolean {
  const VERIFIED =
    /^(new\.)?identity_check_status\s*=\s*'VERIFIED'::cardtrade\.identity_check_status$/;

  const terms = expression
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\(|\)$/g, '')
    .split(/\s+and\s+/i)
    .map((term) => term.trim());

  const checks = terms.map((term) => {
    if (VERIFIED.test(term)) {
      return (input: IdentityGateInput) => input.identityCheckStatus === 'VERIFIED';
    }
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

  it('propagates on the gate column, so the denormalisation cannot go stale', () => {
    // 0060 narrowed this to `after update of merchant_status` while the gate also
    // depended on settlements, so the transition that MEANT onboarding finished did
    // not fire and every item row would have frozen. Nothing read the column yet, so
    // it would have failed silently and indefinitely. The gate now depends on one
    // column, so this must watch exactly that one — no more, no fewer.
    const trigger = effectiveExpression(
      /create trigger profiles_sync_items_seller_identity_verified\s*\n\s*after update of ([^\n]*)\n/,
      'the seller_identity_verified propagation trigger',
    );
    const columns = trigger.split(',').map((column) => column.trim());
    expect(columns).toEqual(['identity_check_status']);
  });
});
