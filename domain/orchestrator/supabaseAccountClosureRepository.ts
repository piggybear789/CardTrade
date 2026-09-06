// domain/orchestrator/supabaseAccountClosureRepository.ts
//
// Production wiring of the Account_Closure_Service data-access seam (Req 7.4, 7.5,
// 7.6). Kept OUT of `accountClosureOrchestrator.ts` for the same reason
// `supabaseMerchantRepository.ts` is kept out of `merchantOnboarding.ts`: that module
// must stay importable by the domain tests with in-memory fakes, without pulling in
// `server-only` or Supabase. Only this file carries the server-only dependency.
//
// WHY THIS USES THE SERVICE-ROLE CLIENT, AND WHAT THAT COSTS. Migration 0111 gives
// members no UPDATE grant on `profiles.closed_at` — deliberately, because a
// member-writable closure flag is a way to fake a closed account — and
// `revokeSessions` / `detachAuthIdentity` reach the GoTrue admin API, which is
// service-role only regardless. So every write here goes through
// `createAdminClient()`, which BYPASSES RLS. This is exactly the "guarded
// orchestrator write" the steering docs permit, but the consequence has to be said
// out loud: RLS is not helping here. The own-account guard in `closeAccount`
// (step 1, Req 7.7) is the ONLY thing standing between a caller and somebody else's
// account. Do not add a code path that reaches these methods without going through
// `closeAccount`, and do not weaken that guard.
//
// NO DELETES, ANYWHERE IN THIS FILE. Closure is anonymise-and-detach (decision D3).
// `profiles.id` is referenced by cash sales, trades, payouts, reviews and arbitration
// records that accounting and dispute resolution read (Req 7.4), and the fraud
// identity blocklist key in `identity_person_keys` (0105) exists so a banned person
// cannot return under a new email (Req 7.6). Neither is touched. The one object this
// file does remove is the avatar FILE in Storage, and only because it is not a record
// — see `anonymiseProfile`.

import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { removeAvatarObject } from '@/lib/storage/profileImages';
import type { TablesUpdate } from '@/lib/supabase/database.types';
import type { MoneyInFlightSnapshot } from '../account/accountClosure';
import { TERMINAL_STATES, type TradeState } from '../state-machine/types';
import type { CashSaleStatus } from './cashSaleOrchestrator';
import {
  closeAccount,
  type AccountClosureRepository,
  type CloseAccountParams,
  type CloseAccountResult,
} from './accountClosureOrchestrator';

/** The Supabase admin client type (service-role, RLS-bypassing). */
type AdminClient = ReturnType<typeof createAdminClient>;

// ---------------------------------------------------------------------------
// What Money_In_Flight is, in SQL
// ---------------------------------------------------------------------------
//
// This is the one place the glossary definition becomes a query, so it is spelled
// out against the actual enums rather than against a list composed here.

/**
 * Which Cash_Sale_Status values are terminal.
 *
 * Written as a total map over {@link CashSaleStatus} rather than a bare array, so
 * adding a status to the enum is a COMPILE ERROR here until someone decides whether
 * it settles the contract. A `readonly string[]` would have silently treated the new
 * status as terminal or non-terminal depending on which side the author forgot,
 * and the failure mode is closing an account with a live contract on it.
 *
 * `RETURN_PENDING` and `RETURN_IN_TRANSIT` are NOT terminal: a full refund has been
 * awarded and the goods are still moving, so the platform is still holding the
 * Buyer's money.
 */
const CASH_SALE_STATUS_IS_TERMINAL: Readonly<Record<CashSaleStatus, boolean>> = {
  AGREEMENT: false,
  PAYMENT_PENDING: false,
  ESCROW_HELD: false,
  IN_TRANSIT: false,
  HANDOVER: false,
  INSPECTION: false,
  DISPUTED: false,
  RETURN_PENDING: false,
  RETURN_IN_TRANSIT: false,
  COMPLETED: true,
  CANCELLED: true,
  FAILED: true,
  REFUNDED: true,
};

/** Cash_Sale statuses that count as in flight: every non-terminal one. */
const NON_TERMINAL_CASH_SALE_STATUSES: readonly CashSaleStatus[] = (
  Object.keys(CASH_SALE_STATUS_IS_TERMINAL) as CashSaleStatus[]
).filter((status) => !CASH_SALE_STATUS_IS_TERMINAL[status]);

