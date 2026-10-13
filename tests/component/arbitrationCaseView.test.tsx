// tests/component/arbitrationCaseView.test.tsx
//
// The Decision card and the shipment evidence on a staff case page.
//
// THE DEFECT THIS PINS (lapsed-sale-case-fix, Bug 2). A "Not shipped" case (0132) is a
// posted sale still in ESCROW_HELD after its ship-by date passed. The Decision card chose
// its controls from the sale's status alone, so it offered DisputeActions: refund,
// release and partial refund, each confirmed as moving real money, and each refused
// because the sale is not DISPUTED. The page never said what could actually happen next,
// and never showed the date the seller missed. The card now keys on the case's
// SITUATION and shows guidance, and the shipment evidence carries a dated ship-by entry.
//
// Keyed on the situation rather than the resolution's status because those are two
// reads: a seller adding tracking between them must still land on guidance, so the
// "Not shipped" checks run against every status the second read could return.
//
// The view has no hooks of its own, and the action modules its panels call are mocked,
// so rendering it moves nothing.

import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('@/lib/actions/admin', () => ({
  resolveCashSaleDispute: vi.fn(),
  resolveCashSaleReturnCase: vi.fn(),
  resolveTradeConditionDispute: vi.fn(),
  resolveTradeFraud: vi.fn(),
}));

vi.mock('@/lib/actions/arbitration', () => ({
  addArbitrationNote: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}));

// Evidence media renders through signed Storage URLs; no fixture here files any.
vi.mock('@/components/arbitration/ArbitrationEvidenceGrid', () => ({
  ArbitrationEvidenceGrid: () => null,
}));

import { ArbitrationCaseView } from '@/components/arbitration/ArbitrationCaseView';
import {
  triage,
  type ArbitrationCase,
  type ArbitrationCaseSituation,
} from '@/domain/arbitration/arbitrationCase';
import type {
  ArbitrationCaseDetail,
  ArbitrationResolution,
  ArbitrationShipmentEvidence,
} from '@/lib/actions/arbitration';
import { formatContractDateTime } from '@/lib/format';

const NOW = new Date();
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000).toISOString();

const SHIP_BY_AT = hoursAgo(30);
const SHIP_LAPSED_AT = hoursAgo(6);

/** Every status the resolution read could report. */
const STATUSES = [
  'AGREEMENT',
  'PAYMENT_PENDING',
  'ESCROW_HELD',
  'IN_TRANSIT',
  'HANDOVER',
  'INSPECTION',
  'COMPLETED',
  'DISPUTED',
  'CANCELLED',
  'FAILED',
  'REFUNDED',
  'RETURN_PENDING',
  'RETURN_IN_TRANSIT',
] as const;

type CashResolution = Extract<ArbitrationResolution, { kind: 'CASH_SALE' }>;

function caseOf(overrides: Partial<ArbitrationCase> = {}) {
  return triage(
    {
      kind: 'CASH_SALE',
      ref: 'sale-1',
      situation: 'SHIP_LAPSED',
      title: 'Charizard',
      goods: [],
      amountAtRiskCents: 10_000,
      currency: 'aud',
      openedAt: SHIP_LAPSED_AT,
      raisedById: null,
      claim: "The seller has not posted the item by the ship-by date. The buyer's payment is still held.",
      parties: [
        { id: 'buyer-1', name: 'Bea', stakeCents: 10_000, role: 'Buyer' },
        { id: 'seller-1', name: 'Sam', stakeCents: 10_000, role: 'Seller' },
      ],
      assigneeId: null,
      assigneeName: null,
      noteCount: 0,
      hasHardDeadline: false,
      deadlineAt: null,
      fraudAlleged: false,
      ...overrides,
    },
    NOW,
  );
}

function cashResolution(overrides: Partial<CashResolution> = {}): CashResolution {
  return {
    kind: 'CASH_SALE',
    cashSaleId: 'sale-1',
    amountCents: 10_000,
    platformFeeCents: 0,
    refundCents: 0,
    refundStatus: null,
    status: 'ESCROW_HELD',
    buyerHasGoods: false,
    returnConfirmed: false,
    returnLapsed: false,
    openChargebackRef: null,
    ...overrides,
  };
}

const NO_LEG = { carrier: null, trackingNumber: null, shippedAt: null, carrierDeliveredAt: null };

