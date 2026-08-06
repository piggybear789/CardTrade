// tests/unit/merchantOnboarding.test.ts
//
// Covers the sub-merchant (payee) onboarding core: status derivation, the
// payability predicate that gates Cash_Sales, submission guards, and application
// of a provider compliance decision.

import { describe, expect, it, vi } from 'vitest';

import {
  applyComplianceUpdate,
  canReceiveFunds,
  sellerIdentityDisclosure,
  deriveMerchantStatus,
  submitMerchantOnboarding,
  type MerchantRecord,
  type MerchantRepository,
  type MerchantUpdate,
} from '@/domain/orchestrator/merchantOnboarding';
import type { ManagedMerchant, ManagedMerchantDetails, PaymentService } from '@/domain/services/types';

// Deliberately tiny: with provider-hosted onboarding the provider collects and
// verifies the bank account, government registration, date of birth and address
// on its own pages, so none of it is submitted from here.
const DETAILS: ManagedMerchantDetails = {
  profileId: 'profile-1',
  businessEmail: 'jane@example.com',
  tradingName: 'Jane Collector',
  legalEntityName: 'Jane Collector',
};

/** In-memory repository capturing the last update for assertions. */
function makeRepository(initial: MerchantRecord | null): MerchantRepository & {
  updates: MerchantUpdate[];
  record: MerchantRecord | null;
} {
  const state = {
    record: initial,
    updates: [] as MerchantUpdate[],
    async loadMerchant() {
      return state.record;
    },
    async updateMerchant(update: MerchantUpdate) {
      state.updates.push(update);
    },
    async findProfileIdByMerchantRef(merchantRef: string) {
      return state.record?.merchantRef === merchantRef ? state.record.profileId : null;
    },
  };
  return state;
}

function baseRecord(overrides: Partial<MerchantRecord> = {}): MerchantRecord {
  return {
    profileId: 'profile-1',
    merchantRef: null,
    merchantStatus: 'NONE',
    liveEnabled: false,
    transactionsEnabled: false,
    settlementsEnabled: false,
    ...overrides,
  };
}

/** Payment service exposing only `createManagedMerchant`. */
function makePayments(result: ManagedMerchant | Error): PaymentService {
  return {
    createManagedMerchant: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
  } as unknown as PaymentService;
}

describe('deriveMerchantStatus', () => {
  it('is APPROVED only once settlements are enabled', () => {
    expect(deriveMerchantStatus({ complianceStatus: 'approved', settlementsEnabled: true })).toBe(
      'APPROVED',
    );
    // Approved on paper but settlements still off: the user cannot be paid yet.
    expect(deriveMerchantStatus({ complianceStatus: 'approved', settlementsEnabled: false })).toBe(
      'PENDING',
    );
  });

  it('accepts the documented webhook signal: approved submission + active merchant', () => {
    // The `compliance-updated` payload carries SubmissionStatus + MerchantStatus
    // and NOT the enable flags, so this must reach APPROVED without them.
    expect(
      deriveMerchantStatus({
        complianceStatus: 'approved',
        settlementsEnabled: false,
        merchantActive: true,
      }),
    ).toBe('APPROVED');
    // Active but not yet approved stays pending.
    expect(
      deriveMerchantStatus({
        complianceStatus: 'in-review',
        settlementsEnabled: false,
        merchantActive: true,
      }),
    ).toBe('PENDING');
  });

  it('maps declined/rejected provider statuses to REJECTED', () => {
    expect(deriveMerchantStatus({ complianceStatus: 'declined', settlementsEnabled: false })).toBe(
      'REJECTED',
    );
    expect(deriveMerchantStatus({ complianceStatus: 'rejected', settlementsEnabled: false })).toBe(
      'REJECTED',
    );
  });

  it('treats a fresh or unknown status as PENDING', () => {
    expect(deriveMerchantStatus({ complianceStatus: 'new', settlementsEnabled: false })).toBe(
      'PENDING',
    );
    expect(deriveMerchantStatus({ settlementsEnabled: false })).toBe('PENDING');
  });
});

