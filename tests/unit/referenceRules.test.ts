// tests/unit/referenceRules.test.ts
//
// The pure rules under References (0155): who a profile is as a person, which handles
// count, where a reference page lives, and what a reference may say.
//
// THE PERSON KEY HAS TWO IMPLEMENTATIONS THAT MUST AGREE. `pickPersonKey` (the app) and
// `cardtrade.person_key_for` (the claim trigger, 0162) each decide who a profile is. If
// they named different people, a claim could move a reference into a duplicate edge or
// past the self-reference check, so the ordering is pinned here.

import { describe, expect, it } from 'vitest';

import { pickPersonKey } from '@/domain/references/reference';

describe('pickPersonKey', () => {
  it('falls back to the profile id when the profile has no identity keys', () => {
    expect(pickPersonKey('p1', [])).toBe('profile:p1');
  });

  it('prefers a document key over any other kind', () => {
    expect(
      pickPersonKey('p1', [
        { kind: 'card-fingerprint', fingerprint: 'aaa' },
        { kind: 'document-id', fingerprint: 'zzz' },
      ]),
    ).toBe('zzz');
  });

  it('otherwise orders by kind, then fingerprint, in code-point order like `collate "C"`', () => {
    const rows = [
      { kind: 'selfie', fingerprint: 'b' },
      { kind: 'Selfie', fingerprint: 'c' },
      { kind: 'selfie', fingerprint: 'a' },
    ];
    // Upper case sorts before lower case in code-point order, where a locale sort would not.
    expect(pickPersonKey('p1', rows)).toBe('c');
    expect(pickPersonKey('p1', rows.filter((row) => row.kind === 'selfie'))).toBe('a');
  });

  it('does not depend on the order the rows arrive in', () => {
    const rows = [
      { kind: 'document-id', fingerprint: 'f2' },
      { kind: 'document-id', fingerprint: 'f1' },
    ];
    expect(pickPersonKey('p1', rows)).toBe('f1');
    expect(pickPersonKey('p1', [...rows].reverse())).toBe('f1');
  });
});