function shipmentOf(overrides: Partial<ArbitrationShipmentEvidence> = {}): ArbitrationShipmentEvidence {
  return {
    outbound: NO_LEG,
    returnLeg: NO_LEG,
    returnDisputeReason: null,
    returnDisputedAt: null,
    returnLapsedAt: null,
    shipByAt: SHIP_BY_AT,
    shipLapsedAt: SHIP_LAPSED_AT,
    ...overrides,
  };
}

function detailOf(
  parts: {
    case?: ReturnType<typeof caseOf>;
    resolution?: ArbitrationResolution | null;
    shipment?: ArbitrationShipmentEvidence | null;
  } = {},
): ArbitrationCaseDetail {
  return {
    case: parts.case ?? caseOf(),
    notes: [],
    timeline: [],
    resolution: parts.resolution === undefined ? cashResolution() : parts.resolution,
    contractHref: '/sales/sale-1',
    evidence: [],
    shipment: parts.shipment === undefined ? shipmentOf() : parts.shipment,
    currency: 'aud',
    viewerIsAdmin: false,
    viewerId: 'staff-1',
  };
}

/** Page text with whitespace collapsed, so locale spacing inside a date cannot break a match. */
const pageText = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');
const when = (iso: string) => (formatContractDateTime(iso) ?? iso).replace(/\s+/g, ' ').trim();

/** Every refund or release control either decision panel renders. */
const MONEY_CONTROLS = [
  /Refund buyer in full/,
  /Release to seller/,
  /Partially refund/,
  /Refund the buyer/,
  /Release to the seller/,
];

function moneyControls(): string[] {
  return MONEY_CONTROLS.filter((name) => screen.queryAllByRole('button', { name }).length > 0).map(
    String,
  );
}

describe('Property 3: a "Not shipped" case shows guidance instead of refused outcomes', () => {
  it.each(STATUSES)('offers no refund or release when the resolution read reports %s', (status) => {
    render(<ArbitrationCaseView detail={detailOf({ resolution: cashResolution({ status }) })} />);

    expect(moneyControls()).toEqual([]);
    expect(pageText()).toContain('Nothing to decide yet');
  });

  it('says what can happen next, with the date the seller missed', () => {
    render(<ArbitrationCaseView detail={detailOf()} />);

    const text = pageText();
    for (const phrase of [
      "The seller has not posted by the ship-by date, and the buyer's payment is still held.",
      'Nothing has been cancelled or refunded, and nothing happens automatically.',
      'Check in with the seller and keep a record in the staff notes.',
      'When the seller adds tracking, the sale moves on and this case closes by itself.',
      'The buyer can report a problem from their contract room.',
      'a full refund goes straight back to the buyer',
      `Ship by: ${when(SHIP_BY_AT)}`,
      `Flagged: ${when(SHIP_LAPSED_AT)}`,
    ]) {
      expect(text).toContain(phrase);
    }
  });

  it('promises an immediate refund only when the record shows the buyer has nothing', () => {
    render(
      <ArbitrationCaseView
        detail={detailOf({ resolution: cashResolution({ buyerHasGoods: true }) })}
      />,
    );

    expect(pageText()).toContain('The buyer can report a problem from their contract room.');
    expect(pageText()).not.toContain('a full refund goes straight back to the buyer');
  });

  it('adds a dated ship-by entry to the shipment evidence', () => {
    render(<ArbitrationCaseView detail={detailOf()} />);

    expect(pageText()).toContain(`Ship-by date passed \u00b7 ${when(SHIP_LAPSED_AT)}`);
    expect(pageText()).toContain(`The seller was due to post by ${when(SHIP_BY_AT)}.`);
    expect(pageText()).toContain('Nothing is cancelled or refunded because of it.');
  });

  it('drops the due-by sentence when the sale has no ship-by date on record', () => {
    render(<ArbitrationCaseView detail={detailOf({ shipment: shipmentOf({ shipByAt: null }) })} />);

    expect(pageText()).toContain(`Ship-by date passed \u00b7 ${when(SHIP_LAPSED_AT)}`);
    expect(pageText()).not.toContain('The seller was due to post by');
  });

  it('keeps the entry once the buyer reports a problem and the case becomes a dispute', () => {
    render(
      <ArbitrationCaseView
        detail={detailOf({
          case: caseOf({ situation: 'CONDITION_DISPUTE', raisedById: 'buyer-1', claim: 'Never posted' }),
          resolution: cashResolution({ status: 'DISPUTED' }),
        })}
      />,
    );

    expect(pageText()).toContain(`Ship-by date passed \u00b7 ${when(SHIP_LAPSED_AT)}`);
    expect(moneyControls()).toEqual([
      String(/Refund buyer in full/),
      String(/Release to seller/),
      String(/Partially refund/),
    ]);
  });
});

