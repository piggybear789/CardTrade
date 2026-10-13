-- 0136_items_insert_service_role.sql
--
-- ESC-26 (Medium): listings could be published without the Identity_Gate.
--
-- Members held column-level INSERT on `cardtrade.items` (0077, plus `image_dims` in
-- 0106 and the grading columns in 0129), guarded by a policy that only checked
-- `owner_id = auth.uid()`. The gate (`readListingGate`: a verified identity and a
-- seller disclosure) lives in `createItem`, so a direct PostgREST insert skipped it
-- entirely and produced a public listing from an unverified account — useful as
-- off-platform bait.
--
-- Now every insert goes through the server:
--   * `createItem` checks the gate, validates, then inserts with the service role and
--     the session user as owner;
--   * `createPrivateTradeItem` (a private-deal card, deliberately ungated) inserts with
--     the service role and forces hidden, AVAILABLE, SINGLE and the session owner.
--
-- DELETE stays with members. The member INSERT policy goes with the grants so the
-- policy set still matches the grant set.

drop policy if exists items_owner_insert on cardtrade.items;

-- Grants last.
revoke insert on cardtrade.items from authenticated;
revoke insert (
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
  location_country_code,
  image_dims,
  grader,
  grade,
  cert_number
) on cardtrade.items from authenticated;
