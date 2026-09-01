// tests/unit/meetingLeadCap.test.ts
//
// How far ahead a face-to-face trade may be scheduled, and why there is a limit.
//
// THE HOLE THIS CLOSES. Collateral is placed when terms are agreed, and lapses about
// seven days later. The inspection window — the only period in which a face-to-face
// scam becomes visible — runs from the MEETING. The single rule on a meeting time was
// that it be in the future, so two traders could agree today, meet in three weeks, and
// discover the problem long after the only money that could answer for it had been
// released. The seven days were spent entirely on waiting.
//
// These pin the arithmetic that closes it, and the two things it must NOT do: apply to
// Cash_Sales, whose money is already collected, and drift away from the inspection
// window it is derived from.

import { describe, expect, it } from 'vitest';

import {
  CARD_AUTHORISATION_DAYS,
  COLLATERAL_MARGIN_HOURS,
  MAX_MEETING_LEAD_HOURS,
  TRADE_INSPECTION_HOURS,
  latestSafeMeetingInstant,
  validateFulfilmentTerms,
  type FulfilmentTerms,
} from '@/domain/fulfilment';

const HOUR_MS = 3_600_000;
const NOW = new Date('2026-03-01T00:00:00.000Z');
const now = () => NOW;

/** A resolved place, which is the only kind that may become contractual. */
const PLACE = {
  label: 'Sydney Town Hall',
  placeId: 'ChIJ_place_id',
  lat: -33.873,
  lng: 151.206,
};

function meetingAt(hoursFromNow: number): FulfilmentTerms {
  return {
    method: 'IN_PERSON',
    meeting: {
      place: PLACE,
      at: new Date(NOW.getTime() + hoursFromNow * HOUR_MS).toISOString(),
    },
    delivery: { costCents: null, notes: null },
  };
}

describe('MAX_MEETING_LEAD_HOURS', () => {
  it('is derived from the authorisation, not chosen', () => {
    // The point of the derivation is that it cannot drift. If someone lengthens the
    // inspection window without thinking about collateral, this fails rather than
    // silently letting the handover fall outside the hold.
    expect(MAX_MEETING_LEAD_HOURS).toBe(
      CARD_AUTHORISATION_DAYS * 24 - TRADE_INSPECTION_HOURS - COLLATERAL_MARGIN_HOURS,
    );
  });

  it('leaves the whole inspection window inside the authorisation', () => {
    // The property that actually matters, stated independently of the formula: meet at
    // the last permitted moment, inspect for the full window, and the collateral is
    // still alive — with the margin to spare.
    const authorisationHours = CARD_AUTHORISATION_DAYS * 24;
    const inspectionEnds = MAX_MEETING_LEAD_HOURS + TRADE_INSPECTION_HOURS;

    expect(inspectionEnds).toBeLessThan(authorisationHours);
    expect(authorisationHours - inspectionEnds).toBe(COLLATERAL_MARGIN_HOURS);
  });

  it('still leaves a usable amount of time to arrange a meeting', () => {
    // A cap that forces a meeting inside a day would be unusable, and someone would
    // route around it. Three days is the answer today; this guards the order of
    // magnitude rather than the exact figure.
    expect(MAX_MEETING_LEAD_HOURS).toBeGreaterThanOrEqual(48);
  });
});

describe('validateFulfilmentTerms — meeting lead cap', () => {
  const capped = { now, maxMeetingLeadHours: MAX_MEETING_LEAD_HOURS };

  it('accepts a meeting inside the window', () => {
    expect(validateFulfilmentTerms(meetingAt(24), capped)).toEqual({ ok: true });
  });

  it('refuses one scheduled past it', () => {
    expect(validateFulfilmentTerms(meetingAt(MAX_MEETING_LEAD_HOURS + 1), capped)).toEqual(
      { ok: false, error: 'meeting-time-too-far' },
    );
  });

  it('accepts the boundary exactly, and refuses a millisecond past it', () => {
    const exact: FulfilmentTerms = {
      ...meetingAt(0),
      meeting: {
        place: PLACE,
        at: new Date(NOW.getTime() + MAX_MEETING_LEAD_HOURS * HOUR_MS).toISOString(),
      },
    };
    const justPast: FulfilmentTerms = {
      ...exact,
      meeting: {
        place: PLACE,
        at: new Date(NOW.getTime() + MAX_MEETING_LEAD_HOURS * HOUR_MS + 1).toISOString(),
      },
    };

    expect(validateFulfilmentTerms(exact, capped)).toEqual({ ok: true });
    expect(validateFulfilmentTerms(justPast, capped)).toEqual({
      ok: false,
      error: 'meeting-time-too-far',
    });
  });

  it('reports a past meeting as past, not as too far', () => {
    // Both are "bad time" but they need different copy: one says pick later, the other
    // says pick sooner. Collapsing them would tell a trader to do the opposite thing.
    expect(validateFulfilmentTerms(meetingAt(-1), capped)).toEqual({
      ok: false,
      error: 'meeting-time-past',
    });
  });

  it('does NOT cap when no limit is passed, which is how a Cash_Sale is validated', () => {
    // A Cash_Sale's money is captured into the platform balance at agreement, so there
    // is no authorisation to outlive and no reason to restrict the meeting date.
    // Defaulting the cap would impose a trade's constraint on a sale that has none.
    expect(validateFulfilmentTerms(meetingAt(24 * 60), { now })).toEqual({ ok: true });
  });

  it('leaves DELIVERY terms alone entirely', () => {
    // A posted trade has no meeting instant; its clock starts at carrier-confirmed
    // delivery. The cap must not leak into that path.
    expect(
      validateFulfilmentTerms(
        {
          method: 'DELIVERY',
          meeting: { place: null, at: null },
          delivery: { costCents: 1_200, notes: null },
        },
        capped,
      ),
    ).toEqual({ ok: true });
  });
});

describe('latestSafeMeetingInstant', () => {
  it('offers the derived lead time before any hold exists', () => {
    // Terms are agreed BEFORE collateral is placed, so at the moment a trader picks a
    // time there is usually no `capture_before` to read.
    expect(latestSafeMeetingInstant(NOW)).toBe(
      new Date(NOW.getTime() + MAX_MEETING_LEAD_HOURS * HOUR_MS).toISOString(),
    );
  });

  it('prefers the real expiry once the provider has reported one', () => {
    // `capture_before` is what Stripe will actually honour, and it can be shorter than
    // the seven-day assumption. Trusting the assumption over the real value is how a
    // trade ends up scheduled past its own collateral.
    const expiry = new Date(NOW.getTime() + 100 * HOUR_MS).toISOString();

    expect(latestSafeMeetingInstant(NOW, expiry)).toBe(
      new Date(
        NOW.getTime() + (100 - TRADE_INSPECTION_HOURS - COLLATERAL_MARGIN_HOURS) * HOUR_MS,
      ).toISOString(),
    );
  });

  it('never hands back a time in the past', () => {
    // A trade whose collateral is nearly gone has no safe meeting time at all. Returning
    // a past instant would make the picker offer something the "must be in the future"
    // check then rejects, which reads as a broken form rather than a refusal.
    const nearlyGone = new Date(NOW.getTime() + HOUR_MS).toISOString();

    expect(latestSafeMeetingInstant(NOW, nearlyGone)).toBe(NOW.toISOString());
  });

  it('ignores an unparseable expiry rather than treating it as zero', () => {
    expect(latestSafeMeetingInstant(NOW, 'not a date')).toBe(
      new Date(NOW.getTime() + MAX_MEETING_LEAD_HOURS * HOUR_MS).toISOString(),
    );
  });
});
