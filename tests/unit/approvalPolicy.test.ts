// tests/unit/approvalPolicy.test.ts
//
// ESC-23: the two-person rule.

import { describe, expect, it } from 'vitest';

import {
  SOLO_COOLING_OFF_HOURS,
  TWO_PERSON_THRESHOLD_MINOR,
  canApprove,
  isRecused,
  otherApproversFor,
  requiresSecondApproval,
  valueDecidedMinor,
  type ApprovalFacts,
} from '@/domain/arbitration/approvalPolicy';

const NOW = new Date('2026-10-13T12:00:00Z');
const base: ApprovalFacts = {
  status: 'PENDING',
  proposedBy: 'staff-a',
  proposedAt: '2026-10-13T11:00:00Z',
  approverId: 'staff-b',
  participantIds: ['buyer-1', 'seller-1'],
  otherApprovers: 2,
  now: NOW,
};
const COOLED_OFF = new Date(Date.parse(base.proposedAt) + SOLO_COOLING_OFF_HOURS * 3_600_000);

describe('approval policy (ESC-23)', () => {
  it('needs a second approver at or above the threshold, and always for fraud', () => {
    const action = 'RESOLVE_CASH_SALE_DISPUTE' as const;
    expect(requiresSecondApproval({ action, valueMinor: TWO_PERSON_THRESHOLD_MINOR - 1 })).toBe(false);
    expect(requiresSecondApproval({ action, valueMinor: TWO_PERSON_THRESHOLD_MINOR })).toBe(true);
    expect(requiresSecondApproval({ action: 'RESOLVE_TRADE_DISPUTE', valueMinor: 0 }, { fraud: true })).toBe(true);
  });

  it('weighs a non-finite or negative value as zero', () => {
    expect(valueDecidedMinor({ action: 'REVERSE_CASH_SALE_PAYOUT', valueMinor: Number.NaN })).toBe(0);
    expect(valueDecidedMinor({ action: 'REVERSE_CASH_SALE_PAYOUT', valueMinor: -5 })).toBe(0);
  });

  it('lets a different, unrelated staff member approve', () => {
    expect(canApprove(base)).toBeNull();
  });

  it('refuses the proposer on a team of more than one', () => {
    expect(canApprove({ ...base, approverId: 'staff-a' })).toBe('SAME_STAFFER');
  });

  it('lets a solo operator approve only after the cooling-off period', () => {
    const solo = { ...base, approverId: 'staff-a', otherApprovers: otherApproversFor(['staff-a'], 'staff-a', base.participantIds) };
    expect(solo.otherApprovers).toBe(0);
    expect(canApprove(solo)).toBe('COOLING_OFF');
    expect(canApprove({ ...solo, now: COOLED_OFF })).toBeNull();
  });

  it('treats a two-person team whose other member is a party like a solo one, rather than deadlocking', () => {
    const staff = ['staff-a', 'seller-1'];
    expect(otherApproversFor(staff, 'staff-a', ['buyer-1', 'seller-1'])).toBe(0);
    expect(otherApproversFor(staff, 'staff-a', ['buyer-1', 'buyer-2'])).toBe(1);

    const proposer = { ...base, approverId: 'staff-a', otherApprovers: 0 };
    expect(canApprove(proposer)).toBe('COOLING_OFF');
    expect(canApprove({ ...proposer, now: COOLED_OFF })).toBeNull();
    // The party themself still can never approve.
    expect(canApprove({ ...base, approverId: 'seller-1', otherApprovers: 0, now: COOLED_OFF })).toBe('RECUSED');
  });

  it('never lets an unreadable proposal time count as cooled off', () => {
    expect(canApprove({ ...base, approverId: 'staff-a', otherApprovers: 0, proposedAt: 'garbage', now: COOLED_OFF })).toBe('COOLING_OFF');
  });

  it('recuses a staff member who is a party to the case', () => {
    expect(isRecused('seller-1', base.participantIds)).toBe(true);
    expect(canApprove({ ...base, approverId: 'seller-1' })).toBe('RECUSED');
  });

  it('refuses anything that is not pending', () => {
    expect(canApprove({ ...base, status: 'EXECUTED' })).toBe('NOT_PENDING');
  });
});
