// tests/unit/meetingLeadCap.test.ts
//
// The trade timing budget: how one card authorisation is divided between waiting for
// the meeting, inspecting afterwards, and the slack that lets a last-minute dispute
// actually capture something.
//
// WHAT THIS REPLACED. Bonds used to be placed the moment terms were agreed, so the
// authorisation was spent on WAITING — agree today, meet in three weeks, and the
// collateral was long dead before anyone shook hands. The first fix capped the meeting
// at 72 hours, which worked but charged traders for our infrastructure limit. Placing
// the bond a day before the MEETING removes the coupling: the authorisation does not
// start until the risk does, the date can be anything, and the three windows below add
// up to exactly the seven days.
//
// The partition assertion is the important one. The last time these figures were free
// to move independently, a fourteen-day dispute return window ended up backed by a
// seven-day hold and nothing anywhere noticed.

import { describe, expect, it } from 'vitest';

import {
  BOND_PLACEMENT_LEAD_HOURS,
  CARD_AUTHORISATION_DAYS,
  COLLATERAL_HOURS_AFTER_MEETING,
  COLLATERAL_MARGIN_HOURS,
  MAX_MEETING_LEAD_HOURS,
  TRADE_INSPECTION_HOURS,
  bondPlacementInstant,
  latestSelectableMeetingInstant,
  projectedCollateralLapse,
  validateFulfilmentTerms,
  type FulfilmentTerms,
} from '@/domain/fulfilment';

const HOUR_MS = 3_600_000;
const NOW = new Date('2026-03-01T00:00:00.000Z');
const now = () => NOW;

const PLACE = {
  label: 'Sydney Town Hall',
  placeId: 'ChIJ_place_id',
  lat: -33.873,
  lng: 151.206,
};

function meetingIn(hours: number): FulfilmentTerms {
  return {
    method: 'IN_PERSON',
    meeting: { place: PLACE, at: new Date(NOW.getTime() + hours * HOUR_MS).toISOString() },
    delivery: { costCents: null, notes: null },
  };
}

describe('the trade timing budget', () => {
  it('divides the authorisation exactly, with nothing unaccounted for', () => {
    // placement lead + inspection + margin == the whole authorisation.
    expect(
      BOND_PLACEMENT_LEAD_HOURS + TRADE_INSPECTION_HOURS + COLLATERAL_MARGIN_HOURS,
    ).toBe(CARD_AUTHORISATION_DAYS * 24);
  });

  it('leaves the inspection window finishing inside the collateral, with slack', () => {
    // Stated independently of the formula: meet, inspect for the full window, and the
    // collateral is still alive by exactly the margin. Six days of inspection would
    // land on the instant it dies, which is why the window is five.
    expect(TRADE_INSPECTION_HOURS).toBeLessThan(COLLATERAL_HOURS_AFTER_MEETING);
    expect(COLLATERAL_HOURS_AFTER_MEETING - TRADE_INSPECTION_HOURS).toBe(
      COLLATERAL_MARGIN_HOURS,
    );
  });

  it('gives a full day to survive a declined card before the meeting', () => {
    // Found the evening before, a decline is a text message. Found at the meeting, it
    // is two people standing in a car park. The lead time is the only chance to fix it.
    expect(BOND_PLACEMENT_LEAD_HOURS).toBeGreaterThanOrEqual(24);
  });

  it('no longer ties the meeting date to the collateral', () => {
    // The whole point of moving placement. A cap derived from the authorisation would
    // be 72 hours; this is a staleness bound and is deliberately far larger.
    expect(MAX_MEETING_LEAD_HOURS).toBeGreaterThan(CARD_AUTHORISATION_DAYS * 24);
  });
});

describe('bondPlacementInstant', () => {
  it('is a day before the meeting', () => {
    const meeting = new Date(NOW.getTime() + 10 * 24 * HOUR_MS).toISOString();
    expect(bondPlacementInstant(meeting)).toBe(
      new Date(Date.parse(meeting) - BOND_PLACEMENT_LEAD_HOURS * HOUR_MS).toISOString(),
    );
  });

  it('refuses to guess from an unusable meeting time', () => {
    // The scheduled pass reads this to decide when to authorise a card. A fabricated
    // instant there would place a real hold against a date nobody agreed to.
    expect(bondPlacementInstant(null)).toBeNull();
    expect(bondPlacementInstant('not a date')).toBeNull();
  });
});

describe('projectedCollateralLapse', () => {
  it('is six days after the meeting, because the hold started a day early', () => {
    const meeting = new Date(NOW.getTime() + 5 * 24 * HOUR_MS).toISOString();
    expect(projectedCollateralLapse(meeting)).toBe(
      new Date(Date.parse(meeting) + COLLATERAL_HOURS_AFTER_MEETING * HOUR_MS).toISOString(),
    );
  });

  it('outlives the inspection window that follows the same meeting', () => {
    const meeting = new Date(NOW.getTime() + 5 * 24 * HOUR_MS).toISOString();
    const inspectionCloses = Date.parse(meeting) + TRADE_INSPECTION_HOURS * HOUR_MS;

    expect(Date.parse(projectedCollateralLapse(meeting)!)).toBeGreaterThan(inspectionCloses);
  });
});

describe('validateFulfilmentTerms — meeting date bound', () => {
  const bounded = { now, maxMeetingLeadHours: MAX_MEETING_LEAD_HOURS };

  it('accepts a meeting weeks out, which the old collateral-derived cap refused', () => {
    // Two traders in the same city picking a date a fortnight away is ordinary, and
    // used to be rejected because the authorisation was already running.
    expect(validateFulfilmentTerms(meetingIn(14 * 24), bounded)).toEqual({ ok: true });
  });

  it('still refuses something far enough out to be abandoned', () => {
    expect(validateFulfilmentTerms(meetingIn(MAX_MEETING_LEAD_HOURS + 1), bounded)).toEqual(
      { ok: false, error: 'meeting-time-too-far' },
    );
  });

  it('reports a past meeting as past, not as too far', () => {
    // Different copy: one says pick sooner, the other says pick later. Collapsing them
    // tells a trader to do the opposite of what they need to.
    expect(validateFulfilmentTerms(meetingIn(-1), bounded)).toEqual({
      ok: false,
      error: 'meeting-time-past',
    });
  });

  it('applies no bound at all when none is passed, which is how a Cash_Sale validates', () => {
    // A Cash_Sale's money is captured at agreement and outlives anything, so it has no
    // reason to restrict the date.
    expect(validateFulfilmentTerms(meetingIn(365 * 24), { now })).toEqual({ ok: true });
  });
});

describe('latestSelectableMeetingInstant', () => {
  it('is the staleness bound, with no collateral subtracted', () => {
    expect(latestSelectableMeetingInstant(NOW)).toBe(
      new Date(NOW.getTime() + MAX_MEETING_LEAD_HOURS * HOUR_MS).toISOString(),
    );
  });
});
