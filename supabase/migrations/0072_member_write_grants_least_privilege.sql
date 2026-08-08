-- 0072_member_write_grants_least_privilege.sql
--
-- Removes member-level write access that nothing ever granted deliberately, and
-- closes the two holes reachable with nothing but the public anon key.
--
-- ============================================================================
-- ROOT CAUSE: DEFAULT PRIVILEGES, NOT A MIGRATION
-- ============================================================================
--
-- Every table and view in `cardtrade` granted INSERT, UPDATE and DELETE to
-- `authenticated` on EVERY column. No migration did that. `pg_default_acl` held
-- `{authenticated=arwd/postgres}` for tables in this schema, so each new relation
-- inherited member write access at creation time.
--
-- That is why auditing the migrations could not find it, and why the revoke in
-- 0032_verified_identity_display.sql did not hold: the grants come back with the
-- next relation. Revoking the privileges without changing the default would be
-- undone by the next migration that adds a table, so this fixes the default FIRST
-- and then cleans up what the default already produced.
--
-- ============================================================================
-- WHAT WAS REACHABLE
-- ============================================================================
--
-- 1. `cardtrade.public_profiles` is an auto-updatable view onto `profiles`, owned
--    by `postgres` — which owns `profiles` too. A view without `security_invoker`
--    resolves base-table permissions as its OWNER, and a table owner bypasses RLS
--    unless the table forces it (`relforcerowsecurity` is false here). With the
--    inherited write grants, any signed-in member could UPDATE or DELETE ANY
--    other member's profile row through the view, and could write `rating` /
--    `rating_count`, which the `profiles` column allowlist deliberately excludes.
--
--    THE FIX IS TO REVOKE THE WRITES, NOT TO SET `security_invoker`. Invoker
--    rights would evaluate `profiles_owner_select` (`auth.uid() = id`) as the
--    caller, and every catalog page, seller page and review list reads OTHER
--    members through this view — so it would return nothing and take the
--    marketplace down. The owner-executing SELECT is the entire point of a
--    public projection; only the write paths were wrong.
--
-- 2. Column-level tampering the server actions were carefully guarding against:
--    a seller could set `items.hidden = false` to undo an admin moderation hide,
--    write `items.seller_identity_verified` (the denormalised Identity_Gate), or
--    move `items.fmv_cents` while reserved; either party to an offer could rewrite
--    `offers.amount_cents` and `offered_by`; either party to a conversation could
--    rewrite the other's `messages.body` or promote a message to a forged
--    `kind = 'SYSTEM'` event in the record an arbitrator reads; a review author
--    could repoint `reviews.reviewee_id`.
--
-- The grants at the end of this file are the complete set of member writes the
-- application actually performs through the cookie-bound client, enumerated from
-- `lib/actions/**`. Everything else is written by the service role.
--
-- Requirements: 1.6, 1.7, 3.4-3.8, 21.6.

-- ---------------------------------------------------------------------------
-- 1. The default itself
-- ---------------------------------------------------------------------------

alter default privileges for role postgres in schema cardtrade
  revoke insert, update, delete on tables from authenticated;

alter default privileges for role postgres in schema cardtrade
  revoke insert, update, delete on tables from anon;

-- ---------------------------------------------------------------------------
-- 2. Clean up what the default already produced
-- ---------------------------------------------------------------------------
--
-- Blanket revoke across every relation in the schema, including views. The grants
-- at the end of the file then add back precisely what members need. Doing it in
-- this order means a table added later without an explicit grant is closed by
-- default rather than open by default.

do $$
declare
  rel record;
