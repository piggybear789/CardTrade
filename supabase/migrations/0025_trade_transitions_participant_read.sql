-- CardTrade — 0025_trade_transitions_participant_read.sql
--
-- Participant read access for `trade_state_transitions`, so the trade room's
-- History tab can load the same audit trail the chat already mirrors.
-- Deferred from 0002_rls (see the note there); cash_sale_events got this in
-- 0008, deals have deal_events — trades were the gap.
--
-- Remote already had RLS + `transitions_participant_select` (public role).
-- This migration: narrows grants to SELECT for authenticated, renames the
-- policy to the cash_sale_events convention, and adds the table to realtime.

alter table cardtrade.trade_state_transitions enable row level security;

drop policy if exists transitions_participant_select
  on cardtrade.trade_state_transitions;
drop policy if exists trade_state_transitions_participant_select
  on cardtrade.trade_state_transitions;

create policy trade_state_transitions_participant_select
  on cardtrade.trade_state_transitions for select to authenticated
  using (
    exists (
      select 1
      from cardtrade.trades t
      where t.id = trade_state_transitions.trade_id
        and (
          (select auth.uid()) = t.initiator_id
          or (select auth.uid()) = t.counterpart_id
        )
    )
  );

revoke all on cardtrade.trade_state_transitions from anon, authenticated;
grant select on cardtrade.trade_state_transitions to authenticated;
grant all on cardtrade.trade_state_transitions to service_role;

-- Live History: append-only inserts from the orchestrator.
alter table cardtrade.trade_state_transitions replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'cardtrade'
      and tablename = 'trade_state_transitions'
  ) then
    alter publication supabase_realtime add table cardtrade.trade_state_transitions;
  end if;
end $$;