describe('Property 4: every other Decision card is unchanged', () => {
  const OTHER_SITUATIONS: ArbitrationCaseSituation[] = [
    'CONDITION_DISPUTE',
    'FRAUD_DISPUTE',
    'RETURN_CONTESTED',
    'RETURN_LAPSED',
  ];

  it.each(STATUSES)('renders the panel the status calls for when the sale is %s', (status) => {
    const returnFlow = status === 'RETURN_PENDING' || status === 'RETURN_IN_TRANSIT';
    for (const situation of OTHER_SITUATIONS) {
      for (const returnLapsed of [false, true]) {
        render(
          <ArbitrationCaseView
            detail={detailOf({
              case: caseOf({ situation }),
              resolution: cashResolution({ status, returnLapsed }),
            })}
          />,
        );

        if (returnFlow) {
          expect(moneyControls()).toEqual([String(/Refund the buyer/), String(/Release to the seller/)]);
          expect(pageText()).toContain(
            returnLapsed
              ? 'The buyer did not post the return before the deadline.'
              : 'The seller says the return did not arrive as expected.',
          );
        } else {
          expect(moneyControls()).toEqual([
            String(/Refund buyer in full/),
            String(/Release to seller/),
            String(/Partially refund/),
          ]);
        }
        expect(pageText()).not.toContain('Nothing to decide yet');
        cleanup();
      }
    }
  });

  it('keeps the trade and chargeback panels', () => {
    render(
      <ArbitrationCaseView
        detail={detailOf({
          case: caseOf({ kind: 'TRADE', ref: 'trade-1', situation: 'CONDITION_DISPUTE' }),
          resolution: {
            kind: 'TRADE',
            tradeId: 'trade-1',
            initiator: { id: 'buyer-1', name: 'Bea', bondCents: 10_000 },
            counterpart: { id: 'seller-1', name: 'Sam', bondCents: 10_000 },
            fraudClaimedById: null,
            frictionTaxCents: 2_000,
            counterpartGoodsDescription: null,
          },
          shipment: null,
        })}
      />,
    );
    expect(screen.getByRole('button', { name: /Resolve as condition dispute/ })).toBeInTheDocument();
    expect(pageText()).not.toContain('Nothing to decide yet');
    cleanup();

    render(
      <ArbitrationCaseView
        detail={detailOf({
          case: caseOf({
            kind: 'CHARGEBACK',
            ref: 'cb-1',
            situation: 'CHARGEBACK',
            hasHardDeadline: true,
            deadlineAt: hoursAgo(-200),
          }),
          resolution: {
            kind: 'CHARGEBACK',
            disputeId: 'cb-1',
            providerStatus: 'needs_response',
            evidenceDueBy: null,
            cashSaleId: 'sale-1',
            tradeId: null,
            disputeRef: 'dp_1',
            outcome: null,
          },
          shipment: null,
        })}
      />,
    );
    expect(pageText()).toContain('Not ours to decide');
  });

  it('keeps the refund-failed banner and the already-refunded line above the panel', () => {
    render(
      <ArbitrationCaseView
        detail={detailOf({
          case: caseOf({ situation: 'CONDITION_DISPUTE' }),
          resolution: cashResolution({ status: 'DISPUTED', refundStatus: 'FAILED', refundCents: 2_500 }),
        })}
      />,
    );

    expect(pageText()).toContain('A previous refund attempt failed. Retrying is safe (deduplicated).');
    expect(pageText()).toContain('already refunded.');
  });

  it('shows no ship-by entry on a sale that never lapsed', () => {
    render(
      <ArbitrationCaseView
        detail={detailOf({
          case: caseOf({ situation: 'CONDITION_DISPUTE' }),
          resolution: cashResolution({ status: 'DISPUTED' }),
          shipment: shipmentOf({ shipByAt: null, shipLapsedAt: null }),
        })}
      />,
    );

    expect(pageText()).not.toContain('Ship-by date passed');
    expect(pageText()).toContain('Outbound (seller');
  });
});
