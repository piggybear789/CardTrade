-- 0078_rls_initplan_optimisation.sql
--
-- Stops 26 RLS policies re-evaluating `auth.uid()` once PER ROW.
--
-- THE PROBLEM. A bare `auth.uid()` in a policy expression is treated as a volatile
-- per-row call, so Postgres executes it for every row it tests. Wrapping it in a
-- scalar subquery — `(select auth.uid())` — lets the planner hoist it into an
-- InitPlan, evaluate it once per statement, and reuse the result. Supabase's own
-- database linter flags the unwrapped form as `auth_rls_initplan`, and it flagged
-- exactly these 26 policies in the `cardtrade` schema.
--
-- SEMANTICS ARE IDENTICAL. `auth.uid()` does not depend on the row being tested, so
-- evaluating it once per statement instead of once per row cannot change which rows
-- pass. This is a pure planner optimisation, which is why it is safe to apply in bulk.
--
-- WHY IT MATTERS MOST ON THE READ PATHS. The worst cases are the policies guarding
-- tables the app reads in bulk: `messages_participant_select` (the inbox reads every
-- message across every conversation), `notifications_owner_select` (already 169 rows
-- for one member), `items_owner_*`, and `trades_participant_select`. On a table scan
-- the saving is proportional to the row count, so this gets more valuable as the
-- marketplace grows — which is the opposite of the usual "optimise later" tradeoff.
--
-- THE PATTERN WAS ALREADY KNOWN HERE AND APPLIED INCONSISTENTLY. 0071's
-- `items_trade_participant_select`, `cash_sales_participant_select`, the
-- `cash_sale_*` policies, `trade_delivery_details`, `trade_fees`,
-- `trade_state_transitions` and `messages_participant_insert` all use the wrapped
-- form already and are deliberately left untouched. The 26 below are the ones that
-- did not — including several this project's own 0076 re-declared in the unwrapped
-- form while backfilling them into version control.
--
-- `is_staff()` and `is_admin()` are wrapped for the same reason where they appear:
-- neither depends on the row.
--
-- Requirements: 1.6, 1.7, 9.6, 9.7.

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

drop policy if exists profiles_owner_select on cardtrade.profiles;
create policy profiles_owner_select on cardtrade.profiles
  for select using ((select auth.uid()) = id);

drop policy if exists profiles_owner_update on cardtrade.profiles;
create policy profiles_owner_update on cardtrade.profiles
  for update using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists profiles_owner_insert on cardtrade.profiles;
create policy profiles_owner_insert on cardtrade.profiles
  for insert with check ((select auth.uid()) = id);

-- ---------------------------------------------------------------------------
-- items — the catalog. `items_catalog_select` and `items_trade_participant_select`
-- are already wrapped and are not touched here.
-- ---------------------------------------------------------------------------

drop policy if exists items_owner_insert on cardtrade.items;
create policy items_owner_insert on cardtrade.items
  for insert with check (owner_id = (select auth.uid()));

drop policy if exists items_owner_update on cardtrade.items;
create policy items_owner_update on cardtrade.items
  for update using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists items_owner_delete on cardtrade.items;
create policy items_owner_delete on cardtrade.items
  for delete using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- trades and trade_items
-- ---------------------------------------------------------------------------

drop policy if exists trades_participant_select on cardtrade.trades;
create policy trades_participant_select on cardtrade.trades
  for select using (
    (select auth.uid()) = initiator_id or (select auth.uid()) = counterpart_id
  );

drop policy if exists trade_items_participant_select on cardtrade.trade_items;
create policy trade_items_participant_select on cardtrade.trade_items
  for select to authenticated
  using (
    exists (
      select 1 from cardtrade.trades t
      where t.id = trade_items.trade_id
        and ((select auth.uid()) = t.initiator_id or (select auth.uid()) = t.counterpart_id)
    )
  );

-- ---------------------------------------------------------------------------
-- pre_auth_holds — read on every contract-room render.
-- ---------------------------------------------------------------------------

drop policy if exists holds_participant_select on cardtrade.pre_auth_holds;
create policy holds_participant_select on cardtrade.pre_auth_holds
  for select using (
    exists (
      select 1 from cardtrade.trades t
      where t.id = pre_auth_holds.trade_id
        and (t.initiator_id = (select auth.uid()) or t.counterpart_id = (select auth.uid()))
    )
  );

-- ---------------------------------------------------------------------------
-- conversations and messages — the inbox reads these in bulk, so these are the
-- policies with the most rows to test.
-- ---------------------------------------------------------------------------

drop policy if exists conversations_participant_select on cardtrade.conversations;
create policy conversations_participant_select on cardtrade.conversations
  for select using (
    (select auth.uid()) = participant_a or (select auth.uid()) = participant_b
  );

drop policy if exists conversations_participant_insert on cardtrade.conversations;
create policy conversations_participant_insert on cardtrade.conversations
  for insert with check (
    (select auth.uid()) = participant_a or (select auth.uid()) = participant_b
  );

