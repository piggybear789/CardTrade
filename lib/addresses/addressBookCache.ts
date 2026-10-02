// lib/addresses/addressBookCache.ts
//
// The member's saved-address book as this browser tab last read it.
//
// BOTH READERS LIVE IN DIALOGS. `SavedAddressField` (buy flow, trade terms, delivery
// panel) and `MemberAddressesEditor` (the profile's Addresses row) mount when a dialog
// opens and fetch the book on mount, so every open drew a one-line placeholder and then
// grew into a list — a centred dialog growing in both directions, its footer moving
// while the member reached for it. Remembering the book means only the first open of a
// session waits; later ones paint the final list immediately and revalidate behind it.
//
// Client-only, module-scoped, and holds nothing but the viewer's own addresses — the
// same rows `listMyAddresses` returns to them under RLS. It is a paint hint, never a
// source of truth: every reader still re-reads on mount.

import type { SavedAddress } from '@/lib/actions/addresses';

let book: SavedAddress[] | null = null;

/** The last book read in this tab, or null before the first read. */
export function readAddressBook(): SavedAddress[] | null {
  return book;
}

/** Record a fresh read (or a write's read-back). */
export function rememberAddressBook(next: SavedAddress[]): void {
  book = next;
}

/** Test seam: forget the book between cases. */
export function resetAddressBookCache(): void {
  book = null;
}
