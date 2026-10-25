'use server';

// lib/actions/identity.ts
//
// The Identity_Gate (0069): starting, resuming and reading back a member's Stripe
// Identity check.
//
// DISCLOSURE IS STAGED. Public surfaces read `public_profiles`, which exposes a given
// name and a badge only. A seller's FULL legal name reaches only their buyer, at a
// commitment point (`sellerIdentityDisclosure`) — never a listing or profile page.

import { withActionLog } from '@/lib/errors/withActionLog';
import { cookies } from 'next/headers';

import { createClient } from '@/lib/supabase/server';
import { getCachedAuthUser } from '@/lib/supabase/cachedAuth';
import { createAdminClient } from '@/lib/supabase/admin';
import { getPaymentService } from '@/domain/services';
import { DEFAULT_CONFIG_REGION } from '@/domain/services/stripe/config';
import { regionForProfile } from '@/lib/regionBinding';
import type { IdentityCheckStatus } from '@/domain/identity/identityGate';
import { friendlyWriteFailure } from '@/lib/actions/writeFailure';
import { pushVerifiedIdentityToConnect } from '@/lib/identity/pushVerifiedIdentity';
import { applyIdentityDecision } from '@/lib/identity/applyIdentityDecision';
import {
  DEFAULT_IDENTITY_RETURN_PATH,
  IDENTITY_RETURN_COOKIE,
  identityReturnCookieOptions,
  identityReturnUrl,
  safeIdentityReturnPath,
} from '@/lib/identity/identityReturn';
import type { IdentityCheckProgress } from '@/domain/services/types';
import { type ActionResult, fail, ok } from './result';

/**
 * Remember which screen the member is leaving for Stripe from, so the fixed return
 * route can send them back to it. Rewritten on every press: the session's own
 * `return_url` cannot move, so this cookie is what makes resuming from a different
 * screen land on THAT screen. See `lib/identity/identityReturn.ts`.
 */
async function rememberIdentityReturnPath(returnPath: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(
    IDENTITY_RETURN_COOKIE,
    safeIdentityReturnPath(returnPath),
    identityReturnCookieOptions(),
  );
}

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
  /**
   * Provider-hosted URL. Single-use and short-lived — never cached.
   *
   * NULL WHEN THERE IS NOWHERE TO SEND THEM, which is a success rather than a fault:
   * the provider is mid-decision, or the check has already passed. Read
   * {@link StartedIdentityCheck.progress} before treating an absent URL as an error —
   * the alternative is telling a member their verification is broken while it is in
   * fact being reviewed.
   */
  url: string | null;
  sessionId: string;
  /** How far through the check the member is. See `IdentityCheckProgress`. */
  progress: IdentityCheckProgress;
}

/**
 * Start, RESUME, or replace the caller's identity check and hand back a hosted URL.
 *
 * PASSES THE PERSISTED SESSION ID TO THE PROVIDER, WHICH IS THE WHOLE FIX FOR A RETRY
 * THAT WENT NOWHERE. This used to call `createIdentityCheck` without reading our own
 * row first, so the provider replayed its idempotent create and returned the hosted
 * link minted for the FIRST attempt. That link is single-use: pressing "Try again"
 * after a declined document opened a consumed page which immediately redirected back
 * to `returnPath`, so the button looked broken. The binding now resumes the session
 * and mints a fresh link — and reuse is also what the provider recommends, because the
 * session is what records the failed attempts.
 *
 * PERSISTS PENDING BEFORE RETURNING, so a member who abandons the flow and comes
 * back is shown "in progress" rather than "not started" and can be reconciled by
 * webhook. The session id is stored for exactly that: the pipeline resolves an
 * event carrying no metadata through the indexed `identity_check_session_id`.
 *
 * DOES NOT mark anyone verified — with one narrow exception it would be wrong to
 * omit: if the resumed session has ALREADY passed, the decision is applied through the
 * same single writer the webhook uses. Writing PENDING over it instead would un-verify
 * a member for pressing a button. `createIdentityCheck` throws rather than returning a
 * status precisely so a provider failure leaves verification state untouched.
 *
 * `returnPath` IS NOT THE SESSION'S RETURN URL. Every session returns to the fixed
 * `/identity/return` route; the path is remembered in a cookie and the route forwards
 * there. A session's `return_url` cannot be changed once created and this action
 * resumes sessions, so a per-screen URL baked into the session sent members back to
 * whichever screen they FIRST pressed the button on — the payouts tab, for a session
 * opened under an earlier default. See `lib/identity/identityReturn.ts`.
 */
