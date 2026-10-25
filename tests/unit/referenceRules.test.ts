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

import {
  referenceAddressKey,
  referenceGraphApiHref,
  referenceHref,
  withQuery,
} from '@/domain/references/address';
import {
  displayNameLabel,
  isValidClaimHandle,
  pickPersonKey,
  validateGiveReference,
} from '@/domain/references/reference';

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

// A HANDLE IS ALWAYS ON A PLATFORM. Every link the app builds must say which, or the
// page could resolve to someone else who shares the spelling.
describe('reference addresses', () => {
  it('puts the platform on every handle link and every graph request', () => {
    const address = { slug: 'kai.collects', on: 'instagram' as const };
    expect(referenceHref(address)).toBe('/references/kai.collects?on=instagram');
    expect(referenceGraphApiHref(address)).toBe('/api/references/graph?handle=kai.collects&on=instagram');
  });

  it('links a member with no claimed handle by id alone', () => {
    const address = { slug: '00000000-0000-4000-8000-000000000001', on: null };
    expect(referenceHref(address)).toBe('/references/00000000-0000-4000-8000-000000000001');
    expect(referenceGraphApiHref(address)).toBe(
      '/api/references/graph?handle=00000000-0000-4000-8000-000000000001',
    );
  });

  it('keeps the platform when adding parameters to a page that already has one', () => {
    expect(referenceHref({ slug: 'john', on: 'discord' }, { experience: '1' })).toBe(
      '/references/john?on=discord&experience=1',
    );
    expect(withQuery('/references/john?on=discord', { claim: 'manual' })).toBe(
      '/references/john?on=discord&claim=manual',
    );
    expect(withQuery('/sellers/abc', { experience: '1' })).toBe('/sellers/abc?experience=1');
  });

  it('keys the same handle on two platforms as two pages', () => {
    expect(referenceAddressKey({ slug: 'John', on: 'instagram' })).not.toBe(
      referenceAddressKey({ slug: 'john', on: 'discord' }),
    );
    expect(referenceAddressKey({ slug: 'John', on: 'instagram' })).toBe(
      referenceAddressKey({ slug: 'john', on: 'instagram' }),
    );
  });
});

describe('isValidClaimHandle', () => {
  it('accepts real usernames', () => {
    expect(isValidClaimHandle('instagram', 'kai.collects')).toBe(true);
    expect(isValidClaimHandle('x', 'graded_gems')).toBe(true);
    expect(isValidClaimHandle('ebay', 'card*shop-99')).toBe(true);
    expect(isValidClaimHandle(null, 'some-handle')).toBe(true);
  });

  it('refuses anything that could pass for text, a link or markup on a public page', () => {
    for (const handle of ['100%legit', 'scam alert', '<b>x</b>', 'a/b', 'ab:cd', 'emoji🙂', '']) {
      expect(isValidClaimHandle(null, handle)).toBe(false);
    }
    expect(isValidClaimHandle('instagram', 'card*shop')).toBe(false);
  });

  it("holds each platform to its own length limit", () => {
    expect(isValidClaimHandle('x', 'a'.repeat(15))).toBe(true);
    expect(isValidClaimHandle('x', 'a'.repeat(16))).toBe(false);
    expect(isValidClaimHandle('instagram', 'a'.repeat(31))).toBe(false);
  });
});

describe('displayNameLabel', () => {
  it('never shows a display name as if it were a handle', () => {
    expect(displayNameLabel('@famous_trader')).toBe('famous_trader');
    expect(displayNameLabel('  Ava Nguyen ')).toBe('Ava Nguyen');
  });
});

describe('validateGiveReference: handle targets', () => {
  const details = { platform: 'instagram', role: 'BOUGHT', rating: 5 };

  it('needs the platform the account is on', () => {
    const result = validateGiveReference({
      ...details,
      target: { kind: 'handle', handle: 'john', platform: 'other' },
    });
    expect(result).toMatchObject({ ok: false, field: 'platform' });
  });

  it('carries the platform through with the handle', () => {
    const result = validateGiveReference({
      ...details,
      platform: 'whatnot',
      target: { kind: 'handle', handle: '@john', platform: 'whatnot' },
    });
    expect(result).toMatchObject({ ok: true, value: { target: { kind: 'handle', handle: 'john', platform: 'whatnot' } } });
  });
});
