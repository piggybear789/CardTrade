// domain/orchestrator/accountClosureOrchestrator.ts
//
// Account_Closure_Service, use-case half (Req 7.1, 7.2, 7.3, 7.7).
//
// WHAT THIS DOES. `closeAccount` is the ONE closure path in the product. It is
// reached by the web server action (`lib/actions/account.ts`) and by the mobile
// endpoint (`app/api/mobile/account/close`), which is what Req 7.1 asks for: one
// capability on the server, two entry points, no second copy of the rule. Both
// callers inject the same repository, so "may I close this account" is answered
// identically whichever client asked.
//
// PURE, AND WITHOUT A CLOCK. No Supabase import, no `server-only`, no `lib/`
// import, no `Date.now()`. `domain/` may not import from `app/`, `components/` or
// `lib/` and nothing here does — including the result type, see the note below. The
// closure instant arrives as a REQUIRED `at` parameter rather than being read here
// or defaulted, so a test asserts on an instant it chose instead of freezing time,
// and the value written to `profiles.closed_at` is the same one returned to the
// caller. A default would have been a clock read wearing a parameter's clothes.
//
// THE MONEY RULE IS NOT RE-DERIVED HERE. `evaluateClosureEligibility` in
// `domain/account/accountClosure.ts` is the one place the Money_In_Flight rule
// lives; this module loads a snapshot through the repository, hands it over, and
// reports the verdict. On a refusal the blocking CATEGORIES come back to the caller
// (Req 7.3) so the UI can render them as sentences — a bare refusal is
// indistinguishable from a bug.
//
// THE REFUSAL IS A REFUSAL, NOT A QUEUE (decision D3). A member holding
// Money_In_Flight is refused now. Nothing is enqueued, no closure is deferred: a
// deferred closure has to keep the member reachable in order to settle the contract,
// which is exactly what closure takes away.
//
// CLOSURE IS ANONYMISE-AND-DETACH, NOT DELETE (decision D3, Req 7.4, 7.6). That is
// why this interface has no `deleteProfile`, no `deleteContracts`, no
// `deleteReviews`, no `purgeIdentityKeys` and no delete of any kind: `profiles.id`
// is referenced by cash sales, trades, payouts, reviews and arbitration records that
// accounting and dispute resolution read, and the fraud identity blocklist key
// (`identity_person_keys`, 0105) exists so a banned person cannot come back under a
// new email. An operation that could remove either would make closure a way to
// destroy evidence or launder a ban, so the absence of one is load-bearing rather
// than an oversight. Do not add one.

import {
  evaluateClosureEligibility,
  type ClosureBlocker,
  type MoneyInFlightSnapshot,
} from '../account/accountClosure';

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------
//
// The design sketch wrote this as `ActionResult<{ closedAt: string }>`, and the
// SHAPE below is exactly that — `{ ok: true; data }` / `{ ok: false; error;
// message }` — but the types are declared HERE rather than imported from
// `lib/actions/result.ts`, because `domain/` never imports from `lib/` and every
// other orchestrator in this folder (`cashSaleOrchestrator`, `tradeOrchestrator`,
// `merchantOnboarding`, `itemOrchestrator`, `disputeResolution`) declares its own
// discriminated result for the same reason. Being structurally identical to
// `ActionResult<{ closedAt: string }, CloseAccountError>` means the server action and
// the mobile handler can return this value verbatim, with no translation layer to
// drift.

/**
 * Why a closure request was refused, or how far it got before failing.
 *
 * - `NOT_ACCOUNT_OWNER` — the caller is not the member whose account this is
 *   (Req 7.7). Distinct from every other code on purpose: it is an authorisation
 *   refusal, not a state problem, and must never be reported as "something went
 *   wrong".
 * - `MONEY_IN_FLIGHT` — the member is party to unsettled value (Req 7.2, 7.3). The
 *   blocking categories are on the failure as `blockers`.
 * - `ELIGIBILITY_UNREADABLE` — the Money_In_Flight snapshot could not be loaded.
 *   Nothing was changed. Refusing here rather than proceeding is the same
 *   fail-closed choice the eligibility rule itself makes about an unreadable count.
 * - `ANONYMISE_FAILED` — the profile fields could not be replaced. The account is
 *   NOT closed and nothing else was attempted.
 * - `MARK_CLOSED_FAILED` — `profiles.closed_at` could not be set. The profile has
 *   already been anonymised; see the partial-failure note on {@link closeAccount}.
 * - `SIGN_OUT_INCOMPLETE` — the account IS closed, but existing sessions could not
 *   be revoked.
 * - `DETACH_INCOMPLETE` — the account IS closed, but the auth identity could not be
 *   detached, so the old credentials may still sign in.
 */
