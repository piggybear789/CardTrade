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
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { getPaymentService } from '@/domain/services';
import { DEFAULT_CONFIG_REGION } from '@/domain/services/stripe/config';
import { regionForProfile } from '@/lib/regionBinding';
import { satisfiesIdentityGate, type IdentityCheckStatus } from '@/domain/identity/identityGate';
import { friendlyWriteFailure } from '@/lib/actions/writeFailure';
import { pushVerifiedIdentityToConnect } from '@/lib/actions/merchant';
import { applyIdentityDecision } from '@/lib/identity/applyIdentityDecision';
import { type ActionResult, fail, ok } from './result';

/**
 * The signed-in member's own platform region (0068).
 *
 * A verification flow belongs to one Stripe account, so the identity call has to go
 * through the member's own platform — the same rule as their connected account.
 * Falls back to the default region when there is no session; the actions themselves
 * then refuse for want of a user.
 */
async function viewerRegion(): Promise<string> {
  const user = await getCachedAuthUser();
  return user ? regionForProfile(user.id) : DEFAULT_CONFIG_REGION;
}

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
 * participant in a Trade or Cash_Sale with `counterpartyId`
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

  // THE ID IS INTERPOLATED INTO A FILTER GRAMMAR BELOW, SO IT IS VALIDATED FIRST.
  //
  // `.or('and(initiator_id.eq.<id>,...)')` is PostgREST's own filter syntax, not a
  // parameterised query: a value containing its metacharacters is parsed as structure
  // rather than data. Nothing exploitable was found — the same string is later matched
  // with `.eq('id', counterpartyId)`, which rejects a non-UUID — but "a later call
  // happens to reject it" is not a control, and this one decides whether a verified
  // legal name is disclosed. A shape check makes the guarantee local.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(counterpartyId)) {
    return fail('PROFILE_NOT_FOUND', 'That member could not be found.');
  }

  const admin = createAdminClient();

  // Prove a shared transaction exists before disclosing anything. Either relationship
  // is sufficient; each is checked with both role orderings.
  const [trades, sales] = await Promise.all([
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
  ]);

  const related =
    (trades.data?.length ?? 0) > 0 || (sales.data?.length ?? 0) > 0;

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
      'identity_check_status, identity_check_name, identity_check_verified_at, merchant_legal_entity_name, merchant_identity_verified_at',
    )
    .eq('id', counterpartyId)
    .maybeSingle();

  if (!data) return fail('PROFILE_NOT_FOUND', 'That account no longer exists.');

  // Only disclose while the Identity_Gate still stands.
  const verified = satisfiesIdentityGate({
    identityCheckStatus: (data.identity_check_status ?? 'NONE') as IdentityCheckStatus,
  });

  // Prefer the document-backed name from Stripe Identity, falling back to the
  // Connect-reported one for members verified before 0069. The fallback matters:
  // a null disclosure blocks the buy path entirely, so a grandfathered seller must
  // keep the name they were already disclosed under.
  return ok({
    legalName: verified
      ? ((data.identity_check_name as string | null) ??
         (data.merchant_legal_entity_name as string | null) ??
         null)
      : null,
    verifiedAt: verified
      ? ((data.identity_check_verified_at as string | null) ??
         (data.merchant_identity_verified_at as string | null) ??
         null)
      : null,
  });
}

// ---------------------------------------------------------------------------
// The Identity_Gate: starting and refreshing a verification check (0069)
// ---------------------------------------------------------------------------
//
// TWO STEPS, SEQUENTIAL. This is step one and it needs no bank details; Connect
// payout setup is step two and lives in `lib/actions/merchant.ts`. Keeping them in
// separate modules is deliberate — they answer different questions ("who is this"
// and "where does money go") and the retired KYC seam's failure was letting one
// surface answer both.

/** Typed failures for starting or refreshing an identity check. */
export type IdentityCheckError =
  | 'NOT_AUTHENTICATED'
  | 'NOT_SUPPORTED' // the active provider has no identity binding
  | 'NO_CHECK' // refresh called with nothing to refresh
  | 'START_FAILED'
  | 'PERSIST_FAILED';

/** What a caller needs to send the member to the provider. */
export interface StartedIdentityCheck {
  /** Provider-hosted URL. Single-use and short-lived — never cached. */
  url: string;
  sessionId: string;
}

