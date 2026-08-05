-- supabase/seeds/demo_kitsunearia.sql
--
-- Demo fixtures for kitsunearia@gmail.com: one completed Cash_Sale with a Seller
-- release still owed, and one live Deal room.
--
-- WHY THIS SHAPE. The point is to exercise the operator and participant UI added
-- on 2026-08-03, so the Cash_Sale is deliberately left in the state that is hard
-- to see any other way: COMPLETED, Buyer debited, and the release to the Seller
-- FAILED. That is the row that means the platform is sitting on someone else's
-- money, and it is what the /admin "Seller releases owed" section exists for.
--
-- PROVIDER REFS ARE FAKE. Nothing here touches Stripe. `pi_demo_*` / `mch_demo_*`
-- are placeholders so the rows render, which means:
--   * "Retry release" WILL fail against the real API â€” that is honest behaviour
--     for a fake reference, and it exercises the error path.
--   * Do not use these fixtures to conclude anything about live payment behaviour.
--     scripts/smoke-stripe-test.ts is the tool for that.
--
-- Idempotent: re-running replaces the demo rows rather than duplicating them.
-- Safe to run repeatedly and safe to delete (see the teardown at the bottom).

do $$
declare
  v_phil uuid;
  -- Fixed sentinel id so re-running updates the same demo counterparty rather
  -- than creating a new one each time. Valid hex, obviously synthetic.
  v_mika uuid := '00000000-0000-4000-8000-00000000dead';
  v_item_phil uuid;
  v_item_mika uuid;
  v_sale uuid;
