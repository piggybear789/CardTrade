// tests/unit/merchantOnboarding.test.ts
//
// Covers the sub-merchant (payee) onboarding core: status derivation, the
// payability predicate that gates Cash_Sales, submission guards, and application
// of a provider compliance decision.

import { describe, expect, it, vi } from 'vitest';

import {
  applyComplianceUpdate,
  canReceiveFunds,
  deriveMerchantStatus,
  submitMerchantOnboarding,
  type MerchantRecord,
  type MerchantRepository,
  type MerchantUpdate,
} from '@/domain/orchestrator/merchantOnboarding';
import type { ManagedMerchant, ManagedMerchantDetails, PaymentService } from '@/domain/services/types';

const DETAILS: ManagedMerchantDetails = {
  legalEntityName: 'Jane Collector Pty Ltd',
  tradingName: 'Jane Collector',
  businessEmail: 'jane@example.com',
  businessRegistrationNumber: '12345678901',
  bankAccountBsb: '012001',
  bankAccountNumber: '12345678',
  contact: { email: 'jane@example.com' },
  ipAddress: '203.0.113.10',
  userAgent: 'test-agent',
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

  it('stores the new merchant as PENDING with a submission timestamp', async () => {
    const repository = makeRepository(baseRecord());
    const result = await submitMerchantOnboarding(
      { repository, payments: makePayments(created), now: () => new Date('2026-07-25T00:00:00Z') },
      { profileId: 'profile-1', details: DETAILS, buyerDisclosureConsent: true },
    );

    expect(result).toMatchObject({ ok: true });
    expect(repository.updates[0]).toMatchObject({
      profileId: 'profile-1',
      merchantRef: 'mch_new',
      merchantStatus: 'PENDING',
      settlementsEnabled: false,
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