describe('sellerIdentityDisclosure', () => {
  /** A verified, payable Stripe-onboarded seller. */
  function approved(overrides: Partial<MerchantRecord> = {}): MerchantRecord {
    return baseRecord({
      merchantRef: 'acct_1',
      merchantStatus: 'APPROVED',
      settlementsEnabled: true,
      legalEntityName: 'Jane Collector',
      identityVersion: 'acct_1:2026-07-25T00:00:00.000Z',
      identityDisclosureConsentedAt: '2026-07-25T00:00:00.000Z',
      identityVerifiedAt: '2026-07-26T00:00:00.000Z',
      // The Identity_Gate since 0069. A disclosure asserts that a provider checked
      // WHO this is, which is what the Identity check answers — the `merchant_*`
      // fields above only establish that they can be paid.
      identityCheckStatus: 'VERIFIED',
      ...overrides,
    });
  }

  // REGRESSION. The guard used to require `registrationNumber`, which
  // `0028_stripe_migration.sql` records as deprecated and null for every
  // Stripe-onboarded seller and which `submitMerchantOnboarding` hardcodes to
  // null. The disclosure was therefore always null in production, so
  // `agreeCashSale` failed with SELLER_IDENTITY_UNVERIFIED and buying and offers
  // were blocked for every real seller. Only seeded demo sellers, which hardcode
  // a fake ABN, ever passed.
  it('discloses a Stripe-onboarded seller who has no registration number', () => {
    const disclosure = sellerIdentityDisclosure(approved({ registrationNumber: null }));

    expect(disclosure).not.toBeNull();
    expect(disclosure?.legalEntityName).toBe('Jane Collector');
    expect(disclosure?.sellerId).toBe('profile-1');
  });

  it('carries no registration number in the disclosed shape', () => {
    const disclosure = sellerIdentityDisclosure(approved());

    expect(disclosure).not.toBeNull();
    expect(disclosure).not.toHaveProperty('registrationNumber');
  });

  it('withholds a disclosure until the identity check is verified', () => {
    // THE GATE MOVED IN 0069. A disclosure tells a buyer WHO their counterparty is,
    // so it must rest on something that actually checked a document — which Connect
    // never did, and which the Identity check does. Payout state is now irrelevant
    // here; see the next test.
    for (const status of ['NONE', 'PENDING', 'FAILED'] as const) {
      expect(sellerIdentityDisclosure(approved({ identityCheckStatus: status }))).toBeNull();
    }
  });

  it('discloses a verified seller who cannot yet be paid (two-step property)', () => {
    // The precise consequence of splitting the gate: identity and payouts are
    // separate steps, so a member who has verified but not finished Connect IS
    // disclosable. Between 0060 and 0061 the reverse bug existed — an empty Connect
    // shell could front a sale — and the fix then was to require settlements. The
    // correct requirement was always "a provider checked who this is", which is what
    // this now asserts.
    const disclosure = sellerIdentityDisclosure(
      approved({ merchantStatus: 'PENDING', settlementsEnabled: false }),
    );

    expect(disclosure).not.toBeNull();
    expect(disclosure?.legalEntityName).toBe('Jane Collector');
    // Being disclosable is NOT being payable. `canReceiveFunds` is the separate
    // predicate that stops a sale the platform could not settle.
    expect(canReceiveFunds(approved({ merchantStatus: 'PENDING', settlementsEnabled: false }))).toBe(
      false,
    );
  });

  it('prefers the document-backed name over the Connect-reported one', () => {
    // `identityCheckName` came off a government document; `legalEntityName` is
    // whatever Connect held, which for a member verified before 0069 may still be
    // their own stated name.
    const disclosure = sellerIdentityDisclosure(
      approved({ identityCheckName: 'Jane Q Collector' }),
    );

    expect(disclosure?.legalEntityName).toBe('Jane Q Collector');
  });

  it('withholds a disclosure without a provider-verified legal name', () => {
    expect(sellerIdentityDisclosure(approved({ legalEntityName: null }))).toBeNull();
  });

  // REGRESSION. Every APPROVED seller in the live database has a null
  // `merchant_identity_version`, because the column is only written by
  // `submitMerchantOnboarding` and `0031_reset_provider_state.sql` nulls it.
  // Requiring it withheld the disclosure and blocked buying just as the
  // registration-number condition did. The version is internal bookkeeping, so it
  // is derived when absent.
  it('derives a stable version when none is stored', () => {
    const disclosure = sellerIdentityDisclosure(approved({ identityVersion: null }));

    expect(disclosure).not.toBeNull();
    expect(disclosure?.version).toBe('acct_1:2026-07-26T00:00:00.000Z');
  });

  it('prefers a stored version over the derived one', () => {
    const disclosure = sellerIdentityDisclosure(approved({ identityVersion: 'stored-v2' }));

    expect(disclosure?.version).toBe('stored-v2');
  });

  it('changes the derived version when the provider re-verifies', () => {
    const before = sellerIdentityDisclosure(approved({ identityVersion: null }));
    const after = sellerIdentityDisclosure(
      approved({ identityVersion: null, identityVerifiedAt: '2026-08-01T00:00:00.000Z' }),
    );

    expect(before?.version).not.toBe(after?.version);
  });

  it('withholds a disclosure before the provider has verified identity', () => {
    expect(sellerIdentityDisclosure(approved({ identityVerifiedAt: null }))).toBeNull();
  });

  it('withholds a disclosure without buyer-disclosure consent', () => {
    expect(
      sellerIdentityDisclosure(approved({ identityDisclosureConsentedAt: null })),
    ).toBeNull();
  });

  it('withholds a disclosure for a null merchant', () => {
    expect(sellerIdentityDisclosure(null)).toBeNull();
  });
});