/**
 * Start (or resume) the caller's identity check and hand back the hosted URL.
 *
 * PERSISTS PENDING BEFORE RETURNING, so a member who abandons the flow and comes
 * back is shown "in progress" rather than "not started" and can be reconciled by
 * webhook. The session id is stored for exactly that: the pipeline resolves an
 * event carrying no metadata through the indexed `identity_check_session_id`.
 *
 * DOES NOT mark anyone verified. `createIdentityCheck` throws rather than returning
 * a status precisely so a provider failure leaves verification state untouched.
 */
export async function beginIdentityCheck(
  returnPath = '/profile?tab=verification',
): Promise<ActionResult<StartedIdentityCheck, IdentityCheckError>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('NOT_AUTHENTICATED', 'Sign in to verify your identity.');

  const payments = getPaymentService(await viewerRegion());
  if (!payments.createIdentityCheck) {
    return fail('NOT_SUPPORTED', 'The active payment provider does not support identity checks.');
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const path = returnPath.startsWith('/') ? returnPath : `/${returnPath}`;
  const separator = path.includes('?') ? '&' : '?';

  let check;
  try {
    check = await payments.createIdentityCheck({
      profileId: user.id,
      returnUrl: `${origin}${path}${separator}identity=complete`,
    });
  } catch (err) {
    return fail(
      'START_FAILED',
      err instanceof Error ? err.message : 'Could not start the identity check.',
    );
  }

  if (!check.hostedUrl) {
    return fail('START_FAILED', 'The provider did not return a verification link.');
  }

  // Service role: these columns are provider-owned and carry no member update grant.
  // Only move NONE/FAILED to PENDING — never overwrite a VERIFIED member, so a stray
  // second call cannot un-verify someone.
  const admin = createAdminClient();
  const { error } = await admin
    .from('profiles')
    .update({
      identity_check_status: 'PENDING',
      identity_check_session_id: check.sessionId,
    })
    .eq('id', user.id)
    .neq('identity_check_status', 'VERIFIED');

  if (error) return fail('PERSIST_FAILED', friendlyWriteFailure(error, 'Could not save identity check state.'));

  return ok({ url: check.hostedUrl, sessionId: check.sessionId });
}

/** What the browser needs to render the embedded `stripe.verifyIdentity` modal. */
export interface StartedEmbeddedIdentity {
  /** Single-use Identity session client secret. Never cached; re-minted on retry. */
  clientSecret: string;
  /** Browser-safe publishable key for initialising Stripe.js. */
  publishableKey: string;
  /** Provider session id (`vs_...`), persisted so the read-back can reconcile it. */
  sessionId: string;
}

/**
 * Start (or resume) the caller's identity check for the EMBEDDED modal
 * (unified-seller-onboarding, Req 2.1). Mirrors {@link beginIdentityCheck} but hands
 * back a client secret for `stripe.verifyIdentity` instead of a hosted URL, so the
 * check runs inline with no redirect.
 *
 * Persists PENDING before returning, exactly as the hosted path does, so an abandoned
 * flow is reconcilable. Returns `NOT_SUPPORTED` when the active provider has no
 * embedded binding (the Mock) — the surface then falls back to the hosted/mock flow.
 * On any provider failure it returns an error and leaves `identity_check_status`
 * untouched (Req 2.6, 13.1).
 */
export async function beginEmbeddedIdentity(
  returnPath = '/onboarding',
): Promise<ActionResult<StartedEmbeddedIdentity, IdentityCheckError>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('NOT_AUTHENTICATED', 'Sign in to verify your identity.');

  const payments = getPaymentService(await viewerRegion());
  // Both are required for the embedded path; either absent is the fallback signal.
  if (!payments.createIdentityCheck || !payments.createIdentitySessionSecret) {
    return fail('NOT_SUPPORTED', 'The active payment provider does not support embedded identity.');
  }

  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
  const path = returnPath.startsWith('/') ? returnPath : `/${returnPath}`;
  const separator = path.includes('?') ? '&' : '?';

  let check;
  let secret;
  try {
    check = await payments.createIdentityCheck({
      profileId: user.id,
      // Harmless for the embedded modal (which does not redirect); kept so a session
      // is equally resumable through the hosted fallback.
      returnUrl: `${origin}${path}${separator}identity=complete`,
    });
    secret = await payments.createIdentitySessionSecret(check.sessionId);
  } catch (err) {
    return fail(
      'START_FAILED',
      err instanceof Error ? err.message : 'Could not start the identity check.',
    );
  }

  // Persist PENDING + session id (service role: these columns carry no member update
  // grant). Never overwrite a VERIFIED member, so a stray call cannot un-verify.
  const admin = createAdminClient();
  const { error } = await admin
    .from('profiles')
    .update({
      identity_check_status: 'PENDING',
      identity_check_session_id: check.sessionId,
    })
    .eq('id', user.id)
    .neq('identity_check_status', 'VERIFIED');

  if (error) return fail('PERSIST_FAILED', error.message);

  return ok({
    clientSecret: secret.clientSecret,
    publishableKey: secret.publishableKey,
    sessionId: check.sessionId,
  });
}