export type CloseAccountError =
  | 'NOT_ACCOUNT_OWNER'
  | 'MONEY_IN_FLIGHT'
  | 'ELIGIBILITY_UNREADABLE'
  | 'ANONYMISE_FAILED'
  | 'MARK_CLOSED_FAILED'
  | 'SIGN_OUT_INCOMPLETE'
  | 'DETACH_INCOMPLETE';

/** What a successful closure reports back. */
export interface CloseAccountData {
  /** The instant recorded on `profiles.closed_at`, as an ISO-8601 string. */
  closedAt: string;
}

/**
 * Discriminated outcome of {@link closeAccount}.
 *
 * `blockers` is present only on a `MONEY_IN_FLIGHT` refusal and carries the
 * categories, sorted and deduplicated, that the caller renders (Req 7.3).
 */
export type CloseAccountResult =
  | { ok: true; data: CloseAccountData }
  | {
      ok: false;
      error: CloseAccountError;
      message: string;
      blockers?: ClosureBlocker[];
    };

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

/**
 * The persistence surface closure needs, and deliberately nothing more.
 *
 * Every method is a write the closure itself performs, or the one read the money
 * rule needs. There is no delete of any kind, for the reason given in the file
 * header: contract, payout, review and arbitration records (Req 7.4) and the fraud
 * identity blocklist key (Req 7.6) must survive closure, and an interface that
 * cannot express their removal cannot be talked into it by a later caller.
 *
 * Implementations report failure by REJECTING. `closeAccount` catches each step and
 * maps it to a distinct {@link CloseAccountError}, so a partial closure is never
 * reported as a clean success.
 */
export interface AccountClosureRepository {
  /**
   * Count the member's unsettled value, one count per {@link ClosureBlocker}
   * category. Read-only.
   */
  loadMoneyInFlight(profileId: string): Promise<MoneyInFlightSnapshot>;

  /**
   * Replace the member-identifying profile fields — display name, avatar, bio and
   * social links — so the account stops being publicly identifiable (Req 7.5).
   */
  anonymiseProfile(profileId: string): Promise<void>;

  /**
   * Record `profiles.closed_at`. This is the instant that makes the account closed;
   * `at` is the same value the caller receives back.
   */
  markClosed(profileId: string, at: Date): Promise<void>;

  /** Revoke the member's existing sessions so they are signed out (Req 7.2). */
  revokeSessions(profileId: string): Promise<void>;

  /**
   * Detach the auth identity: the email becomes non-routable and the credentials are
   * rotated, so the old sign-in no longer reaches this account.
   */
  detachAuthIdentity(profileId: string): Promise<void>;
}

/** Everything {@link closeAccount} needs about the request. */
export interface CloseAccountParams {
  /** The authenticated member making the request. */
  callerProfileId: string;
  /** The account the request asks to close. */
  targetProfileId: string;
  /**
   * The closure instant. Required rather than defaulted, so this module reads no
   * clock and a test need not freeze one.
   */
  at: Date;
}

/**
 * Is this a usable profile id?
 *
 * An empty or whitespace-only id must never satisfy the own-account guard by
 * matching another empty id — "nobody is asking to close nobody's account" is not
 * an authenticated request for one's own closure.
 */
function isUsableId(id: string): boolean {
  return typeof id === 'string' && id.trim().length > 0;
}

