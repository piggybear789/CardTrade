-- 0094_audit_hardening.sql
--
-- Four findings from a parallel audit of the surfaces that had not been audited:
-- offers/listings, messaging/notifications, storage, identity, auth/access, and
-- reviews/moderation. None loses money. Three close gaps that were only closed by
-- accident, and one stops a harassment vector.

-- ---------------------------------------------------------------------------
-- 1. A banned member's write to `dispute_evidence` was blocked COINCIDENTALLY.
-- ---------------------------------------------------------------------------
--
-- 0059 put a RESTRICTIVE `fraud_banned_no_access` policy on nineteen member-facing
-- tables. `dispute_evidence` arrived later (0082) and never got one. It is currently
-- unreachable for a banned member anyway, because its INSERT policy subqueries
-- `cash_sales` and `trades` — and those ARE blocked — so the subquery returns no rows.
--
-- That is protection by side effect. It survives only as long as nobody rewrites the
-- insert policy to stop referencing a blocked table, and the next person to touch it has
-- no way to know their edit removes a security property. Stating it directly costs one
-- policy.
drop policy if exists fraud_banned_no_access on cardtrade.dispute_evidence;
create policy fraud_banned_no_access
  on cardtrade.dispute_evidence
  as restrictive
  for all
  to authenticated
  using (not cardtrade.is_fraud_banned())
  with check (not cardtrade.is_fraud_banned());

-- ---------------------------------------------------------------------------
-- 2. A hidden listing was still SELECTable through a raw client.
-- ---------------------------------------------------------------------------
--
-- Moderation hides a listing by setting `items.hidden`, and every application read
-- filters on it — `getItem` returns not-found, and each catalog query adds
-- `.eq('hidden', false)`. The POLICY did not, so an authenticated caller using the
-- publishable key directly could still read a hidden AVAILABLE item.
--
-- That makes the moderation action advisory rather than enforced, which is the same shape
-- as the fraud-ban gap fixed in 0091: the application agreed to hide it and the database
-- never did. The owner branch is unchanged, so a seller still sees their own hidden
-- listing and can tell it has been actioned. Staff read through the service role and are
-- unaffected.
drop policy if exists items_catalog_select on cardtrade.items;
create policy items_catalog_select
  on cardtrade.items
  for select
  using (
    (
      status = 'AVAILABLE'::cardtrade.item_status
      and closed_at is null
      -- From 0091: a banned account's goods leave the catalog immediately.
      and seller_fraud_banned = false
      -- New: so does a listing moderation has hidden.
      and hidden = false
    )
    or owner_id = (select auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 3. Unlimited duplicate reports against the same target.
-- ---------------------------------------------------------------------------
--
-- Nothing stopped a member filing the same report repeatedly, each one a new OPEN row in
-- the moderation queue. That is a harassment vector against the reported member and a
-- denial-of-attention attack on staff, who lose the ability to see what is actually
-- happening.
--
-- PARTIAL on `status = 'OPEN'`, deliberately. One open report per member per target is the
-- right limit; once staff have resolved it, a genuinely recurring problem SHOULD be
-- reportable again. A blanket unique index would silence a real second offence.
create unique index if not exists reports_one_open_per_reporter_target
  on cardtrade.reports (reporter_id, target_type, target_id)
  where status = 'OPEN';

-- ---------------------------------------------------------------------------
-- 4. A member could file a report pre-marked as resolved.
-- ---------------------------------------------------------------------------
--
-- The column-level INSERT grant included `status`, so a direct insert could set
-- `ACTIONED` or `DISMISSED` and land outside the moderation queue. It only ever affected
-- the member's OWN reports — the INSERT policy pins `reporter_id = auth.uid()` — so this
-- is self-harm rather than an attack on anyone else, and `reviewed_by` was never grantable.
--
-- Still wrong: `status` is the moderation queue's own state, and a member has no business
-- writing it. The column defaults to OPEN, so nothing needs it in the grant. Revoking the
-- whole table INSERT first, then re-granting the intended columns, because a column grant
-- cannot be narrowed in place.
revoke insert on cardtrade.reports from authenticated;
grant insert (reporter_id, target_type, target_id, reason, details)
  on cardtrade.reports to authenticated;

comment on index cardtrade.reports_one_open_per_reporter_target is
  'One OPEN report per member per target. Partial on purpose: a resolved report may be '
  'filed again, because a repeat offence is a real thing and a blanket unique index '
  'would silence it.';
