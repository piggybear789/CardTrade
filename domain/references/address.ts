// domain/references/address.ts
//
// Where a references page lives. A handle alone names nobody: @john on Instagram and
// john on Discord are different people. So every link the app builds carries the
// platform too (`/references/john?on=instagram`), or an id: a profile with no claimed
// handle, or an unclaimed handle, by UUID. A bare `/references/john` still works for a
// visitor who types it; it asks which john when more than one exists.
//
// Pure: shared by the server loaders and the client components that link and walk.

import { isClaimPlatform, type ClaimPlatform } from '@/domain/references/reference';

export interface ReferenceAddress {
  /** A handle without `@`, or a profile / social_claims UUID. */
  slug: string;
  /** The platform the handle lives on. Null for an id, or a handle nobody has placed yet. */
  on: ClaimPlatform | null;
}

/** A claimed or unclaimed handle's own page. */
export function claimAddress(claim: { handle: string; platform: string }): ReferenceAddress {
  return { slug: claim.handle, on: isClaimPlatform(claim.platform) ? claim.platform : null };
}

/** A path segment decoded, or as it came when it is not valid percent-encoding. */
export function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The page for `address`, with any extra query parameters. */
export function referenceHref(address: ReferenceAddress, params: Record<string, string> = {}): string {
  const query = new URLSearchParams();
  if (address.on) query.set('on', address.on);
  for (const [key, value] of Object.entries(params)) query.set(key, value);
  const search = query.toString();
  return `/references/${encodeURIComponent(address.slug)}${search ? `?${search}` : ''}`;
}

/** The JSON graph for `address` (`app/api/references/graph`), for walking the network. */
export function referenceGraphApiHref(address: ReferenceAddress): string {
  const query = new URLSearchParams({ handle: address.slug });
  if (address.on) query.set('on', address.on);
  return `/api/references/graph?${query.toString()}`;
}

/** One key per page, for caches and React keys. */
export function referenceAddressKey(address: ReferenceAddress): string {
  return `${address.on ?? '*'}:${address.slug.toLowerCase()}`;
}

/** Add query parameters to a same-site path that may already carry some. */
export function withQuery(path: string, params: Record<string, string>): string {
  const url = new URL(path, 'https://noditto.invalid');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}
