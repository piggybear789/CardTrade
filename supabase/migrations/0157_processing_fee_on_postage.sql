-- 0157_processing_fee_on_postage.sql
--
-- The cash-sale fee is now the Processing_Fee: Stripe's card and payout costs passed
-- through to the buyer in full (`domain/fees/processingFee.ts`). Stripe charges on the
-- whole payment, so the fee's base is price PLUS postage, and a postage change has to
-- move the fee with it.
--
-- `update_cash_sale_terms` (0050) is where postage changes, and it reused the stored
-- fee. This redefines it with one more argument, `p_platform_fee_cents`, written in
-- the SAME statement as the postage, so `amount = price + fee + postage` can never
-- hold a fee sized for a different postage. Null keeps the stored fee, which is what
-- a caller written before this migration would mean.
--
-- The fee is computed in TypeScript and passed in, as `create_cash_sale_agreement`
-- and `replace_cash_sale_items` already do (0064): the rate table lives in one place.
--
-- Body otherwise identical to 0050. The old 16-argument signature is dropped, because
-- two overloads differing only in a trailing defaulted argument make a named-argument
-- RPC call ambiguous.

drop function if exists cardtrade.update_cash_sale_terms(
  uuid, uuid, integer, cardtrade.handover_method, bigint, text, text,
  double precision, double precision, text, timestamptz, text, text, text,
  double precision, double precision
);

create or replace function cardtrade.update_cash_sale_terms(
  p_cash_sale_id uuid,
  p_actor_id uuid,
  p_expected_terms_version integer,
  p_fulfillment_method cardtrade.handover_method,
  p_shipping_cost_cents bigint,
  p_shipping_notes text,
  p_meeting_location text,
  p_meeting_lat double precision,
  p_meeting_lng double precision,
  p_meeting_place_id text,
  p_meeting_at timestamptz,
  p_delivery_address_label text default null,
  p_delivery_place_id text default null,
  p_delivery_country_code text default null,
  p_delivery_lat double precision default null,
  p_delivery_lng double precision default null,
  p_platform_fee_cents bigint default null
)
returns setof cardtrade.cash_sales
language plpgsql
set search_path = ''
as $$
declare
  v_sale cardtrade.cash_sales%rowtype;
  v_has_delivery_input boolean;
  v_updated cardtrade.cash_sales%rowtype;
  v_fee bigint;
