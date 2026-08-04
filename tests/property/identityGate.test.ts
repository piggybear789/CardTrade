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
  it('is true only for APPROVED with settlements enabled (single-source property)', () => {
    fc.assert(
      fc.property(gateInput, (input) => {
        expect(satisfiesIdentityGate(input)).toBe(
          input.merchantStatus === 'APPROVED' && input.settlementsEnabled,
        );
      }),
    );
  });

  it('never treats approval alone as verified', () => {
    fc.assert(
      fc.property(fc.constant('APPROVED' as const), (merchantStatus) => {
        expect(satisfiesIdentityGate({ merchantStatus, settlementsEnabled: false })).toBe(false);
      }),
    );
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

  it('collapses approved-without-settlements to in-progress', () => {
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