/**
 * The Trade_State an open dispute sits in.
 *
 * Taken from the state machine's own vocabulary, not restated as a string at the
 * query: `DISPUTED` is the one non-terminal state a live dispute occupies, and
 * `FRAUD_RESOLVED` and `CANCELLED` — where a resolved or abandoned one lands — are
 * excluded by `TERMINAL_STATES` in `domain/state-machine/types.ts` rather than by a
 * list restated here.
 */
const OPEN_TRADE_DISPUTE_STATE: TradeState = 'DISPUTED';

/**
 * True while the state counted as an open Trade dispute is still non-terminal.
 *
 * A function rather than a top-level assertion, deliberately: this module is
 * `server-only`, and a binding that throws at import time takes every unrelated route
 * down with it. Anything that wants the guarantee can call this; nothing pays for it
 * just by importing the repository.
 */
export function openTradeDisputeIsStillOpen(): boolean {
  return !TERMINAL_STATES.has(OPEN_TRADE_DISPUTE_STATE);
}

/**
 * Cash_Sale statuses in which an arbitration case can be open on the RETURN leg.
 *
 * Mirrors `lib/actions/arbitration.ts`, which builds the staff queue from exactly
 * this pair plus a contested-or-lapsed marker.
 */
const RETURN_LEG_STATUSES: readonly CashSaleStatus[] = ['RETURN_PENDING', 'RETURN_IN_TRANSIT'];

/**
 * Payout states that mean money is owed and has not landed.
 *
 * `NOT_DUE` is not owed and `SETTLED` has landed; the other two are the "queued or
 * failed payout" of the Money_In_Flight glossary. `FAILED` in particular MUST block:
 * it means the platform is holding money that belongs to the member and an operator
 * has not yet fixed it, which is the worst moment to let the account go.
 */
const UNSETTLED_PAYOUT_STATUSES = ['PENDING', 'FAILED'] as const;

/** The hold status that means collateral is authorised and uncaptured. */
const UNCAPTURED_HOLD_STATUS = 'ACTIVE' as const;

/** The label a closed profile's display name is replaced with (Req 7.5). */
export const CLOSED_ACCOUNT_DISPLAY_NAME = 'Closed account';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shape every `count`-mode PostgREST read comes back as. */
interface CountResult {
  count: number | null;
  error: { message: string } | null;
}

/**
 * Read one count, or REJECT.
 *
 * Fail-closed on purpose. `closeAccount` maps a rejection from
 * `loadMoneyInFlight` to `ELIGIBILITY_UNREADABLE` and refuses, changing nothing —
 * which is the right answer to "we could not tell whether this member has an open
 * contract". Returning 0 on an unreadable count would close the account instead, at
 * exactly the moment the platform is holding somebody's funds. A null count from a
 * successful response is treated the same way: it means the row estimate is missing,
 * not that there are no rows.
 */
async function readCount(result: PromiseLike<CountResult>, label: string): Promise<number> {
  const { count, error } = await result;
  if (error) {
    throw new Error(`Could not count ${label}: ${error.message}`);
  }
  if (typeof count !== 'number' || !Number.isFinite(count)) {
    throw new Error(`Could not count ${label}: the provider returned no count.`);
  }
  return count;
}

/**
 * Is this a profile id we are willing to interpolate into a PostgREST filter?
 *
 * The either-party reads below use `.or('buyer_id.eq.X,seller_id.eq.X')`, which is a
 * STRING filter language — an id carrying a comma or a parenthesis would change the
 * predicate rather than fail to match it, and a predicate that matches more rows than
 * intended is the wrong direction for a money check. Ids come from an authenticated
 * session and are always UUIDs, so anything else is refused rather than escaped.
 */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Either-party filter for a Cash_Sale. */
function eitherCashSaleParty(profileId: string): string {
  return `buyer_id.eq.${profileId},seller_id.eq.${profileId}`;
}

/** Either-party filter for a Trade. */
function eitherTradeParty(profileId: string): string {
  return `initiator_id.eq.${profileId},counterpart_id.eq.${profileId}`;
}

/**
 * A deterministic, permanently unroutable address for a closed account.
 *
 * `.invalid` is reserved by RFC 2606 and can never resolve, so the rotated address
 * cannot reach a real mailbox — including one the member later gives up and someone
 * else takes over. Derived from the profile id rather than randomised so a retry
 * writes the SAME value: `closeAccount` documents steps 3–6 as idempotent and its
 * remedy for a partial failure is a retry, which a random address would turn into a
 * new mutation every time.
 *
 * The id, not the old address, is what appears in it — a hash of the old email would
 * be a way to test a guess at who held the account.
 */
export function closedAccountEmail(profileId: string): string {
  return `closed+${profileId}@accounts.invalid`;
}