describe('canReceiveFunds', () => {
  it('requires a merchant ref, APPROVED status and settlements enabled', () => {
    expect(
      canReceiveFunds(
        baseRecord({ merchantRef: 'mch_1', merchantStatus: 'APPROVED', settlementsEnabled: true }),
      ),
    ).toBe(true);
    expect(
      canReceiveFunds(baseRecord({ merchantRef: 'mch_1', merchantStatus: 'PENDING' })),
    ).toBe(false);
    expect(
      canReceiveFunds(
        baseRecord({ merchantRef: null, merchantStatus: 'APPROVED', settlementsEnabled: true }),
      ),
    ).toBe(false);
    expect(canReceiveFunds(null)).toBe(false);
  });
});

describe('submitMerchantOnboarding', () => {
  const created: ManagedMerchant = {
    merchantRef: 'mch_new',
    complianceStatus: 'new',
    liveEnabled: false,
    transactionsEnabled: false,
    settlementsEnabled: false,
  };

  it('stores a new Connect account as PENDING, because creating it starts onboarding', async () => {
    const repository = makeRepository(baseRecord());
    const result = await submitMerchantOnboarding(
      { repository, payments: makePayments(created), now: () => new Date('2026-07-25T00:00:00Z') },
      { profileId: 'profile-1', details: DETAILS, buyerDisclosureConsent: true },
    );

    expect(result).toMatchObject({ ok: true });
    expect(repository.updates[0]).toMatchObject({
      profileId: 'profile-1',
      merchantRef: 'mch_new',
      // NOT APPROVED. The member has not touched Stripe's hosted pages yet.
      merchantStatus: 'PENDING',
      settlementsEnabled: false,
      // Consent is real — they pressed the control it is stated on — but nothing has
      // been verified, so the verification timestamp stays absent (the 0060 bug was
      // dating "identity verified" to the creation of an empty shell).
      identityDisclosureConsentedAt: '2026-07-25T00:00:00.000Z',
      identityVerifiedAt: null,
      submittedAt: '2026-07-25T00:00:00.000Z',
    });
  });

  it('rejects a second submission when a merchant already exists', async () => {
    const repository = makeRepository(
      baseRecord({ merchantRef: 'mch_1', merchantStatus: 'PENDING' }),
    );
    const result = await submitMerchantOnboarding(
      { repository, payments: makePayments(created) },
      { profileId: 'profile-1', details: DETAILS, buyerDisclosureConsent: true },
    );

    expect(result).toEqual({ ok: false, error: 'ALREADY_ONBOARDED' });
    expect(repository.updates).toHaveLength(0);
  });

  it('leaves state untouched when the provider rejects the submission', async () => {
    const repository = makeRepository(baseRecord());
    const result = await submitMerchantOnboarding(
      { repository, payments: makePayments(new Error('bank account invalid')) },
      { profileId: 'profile-1', details: DETAILS, buyerDisclosureConsent: true },
    );

    expect(result).toMatchObject({ ok: false, error: 'SUBMISSION_FAILED' });
    expect(repository.updates).toHaveLength(0);
  });

  it('reports NOT_SUPPORTED when the provider has no sub-merchant capability', async () => {
    const repository = makeRepository(baseRecord());
    const result = await submitMerchantOnboarding(
      { repository, payments: {} as PaymentService },
      { profileId: 'profile-1', details: DETAILS, buyerDisclosureConsent: true },
    );

    expect(result).toEqual({ ok: false, error: 'NOT_SUPPORTED' });
  });
});