/** The caller's own identity check state, for a status card. */
export interface IdentityCheckState {
  status: IdentityCheckStatus;
  verifiedName: string | null;
  verifiedAt: string | null;
}

/**
 * Read the caller's own identity check state. No provider call.
 *
 * Separate from {@link refreshIdentityCheck} on purpose: rendering a page must not
 * make a network round trip to Stripe, and a read that also WROTE would fire on
 * every render of the card.
 */
export async function getIdentityCheckState(): Promise<
  ActionResult<IdentityCheckState, IdentityCheckError>
> {
  const user = await getCachedAuthUser();
  if (!user) return fail('NOT_AUTHENTICATED', 'Sign in to see your verification status.');

  const { data } = await createAdminClient()
    .from('profiles')
    .select('identity_check_status, identity_check_name, identity_check_verified_at')
    .eq('id', user.id)
    .maybeSingle();

  return ok({
    status: ((data?.identity_check_status as IdentityCheckStatus | null) ?? 'NONE'),
    verifiedName: (data?.identity_check_name as string | null) ?? null,
    verifiedAt: (data?.identity_check_verified_at as string | null) ?? null,
  });
}

/**
 * Read the check back from the provider and persist the outcome.
 *
 * THE RELIABLE PATH, and the reason this exists alongside the webhook: a delivery
 * can be delayed, retried, or lost, and a member returning from the hosted flow will
 * not wait for a retry before deciding the app is broken. Returning from the flow
 * proves only that they came back — the same trap `refreshPayoutStatus` exists for on
 * the Connect side.
 *
 * Idempotent and monotonic: it writes the provider's current answer, and the name
 * only when the provider supplies one, so a later read cannot blank a name already
 * disclosed to a buyer.
 */
export async function refreshIdentityCheck(): Promise<
  ActionResult<IdentityCheckState, IdentityCheckError>
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return fail('NOT_AUTHENTICATED', 'Sign in to check your verification.');

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from('profiles')
    .select('identity_check_status, identity_check_session_id, identity_check_name, identity_check_verified_at')
    .eq('id', user.id)
    .maybeSingle();

  const sessionId = (profile?.identity_check_session_id as string | null) ?? null;
  if (!sessionId) {
    return fail('NO_CHECK', 'You have not started an identity check yet.');
  }

  const payments = getPaymentService(await viewerRegion());
  if (!payments.readIdentityCheck) {
    return fail('NOT_SUPPORTED', 'The active payment provider does not support identity checks.');
  }

  let check;
  try {
    check = await payments.readIdentityCheck(sessionId);
  } catch (err) {
    return fail(
      'START_FAILED',
      err instanceof Error ? err.message : 'Could not read the identity check.',
    );
  }

  let decision;
  try {
    decision = await applyIdentityDecision({ profileId: user.id, check });
  } catch (err) {
    return fail(
      'PERSIST_FAILED',
      err instanceof Error
        ? friendlyWriteFailure(err, 'Could not update identity status.')
        : 'Could not update identity status.',
    );
  }

  if (decision === 'verified') {
    await pushVerifiedIdentityToConnect(user.id);
  }

  const status: IdentityCheckStatus =
    decision === 'verified' ? 'VERIFIED' : decision === 'failed' ? 'FAILED' : 'PENDING';

  return ok({
    status,
    verifiedName:
      decision === 'verified'
        ? (check.verifiedName ?? ((profile?.identity_check_name as string | null) ?? null))
        : ((profile?.identity_check_name as string | null) ?? null),
    verifiedAt:
      decision === 'verified'
        ? (check.verifiedAt ?? ((profile?.identity_check_verified_at as string | null) ?? null))
        : ((profile?.identity_check_verified_at as string | null) ?? null),
  });
}
