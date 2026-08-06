-- 0064: Shopfront listings + per-contract line items.
--
-- WHY
-- ---
-- Sellers list a whole binder and then sell individual cards out of it. Until
-- now a listing WAS a single sellable object: opening one Cash_Sale flipped
-- `items.status` to RESERVED, and because `items_catalog_select` treats
-- availability as VISIBILITY, the binder vanished from the catalog for everyone
-- else. `cash_sales_one_active_per_item` then forbade a second live contract
-- outright.
--
-- A shopfront listing is a browsable inventory, not an object for sale. Several
-- Buyers each open their OWN contract against it and negotiate which cards at
-- what price inside that contract. The contract, not the listing, is the thing
-- that gets sold.
--
-- Most of that already worked: `agreed_price_cents` lives on `cash_sales`,
-- `proposeCashSalePrice` renegotiates it, the `cash_sales_reset_acceptances`
-- trigger voids BOTH acceptances on any term change, and money is collected only
-- by the second acceptance. Price was always negotiable right up to collection
-- and frozen after. What was missing is the ability to have more than one live
-- contract, and a record of WHICH goods each contract covers.
--
-- LINE ITEMS ARE NOT COSMETIC.
-- `create_cash_sale_agreement` snapshots the goods FROM the listing, so ten
-- concurrent binder contracts would all read "Josh's Pokémon binder" and nothing
-- would say that one is the Charizard and another is three Pikachus. Arbitration
-- reads `cash_sales.item_title` and NOTHING else — no join back to `items`, not
-- even `item_description`. A disputed binder sale would hand staff one string
-- and a dollar figure, with no way to adjudicate "he sent the wrong card". So
-- `cash_sale_items` is what makes a shopfront sale arbitrable, and it is
-- therefore a precondition of the feature rather than a nicety.
--
-- ACCEPTED RISK, RECORDED DELIBERATELY.
-- `items.status = 'RESERVED'` is what makes double-selling one physical object
-- structurally impossible today. A shopfront has no per-card exclusion, so a
-- Seller CAN agree to sell the same card to three Buyers. Two things bound the
-- damage: escrow still holds every Buyer's money in the platform balance until
-- they accept the goods, so the Buyers who get nothing dispute and are refunded;
-- and because contents are now rows rather than chat messages, "three live
-- contracts naming the same card" is a queryable fact that can be surfaced to
-- the Seller and handed to an arbitrator. Without line items there would be
-- neither containment nor evidence. This is a reputation and friction problem,
-- not a stolen-money problem, and that is the trade being made.

-- =============================================================================
-- 1. Listing kind
-- =============================================================================

create type cardtrade.listing_kind as enum ('SINGLE', 'SHOPFRONT');

comment on type cardtrade.listing_kind is
  'SINGLE = one physical object, reserved by its one live contract. SHOPFRONT = a browsable inventory (binder, bulk lot) that many Buyers contract against concurrently and that is never itself reserved or sold.';

alter table cardtrade.items
  add column listing_kind cardtrade.listing_kind not null default 'SINGLE',
  -- A shopfront never reaches SOLD, so it needs an explicit end of life. Kept
  -- separate from `hidden`, which already means two other things (private trade
  -- items, and listings suppressed by a fraud ban).
  add column closed_at timestamptz;

comment on column cardtrade.items.closed_at is
  'When the owner closed a SHOPFRONT listing. Null for open listings. SINGLE listings use status instead and should leave this null.';

comment on column cardtrade.items.fmv_cents is
  'For SINGLE, the asking price. For SHOPFRONT, an INDICATIVE "from" price only — the amount actually charged is the sum of that contract''s cash_sale_items and is never read from here after the agreement exists.';

-- Catalog visibility. SINGLE keeps the existing status rule verbatim; a
-- shopfront stays visible because nothing ever moves it off AVAILABLE, and
-- disappears when the owner closes it. Owners still see their own rows.
drop policy if exists items_catalog_select on cardtrade.items;
create policy items_catalog_select on cardtrade.items
  for select using (
    (status = 'AVAILABLE' and closed_at is null)
    or owner_id = (select auth.uid())
  );

