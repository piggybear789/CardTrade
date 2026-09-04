-- 0109_expired_collateral_escalation.sql
--
-- Losing collateral on a live Trade now reaches an operator.
--
-- WHAT WAS WRONG. `expire_lapsed_holds` (0035) correctly marked a lapsed hold
-- EXPIRED and told both Traders, and then stopped. It never set
-- `manual_reconciliation`, so nothing reached the admin queue: a Trade could sit in
-- DISPUTED with both authorisations released and the only trace was a notification
-- two people may never open. The one case where the platform most needs to know it
-- is no longer holding anything was the one case nobody was told.
--
-- WHY NOT JUST EXCLUDE DISPUTED TRADES FROM EXPIRY. Because the provider has already
-- released the money. Skipping the row would leave `pre_auth_holds.status = 'ACTIVE'`
-- describing an authorisation that no longer exists, and `bothHoldsActive()` would go
-- on counting it as protection. The record must stay true; what changes is that the
-- loss is now actionable rather than merely announced.
--
-- THE ARITHMETIC THIS EXISTS FOR. An authorisation lapses in about seven days and
-- extended authorisation is not available on this account — the attempt is on file,
-- rejected with "This account is not eligible for the requested card features". Any
-- dispute therefore outlives its own collateral, because a condition dispute is
-- raised partway through a Trade that has already spent days shipping. That gap
-- cannot be closed by scheduling; it can only be handed to a human before the
-- Traders discover it themselves.
--
-- TERMINAL TRADES ARE DELIBERATELY NOT FLAGGED. `finalizeCompletedTrade` leaves a
-- hold ACTIVE when its void fails, precisely so this reconciler owns it — and for a
-- finished Trade the provider releasing the funds IS the intended outcome. Flagging
-- those would fill the queue with cases that resolved themselves correctly.

create or replace function cardtrade.expire_lapsed_holds()
returns integer
language plpgsql
security definer
set search_path to 'cardtrade', 'pg_temp'
as $function$
declare
  v_expired integer := 0;
  r record;
  v_live boolean;
begin
  for r in
    select h.id, h.trade_id, h.trader_id, h.amount_cents,
           t.state, t.initiator_id, t.counterpart_id
    from cardtrade.pre_auth_holds h
    join cardtrade.trades t on t.id = h.trade_id
    where h.status = 'ACTIVE'
      and h.expires_at is not null
      and h.expires_at <= now()
    for update of h skip locked
  loop
    -- Reality: the provider has already released these funds. Recording EXPIRED
    -- rather than VOIDED keeps a lost guarantee distinguishable from an
    -- honoured one, and stops bothHoldsActive() counting it as collateral.
    update cardtrade.pre_auth_holds
    set status = 'EXPIRED', updated_at = now()
    where id = r.id and status = 'ACTIVE';

    -- Same-state audit row: the Trade_State genuinely has not changed, so this
    -- records the event without inventing a transition. The realtime trade view
    -- already subscribes to this table, so it surfaces without new plumbing.
    insert into cardtrade.trade_state_transitions
      (trade_id, from_state, to_state, requested_by, event)
    values (r.trade_id, r.state, r.state, null, 'COLLATERAL_EXPIRED');

    v_live := r.state not in ('COMPLETED', 'FRAUD_RESOLVED', 'CANCELLED');

    -- The escalation. Guarded on state so a Trade that reached a terminal state
    -- between the read above and this write is not queued for a human.
    if v_live then
      update cardtrade.trades
      set manual_reconciliation = true, updated_at = now()
      where id = r.trade_id
        and manual_reconciliation = false
        and state not in ('COMPLETED', 'FRAUD_RESOLVED', 'CANCELLED');
    end if;

    -- Both participants need to know the protection is gone, not just the payer.
    --
    -- A DISPUTED Trade gets different words because the old ones were wrong for it:
    -- "do not hand over goods" is advice for someone who still holds their card, and
    -- in a dispute the goods have already moved and a return may be in progress.
    -- Telling those two to sit tight is the only safe instruction, and it is only
    -- honest because the branch above has actually queued someone to act.
    insert into cardtrade.notifications (user_id, type, title, body, link)
    select
      participant,
      'TRADE',
      'Trade collateral has expired',
      case
        when r.state = 'DISPUTED' then
          'The authorisation holding collateral on this disputed trade has lapsed '
            || 'and the funds have been released by the payment provider. Our team '
            || 'has been notified and will contact you. Do not send or hand over '
            || 'anything further until they do.'
        when v_live then
          'The authorisation holding collateral on this trade has lapsed and the '
            || 'funds have been released by the payment provider. This trade is no '
            || 'longer protected by escrow, and our team has been notified. Do not '
            || 'hand over goods before you hear from us.'
        else
          'The authorisation holding collateral on this trade has lapsed and the '
            || 'funds have been released by the payment provider. This trade has '
            || 'already finished, so no action is needed.'
      end,
      '/trades/' || r.trade_id
    from unnest(array[r.initiator_id, r.counterpart_id]) as participant
    where participant is not null;

    v_expired := v_expired + 1;
  end loop;

  return v_expired;
end;
$function$;

comment on function cardtrade.expire_lapsed_holds is
  'Marks ACTIVE holds EXPIRED once expires_at has passed, records a same-state '
  'COLLATERAL_EXPIRED audit row, flags the Trade for manual reconciliation when it '
  'is still live, and notifies both Traders with wording that matches the state the '
  'Trade is actually in.';