/**
 * A rotated credential.
 *
 * Random, and never returned to anyone. The point is only that the value the member
 * knows stops working; nothing needs to be able to use the new one.
 */
function rotatedSecret(): string {
  // `crypto` is global in Node 18+ and in the Edge runtime.
  return `closed-${crypto.randomUUID()}-${crypto.randomUUID()}`;
}

// ---------------------------------------------------------------------------
// The repository
// ---------------------------------------------------------------------------

/**
 * Build an {@link AccountClosureRepository} backed by the Supabase admin client.
 *
 * Column mapping:
 * - `profiles`: `display_name`, `avatar_path`, `bio`, `social_links`, `closed_at` (0111)
 * - `cash_sales`: `buyer_id`, `seller_id`, `status`, `seller_payout_status`,
 *   `refund_status`, `disputed_at`, `dispute_resolved_at`, `return_disputed_at`,
 *   `return_lapsed_at`
 * - `trades`: `initiator_id`, `counterpart_id`, `state`
 * - `pre_auth_holds`: `trader_id`, `status`
 * - auth: GoTrue admin (`auth.admin`), for the session and credential steps
 */
export function createSupabaseAccountClosureRepository(
  client: AdminClient = createAdminClient(),
): AccountClosureRepository {
  return {
    /**
     * Count the member's unsettled value, one count per `ClosureBlocker` category
     * (Req 7.2, 7.3).
     *
     * THE MEMBER COUNTS AS EITHER PARTY, everywhere. A Buyer with an open purchase is
     * as blocked as a Seller with an open sale — they are owed goods or a refund, and
     * closing the account would leave the counterparty facing nobody. Same for a
     * Trade: `initiator_id` and `counterpart_id` are symmetric.
     *
     * THE CATEGORIES OVERLAP, DELIBERATELY. A `DISPUTED` Cash_Sale is both a
     * non-terminal contract and an open arbitration case, so it is counted twice —
     * once in each category. That is what Req 7.3 asks for: the member is told every
     * reason they are blocked, not the first one found, and a category is a reason
     * rather than a bucket in a partition.
     */
    async loadMoneyInFlight(profileId: string): Promise<MoneyInFlightSnapshot> {
      if (!isUuid(profileId)) {
        // Rejecting reaches the member as ELIGIBILITY_UNREADABLE and changes
        // nothing, which is the correct outcome for an id we cannot query with.
        throw new Error('Cannot check open contracts for a malformed profile id.');
      }

      const countOptions = { count: 'exact' as const, head: true };

      const [
        activeCashSaleCount,
        activeTradeCollateralCount,
        unsettledSellerPayouts,
        unsettledBuyerRefunds,
        disputedCashSales,
        disputedReturnLegs,
        disputedTrades,
      ] = await Promise.all([
        // A Cash_Sale in any non-terminal status, on either side.
        readCount(
          client
            .from('cash_sales')
            .select('id', countOptions)
            .in('status', NON_TERMINAL_CASH_SALE_STATUSES)
            .or(eitherCashSaleParty(profileId)),
          'open cash sales',
        ),

        // An uncaptured Trade_Collateral authorisation. Read from the hold rather
        // than from the Trade's state: the hold is the thing that is actually live on
        // the member's card, and a Trade can sit in a non-terminal state with its
        // collateral already voided.
        readCount(
          client
            .from('pre_auth_holds')
            .select('id', countOptions)
            .eq('trader_id', profileId)
            .eq('status', UNCAPTURED_HOLD_STATUS),
          'open trade collateral',
        ),

        // A queued or failed payout owed TO the member as Seller.
        readCount(
          client
            .from('cash_sales')
            .select('id', countOptions)
            .eq('seller_id', profileId)
            .in('seller_payout_status', UNSETTLED_PAYOUT_STATUSES),
          'unsettled seller payouts',
        ),

        // And the same on the other side of the ledger: a refund owed TO the member
        // as Buyer. The glossary says "a queued or failed payout" and a refund is a
        // payout in the only sense that matters here — the platform is holding money
        // that is theirs and has not handed it over. Leaving it out would let a Buyer
        // close their account while a refund was still failing, and a refund has to
        // land on the card of an account that still exists.
        readCount(
          client
            .from('cash_sales')
            .select('id', countOptions)
            .eq('buyer_id', profileId)
            .in('refund_status', UNSETTLED_PAYOUT_STATUSES),
          'unsettled buyer refunds',
        ),

        // An open dispute on a Cash_Sale: raised and not yet resolved.
        readCount(
          client
            .from('cash_sales')
            .select('id', countOptions)
            .not('disputed_at', 'is', null)
            .is('dispute_resolved_at', null)
            .or(eitherCashSaleParty(profileId)),
          'open cash sale disputes',
        ),

        // An open arbitration case on the RETURN leg: the Seller contested the
        // return, or the Buyer never posted it. Same pair of statuses and same two
        // markers the staff queue in `lib/actions/arbitration.ts` builds from, so a
        // case an operator can see is a case that blocks closure.
        readCount(
          client
            .from('cash_sales')
            .select('id', countOptions)
            .in('status', RETURN_LEG_STATUSES)
            // Two `.or()` groups are ANDed by PostgREST, so this reads as
            // "(contested OR lapsed) AND (buyer OR seller)".
            .or('return_disputed_at.not.is.null,return_lapsed_at.not.is.null')
            .or(eitherCashSaleParty(profileId)),
          'open return cases',
        ),

        // An open dispute on a Trade. `DISPUTED` is non-terminal; `FRAUD_RESOLVED` is
        // the terminal state a resolved fraud finding lands in, so it is excluded by
        // the state machine's own terminal set rather than by a list here.
        readCount(
          client
            .from('trades')
            .select('id', countOptions)
            .eq('state', OPEN_TRADE_DISPUTE_STATE)
            .or(eitherTradeParty(profileId)),
          'open trade disputes',
        ),
      ]);

      return {
        activeCashSaleCount,
        activeTradeCollateralCount,
        pendingPayoutCount: unsettledSellerPayouts + unsettledBuyerRefunds,
        openDisputeCount: disputedCashSales + disputedReturnLegs + disputedTrades,
      };
    },

    /**
     * Replace the member-identifying profile fields (Req 7.5).
     *
     * EXACTLY FOUR FIELDS, and the list is the requirement's list: display name,
     * avatar, bio, social links. What is deliberately NOT touched:
     *
     * - `identity_check_name` and `merchant_legal_entity_name` — the
     *   provider-verified legal name IS the seller identity disclosure that
     *   arbitration reads on a completed contract (Req 7.4). Blanking it would strip
     *   the counterparty record off every sale the member ever fronted.
     * - `identity_check_status`, `merchant_status`, `merchant_ref` and the rest of the
     *   Connect columns — they describe a provider account that still exists and that
     *   accounting still reconciles against.
     * - `identity_person_keys` — the fraud identity blocklist (0105). Req 7.6 exists
     *   precisely so closure cannot launder a ban, so the key survives closure.
     * - `contact_email` — not on the Req 7.5 list, on no public read path, and part
     *   of the provider account record Req 7.4 retains. The address that stops
     *   working is the AUTH one; see `detachAuthIdentity`.
     *
     * THE AVATAR FILE IS DELETED, not just dereferenced, and that is a choice.
     * Nulling `avatar_path` already removes the picture from every read path — 0111's
     * projection nulls it too, from `closed_at` alone — so the row is safe either way.
     * But `profile-images` is a PUBLIC-read bucket, so any URL that was ever shared
     * or cached keeps serving the member's face after they have left. Deleting is
     * irreversible; that is acceptable because closure is irreversible by design and
     * a picture is not one of the records Req 7.4 protects. The delete runs through
     * `removeAvatarObject`, which is best-effort and never throws, so a Storage
     * hiccup leaves an orphaned file rather than failing a closure whose row write
     * has already made the picture unreachable.
     */
    async anonymiseProfile(profileId: string): Promise<void> {
      const { data: existing, error: readError } = await client
        .from('profiles')
        .select('avatar_path')
        .eq('id', profileId)
        .maybeSingle();
      if (readError) {
        throw new Error(`Could not read the profile to anonymise it: ${readError.message}`);
      }
      const avatarPath = (existing as { avatar_path: string | null } | null)?.avatar_path ?? null;

      const patch: TablesUpdate<'profiles'> = {
        // The same literal 0111's projection substitutes, so the base table and the
        // view agree and nothing has to decide which one is "really" the name.
        display_name: CLOSED_ACCOUNT_DISPLAY_NAME,
        avatar_path: null,
        bio: null,
        social_links: null,
      };

      const { error } = await client.from('profiles').update(patch).eq('id', profileId);
      if (error) {
        // Loudly: `closeAccount` reports this as ANONYMISE_FAILED and stops before
        // marking the account closed, so the member keeps an open, working account
        // and can retry. Swallowing it would flag an account closed while the base
        // table still held the real name for staff tooling and email to read.
        throw new Error(`Could not anonymise profile ${profileId}: ${error.message}`);
      }

      // Only after the row no longer references it.
      await removeAvatarObject(client, avatarPath);
    },

    /**
     * Record `profiles.closed_at` — the write that makes the account closed.
     *
     * Idempotent: writing the same instant twice is the same row. `at` is the instant
     * the caller receives back, so the value stored and the value reported cannot
     * disagree.
     */
    async markClosed(profileId: string, at: Date): Promise<void> {
      const { error } = await client
        .from('profiles')
        .update({ closed_at: at.toISOString() })
        .eq('id', profileId);
      if (error) {
        throw new Error(`Could not mark profile ${profileId} closed: ${error.message}`);
      }
    },

    /**
     * End the member's existing sessions (Req 7.2).
     *
     * WHY A BAN AND NOT A SIGN-OUT CALL. `auth.admin.signOut` takes the SESSION JWT,
     * which this repository does not have and must not require — the closure seam is
     * addressed by profile id so that the web action and the mobile endpoint reach
     * the identical code. GoTrue exposes no per-user "sign out everywhere" through
     * supabase-js, so the mechanism that actually ends live sessions is
     * `banned_until`: while it is in the future the refresh path is refused, so every
     * outstanding access token dies at its next refresh and no new one is issued.
     *
     * The ban is set far in the future rather than "forever" because the field is a
     * duration; there is no unban step anywhere in the product, and the account is
     * closed regardless of it.
     *
     * Idempotent: re-banning an already-banned user is the same state.
     */
    async revokeSessions(profileId: string): Promise<void> {
      const { error } = await client.auth.admin.updateUserById(profileId, {
        // ~100 years. Long enough that expiry is not a real event.
        ban_duration: '876000h',
      });
      if (error) {
        throw new Error(`Could not revoke sessions for ${profileId}: ${error.message}`);
      }
    },

    /**
     * Detach the auth identity: the email becomes non-routable and the credentials
     * are rotated.
     *
     * NOT A DELETE. `auth.admin.deleteUser` is deliberately not called: `profiles.id`
     * references the auth user, and Req 7.4 protects the records that reference the
     * profile. Deleting the user either cascades those away or fails on a constraint
     * — the same reasoning that makes closure anonymise-and-detach in the first place
     * (decision D3).
     *
     * WHAT CHANGES:
     * - the email becomes {@link closedAccountEmail}, a deterministic `.invalid`
     *   address, so nothing addressable to a real mailbox is left and a retry writes
     *   the same value;
     * - `email_confirm` is set so the admin write lands directly and no confirmation
     *   mail is sent to an address that cannot receive it;
     * - the password is rotated to a random value nobody holds, so the credential the
     *   member knows stops working even if the ban were ever lifted;
     * - the OAuth display fields on `user_metadata` (`full_name`, `name`,
     *   `avatar_url`, `picture`) are cleared. They are not a public read path, but
     *   `app/auth/callback` and `lib/actions/profile.ts` both read them to provision a
     *   profile display name, so leaving them would keep a route by which the real
     *   name could be written back onto an anonymised row.
     *
     * Idempotent in the sense the retry path needs: running it twice sets the same
     * address and the same metadata, and rotates the password again, which is harmless
     * because no caller ever learns either value.
     */
    async detachAuthIdentity(profileId: string): Promise<void> {
      const { error } = await client.auth.admin.updateUserById(profileId, {
        email: closedAccountEmail(profileId),
        email_confirm: true,
        password: rotatedSecret(),
        user_metadata: {
          full_name: null,
          name: null,
          avatar_url: null,
          picture: null,
        },
      });
      if (error) {
        throw new Error(`Could not detach the auth identity for ${profileId}: ${error.message}`);
      }
    },
  };
}

/**
 * The closure capability, bound to a repository.
 *
 * One method, because there is one use case. Both entry points — the web server
 * action and `app/api/mobile/account/close` — hold this and nothing else, which is
 * what makes Req 7.1's "exists once on the server" true in code rather than in
 * intent.
 */
export interface AccountClosureOrchestrator {
  closeAccount(params: CloseAccountParams): Promise<CloseAccountResult>;
}

/**
 * Default production closure orchestrator: the pure use case bound to the
 * Supabase-backed repository.
 *
 * The repository is injectable so an integration test can pass a fake without
 * reaching for the service-role key.
 */
export function createDefaultAccountClosureOrchestrator(
  repository: AccountClosureRepository = createSupabaseAccountClosureRepository(),
): AccountClosureOrchestrator {
  return {
    closeAccount: (params: CloseAccountParams) => closeAccount(repository, params),
  };
}