create index items_shopfront_open_idx
  on cardtrade.items (listing_kind)
  where closed_at is null and hidden = false;

-- =============================================================================
-- 2. Cash_Sale: which listing kind it came from
-- =============================================================================

-- Denormalised onto the sale for the same reason as item_title and the seller
-- identity snapshot: a partial index cannot reach into another table, and the
-- contract must keep describing itself even if the listing is later closed.
alter table cardtrade.cash_sales
  add column from_shopfront boolean not null default false;

comment on column cardtrade.cash_sales.from_shopfront is
  'True when this contract was opened against a SHOPFRONT listing. Snapshotted at creation. Drives the one-active-contract-per-item exemption and means agreed_price_cents is derived from cash_sale_items.';

-- One live contract per item is STILL the rule for SINGLE listings: dropping the
-- index outright would let two Buyers race onto the same one-of-a-kind card.
-- Shopfronts opt out; nothing else does.
drop index if exists cardtrade.cash_sales_one_active_per_item;
create unique index cash_sales_one_active_per_item
  on cardtrade.cash_sales (item_id)
  where from_shopfront = false
    and status in (
      'AGREEMENT','PAYMENT_PENDING','ESCROW_HELD','IN_TRANSIT',
      'HANDOVER','INSPECTION','DISPUTED'
    );

-- A Buyer gets ONE live contract per shopfront. Without this, a mis-click or a
-- double-submitted dialog leaves the same pair holding two negotiations against
-- the same binder with no way to tell which one is real.
create unique index cash_sales_one_active_per_shopfront_buyer
  on cardtrade.cash_sales (item_id, buyer_id)
  where from_shopfront = true
    and status in (
      'AGREEMENT','PAYMENT_PENDING','ESCROW_HELD','IN_TRANSIT',
      'HANDOVER','INSPECTION','DISPUTED'
    );

-- =============================================================================
-- 3. Contract line items
-- =============================================================================

create table cardtrade.cash_sale_items (
  id               uuid primary key default gen_random_uuid(),
  cash_sale_id     uuid not null references cardtrade.cash_sales(id) on delete cascade,
  description      text not null,
  condition        text,
  quantity         integer not null default 1,
  unit_price_cents bigint not null,
  -- Optional Storage path, chosen from the shopfront's own images so a Buyer can
  -- point at the card they mean. No new upload surface.
  image_path       text,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),

  constraint cash_sale_items_description_length
    check (char_length(description) between 1 and 200),
  constraint cash_sale_items_condition_length
    check (condition is null or char_length(condition) between 1 and 60),
  constraint cash_sale_items_quantity_range
    check (quantity between 1 and 999),
  -- Zero is allowed for a throw-in; the sale's own
  -- `cash_sales_agreed_price_positive` still forbids a contract worth nothing.
  constraint cash_sale_items_unit_price_nonnegative
    check (unit_price_cents >= 0)
);

comment on table cardtrade.cash_sale_items is
  'What a Cash_Sale actually covers, line by line. Authored during negotiation and frozen when the contract leaves AGREEMENT. Required for SHOPFRONT contracts, unused by SINGLE ones (whose goods are the item snapshot columns).';

create index cash_sale_items_sale_idx
  on cardtrade.cash_sale_items (cash_sale_id, sort_order);

alter table cardtrade.cash_sale_items enable row level security;

-- Participants read; only the service role writes, exactly as for cash_sales.
create policy cash_sale_items_participant_select
  on cardtrade.cash_sale_items for select to authenticated
  using (
    exists (
      select 1 from cardtrade.cash_sales s
      where s.id = cash_sale_items.cash_sale_id
        and ((select auth.uid()) = s.buyer_id or (select auth.uid()) = s.seller_id)
    )
  );

