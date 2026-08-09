-- 0076_as_built_rls_for_unversioned_tables.sql
--
-- Brings eight tables' row-level security into version control, where it has never
-- been.
--
-- ============================================================================
-- THE DRIFT
-- ============================================================================
--
-- `conversations`, `messages`, `notifications`, `offers`, `reports`, `reviews` and
-- `watchlist` are created by NO migration in this directory. They exist in the
-- deployed database and the application reads and writes them constantly; later
-- migrations (0012, 0019, 0031, 0059) alter them and add policies to them, but nothing
-- ever created them. `pre_auth_holds` IS created (0001) but never has
-- `enable row level security` run on it: 0002 enables RLS on exactly four tables, and
-- the comment at its foot defers the collateral table's read policy to "the subsequent
-- migration" — which contains no policy at all.
--
-- So the protection on the chat thread, the offer ledger, the review history, the
-- notification feed and the COLLATERAL TABLE existed only in the deployed database.
-- Version control described a system where all of it was wide open.
--
-- That is not a filing problem. It is why a genuine access-control defect went
-- unnoticed for as long as it did: `messages_participant_update` grants UPDATE to
-- either participant with no `sender_id` check, so with the table-wide column grants
-- that 0072 has now removed, either party could rewrite the other's messages or
-- promote one to a forged SYSTEM event — in the record an arbitrator reads. Nobody
-- reviewing this directory could have seen that policy, because it is not here.
--
-- ============================================================================
-- WHAT THIS FILE DOES, AND WHAT IT DELIBERATELY DOES NOT
-- ============================================================================
--
-- It records the RLS state as built: enables RLS on all eight, and declares every
-- policy exactly as the live database has it. Idempotent, so applying it to the live
-- database is a no-op that changes nothing.
--
-- It does NOT invent `create table` statements. Writing DDL for tables that already
-- exist means guessing column types, defaults, constraints and indexes, and because it
-- would have to be `if not exists` to be safe, a wrong guess would never surface — an
-- unverifiable lie in the migration history is worse than a known gap.
--
-- CONSEQUENCE, STATED PLAINLY: a from-scratch `supabase db reset` still cannot build
-- this schema, and will now FAIL LOUDLY on this file instead of quietly producing a
-- database whose collateral and chat tables have no RLS. That is the better failure.
-- Closing it properly means dumping the real DDL for those seven tables into a
-- migration and verifying it against the live schema — worth doing, and out of scope
-- for a security fix.
--
-- Requirements: 1.6, 1.7, 9.6, 9.7, 11.1.

alter table cardtrade.conversations  enable row level security;
alter table cardtrade.messages       enable row level security;
alter table cardtrade.notifications  enable row level security;
alter table cardtrade.offers         enable row level security;
alter table cardtrade.reports        enable row level security;
alter table cardtrade.reviews        enable row level security;
alter table cardtrade.watchlist      enable row level security;

-- The collateral table. Read-only to the two traders on the trade; every write goes
-- through the service role.
alter table cardtrade.pre_auth_holds enable row level security;

drop policy if exists holds_participant_select on cardtrade.pre_auth_holds;
create policy holds_participant_select on cardtrade.pre_auth_holds
  for select using (
    exists (
      select 1 from cardtrade.trades t
      where t.id = pre_auth_holds.trade_id
        and (t.initiator_id = auth.uid() or t.counterpart_id = auth.uid())
    )
  );

-- Conversations: the two participants.
drop policy if exists conversations_participant_select on cardtrade.conversations;
create policy conversations_participant_select on cardtrade.conversations
  for select using (auth.uid() = participant_a or auth.uid() = participant_b);

drop policy if exists conversations_participant_insert on cardtrade.conversations;
create policy conversations_participant_insert on cardtrade.conversations
  for insert with check (auth.uid() = participant_a or auth.uid() = participant_b);

-- UPDATE is scoped to participation only, which is adequate BECAUSE 0072 narrowed the
-- column grant to `last_message_at`. The policy answers "which row"; the grant answers
-- "which column". Neither is sufficient alone here.
drop policy if exists conversations_participant_update on cardtrade.conversations;
create policy conversations_participant_update on cardtrade.conversations
  for update using (auth.uid() = participant_a or auth.uid() = participant_b)
  with check (auth.uid() = participant_a or auth.uid() = participant_b);

-- Messages: readable and writable by the thread's participants.
drop policy if exists messages_participant_select on cardtrade.messages;
create policy messages_participant_select on cardtrade.messages
  for select using (
    exists (
      select 1 from cardtrade.conversations c
      where c.id = messages.conversation_id
        and (c.participant_a = auth.uid() or c.participant_b = auth.uid())
    )
  );

-- INSERT pins `kind` and the sender, so a SYSTEM event cannot be forged on the way in.
drop policy if exists messages_participant_insert on cardtrade.messages;
create policy messages_participant_insert on cardtrade.messages
  for insert to authenticated
  with check (
    kind = 'USER'
    and sender_id = (select auth.uid())
    and exists (
      select 1 from cardtrade.conversations c
      where c.id = messages.conversation_id
        and ((select auth.uid()) = c.participant_a or (select auth.uid()) = c.participant_b)
    )
  );