drop policy if exists conversations_participant_update on cardtrade.conversations;
create policy conversations_participant_update on cardtrade.conversations
  for update using (
    (select auth.uid()) = participant_a or (select auth.uid()) = participant_b
  )
  with check (
    (select auth.uid()) = participant_a or (select auth.uid()) = participant_b
  );

drop policy if exists messages_participant_select on cardtrade.messages;
create policy messages_participant_select on cardtrade.messages
  for select using (
    exists (
      select 1 from cardtrade.conversations c
      where c.id = messages.conversation_id
        and (c.participant_a = (select auth.uid()) or c.participant_b = (select auth.uid()))
    )
  );

-- Still no `sender_id` predicate, which is safe ONLY because 0072 narrowed the
-- column grant to `read_at`. See the note in 0076 before widening either.
drop policy if exists messages_participant_update on cardtrade.messages;
create policy messages_participant_update on cardtrade.messages
  for update using (
    exists (
      select 1 from cardtrade.conversations c
      where c.id = messages.conversation_id
        and (c.participant_a = (select auth.uid()) or c.participant_b = (select auth.uid()))
    )
  )
  with check (
    exists (
      select 1 from cardtrade.conversations c
      where c.id = messages.conversation_id
        and (c.participant_a = (select auth.uid()) or c.participant_b = (select auth.uid()))
    )
  );

-- ---------------------------------------------------------------------------
-- notifications — the bell polls these, and they accumulate per member.
-- ---------------------------------------------------------------------------

drop policy if exists notifications_owner_select on cardtrade.notifications;
create policy notifications_owner_select on cardtrade.notifications
  for select using (user_id = (select auth.uid()));

drop policy if exists notifications_owner_update on cardtrade.notifications;
create policy notifications_owner_update on cardtrade.notifications
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists notifications_owner_delete on cardtrade.notifications;
create policy notifications_owner_delete on cardtrade.notifications
  for delete using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- offers
-- ---------------------------------------------------------------------------

drop policy if exists offers_party_select on cardtrade.offers;
create policy offers_party_select on cardtrade.offers
  for select using (
    (select auth.uid()) = buyer_id or (select auth.uid()) = seller_id
  );

drop policy if exists offers_party_insert on cardtrade.offers;
create policy offers_party_insert on cardtrade.offers
  for insert with check (
    offered_by = (select auth.uid())
    and ((select auth.uid()) = buyer_id or (select auth.uid()) = seller_id)
  );

drop policy if exists offers_party_update on cardtrade.offers;
create policy offers_party_update on cardtrade.offers
  for update using (
    (select auth.uid()) = buyer_id or (select auth.uid()) = seller_id
  )
  with check (
    (select auth.uid()) = buyer_id or (select auth.uid()) = seller_id
  );

-- ---------------------------------------------------------------------------
-- reports and reviews
-- ---------------------------------------------------------------------------

drop policy if exists reports_select on cardtrade.reports;
create policy reports_select on cardtrade.reports
  for select using (
    reporter_id = (select auth.uid()) or (select cardtrade.is_admin())
  );

drop policy if exists reports_insert on cardtrade.reports;
create policy reports_insert on cardtrade.reports
  for insert with check (reporter_id = (select auth.uid()));

drop policy if exists reviews_author_insert on cardtrade.reviews;
create policy reviews_author_insert on cardtrade.reviews
  for insert with check (reviewer_id = (select auth.uid()));

drop policy if exists reviews_author_update on cardtrade.reviews;
create policy reviews_author_update on cardtrade.reviews
  for update using (reviewer_id = (select auth.uid()))
  with check (reviewer_id = (select auth.uid()));

drop policy if exists reviews_author_delete on cardtrade.reviews;
create policy reviews_author_delete on cardtrade.reviews
  for delete using (reviewer_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- watchlist
-- ---------------------------------------------------------------------------

drop policy if exists watchlist_owner_all on cardtrade.watchlist;
create policy watchlist_owner_all on cardtrade.watchlist
  for all using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Staff and admin surfaces
-- ---------------------------------------------------------------------------

drop policy if exists arbitration_notes_staff_insert on cardtrade.arbitration_notes;
create policy arbitration_notes_staff_insert on cardtrade.arbitration_notes
  for insert to authenticated
  with check ((select cardtrade.is_staff()) and author_id = (select auth.uid()));

drop policy if exists "Admins read charge disputes" on cardtrade.charge_disputes;
create policy "Admins read charge disputes" on cardtrade.charge_disputes
  for select to authenticated
  using (
    exists (
      select 1 from cardtrade.profiles p
      where p.id = (select auth.uid()) and p.is_admin
    )
  );

drop policy if exists charge_disputes_member_select on cardtrade.charge_disputes;
create policy charge_disputes_member_select on cardtrade.charge_disputes
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or exists (
      select 1 from cardtrade.cash_sales cs
      where cs.id = charge_disputes.cash_sale_id
        and (cs.buyer_id = (select auth.uid()) or cs.seller_id = (select auth.uid()))
    )
    or exists (
      select 1 from cardtrade.trades t
      where t.id = charge_disputes.trade_id
        and (t.initiator_id = (select auth.uid()) or t.counterpart_id = (select auth.uid()))
    )
  );