/**
 * Close a member account (Req 7.1, 7.2, 7.3, 7.7).
 *
 * ORDER OF OPERATIONS, AND IT MATTERS:
 *
 *   1. own-account guard  — refuse anything but the member's own account (Req 7.7)
 *   2. eligibility        — refuse while Money_In_Flight, reporting the categories
 *   3. anonymise profile  — display name, avatar, bio, social links (Req 7.5)
 *   4. mark closed        — `profiles.closed_at`
 *   5. revoke sessions    — the member is signed out (Req 7.2)
 *   6. detach auth identity — the old credentials stop signing anyone in
 *
 * PARTIAL FAILURE, AND WHY THIS ORDER SURVIVES IT. There is no transaction spanning
 * a profile write, a session revocation and an auth-provider mutation, so each
 * boundary is examined on its own:
 *
 * - Fails at 2 or 3: the account is untouched or has only lost its display fields.
 *   It is still open and still signs in, and the member can retry. This is why
 *   anonymising comes BEFORE marking closed. The reverse order leaves a window in
 *   which the account is flagged closed while `cardtrade.profiles` still holds the
 *   real name — and while `public_profiles` would substitute the anonymous label,
 *   anything reading the base table directly (staff tooling, arbitration, an email
 *   send) would not. Failing with identifying data already gone is the safer half.
 * - Fails at 5 or 6, after 4 succeeded: the account IS closed. Migration 0111 makes
 *   `cardtrade.public_profiles` apply the `'Closed account'` label and drop the
 *   avatar, bio and social links from `closed_at` alone, precisely so a
 *   half-completed closure cannot leak a name through the read path — every public
 *   surface goes through that projection, so the anonymity of a closed account does
 *   not depend on step 3 having landed. What is NOT yet true is that the member has
 *   been signed out (5) or that their credentials have stopped working (6). Those
 *   return `SIGN_OUT_INCOMPLETE` / `DETACH_INCOMPLETE` rather than success, because
 *   Req 7.8 forbids presenting an outcome the service did not perform, and "you
 *   have been signed out and can no longer sign in" would be a false statement. The
 *   remedy is a retry, which is safe: steps 3–6 are all idempotent.
 *
 * @param repo  The persistence surface.
 * @param params The caller, the target, and the closure instant.
 * @returns Success carrying the recorded instant, or a typed refusal.
 */
export async function closeAccount(
  repo: AccountClosureRepository,
  params: CloseAccountParams,
): Promise<CloseAccountResult> {
  const { callerProfileId, targetProfileId, at } = params;

  // 1. Own-account guard (Req 7.7). The orchestrator does NOT read a session — the
  // caller identity is injected, so the same guard holds for the web action and the
  // mobile endpoint. A distinct code, never a generic failure: a member must not be
  // told "something went wrong" when the answer is "that is not your account", and
  // staff must be able to tell the two apart in a log.
  if (!isUsableId(callerProfileId) || !isUsableId(targetProfileId)) {
    return {
      ok: false,
      error: 'NOT_ACCOUNT_OWNER',
      message: 'Sign in to close your account.',
    };
  }

  if (callerProfileId !== targetProfileId) {
    return {
      ok: false,
      error: 'NOT_ACCOUNT_OWNER',
      message: 'You can only close your own account.',
    };
  }

  const profileId = targetProfileId;

  // 2. Eligibility. The rule lives in `domain/account/accountClosure.ts` and is not
  // re-derived here.
  let snapshot: MoneyInFlightSnapshot;
  try {
    snapshot = await repo.loadMoneyInFlight(profileId);
  } catch {
    return {
      ok: false,
      error: 'ELIGIBILITY_UNREADABLE',
      message: 'We could not check your open contracts just now. Please try again.',
    };
  }

  const decision = evaluateClosureEligibility(snapshot);
  if (!decision.closable) {
    // Req 7.3: the categories come back so the caller can render them as sentences.
    // Decision D3: this is a refusal, not a deferral — nothing is enqueued.
    return {
      ok: false,
      error: 'MONEY_IN_FLIGHT',
      message: 'Your account still has activity in progress, so it cannot be closed yet.',
      blockers: decision.blockers,
    };
  }

  // 3. Anonymise before marking closed — see the partial-failure note above.
  try {
    await repo.anonymiseProfile(profileId);
  } catch {
    return {
      ok: false,
      error: 'ANONYMISE_FAILED',
      message: 'We could not close your account just now. Nothing has changed. Please try again.',
    };
  }

  // 4. The closure itself.
  try {
    await repo.markClosed(profileId, at);
  } catch {
    return {
      ok: false,
      error: 'MARK_CLOSED_FAILED',
      message: 'We could not close your account just now. Please try again.',
    };
  }

  const closedAt = at.toISOString();

  // 5. Sign the member out (Req 7.2).
  try {
    await repo.revokeSessions(profileId);
  } catch {
    return {
      ok: false,
      error: 'SIGN_OUT_INCOMPLETE',
      message:
        'Your account is closed and your profile is no longer publicly identifiable, but we ' +
        'could not sign you out everywhere. Please try again.',
    };
  }

  // 6. Detach the auth identity last: it is the step that makes the account
  // unreachable, so running it earlier would remove the ability to retry the rest.
  try {
    await repo.detachAuthIdentity(profileId);
  } catch {
    return {
      ok: false,
      error: 'DETACH_INCOMPLETE',
      message:
        'Your account is closed and your profile is no longer publicly identifiable, but your ' +
        'sign-in details may still work. Please try again.',
    };
  }

  return { ok: true, data: { closedAt } };
}
