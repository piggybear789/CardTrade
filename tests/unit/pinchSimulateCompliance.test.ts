// tests/unit/pinchSimulateCompliance.test.ts
//
// The test-mode compliance simulator must produce a delivery the REAL webhook
// path accepts: Pinch-format signature over `{t}.{rawBody}`, an envelope
// `translatePinchEvent` understands, and a decision the onboarding orchestrator
// applies. If any of those drift apart, simulating approval would silently
// no-op, so these tests pin the contract end-to-end (minus HTTP).

import { describe, expect, it } from 'vitest';

import {
  buildComplianceEvent,
  signPinchWebhook,
  simulateComplianceDecision,
  translatePinchEvent,
  verifyPinchSignature,
  type PinchConfig,
} from '@/domain/services/pinch';
import {
  applyComplianceUpdate,
  type MerchantRecord,
  type MerchantRepository,
  type MerchantUpdate,
} from '@/domain/orchestrator/merchantOnboarding';
import type { PaymentService } from '@/domain/services/types';

const SECRET = 'whsec_test_secret';

function testConfig(overrides: Partial<PinchConfig> = {}): PinchConfig {
  return {
    environment: 'test',
    apiBaseUrl: 'https://api.getpinch.com.au/test',
    authUrl: 'https://auth.getpinch.com.au/connect/token',
    clientId: 'app_test',
    clientSecret: 'secret',
    apiVersion: '2020.1',
    webhookSecret: SECRET,
    holdStrategy: 'charge-and-refund',
    kycMode: 'mock',
    simulateCompliance: true,
    ...overrides,
  };
}

function repository(initial: MerchantRecord): MerchantRepository & { updates: MerchantUpdate[] } {
  const state = {
    updates: [] as MerchantUpdate[],
    async loadMerchant() {
      return initial;
    },
    async updateMerchant(update: MerchantUpdate) {
      state.updates.push(update);
    },
    async findProfileIdByMerchantRef(ref: string) {
      return initial.merchantRef === ref ? initial.profileId : null;
    },
  };
  return state;
}

describe('simulated compliance delivery', () => {
  it('signs the body so the real verifier accepts it', async () => {
    const captured: { body?: string; signature?: string } = {};
    const result = await simulateComplianceDecision({
      config: testConfig(),
      merchantRef: 'mch_sim1',
      webhookUrl: 'http://localhost:3000/api/webhooks/pinch',
      webhookSecret: SECRET,
      fetchFn: (async (_url: string, init: { headers: Record<string, string>; body: string }) => {
        captured.body = init.body;
        captured.signature = init.headers['pinch-signature'];
        return { ok: true, status: 200, text: async () => '{"ok":true}' };
      }) as unknown as typeof fetch,
    });

    expect(result).toMatchObject({ ok: true, outcome: 'approved' });
    expect(
      verifyPinchSignature({
        rawBody: captured.body!,
        header: captured.signature!,
        secret: SECRET,
      }),
    ).toBe(true);
    // A wrong secret must not verify, proving the check is real.
    expect(
      verifyPinchSignature({
        rawBody: captured.body!,
        header: captured.signature!,
        secret: 'whsec_wrong',
      }),
    ).toBe(false);
  });

  it('produces an envelope the real translator maps to a compliance event', () => {
    const body = buildComplianceEvent({
      merchantRef: 'mch_sim2',
      outcome: 'approved',
      occurredAt: '2026-07-25T00:00:00.000Z',
      eventId: 'sim_evt_1',
    });

    const events = translatePinchEvent(body);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'merchant.compliance.updated',
      payload: {
        merchantRef: 'mch_sim2',
        status: 'approved',
        settlementsEnabled: true,
        merchantActive: true,
      },
    });
  });

  it('drives the orchestrator to APPROVED on an approved simulation', async () => {
    const repo = repository({
      profileId: 'profile-1',
      merchantRef: 'mch_sim3',
      merchantStatus: 'PENDING',
      liveEnabled: false,
      transactionsEnabled: false,
      settlementsEnabled: false,
    });
    const [event] = translatePinchEvent(
      buildComplianceEvent({
        merchantRef: 'mch_sim3',
        outcome: 'approved',
        occurredAt: '2026-07-25T00:00:00.000Z',
        eventId: 'sim_evt_2',
      }),
    );

    const result = await applyComplianceUpdate(
      { repository: repo, payments: {} as PaymentService, now: () => new Date('2026-07-25T02:00:00Z') },
      {
        merchantRef: event.payload.merchantRef!,
        complianceStatus: event.payload.status,
        liveEnabled: event.payload.liveEnabled,
        transactionsEnabled: event.payload.transactionsEnabled,
        settlementsEnabled: event.payload.settlementsEnabled,
        merchantActive: event.payload.merchantActive,
      },
    );

    expect(result).toMatchObject({ ok: true });
    expect(repo.updates[0]).toMatchObject({
      merchantStatus: 'APPROVED',
      settlementsEnabled: true,
      // Approval stamps the verification time the buyer disclosure requires.
      identityVerifiedAt: '2026-07-25T02:00:00.000Z',
    });
  });

  it('maps a rejected simulation to REJECTED', async () => {
    const repo = repository({
      profileId: 'profile-1',
      merchantRef: 'mch_sim4',
      merchantStatus: 'PENDING',
      liveEnabled: false,
      transactionsEnabled: false,
      settlementsEnabled: false,
    });
    const [event] = translatePinchEvent(
      buildComplianceEvent({
        merchantRef: 'mch_sim4',
        outcome: 'rejected',
        occurredAt: '2026-07-25T00:00:00.000Z',
        eventId: 'sim_evt_3',
      }),
    );

    await applyComplianceUpdate(
      { repository: repo, payments: {} as PaymentService },
      {
        merchantRef: event.payload.merchantRef!,
        complianceStatus: event.payload.status,
        settlementsEnabled: event.payload.settlementsEnabled,
        merchantActive: event.payload.merchantActive,
      },
    );

    expect(repo.updates[0]).toMatchObject({ merchantStatus: 'REJECTED' });
  });

  it('refuses to run in live mode', async () => {
    const result = await simulateComplianceDecision({
      config: testConfig({ environment: 'live', simulateCompliance: false }),
      merchantRef: 'mch_live',
      webhookUrl: 'http://localhost:3000/api/webhooks/pinch',
      webhookSecret: SECRET,
      fetchFn: (async () => {
        throw new Error('must not be called in live mode');
      }) as unknown as typeof fetch,
    });

    expect(result).toEqual({ ok: false, error: 'NOT_TEST_MODE' });
  });

  it('signature timestamps are bound to the body', () => {
    const header = signPinchWebhook({ rawBody: '{"a":1}', secret: SECRET, timestampSeconds: 1000 });
    expect(header).toMatch(/^t=1000,v2=[0-9a-f]{64}$/);
    // Same body, different timestamp -> different signature.
    const other = signPinchWebhook({ rawBody: '{"a":1}', secret: SECRET, timestampSeconds: 1001 });
    expect(header).not.toBe(other);
  });
});