revoke all on cardtrade.cash_sale_items from anon, authenticated;
grant select on cardtrade.cash_sale_items to authenticated;
grant all on cardtrade.cash_sale_items to service_role;

-- Freeze the goods at the Commitment_Point. The money moves on the second
-- acceptance, so anything that changes WHAT was bought after that would rewrite
-- a contract someone has already paid for. Belt and braces alongside the
-- orchestrator guard: this table is reachable by the service role from anywhere.
create or replace function cardtrade.assert_cash_sale_items_mutable()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_sale_id uuid;
  v_status cardtrade.cash_sale_status;
begin
  v_sale_id := coalesce(new.cash_sale_id, old.cash_sale_id);

  select status into v_status
  from cardtrade.cash_sales
  where id = v_sale_id;

  -- No parent means the sale is being deleted and is cascading into its lines.
  if v_status is not null and v_status <> 'AGREEMENT' then
    raise exception 'Cash-sale contents are locked once payment has started';
  end if;

  return coalesce(new, old);
end;
$$;

create trigger cash_sale_items_frozen_after_agreement
before insert or update or delete on cardtrade.cash_sale_items
for each row execute function cardtrade.assert_cash_sale_items_mutable();

-- =============================================================================
-- 4. Opening an agreement against either listing kind
-- =============================================================================

-- Replaces the 0008 version. Differences, both driven by listing_kind:
--   * a SHOPFRONT is not required to be AVAILABLE and is NOT flipped to
--     RESERVED, so it stays in the catalog for the next Buyer;
--   * `p_items` seeds the contract's line items in the same transaction, so a
--     shopfront contract is never briefly live with no statement of its goods.
-- SINGLE behaviour is unchanged: same FOR UPDATE, same availability guard, same
-- reserve, same empty-set-means-unavailable contract with the caller.
create or replace function cardtrade.create_cash_sale_agreement(
  p_item_id uuid,
  p_buyer_id uuid,
  p_agreed_price_cents bigint,
  p_platform_fee_cents bigint,
  p_seller_identity_version text,
  p_seller_legal_entity_name text,
  p_seller_trading_name text,
  p_seller_registration_number text,
  p_seller_organisation_type text,
  p_seller_identity_verified_at timestamptz,
  p_buyer_identity_confirmed_at timestamptz,
  p_items jsonb default null
)
returns setof cardtrade.cash_sales
language plpgsql
set search_path = ''
as $$
declare
  v_item cardtrade.items%rowtype;
  v_sale cardtrade.cash_sales%rowtype;
  v_conversation_id uuid;
  v_shopfront boolean;
  v_a uuid;
  v_b uuid;
