'use server';

// lib/actions/identity.ts
//
// Commitment-point identity disclosure, sourced from Stripe Connect (Req 17).
//
// REPLACES `getCounterpartyIdentity` from the retired `lib/actions/kyc.ts`. The
// participation gate is carried over unchanged; only the SOURCE of the name moves,
// from the retired `identity_verified_*` columns to the Connect-verified legal
// name on the counterparty's connected account.
//
// WHY THE SOURCE CHANGE IS SAFE. `merchant_legal_entity_name` is written only by
// `applyComplianceUpdate`, from `identity.individual.given_name` + `surname` as
// Stripe reports them for the connected account — never from anything a Member
// typed. It is also written monotonically, absent to present, so a later provider
// report cannot blank a name already disclosed to a counterparty.
//
// WHAT IT NO LONGER COVERS. A buy-only Member holds no connected account, so there
// is no verified name for them and this returns null. That is deliberate: a Buyer
// never receives a transfer, so requiring payout onboarding of them would be
// friction with no purpose. Sellers see a display name and trading history for
// such a Buyer instead of a legal name (Req 17.4).
//
// DISCLOSURE IS STILL STAGED. Public surfaces read `public_profiles`, which exposes
// a given name and a badge only. The FULL legal name is released here, and only to
// someone already transacting with that Member — never from a listing or profile
// page.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { satisfiesIdentityGate, type MerchantStatus } from '@/domain/identity/identityGate';
import { type ActionResult, fail, ok } from './result';

/** Typed failures for a disclosure read. */
export type IdentityDisclosureError =
  | 'NOT_AUTHENTICATED'
  | 'NOT_A_COUNTERPARTY'
  | 'PROFILE_NOT_FOUND';

/** A counterparty's verified identity, released at a commitment point. */
export interface CounterpartyIdentity {
  /** Full provider-verified legal name, or null when they have none. */
  legalName: string | null;
  verifiedAt: string | null;
}

/**
 * Release a counterparty's full provider-verified legal name to the caller.
 *
 * Gated on an existing transactional relationship: the caller must be a
 * participant in a Trade, Cash_Sale or private deal with `counterpartyId`
 * (Req 17.2, 17.8).
 */
export async function getCounterpartyIdentity(
  counterpartyId: string,
): Promise<ActionResult<CounterpartyIdentity, IdentityDisclosureError>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('NOT_AUTHENTICATED', 'You must be signed in.');
  if (!counterpartyId || counterpartyId === user.id) {
    return fail('NOT_A_COUNTERPARTY', 'No counterparty was specified.');
  }

  const admin = createAdminClient();

  // Prove a shared transaction exists before disclosing anything. Any one of the
  // three relationships is sufficient; each is checked with both role orderings.
  const [trades, sales, deals] = await Promise.all([
    admin
      .from('trades')
      .select('id')
      .or(
        `and(initiator_id.eq.${user.id},counterpart_id.eq.${counterpartyId}),` +
          `and(initiator_id.eq.${counterpartyId},counterpart_id.eq.${user.id})`,
      )
      .limit(1),
    admin
      .from('cash_sales')
      .select('id')
      .or(
        `and(buyer_id.eq.${user.id},seller_id.eq.${counterpartyId}),` +
          `and(buyer_id.eq.${counterpartyId},seller_id.eq.${user.id})`,
      )
      .limit(1),
    admin
      .from('deals')
      .select('id')
      .or(
        `and(creator_id.eq.${user.id},counterparty_id.eq.${counterpartyId}),` +
          `and(creator_id.eq.${counterpartyId},counterparty_id.eq.${user.id})`,
      )
      .limit(1),
  ]);

  const related =
    (trades.data?.length ?? 0) > 0 ||
    (sales.data?.length ?? 0) > 0 ||
    (deals.data?.length ?? 0) > 0;

  if (!related) {
    return fail(
      'NOT_A_COUNTERPARTY',
      'Verified names are shown once you are transacting with someone.',
    );
  }

  // Single string literal: concatenating it collapses Supabase's row-type
  // inference to `GenericStringError` and every field access below fails to type.
  const { data } = await admin
    .from('profiles')
    .select(
      'merchant_status, merchant_settlements_enabled, merchant_legal_entity_name, merchant_identity_verified_at',
    )
    .eq('id', counterpartyId)
    .maybeSingle();

  if (!data) return fail('PROFILE_NOT_FOUND', 'That account no longer exists.');

  // Only disclose while the Identity_Gate still stands.
  const verified = satisfiesIdentityGate({
    merchantStatus: (data.merchant_status ?? 'NONE') as MerchantStatus,
    settlementsEnabled: Boolean(data.merchant_settlements_enabled),
  });

  return ok({
    legalName: verified ? ((data.merchant_legal_entity_name as string | null) ?? null) : null,
    verifiedAt: verified
      ? ((data.merchant_identity_verified_at as string | null) ?? null)
      : null,
  });
}