begin
  for rel in
    select c.relname, c.relkind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'cardtrade'
      and c.relkind in ('r', 'v', 'm', 'p')
  loop
    execute format(
      'revoke insert, update, delete on cardtrade.%I from anon, authenticated',
      rel.relname
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. SECURITY DEFINER functions that were EXECUTE-able by anon
-- ---------------------------------------------------------------------------
--
-- These run with the definer's rights and mutate contract state. Every other RPC
-- in the schema is already revoked from `public, anon, authenticated` and granted
-- to `service_role` alone (see 0053, 0057, 0064); these six kept PostgreSQL's
-- default EXECUTE TO PUBLIC and were therefore callable over PostgREST by an
-- unauthenticated caller holding only the publishable anon key.
--
-- The most consequential was `mark_cash_sale_refund_due`, which writes
-- `refund_cents` with no cap on a DISPUTED sale. Seller net is
-- `amount - platform_fee - refund`, so an arbitrary caller could reduce or zero
-- any seller's release. `record_trade_fraud_claim` takes the claimant as a
-- PARAMETER and checks only participation, never `auth.uid()`, so a fraud
-- allegation could be attributed to a member who never made it.
--
-- They are called only from server code holding the service-role key, and the
-- three sweep functions are called by pg_cron, so none of them lose a caller.
-- The in-function participation and state guards stay exactly as they are: they
-- are defence in depth for the service-role caller, not the access control that
-- was missing.

revoke all on function cardtrade.mark_cash_sale_refund_due(uuid, bigint)
  from public, anon, authenticated;
grant execute on function cardtrade.mark_cash_sale_refund_due(uuid, bigint)
  to service_role;

revoke all on function cardtrade.mark_cash_sale_payout_due(uuid)
  from public, anon, authenticated;
grant execute on function cardtrade.mark_cash_sale_payout_due(uuid)
  to service_role;

revoke all on function cardtrade.record_cash_sale_refund_failure(uuid, text)
  from public, anon, authenticated;
grant execute on function cardtrade.record_cash_sale_refund_failure(uuid, text)
  to service_role;

revoke all on function cardtrade.record_trade_fraud_claim(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function cardtrade.record_trade_fraud_claim(uuid, uuid, text)
  to service_role;

revoke all on function cardtrade.record_charge_dispute(
  text, text, bigint, text, text, uuid, uuid, uuid, timestamptz, text
) from public, anon, authenticated;
grant execute on function cardtrade.record_charge_dispute(
  text, text, bigint, text, text, uuid, uuid, uuid, timestamptz, text
) to service_role;

revoke all on function cardtrade.attach_dispute_conversation(uuid, uuid)
  from public, anon, authenticated;
grant execute on function cardtrade.attach_dispute_conversation(uuid, uuid)
  to service_role;

-- Scheduled sweeps. pg_cron runs them as the job owner, not as a member.
revoke all on function cardtrade.expire_lapsed_holds()
  from public, anon, authenticated;
revoke all on function cardtrade.warn_expiring_holds()
  from public, anon, authenticated;
revoke all on function cardtrade.enforce_trade_shipping_deadlines()
  from public, anon, authenticated;

-- `is_admin`, `is_staff` and `is_fraud_banned` are deliberately left executable:
-- RLS policies call them as the member, so revoking EXECUTE would deny every
-- policy that depends on them.

-- ---------------------------------------------------------------------------
-- 4. Read access preserved
-- ---------------------------------------------------------------------------
--
-- Step 2 revoked writes only, so no SELECT grant changed. Restated for the
-- public projection because it is the one relation whose read path is the
-- product: the catalog, seller pages and review lists all resolve other
-- members through it.

grant select on cardtrade.public_profiles to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The member write surface, granted back explicitly
-- ---------------------------------------------------------------------------
--
-- COLUMN GRANTS LIVE AT THE END OF THE FILE ON PURPOSE. The denormalisation
-- agreement property in tests/property/identityGate.test.ts parses migration TEXT
-- with regexes, and a column grant contains a token its function matcher can chase
-- across newlines. Keeping these last is the convention recorded in the tech
-- steering doc; do not move them above a function definition.
--
-- Each grant below corresponds to a specific write in `lib/actions/**` through the
-- cookie-bound client. RLS still applies on top of every one of them: the grant
-- says WHICH COLUMN may be written, the policy says WHICH ROW.

-- Profiles: the same allowlist 0005 and 0066 established, restated because step 2
-- revoked it. Nothing here can reach a role flag, a merchant column or an
-- identity-check column.
grant insert on cardtrade.profiles to authenticated;
grant update (display_name, contact_email, region_code, onboarding_completed_at, avatar_path)
  on cardtrade.profiles to authenticated;

-- Items: create, edit and delete your own listing.
--
-- UPDATE is narrowed to the LOCATION columns, which are the only ones the
-- cookie-bound client writes (`updateListing` patches the suburb pin after the
-- guarded content update). Item content goes through `itemOrchestrator` on the
-- service-role client, which is where `ITEM_NOT_AVAILABLE` and `FMV_IMMUTABLE`
-- are enforced — so `status`, `fmv_cents`, `hidden`, `closed_at`, `listing_kind`,
-- `owner_id`, `seller_identity_verified` and `seller_rating` are no longer
-- member-writable at all. `hidden` is the admin moderation switch and
-- `seller_identity_verified` is the denormalised Identity_Gate.
grant insert, delete on cardtrade.items to authenticated;
grant update (
  location_label,
  location_place_id,
  location_lat,
  location_lng,
  location_precision,
  location_country_code
) on cardtrade.items to authenticated;

-- Offers: make, counter, withdraw, decline, accept.
--
-- `status` only. `amount_cents` was writable by either party, which let a buyer
-- rewrite the number and `respondToOffer` read it back at accept time; `offered_by`
-- decided who was allowed to accept, so writing it defeated that check.
grant insert on cardtrade.offers to authenticated;
grant update (status) on cardtrade.offers to authenticated;

-- Conversations and messages: open a thread, send, mark read.
--
-- `messages.body`, `kind`, `sender_id` and `system_event` are no longer writable.
-- Chat is the evidence an arbitrator reads, and INSERT was already correctly
-- constrained to `kind = 'USER'` with `sender_id = auth.uid()` (0012) — UPDATE was
-- the way around it.
grant insert on cardtrade.conversations to authenticated;
grant update (last_message_at) on cardtrade.conversations to authenticated;
grant insert on cardtrade.messages to authenticated;
grant update (read_at) on cardtrade.messages to authenticated;

-- Notifications: mark read. Rows are created by the service role.
grant update (read_at) on cardtrade.notifications to authenticated;

-- Watchlist: save and unsave.
grant insert, delete on cardtrade.watchlist to authenticated;

-- Reviews and reports: insert once, never edit.
--
-- `leaveReview` enforces participation, a COMPLETED contract, counterparty identity
-- and that the reviewee is not the author — all one-shot checks that an UPDATE on
-- `reviewee_id` walked straight past, and `profiles.rating` is trigger-maintained
-- from these rows.
grant insert on cardtrade.reviews to authenticated;
grant insert on cardtrade.reports to authenticated;