begin
  select * into v_item
  from cardtrade.items
  where id = p_item_id
  for update;

  if not found then
    return;
  end if;

  v_shopfront := v_item.listing_kind = 'SHOPFRONT';

  -- A shopfront is never reserved, so availability cannot gate it; being open is
  -- what matters. A single item keeps the original guard verbatim.
  if v_shopfront then
    if v_item.closed_at is not null then
      return;
    end if;
    if p_items is null or jsonb_array_length(p_items) = 0 then
      raise exception 'A shopfront contract must state which items it covers';
    end if;
  elsif v_item.status <> 'AVAILABLE' then
    return;
  end if;

  if v_item.owner_id = p_buyer_id then
    raise exception 'A seller cannot buy their own item';
  end if;

  if p_buyer_id::text < v_item.owner_id::text then
    v_a := p_buyer_id;
    v_b := v_item.owner_id;
  else
    v_a := v_item.owner_id;
    v_b := p_buyer_id;
  end if;

  select id into v_conversation_id
  from cardtrade.conversations
  where item_id = p_item_id
    and participant_a = v_a
    and participant_b = v_b
  limit 1;

  if v_conversation_id is null then
    begin
      insert into cardtrade.conversations (item_id, participant_a, participant_b)
      values (p_item_id, v_a, v_b)
      returning id into v_conversation_id;
    exception when unique_violation then
      select id into v_conversation_id
      from cardtrade.conversations
      where item_id = p_item_id
        and participant_a = v_a
        and participant_b = v_b
      limit 1;
    end;
  end if;

  if not v_shopfront then
    update cardtrade.items
    set status = 'RESERVED', updated_at = now()
    where id = p_item_id;
  end if;

  insert into cardtrade.cash_sales (
    item_id, buyer_id, seller_id, agreed_price_cents, amount_cents,
    platform_fee_cents, status, item_title, item_description, item_condition,
    item_image_paths, seller_identity_version, seller_legal_entity_name,
    seller_trading_name, seller_registration_number, seller_organisation_type,
    seller_identity_verified_at, buyer_seller_identity_confirmed_at,
    conversation_id, from_shopfront
  ) values (
    p_item_id, p_buyer_id, v_item.owner_id, p_agreed_price_cents,
    p_agreed_price_cents + p_platform_fee_cents, p_platform_fee_cents,
    'AGREEMENT', v_item.title, v_item.description, v_item.condition,
    v_item.image_paths, p_seller_identity_version, p_seller_legal_entity_name,
    p_seller_trading_name, p_seller_registration_number,
    p_seller_organisation_type, p_seller_identity_verified_at,
    p_buyer_identity_confirmed_at, v_conversation_id, v_shopfront
  ) returning * into v_sale;

  if p_items is not null and jsonb_array_length(p_items) > 0 then
    insert into cardtrade.cash_sale_items (
      cash_sale_id, description, condition, quantity, unit_price_cents,
      image_path, sort_order
    )
    select
      v_sale.id,
      line->>'description',
      nullif(line->>'condition', ''),
      coalesce((line->>'quantity')::integer, 1),
      coalesce((line->>'unit_price_cents')::bigint, 0),
      nullif(line->>'image_path', ''),
      (ordinality - 1)::integer
    from jsonb_array_elements(p_items) with ordinality as t(line, ordinality);
  end if;

  insert into cardtrade.cash_sale_events (
    cash_sale_id, actor_id, event, to_status, detail
  ) values (
    v_sale.id, p_buyer_id, 'AGREEMENT_CREATED', 'AGREEMENT',
    case
      when v_shopfront then 'Contract opened from a shopfront listing; nothing reserved and no payment collected.'
      else 'Item reserved; no payment collected.'
    end
  );

  return next v_sale;
end;
$$;