begin
  select id into v_phil from auth.users where email = 'kitsunearia@gmail.com';
  if v_phil is null then
    raise exception 'kitsunearia@gmail.com not found - sign up first, then re-run.';
  end if;

  -- ---------------------------------------------------------------------
  -- Counterparty. A fixed UUID so re-running updates rather than piling up.
  -- ---------------------------------------------------------------------
  insert into auth.users (id, email)
  values (v_mika, 'mika.demo@noditto.test')
  on conflict (id) do nothing;

  -- Verification is the Identity_Gate: merchant_status APPROVED with settlements
  -- enabled. The retired payer-gate columns (kyc_status, identity_verified_*) were
  -- dropped in migration 0043, so the seed sets the Connect columns only.
  --
  -- `merchant_legal_entity_name` and `merchant_identity_verified_at` matter: without
  -- them `sellerIdentityDisclosure` withholds a disclosure and the seller cannot
  -- agree a cash sale. `merchant_identity_disclosure_consented_at` is the consent
  -- record the disclosure is gated on.
  insert into cardtrade.profiles (
    id, display_name, contact_email,
    payer_id, payment_source_id,
    merchant_status, merchant_ref, merchant_settlements_enabled,
    merchant_legal_entity_name, merchant_identity_verified_at,
    merchant_identity_disclosure_consented_at, merchant_identity_version
  )
  values (
    v_mika, 'Mika Tanaka', 'mika.demo@noditto.test',
    'cus_demo_mika', 'pm_demo_mika',
    'APPROVED', 'mch_demo_mika', true,
    'Mika Tanaka', now() - interval '20 days',
    now() - interval '20 days', 'mch_demo_mika:seed'
  )
  on conflict (id) do update set
    display_name = excluded.display_name,
    merchant_status = excluded.merchant_status,
    merchant_ref = excluded.merchant_ref,
    merchant_settlements_enabled = excluded.merchant_settlements_enabled,
    merchant_legal_entity_name =
      coalesce(cardtrade.profiles.merchant_legal_entity_name, excluded.merchant_legal_entity_name),
    merchant_identity_verified_at =
      coalesce(cardtrade.profiles.merchant_identity_verified_at, excluded.merchant_identity_verified_at),
    merchant_identity_disclosure_consented_at =
      coalesce(cardtrade.profiles.merchant_identity_disclosure_consented_at, excluded.merchant_identity_disclosure_consented_at),
    merchant_identity_version =
      coalesce(cardtrade.profiles.merchant_identity_version, excluded.merchant_identity_version);

  -- Phil needs to be an admin to see the operator console at all, and needs a
  -- payee reference for the release to have somewhere to go.
  update cardtrade.profiles
  set is_admin = true,
      payer_id = coalesce(payer_id, 'cus_demo_phil'),
      payment_source_id = coalesce(payment_source_id, 'pm_demo_phil'),
      merchant_status = 'APPROVED',
      merchant_ref = coalesce(merchant_ref, 'mch_demo_phil'),
      merchant_settlements_enabled = true,
      merchant_legal_entity_name = coalesce(merchant_legal_entity_name, 'Phil Yang'),
      merchant_identity_verified_at =
        coalesce(merchant_identity_verified_at, now() - interval '10 days'),
      merchant_identity_disclosure_consented_at =
        coalesce(merchant_identity_disclosure_consented_at, now() - interval '10 days'),
      merchant_identity_version =
        coalesce(merchant_identity_version, 'mch_demo_phil:seed')
  where id = v_phil;

  -- ---------------------------------------------------------------------
  -- Items
  -- ---------------------------------------------------------------------
  delete from cardtrade.items where title in ('1999 Charizard Holo (PSA 8)', 'Blastoise Base Set Shadowless');

  insert into cardtrade.items (owner_id, title, description, category, condition, fmv_cents, image_paths, status)
  values (
    v_phil, '1999 Charizard Holo (PSA 8)',
    'Base Set Charizard, PSA 8. Strong centring, sharp corners. Sold and delivered.',
    'Trading Cards', 'NEAR_MINT', 240000, array['demo/charizard.jpg'], 'SOLD'
  ) returning id into v_item_phil;

  insert into cardtrade.items (owner_id, title, description, category, condition, fmv_cents, image_paths, status)
  values (
    v_mika, 'Blastoise Base Set Shadowless',
    'Shadowless Blastoise, raw. Light edge wear on the reverse.',
    'Trading Cards', 'GOOD', 90000, array['demo/blastoise.jpg'], 'AVAILABLE'
  ) returning id into v_item_mika;

  -- ---------------------------------------------------------------------
  -- Cash_Sale: Mika bought Phil's Charizard. COMPLETED, release to Phil FAILED.
  -- ---------------------------------------------------------------------
  delete from cardtrade.cash_sales where item_title = '1999 Charizard Holo (PSA 8)';

  insert into cardtrade.cash_sales (
    item_id, buyer_id, seller_id,
    agreed_price_cents, platform_fee_cents, amount_cents,
    status, item_title, item_description, item_condition, item_image_paths,
    fulfillment_method, shipping_cost_cents,
    delivery_address_configured, tracking_carrier, tracking_number, tracking_status,
    transfer_id, payment_nonce, payment_requested_at, payment_settled_at,
    shipped_at, received_at, carrier_delivered_at, inspection_accepted_at,
    completed_at,
    seller_identity_version, seller_legal_entity_name, seller_identity_verified_at,
    buyer_seller_identity_confirmed_at,
    buyer_terms_accepted_at, seller_terms_accepted_at,
    buyer_terms_accepted_version, seller_terms_accepted_version, terms_version,
    -- The interesting part: the Buyer paid, the Seller has not been paid.
    seller_payout_status, seller_payout_nonce, seller_payout_due_at,
    seller_payout_attempts, seller_payout_error
  )
  values (
    v_item_phil, v_mika, v_phil,
    -- amount = agreed + fee + shipping, enforced by cash_sales_amount_components.
    -- Seller nets amount - fee = 241200 (the price plus the shipping pass-through).
    240000, 12000, 253200,
    'COMPLETED', '1999 Charizard Holo (PSA 8)',
    'Base Set Charizard, PSA 8.', 'NEAR_MINT', array['demo/charizard.jpg'],
    'DELIVERY', 1200,
    true, 'AusPost', 'DEMO123456789', 'DELIVERED',
    'pi_demo_charizard_collection', 'demo-nonce-charizard',
    now() - interval '9 days', now() - interval '9 days',
    now() - interval '8 days', now() - interval '5 days',
    now() - interval '5 days', now() - interval '4 days',
    now() - interval '4 days',
    'phil-v1', 'Phil Yang', now() - interval '10 days',
    now() - interval '9 days',
    now() - interval '9 days', now() - interval '9 days',
    1, 1, 1,
    'FAILED', 'payout:demo-charizard', now() - interval '4 days',
    2, 'Provider rejected the seller payout'
  ) returning id into v_sale;

  insert into cardtrade.cash_sale_delivery_details (
    cash_sale_id, buyer_id, address_label, place_id
  ) values (
    v_sale, v_mika, '12 Example St, Melbourne VIC 3000', 'legacy:demo-kitsunearia'
  );

  insert into cardtrade.cash_sale_events (cash_sale_id, actor_id, event, from_status, to_status, detail)
  values
    (v_sale, v_mika, 'TERMS_ACCEPTED', 'AGREEMENT', 'PAYMENT_PENDING', 'Both parties accepted the terms.'),
    (v_sale, null, 'PAYMENT_CLEARED', 'PAYMENT_PENDING', 'ESCROW_HELD', 'Funds collected into the platform balance.'),
    (v_sale, v_phil, 'SHIPPED', 'ESCROW_HELD', 'IN_TRANSIT', 'AusPost DEMO123456789'),
    (v_sale, v_mika, 'RECEIVED', 'IN_TRANSIT', 'INSPECTION', 'Delivery confirmed by carrier.'),
    (v_sale, v_mika, 'INSPECTION_ACCEPTED', 'INSPECTION', 'COMPLETED', 'Buyer accepted the item.'),
    (v_sale, null, 'SELLER_PAYOUT_FAILED', 'COMPLETED', 'COMPLETED', 'Release to the seller was rejected by the provider.');

  raise notice 'Seeded cash sale % for %', v_sale, v_phil;
end
$$;

-- ---------------------------------------------------------------------------
-- Teardown, if you want the demo data gone:
--
--   (the private-deal fixture was removed with the deals feature itself)
--   delete from cardtrade.cash_sales where item_title = '1999 Charizard Holo (PSA 8)';
--   delete from cardtrade.items where title in
--     ('1999 Charizard Holo (PSA 8)', 'Blastoise Base Set Shadowless');
--   delete from auth.users where email = 'mika.demo@noditto.test';
--
-- Deleting the Mika auth user cascades her profile away. Phil's is_admin and
-- VERIFIED status are NOT reverted by the above - clear those by hand if needed.
-- ---------------------------------------------------------------------------