describe('applyComplianceUpdate', () => {
  it('approves the profile and stamps a decision when settlements switch on', async () => {
    const repository = makeRepository(
      baseRecord({ merchantRef: 'mch_1', merchantStatus: 'PENDING', complianceStatus: 'new' }),
    );

    const result = await applyComplianceUpdate(
      { repository, payments: {} as PaymentService, now: () => new Date('2026-07-25T01:00:00Z') },
      {
        merchantRef: 'mch_1',
        complianceStatus: 'approved',
        liveEnabled: true,
        transactionsEnabled: true,
        settlementsEnabled: true,
      },
    );

    expect(result).toMatchObject({ ok: true });
    expect(repository.updates[0]).toMatchObject({
      merchantStatus: 'APPROVED',
      settlementsEnabled: true,
      decisionAt: '2026-07-25T01:00:00.000Z',
    });
  });

  // Req 17.3 / 21.4. The verified legal name is the buyer-facing disclosure. A
  // later provider report that omits it must not blank a name already shown to a
  // Buyer, so the write is monotonic: absent to present only.
  it('never blanks a stored legal name when a later report omits it', async () => {
    const repository = makeRepository(
      baseRecord({
        merchantRef: 'mch_1',
        merchantStatus: 'APPROVED',
        settlementsEnabled: true,
        legalEntityName: 'Jane Collector',
        identityVerifiedAt: '2026-07-25T00:00:00.000Z',
      }),
    );

    await applyComplianceUpdate(
      { repository, payments: {} as PaymentService, now: () => new Date('2026-07-26T00:00:00Z') },
      { merchantRef: 'mch_1', complianceStatus: 'approved', settlementsEnabled: true },
    );

    expect(repository.updates[0].legalEntityName).toBe('Jane Collector');
  });

  it('records a legal name that arrives for the first time', async () => {
    const repository = makeRepository(
      baseRecord({ merchantRef: 'mch_1', merchantStatus: 'PENDING' }),
    );

    await applyComplianceUpdate(
      { repository, payments: {} as PaymentService, now: () => new Date('2026-07-26T00:00:00Z') },
      {
        merchantRef: 'mch_1',
        complianceStatus: 'approved',
        settlementsEnabled: true,
        legalName: 'Jane Collector',
      },
    );

    expect(repository.updates[0].legalEntityName).toBe('Jane Collector');
  });

  it('preserves the first verification timestamp across later reports', async () => {
    const repository = makeRepository(
      baseRecord({
        merchantRef: 'mch_1',
        merchantStatus: 'APPROVED',
        settlementsEnabled: true,
        legalEntityName: 'Jane Collector',
        identityVerifiedAt: '2026-07-25T00:00:00.000Z',
      }),
    );

    await applyComplianceUpdate(
      { repository, payments: {} as PaymentService, now: () => new Date('2026-08-01T00:00:00Z') },
      { merchantRef: 'mch_1', complianceStatus: 'approved', settlementsEnabled: true },
    );

    expect(repository.updates[0].identityVerifiedAt).toBe('2026-07-25T00:00:00.000Z');
  });

  it('treats absent flags as unchanged rather than false', async () => {
    const repository = makeRepository(
      baseRecord({
        merchantRef: 'mch_1',
        merchantStatus: 'APPROVED',
        settlementsEnabled: true,
        transactionsEnabled: true,
      }),
    );

    await applyComplianceUpdate(
      { repository, payments: {} as PaymentService },
      { merchantRef: 'mch_1', complianceStatus: 'approved' },
    );

    expect(repository.updates[0]).toMatchObject({
      merchantStatus: 'APPROVED',
      settlementsEnabled: true,
      transactionsEnabled: true,
    });
  });

  it('fails when the merchant reference is unknown', async () => {
    const repository = makeRepository(baseRecord({ merchantRef: 'mch_1' }));
    const result = await applyComplianceUpdate(
      { repository, payments: {} as PaymentService },
      { merchantRef: 'mch_other' },
    );

    expect(result).toEqual({ ok: false, error: 'PROFILE_NOT_FOUND' });
  });
});

describe('onboarding is independent of payer KYC', () => {
  it('never reads or writes kyc fields', async () => {
    // Guard against the two verifications being conflated: the onboarding core's
    // repository surface has no KYC methods at all.
    const repository = makeRepository(baseRecord());
    const spy = vi.spyOn(repository, 'updateMerchant');
    await submitMerchantOnboarding(
      {
        repository,
        payments: makePayments({
          merchantRef: 'mch_new',
          complianceStatus: 'new',
          liveEnabled: false,
          transactionsEnabled: false,
          settlementsEnabled: false,
        }),
      },
      { profileId: 'profile-1', details: DETAILS, buyerDisclosureConsent: true },
    );
    const update = spy.mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(Object.keys(update).some((key) => key.toLowerCase().includes('kyc'))).toBe(false);
  });
});