export const beginIdentityCheck = withActionLog('identity.beginIdentityCheck', async function beginIdentityCheck(
  returnPath: string = DEFAULT_IDENTITY_RETURN_PATH,
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

  // Service role: these columns are provider-owned and carry no member update grant.
  const admin = createAdminClient();

  // READ BEFORE STARTING. The persisted session is what the provider needs in order to
  // resume rather than replay, and replaying is what handed a member a dead link.
  const { data: existing } = await admin
    .from('profiles')
    .select('identity_check_session_id')
    .eq('id', user.id)
    .maybeSingle();

  let check;
  try {
    check = await payments.createIdentityCheck({
      profileId: user.id,
      returnUrl: identityReturnUrl(),
      existingSessionId: (existing?.identity_check_session_id as string | null) ?? null,
    });
  } catch (err) {
    return fail(
      'START_FAILED',
      err instanceof Error ? err.message : 'Could not start the identity check.',
    );
  }

  // Written BEFORE the early returns below, and regardless of whether a link comes
  // back: the member is about to leave for the provider in every case that has one,
  // and a session already under review returns them here through the same route.
  await rememberIdentityReturnPath(returnPath);

  const progress = check.progress ?? 'NOT_SUBMITTED';

  // ALREADY PASSED. Apply it through the shared writer rather than persisting PENDING,
  // which would un-verify a member for pressing a button. The fingerprint and ban
  // checks live in there, so this cannot open the gate by a shortcut.
  if (check.outcome === 'VERIFIED') {
    try {
      const decision = await applyIdentityDecision({ profileId: user.id, check });
      if (decision === 'verified') await pushVerifiedIdentityToConnect(user.id);
    } catch (err) {
      return fail(
        'PERSIST_FAILED',
        err instanceof Error
          ? friendlyWriteFailure(err, 'Could not update identity status.')
          : 'Could not update identity status.',
      );
    }
    return ok({ url: null, sessionId: check.sessionId, progress: 'DECIDED' });
  }

  // NO LINK AND NOT DECIDED means the provider is still reviewing a submission. That is
  // a legitimate state with nothing for the member to do, so report it as one: the old
  // blanket START_FAILED here told them verification was broken mid-review.
  if (!check.hostedUrl && progress !== 'PROCESSING') {
    return fail('START_FAILED', 'The provider did not return a verification link.');
  }

  // Only move NONE/FAILED to PENDING — never overwrite a VERIFIED member, so a stray
  // second call cannot un-verify someone.
  const { error } = await admin
    .from('profiles')
    .update({
      identity_check_status: 'PENDING',
      identity_check_session_id: check.sessionId,
    })
    .eq('id', user.id)
    .neq('identity_check_status', 'VERIFIED');

  if (error) return fail('PERSIST_FAILED', friendlyWriteFailure(error, 'Could not save identity check state.'));

  return ok({ url: check.hostedUrl ?? null, sessionId: check.sessionId, progress });
});

/** The caller's own identity check state, for a status card. */
export interface IdentityCheckState {
  status: IdentityCheckStatus;
  /**
   * WHETHER THE WAIT IS OURS OR THEIRS, which `status` cannot express: PENDING covers
   * both "started it and walked away" and "submitted, provider deciding", and those
   * want opposite screens — one needs a button, the other needs the button to stop
   * being offered.
   *
   * ONLY MEANINGFUL FROM {@link refreshIdentityCheck}. It is not a column, so
   * {@link getIdentityCheckState} reports NOT_SUBMITTED for any PENDING row rather
   * than guessing at a review it cannot see.
   */
  progress: IdentityCheckProgress;
  verifiedName: string | null;
  verifiedAt: string | null;
  /**
   * The provider's own words for why it declined, when it did.
   *
   * NOT PERSISTED, because there is no column for it and inventing one would put a
   * provider sentence in our schema. It is therefore present only on the read-back
   * that observed the decline; a later {@link getIdentityCheckState} reports FAILED
   * with no reason and the surface falls back to generic retry copy.
   *
   * It exists at all because the alternative is what shipped: Stripe answered "the
   * document is invalid", the answer went into `webhook_logs`, and the member was
   * shown an unchanged button.
   */
  failureReason: string | null;
}

/**
 * Read the caller's own identity check state. No provider call.
 *
 * Separate from {@link refreshIdentityCheck} on purpose: rendering a page must not
 * make a network round trip to Stripe, and a read that also WROTE would fire on
 * every render of the card.
 */
export const getIdentityCheckState = withActionLog('identity.getIdentityCheckState', async function getIdentityCheckState(): Promise<
  ActionResult<IdentityCheckState, IdentityCheckError>
> {
  const user = await getCachedAuthUser();
  if (!user) return fail('NOT_AUTHENTICATED', 'Sign in to see your verification status.');

  const { data } = await createAdminClient()
    .from('profiles')
    .select('identity_check_status, identity_check_name, identity_check_verified_at')
    .eq('id', user.id)
    .maybeSingle();

  const status = (data?.identity_check_status as IdentityCheckStatus | null) ?? 'NONE';

  return ok({
    status,
    // Derived, not read: there is no progress column. A decided row is DECIDED; a
    // PENDING one is reported as waiting on the MEMBER, because claiming a review that
    // may not be happening would show a spinner nothing can ever clear. The read-back
    // is what resolves it.
    progress: (status === 'VERIFIED' || status === 'FAILED' ? 'DECIDED' : 'NOT_SUBMITTED'),
    verifiedName: (data?.identity_check_name as string | null) ?? null,
    verifiedAt: (data?.identity_check_verified_at as string | null) ?? null,
    // No column to read it from. Only the read-back carries a reason.
    failureReason: null,
  });
});

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
export const refreshIdentityCheck = withActionLog('identity.refreshIdentityCheck', async function refreshIdentityCheck(): Promise<
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
    // Straight from the provider — this is the one path that actually knows. A
    // 'blocked' decision reports DECIDED rather than a review still running: nothing
    // more is coming for that session.
    progress:
      decision === 'blocked' || decision === 'duplicate' ? 'DECIDED' : (check.progress ?? 'NOT_SUBMITTED'),
    verifiedName:
      decision === 'verified'
        ? (check.verifiedName ?? ((profile?.identity_check_name as string | null) ?? null))
        : ((profile?.identity_check_name as string | null) ?? null),
    verifiedAt:
      decision === 'verified'
        ? (check.verifiedAt ?? ((profile?.identity_check_verified_at as string | null) ?? null))
        : ((profile?.identity_check_verified_at as string | null) ?? null),
    // ESC-24: never says another account exists, only that support has to look.
    failureReason:
      decision === 'failed'
        ? (check.failureReason ?? null)
        : decision === 'duplicate'
          ? 'We need to check something before you can sell. Contact support.'
          : null,
  });
});
