// tests/unit/ship24Parsing.test.ts
//
// ESC-02 / ESC-12: when did the carrier FIRST physically scan this parcel, and when
// was it delivered? A label printed before the buyer paid is not a scan (round-3
// review #5), and Ship24 may list events newest-first or oldest-first.

import { describe, expect, it } from 'vitest';

import { deliveredEventAt, firstCarrierScanAt, PRE_SCAN_MILESTONES } from '@/domain/services/tracking/ship24Tracking';

const ev = (occurrenceDatetime: string, statusMilestone: string | null) => ({ occurrenceDatetime, statusMilestone });

describe('firstCarrierScanAt', () => {
  it('finds the earliest physical scan in either order', () => {
    const oldestFirst = [ev('2026-10-01T00:00:00Z', 'in_transit'), ev('2026-10-03T00:00:00Z', 'delivered')];
    expect(firstCarrierScanAt(oldestFirst)).toBe('2026-10-01T00:00:00Z');
    expect(firstCarrierScanAt([...oldestFirst].reverse())).toBe('2026-10-01T00:00:00Z');
  });

  it('skips a label created before the first scan', () => {
    const events = [ev('2026-09-20T00:00:00Z', 'info_received'), ev('2026-10-01T00:00:00Z', 'in_transit')];
    expect(firstCarrierScanAt(events)).toBe('2026-10-01T00:00:00Z');
  });

  it('is null when only label, pending or unlabelled events exist', () => {
    expect(PRE_SCAN_MILESTONES).toEqual(['info_received', 'pending']);
    expect(
      firstCarrierScanAt([ev('2026-09-20T00:00:00Z', 'info_received'), ev('2026-09-21T00:00:00Z', 'pending'), ev('2026-09-22T00:00:00Z', null)]),
    ).toBeNull();
  });

  it('is null with no events', () => {
    expect(firstCarrierScanAt([])).toBeNull();
    expect(firstCarrierScanAt(undefined)).toBeNull();
  });
});

describe('deliveredEventAt', () => {
  it('is the latest delivered-milestone event, not simply the first listed', () => {
    const events = [ev('2026-10-01T00:00:00Z', 'in_transit'), ev('2026-10-03T00:00:00Z', 'delivered')];
    expect(deliveredEventAt(events)).toBe('2026-10-03T00:00:00Z');
  });

  it('is null when nothing was delivered', () => {
    expect(deliveredEventAt([ev('2026-10-01T00:00:00Z', 'in_transit')])).toBeNull();
  });
});
