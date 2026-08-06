// tests/unit/avatars.test.ts
//
// The pure parts of profile pictures (0066): resolving a stored path to a URL, the
// initials fallback, and the upload allowlist.
//
// WHY THESE THREE. Avatars are mostly plumbing and UI, but three pieces carry real
// consequences if they regress:
//
//   * `initialsFor` is the DEFAULT rendering, not an edge case — every account
//     predates avatars and most will never set one. If it can return an empty
//     string the marketplace fills with blank circles that read as broken images.
//   * `avatarUrl` must never treat a path as a URL or vice versa. The database
//     stores paths; a caller that leaks a raw path into `src` gets a silent 404.
//   * The type allowlist is the first of three gates (here, the bucket, and the
//     server). It is the only one that can give the member a readable reason.

import { beforeEach, describe, expect, it } from 'vitest';

import { avatarUrl, initialsFor } from '@/lib/format';
import {
  ALLOWED_AVATAR_TYPES,
  MAX_AVATAR_BYTES,
  isAllowedAvatarType,
} from '@/lib/storage/profileImagesShared';

describe('initialsFor', () => {
  it('takes the first and last initial of a two-part name', () => {
    expect(initialsFor('Ada Lovelace')).toBe('AL');
  });

  it('uses the first and LAST word, not the second', () => {
    // "Mary Anne Evans" should read ME, not MA — the last word is the family name
    // a member is more likely to be known by.
    expect(initialsFor('Mary Anne Evans')).toBe('ME');
  });

  it('gives a single initial for a one-word alias', () => {
    expect(initialsFor('kitsunearia')).toBe('K');
  });

  it('NEVER returns an empty string, whatever it is given', () => {
    // A blank avatar circle reads as a broken image, so every one of these must
    // still produce a glyph.
    for (const input of [null, undefined, '', '   ', '!!!', '🙂', '···']) {
      expect(initialsFor(input).length).toBeGreaterThan(0);
    }
  });

  it('falls back to ? when a name has no letters or digits at all', () => {
    expect(initialsFor('🙂')).toBe('?');
    expect(initialsFor('---')).toBe('?');
  });

  it('ignores punctuation rather than treating it as an initial', () => {
    // Leading punctuation must not become the initial.
    expect(initialsFor('"Ada" Lovelace')).toBe('AL');
    expect(initialsFor('  Ada   Lovelace  ')).toBe('AL');
  });

  it('uppercases, and keeps non-Latin letters', () => {
    expect(initialsFor('ada lovelace')).toBe('AL');
    // Unicode-aware: a Cyrillic name must not be stripped to '?'.
    expect(initialsFor('Ада Лавлейс')).toBe('АЛ');
  });
});

describe('avatarUrl', () => {
  const BASE = 'https://example.supabase.co';

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = BASE;
  });

  it('returns null when there is no avatar', () => {
    // The common case: callers must handle it, which is why it is null rather
    // than a placeholder URL.
    expect(avatarUrl(null)).toBeNull();
    expect(avatarUrl(undefined)).toBeNull();
    expect(avatarUrl('')).toBeNull();
  });

  it('resolves a stored path against the profile-images bucket', () => {
    expect(avatarUrl('owner-1/abc.png')).toBe(
      `${BASE}/storage/v1/object/public/profile-images/owner-1/abc.png`,
    );
  });

  it('does NOT resolve into the item-images bucket', () => {
    // The two buckets have different size and format rules; crossing them is a
    // silent 404 rather than a type error, so it is worth pinning.
    expect(avatarUrl('owner-1/abc.png')).not.toContain('item-images');
  });

  it('passes an absolute URL through untouched', () => {
    const external = 'https://cdn.example.com/a.jpg';
    expect(avatarUrl(external)).toBe(external);
  });

  it('does not double up slashes', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = `${BASE}/`;
    expect(avatarUrl('/owner-1/abc.png')).toBe(
      `${BASE}/storage/v1/object/public/profile-images/owner-1/abc.png`,
    );
  });

  it('returns null when Supabase is not configured, rather than a broken URL', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(avatarUrl('owner-1/abc.png')).toBeNull();
  });
});

describe('avatar upload rules', () => {
  it('accepts PNG, JPEG and WebP', () => {
    expect(isAllowedAvatarType('image/png')).toBe(true);
    expect(isAllowedAvatarType('image/jpeg')).toBe(true);
    expect(isAllowedAvatarType('image/jpg')).toBe(true);
    expect(isAllowedAvatarType('image/webp')).toBe(true);
  });

  it('REFUSES GIF, unlike item photos', () => {
    // Deliberate: an animated avatar plays unbidden on every surface the member
    // appears on, which is a flashing-image accessibility problem. Item photos
    // keep GIF because they are dispute evidence.
    expect(isAllowedAvatarType('image/gif')).toBe(false);
    expect(ALLOWED_AVATAR_TYPES).not.toContain('image/gif');
  });

  it('refuses non-images, including ones dressed as images', () => {
    for (const type of ['image/svg+xml', 'text/html', 'application/pdf', '', 'image']) {
      expect(isAllowedAvatarType(type)).toBe(false);
    }
  });

  it('is case-insensitive about the declared type', () => {
    // Browsers are inconsistent about casing in `File.type`.
    expect(isAllowedAvatarType('IMAGE/PNG')).toBe(true);
  });

  it('caps avatars well below the item-photo limit', () => {
    // 2 MB against 10 MB: an avatar renders at 24-96px, so a lower ceiling bounds
    // what a hostile upload costs without affecting any legitimate one.
    expect(MAX_AVATAR_BYTES).toBe(2 * 1024 * 1024);
    expect(MAX_AVATAR_BYTES).toBeLessThan(10 * 1024 * 1024);
  });
});
