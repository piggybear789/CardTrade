// tests/unit/pinchWebhook.test.ts
//
// Covers the two pure pieces of the real Pinch webhook path (Req 10.1, 10.4,
// 10.5, 10.7): signature verification (authenticity + replay window) and
// translation of Pinch's envelope into internal WebhookEvents.

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { encodeMetadata } from '@/domain/services/pinch/metadata';
import {
  translatePinchEvent,
  verifyPinchSignature,
} from '@/domain/services/pinch/webhook';

const SECRET = 'whsec_test_secret';

/** Build a valid `pinch-signature` header for a body at a given timestamp. */
function sign(rawBody: string, timestampSeconds: number, secret = SECRET): string {
  const signature = createHmac('sha256', secret)
    .update(`${timestampSeconds}.${rawBody}`, 'utf8')
    .digest('hex');
  return `t=${timestampSeconds},v2=${signature}`;
}

describe('verifyPinchSignature', () => {
  const rawBody = JSON.stringify({ Id: 'evt_1', Type: 'realtime-payment' });
  const nowMs = 1_800_000_000_000;
  const nowSeconds = Math.floor(nowMs / 1000);

  it('accepts a correctly signed, fresh delivery', () => {
    expect(
      verifyPinchSignature({
        rawBody,
        header: sign(rawBody, nowSeconds),
        secret: SECRET,
        nowMs,
      }),
    ).toBe(true);
  });

  it('rejects a tampered body', () => {
    expect(
      verifyPinchSignature({
        rawBody: `${rawBody} `,
        header: sign(rawBody, nowSeconds),
        secret: SECRET,
        nowMs,
      }),
    ).toBe(false);
  });

  it('rejects the wrong secret, a missing header, and a malformed header', () => {
    expect(
      verifyPinchSignature({ rawBody, header: sign(rawBody, nowSeconds, 'other'), secret: SECRET, nowMs }),
    ).toBe(false);
    expect(verifyPinchSignature({ rawBody, header: null, secret: SECRET, nowMs })).toBe(false);
    expect(verifyPinchSignature({ rawBody, header: 'v2=abc', secret: SECRET, nowMs })).toBe(false);
  });

  it('rejects a replayed delivery outside the tolerance window', () => {
    const stale = nowSeconds - 301;
    expect(
      verifyPinchSignature({ rawBody, header: sign(rawBody, stale), secret: SECRET, nowMs }),
    ).toBe(false);
    expect(
      verifyPinchSignature({
        rawBody,
        header: sign(rawBody, stale),
        secret: SECRET,
        nowMs,
        toleranceSeconds: 600,
      }),
    ).toBe(true);
  });
});

describe('translatePinchEvent', () => {
  const holdMetadata = encodeMetadata({
    kind: 'HOLD',
    ref: 'hold:trade-1:trader-1',
    tradeId: 'trade-1',
  });
  const transferMetadata = encodeMetadata({
    kind: 'TRANSFER',
    ref: 'cash-sale:sale-1',
    cashSaleId: 'sale-1',
  });

  it('maps an approved collateral charge to hold.active', () => {
    const [event] = translatePinchEvent({
      Id: 'evt_a',
      Type: 'realtime-payment',
      EventDate: '2026-04-10T00:00:00.000Z',
      Data: {
        Payment: { Id: 'pmt_1', Amount: 5000, Status: 'approved', Metadata: holdMetadata },
      },
    });

    expect(event).toEqual({
      eventId: 'evt_a:pmt_1',
      type: 'hold.active',
      occurredAt: '2026-04-10T00:00:00.000Z',
      payload: { holdId: 'pmt_1', tradeId: 'trade-1', amount: 5000, status: 'approved' },
    });
  });

  it('maps a dishonoured cash-sale payment to transfer.failed with a reason', () => {
    const [event] = translatePinchEvent({
      id: 'evt_b',
      type: 'bank-results',
      eventDate: '2026-04-10T00:00:00.000Z',
      data: {
        payments: [
          {
            id: 'pmt_2',
            amount: 7500,
            status: 'dishonoured',
            metadata: transferMetadata,
            dishonour: { type: 'insufficient-funds', reason: 'Refer to Drawer' },
          },
        ],
      },
    });

    expect(event.type).toBe('transfer.failed');
    expect(event.payload.transferId).toBe('pmt_2');
    expect(event.payload.cashSaleId).toBe('sale-1');
    expect(event.payload.reason).toBe('insufficient-funds: Refer to Drawer');
  });

  it('fans a multi-payment delivery out into distinct idempotency keys', () => {
    const events = translatePinchEvent({
      Id: 'evt_c',
      Type: 'bank-results',
      Data: {
        Payments: [
          { Id: 'pmt_3', Amount: 100, Status: 'approved', Metadata: holdMetadata },
          { Id: 'pmt_4', Amount: 200, Status: 'approved', Metadata: transferMetadata },
        ],
      },
    });

    expect(events.map((e) => e.eventId)).toEqual(['evt_c:pmt_3', 'evt_c:pmt_4']);
  });

  it('maps a compliance decision to merchant.compliance.updated', () => {
    // Shape taken from the Managed Merchants payments guide: a submission status
    // plus a merchant status, with no enable flags.
    const [event] = translatePinchEvent({
      Id: 'evt_c1',
      Type: 'compliance-updated',
      EventDate: '2026-07-25T00:00:00.000Z',
      Metadata: { MerchantId: 'mch_seller', Status: 'approved' },
      Data: {
        ComplianceSubmission: {
          MerchantId: 'mch_seller',
          SubmissionStatus: 'approved',
          MerchantStatus: 'active',
        },
      },
    });

    expect(event).toMatchObject({
      eventId: 'evt_c1:mch_seller',
      type: 'merchant.compliance.updated',
      payload: { merchantRef: 'mch_seller', status: 'approved', merchantActive: true },
    });
  });

  it('ignores a compliance event with no resolvable merchant reference', () => {
    expect(
      translatePinchEvent({
        Id: 'evt_c2',
        Type: 'compliance-updated',
        Data: { ComplianceSubmission: { SubmissionStatus: 'in-review' } },
      }),
    ).toEqual([]);
  });

  it('ignores foreign payments, pending payments, and unhandled event types', () => {
    // No CardTrade metadata -> not ours (Req 10.7).
    expect(
      translatePinchEvent({
        Id: 'evt_d',
        Type: 'realtime-payment',
        Data: { Payment: { Id: 'pmt_5', Amount: 100, Status: 'approved' } },
      }),
    ).toEqual([]);

    // Still in flight -> no transition yet.
    expect(
      translatePinchEvent({
        Id: 'evt_e',
        Type: 'payment-created',
        Data: { Payment: { Id: 'pmt_6', Amount: 100, Status: 'scheduled', Metadata: holdMetadata } },
      }),
    ).toEqual([]);

    // Refund/transfer/payer events drive no internal state change.
    expect(
      translatePinchEvent({ Id: 'evt_f', Type: 'refund-updated', Data: { Refund: { Id: 'rfd_1' } } }),
    ).toEqual([]);
  });
});
