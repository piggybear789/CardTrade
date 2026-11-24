// tests/unit/e2eAudit/sharedCleanup.test.ts
//
// Examples for the Shared_Resources cleanup decisions (Req 2.4–2.8): which Storage
// objects are deleted, which runs are healed, and what happens to each Stripe object.

import { describe, expect, it } from 'vitest';
import {
  decideStripeObject,
  mergeLeftInStripe,
  parseUploadLedger,
  planStorageDeletion,
  runStartedAt,
  runsToHeal,
  type StorageCandidate,
} from '../../e2e/audit/core/sharedCleanup';

const RUN = '2026-12-01T09-30-00Z-a1b2c3d';
const OTHER = '2026-11-30T08-00-00Z-zzz';
const OWNER = '11111111-2222-3333-4444-555555555555';
const STRANGER = '99999999-8888-7777-6666-555555555555';
const STAMP = { cardtrade_sandbox: 'true', cardtrade_e2e_run: RUN };

describe('parseUploadLedger', () => {
  it('keeps valid lines for this run only and reports the rest', () => {
    const text = [
      JSON.stringify({ bucket: 'item-images', path: `${OWNER}/a/0.jpg`, runId: RUN, member: 'seller', pathwayId: 'a.b' }),
      JSON.stringify({ bucket: 'item-images', path: `${OWNER}/a/0.jpg`, runId: RUN, member: 'seller', pathwayId: 'a.b' }),
      JSON.stringify({ bucket: 'item-images', path: `${OWNER}/b.jpg`, runId: OTHER }),
      JSON.stringify({ bucket: 'public', path: 'x.jpg', runId: RUN }),
      JSON.stringify({ bucket: 'item-images', path: '../escape.jpg', runId: RUN }),
      'not json',
      '',
    ].join('\n');
    const parsed = parseUploadLedger(text, RUN);
    expect(parsed.entries).toEqual([
      { bucket: 'item-images', path: `${OWNER}/a/0.jpg`, runId: RUN, member: 'seller', pathwayId: 'a.b' },
    ]);
    expect(parsed.invalidLines).toEqual([3, 4, 5, 6]);
  });
});

describe('planStorageDeletion', () => {
  const plan = (candidates: StorageCandidate[], referenced: string[] = []) =>
    planStorageDeletion({ candidates, sandboxOwners: new Set([OWNER]), stillReferenced: new Set(referenced) });

  it('deletes ledger entries by exact path', () => {
    const result = plan([{ bucket: 'message-attachments', path: `${STRANGER}/m.png`, source: 'ledger' }]);
    expect([...result.delete]).toEqual([['message-attachments', [`${STRANGER}/m.png`]]]);
    expect(result.kept).toEqual([]);
  });

  it('deletes a row path only under a sandbox owner folder', () => {
    const result = plan([
      { bucket: 'item-images', path: `${OWNER}/x/0.jpg`, source: 'row' },
      { bucket: 'item-images', path: `${STRANGER}/y/0.jpg`, source: 'row' },
      { bucket: 'item-images', path: 'e2e/placeholder.jpg', source: 'row' },
    ]);
    expect(result.delete.get('item-images')).toEqual([`${OWNER}/x/0.jpg`]);
    expect(result.kept.map((k) => [k.path, k.reason])).toEqual([
      [`${STRANGER}/y/0.jpg`, 'owner-not-sandbox'],
      ['e2e/placeholder.jpg', 'owner-not-sandbox'],
    ]);
  });

  it('never deletes the seed photos or an object a surviving row still names', () => {
    const result = plan(
      [
        { bucket: 'item-images', path: 'sandbox/item/0.jpg', source: 'ledger' },
        { bucket: 'item-images', path: `${OWNER}/shared/0.jpg`, source: 'ledger' },
      ],
      [`item-images/${OWNER}/shared/0.jpg`],
    );
    expect(result.delete.size).toBe(0);
    expect(result.kept.map((k) => k.reason).sort()).toEqual(['seed-image', 'still-referenced']);
  });

  it('decides a path found twice once, by the most trusted source', () => {
    const result = plan([
      { bucket: 'item-images', path: `${STRANGER}/z.jpg`, source: 'row' },
      { bucket: 'item-images', path: `${STRANGER}/z.jpg`, source: 'ledger' },
    ]);
    expect(result.delete.get('item-images')).toEqual([`${STRANGER}/z.jpg`]);
    expect(result.kept).toEqual([]);
  });
});

describe('runsToHeal', () => {
  const now = new Date('2026-12-01T12:00:00Z');

  it('puts the current run first, then recent runs on disk, newest first', () => {
    const old = '2026-11-01T00-00-00Z-old';
    expect(runsToHeal({ current: RUN, onDisk: [OTHER, RUN, old, 'junk'], now })).toEqual([RUN, OTHER]);
  });

  it('ignores a current id that is not a run id', () => {
    expect(runsToHeal({ current: 'nope', onDisk: [], now })).toEqual([]);
  });

  it('reads the start instant out of a run id', () => {
    expect(runStartedAt(RUN)?.toISOString()).toBe('2026-12-01T09:30:00.000Z');
    expect(runStartedAt('2026-12-01')).toBeNull();
  });
});

describe('decideStripeObject', () => {
  it('acts only on objects carrying both stamps for this run', () => {
    expect(decideStripeObject({ type: 'customer', runId: RUN, metadata: {} })).toEqual({ action: 'skip', reason: 'not-stamped' });
    expect(
      decideStripeObject({ type: 'customer', runId: RUN, metadata: { cardtrade_sandbox: 'true', cardtrade_e2e_run: OTHER } }),
    ).toEqual({ action: 'skip', reason: 'other-run' });
    expect(decideStripeObject({ type: 'customer', runId: RUN, metadata: STAMP })).toEqual({ action: 'delete' });
  });

  it('keeps fixture objects', () => {
    expect(
      decideStripeObject({ type: 'account', runId: RUN, metadata: { ...STAMP, cardtrade_e2e_fixture: 'AU' } }),
    ).toEqual({ action: 'skip', reason: 'fixture' });
  });

  it('cancels unfinished PaymentIntents and leaves settled ones', () => {
    expect(decideStripeObject({ type: 'payment_intent', runId: RUN, metadata: STAMP, status: 'requires_capture' })).toEqual({ action: 'cancel' });
    expect(decideStripeObject({ type: 'payment_intent', runId: RUN, metadata: STAMP, status: 'canceled' })).toEqual({ action: 'done' });
    expect(decideStripeObject({ type: 'payment_intent', runId: RUN, metadata: STAMP, status: 'succeeded' }).action).toBe('leave');
  });

  it('cancels an unfinished Identity session and leaves a verified one', () => {
    const base = { type: 'identity.verification_session' as const, runId: RUN, metadata: STAMP };
    expect(decideStripeObject({ ...base, status: 'requires_input' })).toEqual({ action: 'cancel' });
    expect(decideStripeObject({ ...base, status: 'verified' }).action).toBe('leave');
  });
});

describe('mergeLeftInStripe', () => {
  const a = { type: 'payment_intent', id: 'pi_a', reason: 'succeeded' };
  const b = { type: 'customer', id: 'cus_b', reason: 'could not delete' };

  it('replaces the list after a complete pass and merges after a partial one', () => {
    expect(mergeLeftInStripe([a], [b], true)).toEqual([b]);
    expect(mergeLeftInStripe([a], [b], false)).toEqual([b, a]);
  });
});
