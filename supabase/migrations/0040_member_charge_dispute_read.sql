-- 0040_member_charge_dispute_read.sql
--
-- Member-facing read access to their own chargebacks (Req 8).
--
-- WHY. `charge_disputes` is admin-only today, so a chargeback against a Member's
-- sale is completely invisible to that Member: money reverses and nothing in
-- their account explains it. The Payouts_Dashboard needs to show it.
--
-- TWO SEPARATE PROBLEMS, TWO MECHANISMS. RLS is row-level only, so a row policy
-- alone would let a Member read every column of their own dispute row —
-- including `dispute_ref`, `charge_ref`, the provider `reason`/`status` strings
-- and the evidence deadline, none of which are theirs to see (Req 8.3). So:
--
--   1. A row policy scopes WHICH rows a Member may read.
--   2. Column privileges scope WHICH columns, by revoking blanket select from
--      `authenticated` and re-granting only the four safe ones.
--
-- The admin console is unaffected: it reads through the service-role client,
-- which bypasses RLS and holds its own grants.
--
-- Attribution is by `profile_id`, or by participation in the referenced
-- Cash_Sale or Trade, because a dispute is not always attributable to a Profile
-- directly (the provider metadata can be absent, or the charge created outside
-- StripeService).

-- ---------------------------------------------------------------------------
-- 1. Row scoping: a Member may read a dispute attributable to them.
-- ---------------------------------------------------------------------------
drop policy if exists charge_disputes_member_select on cardtrade.charge_disputes;
create policy charge_disputes_member_select
  on cardtrade.charge_disputes for select to authenticated
  using (
    profile_id = auth.uid()
    or exists (
      select 1 from cardtrade.cash_sales cs
      where cs.id = charge_disputes.cash_sale_id
        and (cs.buyer_id = auth.uid() or cs.seller_id = auth.uid())
    )
    or exists (
      select 1 from cardtrade.trades t
      where t.id = charge_disputes.trade_id
        and (t.initiator_id = auth.uid() or t.counterpart_id = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Column scoping: only the member-safe projection.
--
-- `id` is included so a client can key a list; it is an opaque surrogate and
-- reveals nothing about the provider. Deliberately withheld: dispute_ref,
-- charge_ref, reason, status, evidence_due_by, created_at, updated_at.
-- ---------------------------------------------------------------------------
revoke select on cardtrade.charge_disputes from authenticated;
grant select (
  id,
  trade_id,
  cash_sale_id,
  profile_id,
  amount_cents,
  outcome,
  opened_at,
  closed_at
) on cardtrade.charge_disputes to authenticated;

-- No member write path: the webhook pipeline on the service-role client stays
-- the only writer (Req 8.6).
revoke insert, update, delete on cardtrade.charge_disputes from authenticated;
revoke insert, update, delete on cardtrade.charge_disputes from anon;

comment on policy charge_disputes_member_select on cardtrade.charge_disputes is
  'A Member may read a chargeback attributable to them, by profile_id or by '
  'participation in the referenced cash sale or trade. Column privileges above '
  'restrict this to the member-safe projection; provider refs, reason, status '
  'and the evidence deadline are withheld.';