begin
  select * into v_sale
  from cardtrade.cash_sales
  where id = p_cash_sale_id
  for update;

  if not found
    or v_sale.status <> 'AGREEMENT'
    or v_sale.terms_version <> p_expected_terms_version
    or p_actor_id not in (v_sale.buyer_id, v_sale.seller_id) then
    return;
  end if;

  if p_platform_fee_cents is not null and p_platform_fee_cents < 0 then
    return;
  end if;
  v_fee := coalesce(p_platform_fee_cents, v_sale.platform_fee_cents);

  if p_fulfillment_method = 'DELIVERY' then
    if p_shipping_cost_cents is null or p_shipping_cost_cents < 0
      or p_meeting_location is not null or p_meeting_lat is not null
      or p_meeting_lng is not null or p_meeting_place_id is not null
      or p_meeting_at is not null then
      return;
    end if;

    v_has_delivery_input := p_delivery_address_label is not null
      or p_delivery_place_id is not null
      or p_delivery_country_code is not null
      or p_delivery_lat is not null
      or p_delivery_lng is not null;

    -- The Seller can propose delivery costs/notes but never write or replace the
    -- Buyer's address. A partial address is rejected instead of being persisted.
    if p_actor_id = v_sale.seller_id and v_has_delivery_input then
      return;
    end if;
    if v_has_delivery_input and (
      p_delivery_address_label is null
      or p_delivery_place_id is null
      or p_delivery_country_code is null
      or p_delivery_lat is null
      or p_delivery_lng is null
      or char_length(btrim(p_delivery_address_label)) not between 1 and 1000
      or char_length(btrim(p_delivery_place_id)) not between 1 and 255
      or p_delivery_place_id like 'text:%'
      or p_delivery_place_id like 'legacy:%'
      or p_delivery_country_code !~ '^[A-Z]{2}$'
      or p_delivery_lat not between -90 and 90
      or p_delivery_lng not between -180 and 180
    ) then
      return;
    end if;

    if v_has_delivery_input then
      insert into cardtrade.cash_sale_delivery_details (
        cash_sale_id, buyer_id, address_label, place_id, country_code,
        latitude, longitude, updated_at
      ) values (
        v_sale.id, v_sale.buyer_id, btrim(p_delivery_address_label),
        btrim(p_delivery_place_id), p_delivery_country_code,
        p_delivery_lat, p_delivery_lng, now()
      )
      on conflict (cash_sale_id) do update
      set buyer_id = excluded.buyer_id,
          address_label = excluded.address_label,
          place_id = excluded.place_id,
          country_code = excluded.country_code,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          updated_at = now();
    end if;

    update cardtrade.cash_sales
    set fulfillment_method = 'DELIVERY',
        shipping_cost_cents = p_shipping_cost_cents,
        shipping_notes = nullif(btrim(p_shipping_notes), ''),
        delivery_address_configured = case
          when v_has_delivery_input then true
          else v_sale.delivery_address_configured
        end,
        meeting_location = null,
        meeting_lat = null,
        meeting_lng = null,
        meeting_place_id = null,
        meeting_at = null,
        platform_fee_cents = v_fee,
        amount_cents = v_sale.agreed_price_cents + v_fee + p_shipping_cost_cents,
        updated_at = now()
    where id = v_sale.id
    returning * into v_updated;
  elsif p_fulfillment_method = 'IN_PERSON' then
    if p_shipping_cost_cents <> 0 or p_shipping_notes is not null
      or p_delivery_address_label is not null or p_delivery_place_id is not null
      or p_delivery_country_code is not null or p_delivery_lat is not null
      or p_delivery_lng is not null
      or p_meeting_location is null or p_meeting_place_id is null or p_meeting_at is null
      or char_length(btrim(p_meeting_location)) not between 1 and 500
      or char_length(btrim(p_meeting_place_id)) not between 1 and 255
      or p_meeting_place_id like 'text:%' or p_meeting_place_id like 'legacy:%'
      or p_meeting_lat is null or p_meeting_lng is null
      or p_meeting_lat not between -90 and 90 or p_meeting_lng not between -180 and 180
      or p_meeting_at <= now() then
      return;
    end if;

    delete from cardtrade.cash_sale_delivery_details where cash_sale_id = v_sale.id;

    update cardtrade.cash_sales
    set fulfillment_method = 'IN_PERSON',
        shipping_cost_cents = 0,
        shipping_notes = null,
        delivery_address_configured = false,
        meeting_location = btrim(p_meeting_location),
        meeting_lat = p_meeting_lat,
        meeting_lng = p_meeting_lng,
        meeting_place_id = btrim(p_meeting_place_id),
        meeting_at = p_meeting_at,
        platform_fee_cents = v_fee,
        amount_cents = v_sale.agreed_price_cents + v_fee,
        updated_at = now()
    where id = v_sale.id
    returning * into v_updated;
  else
    return;
  end if;

  return next v_updated;
end;
$$;

revoke all on function cardtrade.update_cash_sale_terms(
  uuid, uuid, integer, cardtrade.handover_method, bigint, text, text,
  double precision, double precision, text, timestamptz, text, text, text,
  double precision, double precision, bigint
) from public, anon, authenticated;
grant execute on function cardtrade.update_cash_sale_terms(
  uuid, uuid, integer, cardtrade.handover_method, bigint, text, text,
  double precision, double precision, text, timestamptz, text, text, text,
  double precision, double precision, bigint
) to service_role;
