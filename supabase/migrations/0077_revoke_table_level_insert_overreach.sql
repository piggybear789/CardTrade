-- 0077_revoke_table_level_insert_overreach.sql
--
-- Makes 0073's column-level INSERT grants actually take effect.
--
-- THE MISTAKE, WHICH WAS MINE AND NOT INHERITED. 0072 granted INSERT at TABLE level on
-- `items`, `offers`, `conversations`, `messages`, `reviews`, `reports` and `watchlist`.
-- 0073 then granted INSERT on specific COLUMNS of those same tables, intending to narrow
-- it — but a table-level grant already covers every column, and PostgreSQL keeps the two
-- kinds of grant as separate ACL entries. So the narrower grant added nothing and the wide
-- one still applied. 0073 changed the intent and not the behaviour.
--
-- `profiles` was the exception, and only by accident of a different approach: there the
-- table-level INSERT was REVOKED outright, so the escalation 0073 was written to close
-- (self-inserting a row with `is_admin = true`) really is closed.
--
-- HOW IT WAS CAUGHT. Not by a test and not by review — by asking the database, per
-- column, whether each member flow's privilege matched what it should be:
--
--   has_column_privilege('authenticated', 'cardtrade.messages', 'kind', 'INSERT')
--
-- which should have been false and was true. A grant audit that reads the migration files
-- says what was intended; only `has_column_privilege` says what is true. Worth repeating
-- after any change to grants in this schema.
--
-- WHAT WAS ACTUALLY REACHABLE IN THE MEANTIME. `messages.kind` and `system_event`, so a
-- forged SYSTEM contract event could be inserted directly rather than by promoting a USER
-- message (which 0072 had closed on the UPDATE side). Also `items.seller_identity_verified`
-- and `items.seller_rating` at insert time — both harmless in practice because their
-- BEFORE INSERT triggers overwrite whatever is supplied — and `reports.status` /
-- `reports.reviewed_by`, letting a reporter file a report pre-resolved.
--
-- DELETE stays table-level on `items` and `watchlist`: DELETE has no column granularity,
-- and both are correctly scoped by RLS to the caller's own rows.
--
-- Requirements: 1.6, 1.7, 3.4-3.8.

revoke insert on cardtrade.items         from authenticated;
revoke insert on cardtrade.offers        from authenticated;
revoke insert on cardtrade.conversations from authenticated;
revoke insert on cardtrade.messages      from authenticated;
revoke insert on cardtrade.reviews       from authenticated;
revoke insert on cardtrade.reports       from authenticated;
revoke insert on cardtrade.watchlist     from authenticated;

-- Column grants last, per the convention in the tech steering doc. Re-issued rather than
-- relied upon: a table-level REVOKE and a column-level GRANT touch different ACL entries,
-- and restating them here means this file is the complete picture of the member INSERT
-- surface rather than a diff against two earlier ones.

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

-- `kind` and `system_event` are deliberately absent: `sendMessage` never names them, the
-- column default supplies 'USER', and `messages_participant_insert` requires that value.
grant insert (conversation_id, sender_id, body)
  on cardtrade.messages to authenticated;

grant insert (reviewer_id, reviewee_id, rating, comment, source_type, source_id)
  on cardtrade.reviews to authenticated;

-- `status` is granted because `submitReport` sets 'OPEN' explicitly; `reviewed_by` and
-- `reviewed_at` are the admin triage fields and are not.
grant insert (reporter_id, target_type, target_id, reason, details, status)
  on cardtrade.reports to authenticated;

grant insert (user_id, item_id) on cardtrade.watchlist to authenticated;
