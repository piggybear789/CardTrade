'use server';

// lib/actions/addresses.ts
//
// Server actions for a member's PRIVATE saved-address book (0113) — a convenience
// list of provider-resolved postal addresses a member reuses when a purchase or
// trade needs a delivery address, rather than retyping it into every contract.
//
// Every export here is an attacker-reachable endpoint, so ownership is decided by
// the SESSION user id and NEVER by an argument. A saved address is scoped to its
// owner by RLS (`member_addresses_owner_*` policies, `auth.uid() = owner_id`), and
// the cookie-bound client below is what carries that identity — so even the
// `.eq('owner_id', user.id)` filters are belt-and-braces on top of RLS, not the
// only guard.
//
// A saved address is only ever a SOURCE the member copies from into a contract; it
// is never auto-disclosed to a counterparty. The per-contract disclosure rules on
// cash_sale_delivery_details / trade_delivery_details are unchanged by this file.

import { revalidatePath } from 'next/cache';

import { createClient } from '@/lib/supabase/server';
import { isResolvedPlace } from '@/domain/fulfilment/terms';
import { type ActionResult, fail, ok } from './result';

/** Longest a member-given entry label may be. Mirrors the DB check (0113). */
const LABEL_MAX_LENGTH = 120;

/** A provider-resolved address the caller wants to save to their book. */
export interface SaveAddressInput {
  /** Present when editing an existing entry; absent to create a new one. */
  id?: string;
  /** Optional member-given name (e.g. "Home"). Not the address text. */
  label?: string | null;
  /** The resolved place: label + coordinates + provider id. */
  place: {
    label: string;
    placeId: string;
    countryCode?: string | null;
    lat: number | null;
    lng: number | null;
  };
  /** Make this the member's default (prefilled first). */
  isDefault?: boolean;
}

/** A saved address as returned to the owner. */
export interface SavedAddress {
  id: string;
  label: string | null;
  addressLabel: string;
  placeId: string;
  countryCode: string | null;
  lat: number | null;
  lng: number | null;
  isDefault: boolean;
}

/** Typed failure codes shared by the address-book actions. */
export type AddressError =
  | 'not-authenticated'
  | 'validation-error'
  | 'not-found'
  | 'persistence-error';

type AddressRow = {
  id: string;
  label: string | null;
  address_label: string;
  place_id: string;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  is_default: boolean;
};

function toSavedAddress(row: AddressRow): SavedAddress {
  return {
    id: row.id,
    label: row.label,
    addressLabel: row.address_label,
    placeId: row.place_id,
    countryCode: row.country_code,
    lat: row.latitude,
    lng: row.longitude,
    isDefault: row.is_default,
  };
}

const ADDRESS_COLUMNS =
  'id, label, address_label, place_id, country_code, latitude, longitude, is_default';

/** List the caller's own saved addresses, defaults first then newest first. */
export async function listMyAddresses(): Promise<
  ActionResult<SavedAddress[], AddressError>
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('not-authenticated', 'Sign in to view your saved addresses.');

  const { data, error } = await supabase
    .from('member_addresses')
    .select(ADDRESS_COLUMNS)
    .eq('owner_id', user.id)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) return fail('persistence-error', 'Could not load your saved addresses.');
  return ok((data ?? []).map((row) => toSavedAddress(row as AddressRow)));
}

/**
 * Create a new saved address or update an existing one the caller owns.
 *
 * The place must be provider-resolved: a `text:`/`legacy:` id or missing
 * coordinates is refused here rather than persisted, the same rule that guards a
 * contract's delivery address. When `isDefault` is set, the previous default is
 * demoted first so the one-default-per-owner index cannot be violated.
 */
export async function saveAddress(
  input: SaveAddressInput,
): Promise<ActionResult<SavedAddress, AddressError>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('not-authenticated', 'Sign in to save an address.');

  const label = input.label?.trim() || null;
  if (label && label.length > LABEL_MAX_LENGTH) {
    return fail('validation-error', `Labels can be at most ${LABEL_MAX_LENGTH} characters.`);
  }

  const place = input.place;
  if (
    !isResolvedPlace({
      label: place?.label,
      placeId: place?.placeId,
      lat: place?.lat ?? Number.NaN,
      lng: place?.lng ?? Number.NaN,
      countryCode: place?.countryCode ?? null,
    })
  ) {
    return fail(
      'validation-error',
      'Choose a suggested address so it can be verified before saving.',
    );
  }

  // Demote any existing default before promoting this one. RLS scopes the update
  // to the caller, so this cannot touch another member's rows.
  if (input.isDefault) {
    const { error: demoteError } = await supabase
      .from('member_addresses')
      .update({ is_default: false })
      .eq('owner_id', user.id)
      .eq('is_default', true);
    if (demoteError) return fail('persistence-error', 'Could not save your address.');
  }

  const values = {
    label,
    address_label: place.label.trim(),
    place_id: place.placeId,
    country_code: place.countryCode ?? null,
    latitude: place.lat,
    longitude: place.lng,
    is_default: input.isDefault ?? false,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    // UPDATE is scoped to both the id AND the owner. Trusting the id alone would
    // let a caller edit any row; the owner filter (with RLS behind it) makes the
    // target the caller's own row or nothing.
    const { data, error } = await supabase
      .from('member_addresses')
      .update(values)
      .eq('id', input.id)
      .eq('owner_id', user.id)
      .select(ADDRESS_COLUMNS)
      .maybeSingle();
    if (error) return fail('persistence-error', 'Could not save your address.');
    if (!data) return fail('not-found', 'That saved address no longer exists.');
    revalidatePath('/profile');
    return ok(toSavedAddress(data as AddressRow));
  }

  const { data, error } = await supabase
    .from('member_addresses')
    .insert({ owner_id: user.id, ...values })
    .select(ADDRESS_COLUMNS)
    .single();
  if (error || !data) return fail('persistence-error', 'Could not save your address.');
  revalidatePath('/profile');
  return ok(toSavedAddress(data as AddressRow));
}

/** Delete one of the caller's own saved addresses. */
export async function deleteAddress(
  id: string,
): Promise<ActionResult<null, AddressError>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('not-authenticated', 'Sign in to remove a saved address.');

  if (typeof id !== 'string' || !id.trim()) {
    return fail('validation-error', 'No address was selected.');
  }

  const { error } = await supabase
    .from('member_addresses')
    .delete()
    .eq('id', id)
    .eq('owner_id', user.id);
  if (error) return fail('persistence-error', 'Could not remove that address.');
  revalidatePath('/profile');
  return ok(null);
}

/**
 * Make one of the caller's own saved addresses the default.
 *
 * Demotes the current default first, then promotes the target — both scoped to the
 * caller — so the one-default-per-owner index is never violated.
 */
export async function setDefaultAddress(
  id: string,
): Promise<ActionResult<null, AddressError>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('not-authenticated', 'Sign in to change your default address.');

  if (typeof id !== 'string' || !id.trim()) {
    return fail('validation-error', 'No address was selected.');
  }

  const { error: demoteError } = await supabase
    .from('member_addresses')
    .update({ is_default: false })
    .eq('owner_id', user.id)
    .eq('is_default', true);
  if (demoteError) return fail('persistence-error', 'Could not update your default address.');

  const { data, error } = await supabase
    .from('member_addresses')
    .update({ is_default: true, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('owner_id', user.id)
    .select('id')
    .maybeSingle();
  if (error) return fail('persistence-error', 'Could not update your default address.');
  if (!data) return fail('not-found', 'That saved address no longer exists.');
  revalidatePath('/profile');
  return ok(null);
}