revoke all on function cardtrade.create_cash_sale_agreement(
  uuid, uuid, bigint, bigint, text, text, text, text, text, timestamptz,
  timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function cardtrade.create_cash_sale_agreement(
  uuid, uuid, bigint, bigint, text, text, text, text, text, timestamptz,
  timestamptz, jsonb
) to service_role;

-- The 0008 eleven-argument signature is now unreachable: leaving it in place
-- would let a stale caller open a shopfront contract with no line items.
drop function if exists cardtrade.create_cash_sale_agreement(
  uuid, uuid, bigint, bigint, text, text, text, text, text, timestamptz, timestamptz
);

-- =============================================================================
-- 5. Renegotiating the contents
-- =============================================================================

-- Replace every line in one statement and re-derive the price from them.
--
-- The price update is deliberately how the acceptances get cleared:
-- `agreed_price_cents` is in the `cash_sales_reset_acceptances` trigger's column
-- list, so writing it bumps terms_version and voids both ticks. `UPDATE OF` fires
-- on the column being ASSIGNED, not on its value changing, so swapping one card
-- for another of identical value still forces both parties to re-accept — which
-- is the point: what you are buying changed.
--
-- The caller supplies price and fee because PLATFORM_FEE_BPS lives in
-- `domain/orchestrator/cashSaleOrchestrator.ts` and must not be duplicated here;
-- the totals are re-derived from the lines below and the call is rejected if they
-- disagree, so a caller cannot quietly bill a different number from the one the
-- lines add up to.
create or replace function cardtrade.replace_cash_sale_items(
  p_cash_sale_id uuid,
  p_actor_id uuid,
  p_expected_terms_version integer,
  p_items jsonb,
  p_agreed_price_cents bigint,
  p_platform_fee_cents bigint
)
returns setof cardtrade.cash_sales
language plpgsql
set search_path = ''
as $$
declare
  v_sale cardtrade.cash_sales%rowtype;
  v_updated cardtrade.cash_sales%rowtype;
  v_total bigint;
begin
  select * into v_sale
  from cardtrade.cash_sales
  where id = p_cash_sale_id
  for update;

  if not found then return; end if;
  if p_actor_id <> v_sale.buyer_id and p_actor_id <> v_sale.seller_id then return; end if;
  if v_sale.status <> 'AGREEMENT' then return; end if;
  if v_sale.terms_version <> p_expected_terms_version then return; end if;
  if not v_sale.from_shopfront then return; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then return; end if;

  delete from cardtrade.cash_sale_items where cash_sale_id = p_cash_sale_id;

  insert into cardtrade.cash_sale_items (
    cash_sale_id, description, condition, quantity, unit_price_cents,
    image_path, sort_order
  )
  select
    p_cash_sale_id,
    line->>'description',
    nullif(line->>'condition', ''),
    coalesce((line->>'quantity')::integer, 1),
    coalesce((line->>'unit_price_cents')::bigint, 0),
    nullif(line->>'image_path', ''),
    (ordinality - 1)::integer
  from jsonb_array_elements(p_items) with ordinality as t(line, ordinality);

  select coalesce(sum(quantity * unit_price_cents), 0) into v_total
  from cardtrade.cash_sale_items
  where cash_sale_id = p_cash_sale_id;

  -- The lines are the contract. If the caller's arithmetic disagrees, trust
  -- neither and abort rather than charge a total nobody agreed to.
  if v_total <> p_agreed_price_cents then
    raise exception 'Line items total % but the caller passed %', v_total, p_agreed_price_cents;
  end if;

  update cardtrade.cash_sales
  set agreed_price_cents = p_agreed_price_cents,
      platform_fee_cents = p_platform_fee_cents,
      amount_cents = p_agreed_price_cents + p_platform_fee_cents + shipping_cost_cents,
      updated_at = now()
  where id = p_cash_sale_id
  returning * into v_updated;

  insert into cardtrade.cash_sale_events (
    cash_sale_id, actor_id, event, from_status, to_status, detail
  ) values (
    p_cash_sale_id, p_actor_id, 'CONTENTS_PROPOSED', 'AGREEMENT', 'AGREEMENT',
    format('%s line item(s) totalling %s cents', jsonb_array_length(p_items), v_total)
  );

  return next v_updated;
end;
$$;

revoke all on function cardtrade.replace_cash_sale_items(
  uuid, uuid, integer, jsonb, bigint, bigint
) from public, anon, authenticated;
grant execute on function cardtrade.replace_cash_sale_items(
  uuid, uuid, integer, jsonb, bigint, bigint
) to service_role;

-- =============================================================================
-- 6. Closing a shopfront
-- =============================================================================

-- Closing hides the listing from the catalog but must NOT touch contracts
-- already open against it: those Buyers have negotiated, and some have paid.
create or replace function cardtrade.close_shopfront_listing(
  p_item_id uuid,
  p_owner_id uuid
)
returns setof cardtrade.items
language plpgsql
set search_path = ''
as $$
declare
  v_item cardtrade.items%rowtype;
begin
  update cardtrade.items
  set closed_at = now(), updated_at = now()
  where id = p_item_id
    and owner_id = p_owner_id
    and listing_kind = 'SHOPFRONT'
    and closed_at is null
  returning * into v_item;

  if not found then return; end if;
  return next v_item;
end;
$$;

revoke all on function cardtrade.close_shopfront_listing(uuid, uuid)
  from public, anon, authenticated;
grant execute on function cardtrade.close_shopfront_listing(uuid, uuid)
  to service_role;
