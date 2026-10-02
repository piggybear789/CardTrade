-- 0124_update_deal_invite.sql
--
-- Edit a private-deal invite nobody has joined yet: its terms and its hidden card,
-- in one transaction.
--
-- THE INVITE ROW IS THE LOCK, and it is the same row `claimDealInvite` locks. The
-- claim takes it with a conditional UPDATE (`claimed_at is null`), so whichever of
-- the two reaches the row first decides:
--
--   - an edit that wins commits before the claim's UPDATE re-reads the row, and the
--     room opens on the edited terms (the claim opens it from the row it locked);
--   - a claim that wins leaves `claimed_at` set, and the edit refuses having
--     changed nothing.
--
-- Two writes from the app, one for the card and one for the terms, could not
-- promise that: a claim landing between them opens the room on half an edit.
--
-- The card must still be the host's own hidden, AVAILABLE item. The kind and the
-- host role are fixed: a sale and a trade are different contracts, so changing one
-- into the other is a new invite, not an edit.

create or replace function cardtrade.update_deal_invite(
  p_invite_id uuid,
  p_host_id uuid,
  p_price_cents bigint,
  p_declared_value_cents bigint,
  p_wanted_description text,
  p_item_title text,
  p_item_description text,
  p_item_category text,
  p_item_condition text,
  p_item_fmv_cents bigint,
  p_item_image_paths text[],
  p_item_image_dims jsonb
)
returns text[]
language plpgsql
set search_path = ''
as $$
declare
  v_invite cardtrade.deal_invites%rowtype;
  v_previous_paths text[];
begin
  select * into v_invite
  from cardtrade.deal_invites
  where id = p_invite_id
  for update;

  if not found or v_invite.host_id <> p_host_id then
    raise exception 'invite-not-host';
  end if;
  if v_invite.claimed_at is not null then
    raise exception 'invite-claimed';
  end if;
  if v_invite.revoked_at is not null then
    raise exception 'invite-revoked';
  end if;
  if v_invite.expires_at <= now() then
    raise exception 'invite-expired';
  end if;
  if v_invite.host_item_id is null
    or (v_invite.kind = 'CASH_SALE' and v_invite.host_role is distinct from 'SELLER') then
    raise exception 'invite-not-editable';
  end if;

  select image_paths into v_previous_paths
  from cardtrade.items
  where id = v_invite.host_item_id
    and owner_id = p_host_id
    and hidden
    and status = 'AVAILABLE'
  for update;

  if not found then
    raise exception 'invite-item-unavailable';
  end if;

  update cardtrade.items
  set title = p_item_title,
      description = p_item_description,
      category = p_item_category,
      condition = p_item_condition,
      fmv_cents = p_item_fmv_cents,
      image_paths = p_item_image_paths,
      image_dims = p_item_image_dims
  where id = v_invite.host_item_id;

  if v_invite.kind = 'CASH_SALE' then
    update cardtrade.deal_invites
    set price_cents = p_price_cents
    where id = p_invite_id;
  else
    update cardtrade.deal_invites
    set declared_value_cents = p_declared_value_cents,
        wanted_description = p_wanted_description
    where id = p_invite_id;
  end if;

  -- The photos the card had, so the caller can delete the ones the edit dropped.
  return v_previous_paths;
end;
$$;

comment on function cardtrade.update_deal_invite(
  uuid, uuid, bigint, bigint, text, text, text, text, text, bigint, text[], jsonb
) is
  'Edit an unclaimed private-deal invite and its hidden card atomically. Locks the invite row that claimDealInvite also locks.';

-- Service role only, called from lib/actions/dealInvites.ts, like every contract RPC.
revoke all on function cardtrade.update_deal_invite(
  uuid, uuid, bigint, bigint, text, text, text, text, text, bigint, text[], jsonb
) from public, anon, authenticated;
grant execute on function cardtrade.update_deal_invite(
  uuid, uuid, bigint, bigint, text, text, text, text, text, bigint, text[], jsonb
) to service_role;
