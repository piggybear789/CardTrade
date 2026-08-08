-- 0073_member_insert_grants_least_privilege.sql
--
-- Narrows member INSERT to the columns the application actually writes.
--
-- 0072 fixed the default privileges and narrowed UPDATE, but left INSERT at table
-- scope — which is every column. On `profiles` that included `is_admin`,
-- `is_support`, `identity_check_status`, `merchant_status` and
-- `merchant_settlements_enabled`.
--
-- WHY THAT WAS REACHABLE AND NOT MERELY UNTIDY. `profiles_owner_insert` checks only
-- `auth.uid() = id`, and the primary key stops a member inserting over an existing
-- row — but a signed-in member whose profile row is ABSENT could insert their own
-- with `is_admin = true` and `identity_check_status = 'VERIFIED'`, granting
-- themselves the moderation console and the Identity_Gate in one statement. That
-- state is not hypothetical: a missing profile row is exactly the condition
-- `app/onboarding/layout.tsx` exists to repair, and it was reached in production.
--
-- Neither profile-provisioning path needs the grant. Password sign-up
-- (`lib/actions/auth.ts`) and the OAuth/repair path (`lib/auth/ensureProfile.ts`)
-- both write with the service-role client, so member INSERT on `profiles` is
-- removed outright rather than narrowed.
--
-- A NOTE ON COLUMNS WITH DEFAULTS. Column INSERT privileges are checked only for
-- columns named in the statement, so a column that is always defaulted or
-- trigger-derived needs no grant. That is what keeps `messages.kind` and
-- `messages.system_event` off this list: `sendMessage` never names them, the column
-- default supplies `'USER'`, and `messages_participant_insert` (0012) requires that
-- value — so a forged SYSTEM event is now unwritable by INSERT as well as by UPDATE.
-- Likewise `items.currency`, `items.search_tsv`, `items.seller_identity_verified`
-- and `items.seller_rating` are trigger-derived and deliberately absent.
--
-- Requirements: 1.6, 1.7, 3.4-3.8, 21.6.

revoke insert on cardtrade.profiles from authenticated;

-- Column grants last, per the convention in the tech steering doc.

grant insert (
  owner_id,
  title,
  description,
  category,
  condition,
  fmv_cents,
  image_paths,
  status,
  listing_kind,
  hidden,
  location_label,
  location_place_id,
  location_lat,
  location_lng,
  location_precision,
  location_country_code
) on cardtrade.items to authenticated;

grant insert (
  item_id,
  seller_id,
  buyer_id,
  offered_by,
  amount_cents,
  status,
  message,
  parent_offer_id,
  seller_identity_version,
  buyer_seller_identity_confirmed_at
) on cardtrade.offers to authenticated;

grant insert (item_id, participant_a, participant_b)
  on cardtrade.conversations to authenticated;

grant insert (conversation_id, sender_id, body)
  on cardtrade.messages to authenticated;

grant insert (reviewer_id, reviewee_id, rating, comment, source_type, source_id)
  on cardtrade.reviews to authenticated;

grant insert (reporter_id, target_type, target_id, reason, details, status)
  on cardtrade.reports to authenticated;

grant insert (user_id, item_id) on cardtrade.watchlist to authenticated;