-- And UPDATE exists ONLY so a reader can stamp `read_at`. It carries no `sender_id`
-- predicate, which was the way around the INSERT constraint above until 0072 reduced
-- the column grant to `read_at` alone. If a future migration widens that grant, this
-- policy must gain `sender_id <> auth.uid()` in the same change.
drop policy if exists messages_participant_update on cardtrade.messages;
create policy messages_participant_update on cardtrade.messages
  for update using (
    exists (
      select 1 from cardtrade.conversations c
      where c.id = messages.conversation_id
        and (c.participant_a = auth.uid() or c.participant_b = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from cardtrade.conversations c
      where c.id = messages.conversation_id
        and (c.participant_a = auth.uid() or c.participant_b = auth.uid())
    )
  );

-- Notifications: your own only. Rows are created by the service role.
drop policy if exists notifications_owner_select on cardtrade.notifications;
create policy notifications_owner_select on cardtrade.notifications
  for select using (user_id = auth.uid());

drop policy if exists notifications_owner_update on cardtrade.notifications;
create policy notifications_owner_update on cardtrade.notifications
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notifications_owner_delete on cardtrade.notifications;
create policy notifications_owner_delete on cardtrade.notifications
  for delete using (user_id = auth.uid());

-- Offers: the two parties. INSERT pins `offered_by` to the caller, which is what makes
-- the accept-side check (`you cannot accept your own offer`) meaningful.
drop policy if exists offers_party_select on cardtrade.offers;
create policy offers_party_select on cardtrade.offers
  for select using (auth.uid() = buyer_id or auth.uid() = seller_id);

drop policy if exists offers_party_insert on cardtrade.offers;
create policy offers_party_insert on cardtrade.offers
  for insert with check (
    offered_by = auth.uid() and (auth.uid() = buyer_id or auth.uid() = seller_id)
  );

-- Scoped to participation; 0072 narrowed the column grant to `status`, so the amount
-- and `offered_by` are no longer writable after the fact.
drop policy if exists offers_party_update on cardtrade.offers;
create policy offers_party_update on cardtrade.offers
  for update using (auth.uid() = buyer_id or auth.uid() = seller_id)
  with check (auth.uid() = buyer_id or auth.uid() = seller_id);

-- Reports: the reporter sees their own, admins see and triage all.
drop policy if exists reports_select on cardtrade.reports;
create policy reports_select on cardtrade.reports
  for select using (reporter_id = auth.uid() or cardtrade.is_admin());

drop policy if exists reports_insert on cardtrade.reports;
create policy reports_insert on cardtrade.reports
  for insert with check (reporter_id = auth.uid());

drop policy if exists reports_admin_update on cardtrade.reports;
create policy reports_admin_update on cardtrade.reports
  for update using (cardtrade.is_admin()) with check (cardtrade.is_admin());

-- Reviews: public to read (they are the trading history a buyer judges a seller by),
-- authored and withdrawn by their author.
drop policy if exists reviews_public_select on cardtrade.reviews;
create policy reviews_public_select on cardtrade.reviews
  for select using (true);

drop policy if exists reviews_author_insert on cardtrade.reviews;
create policy reviews_author_insert on cardtrade.reviews
  for insert with check (reviewer_id = auth.uid());

-- The UPDATE policy is retained as built, but 0072 revoked the UPDATE grant entirely:
-- `leaveReview` enforces participation, a COMPLETED contract and that the reviewee is
-- not the author, all one-shot, and an UPDATE on `reviewee_id` walked past every one of
-- them while `profiles.rating` is trigger-maintained from these rows.
drop policy if exists reviews_author_update on cardtrade.reviews;
create policy reviews_author_update on cardtrade.reviews
  for update using (reviewer_id = auth.uid()) with check (reviewer_id = auth.uid());

drop policy if exists reviews_author_delete on cardtrade.reviews;
create policy reviews_author_delete on cardtrade.reviews
  for delete using (reviewer_id = auth.uid());

-- Watchlist: entirely your own.
drop policy if exists watchlist_owner_all on cardtrade.watchlist;
create policy watchlist_owner_all on cardtrade.watchlist
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- The fraud-ban lockout (0059) is RESTRICTIVE and applies on top of all of the above.
-- Re-declared here for the two tables that gained policies in this file, so a rebuild
-- cannot end up with the permissive half and not the restrictive one.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'conversations', 'messages', 'notifications', 'offers',
    'reports', 'reviews', 'watchlist', 'pre_auth_holds'
  ]
  loop
    execute format('drop policy if exists fraud_banned_no_access on cardtrade.%I', table_name);
    execute format(
      'create policy fraud_banned_no_access on cardtrade.%I as restrictive for all to authenticated using (not cardtrade.is_fraud_banned()) with check (not cardtrade.is_fraud_banned())',
      table_name
    );
  end loop;
end;
$$;
