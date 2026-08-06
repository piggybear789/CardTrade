-- CardTrade — seed_demo_kitsunearia.sql
--
-- Everything the demo account (kitsunearia1@gmail.com) needs to walk a room
-- through the product without touching a single form: finished contracts, live
-- contracts waiting on a click, a condition dispute, a fraud case with an
-- evidence pack, offers to answer, trade offers in the inbox, deal rooms,
-- chats with unread messages, notifications, saved items, and a reputation.
--
-- Run AFTER seed_marketplace.sql — the counterparties are the personas created
-- there.
--
-- Ordering rules that matter:
--   * conversations before the contracts that link to them, because inserting a
--     cash_sale_event / trade_state_transition mirrors a SYSTEM message into the
--     linked thread (0012 / 0016). Seeding events last means the chat timelines
--     build themselves.
--   * dispute threads come after their sale (they carry cash_sale_id).
--   * reviews about the demo user drive profiles.rating via
--     reviews_refresh_rating, so no rating is hand-set anywhere.
--
-- Ids are fixed (`5eed5…`-`5eedd…`) so this file is idempotent.

-- =============================================================================
-- 0. The demo account itself
-- =============================================================================
-- KYC moves to VERIFIED so every gated action (list, buy, trade, dispute) is
-- reachable during the demo, and the provider-approved merchant identity is
-- filled in so the seller-disclosure panel has something to show.

-- Verification is the Identity_Gate (merchant_status + settlements), set below.
-- The kyc_status / kyc_reason columns were dropped in migration 0043.
update cardtrade.profiles set
  payer_id = coalesce(payer_id, 'payer_demo_kitsunearia'),
  payment_token = coalesce(payment_token, 'tok_demo_kitsunearia'),
  payment_token_type = coalesce(payment_token_type, 'bank-account'),
  payment_method_label = coalesce(payment_method_label, 'BSB 062-000 acct ••••3391'),
  merchant_ref = coalesce(nullif(merchant_ref, ''), 'mch_demo_kitsunearia'),
  merchant_status = 'APPROVED',
  merchant_compliance_status = 'approved',
  merchant_live_enabled = true,
  merchant_transactions_enabled = true,
  merchant_settlements_enabled = true,
  merchant_submitted_at = coalesce(merchant_submitted_at, now() - interval '46 days'),
  merchant_decision_at = coalesce(merchant_decision_at, now() - interval '45 days'),
  merchant_legal_entity_name = coalesce(merchant_legal_entity_name, 'Aria Kitsune'),
  merchant_trading_name = coalesce(merchant_trading_name, 'Kitsune Slabs'),
  merchant_registration_number = coalesce(merchant_registration_number, '46782119004'),
  merchant_organisation_type = coalesce(merchant_organisation_type, 'sole_trader'),
  merchant_identity_version = coalesce(merchant_identity_version, 'demo-identity-kitsunearia-v1'),
  merchant_identity_disclosure_consented_at =
    coalesce(merchant_identity_disclosure_consented_at, now() - interval '46 days'),
  merchant_identity_verified_at =
    coalesce(merchant_identity_verified_at, now() - interval '45 days'),
  updated_at = now()
where id = '33187ec5-ba33-4ac0-806e-08f09244c517';

-- =============================================================================
-- 1. Items — the demo user's shelf, plus purpose-built trade counterparts
-- =============================================================================

insert into cardtrade.items (
  id, owner_id, title, description, category, condition, fmv_cents, status, hidden,
  image_paths, created_at, updated_at
)
select
  v.id::uuid, v.owner::uuid, v.title, v.descr, 'Trading Cards', v.cond, v.fmv,
  v.status::cardtrade.item_status, false,
  array[b.base || v.front, b.base || replace(v.front, 'front.jpg', 'back.jpg')],
  now() - (v.age_days || ' days')::interval,
  now() - ((v.age_days / 2) || ' days')::interval
from (values
  -- The demo user's own listings -------------------------------------------
  ('5eed5001-0000-4000-8000-000000000001','33187ec5-ba33-4ac0-806e-08f09244c517',
   $t$Charizard · 2006 Kimewaza Pokémon Kids 5 — PSA 9$t$,
   $d$2006 Kimewaza Pokémon Kids Charizard, PSA 9 Mint.

Odd little Japanese side-set that most people have never handled. Print is sharp, no roller lines, corners are clean. Centring is 55/45 which is about as good as this stock gets.

Sold and settled through the platform. Kept listed for provenance.$d$,
   'PSA 9', 78000, 'SOLD', '117189238483/front.jpg', 41),

  ('5eed5002-0000-4000-8000-000000000002','33187ec5-ba33-4ac0-806e-08f09244c517',
   $t$Dragonite · 2021 Evolving Skies Full Art — PSA 10$t$,
   $d$Evolving Skies Dragonite V Alt Art, PSA 10 Gem Mint.

The one everybody wants out of that set. Pulled from a booster box I opened myself, straight into a sleeve and a semi-rigid, submitted the same week. Texture is untouched, no silvering anywhere on the edges.

Currently under contract — payment is confirmed and I am packing it this week. Ships double boxed with signature on delivery.$d$,
   'PSA 10', 145000, 'RESERVED', '117250697361/front.jpg', 15),

  ('5eed5003-0000-4000-8000-000000000003','33187ec5-ba33-4ac0-806e-08f09244c517',
   $t$Eevee · 2021 Eevee Heroes Full Art (JPN) — PSA 9$t$,
   $d$Japanese Eevee Heroes Eevee V Full Art, PSA 9 Mint.

Clean slab, bright foil, no print defects. Centring is 60/40 top-to-bottom which is what kept it off a 10.

Note: the buyer has raised a condition dispute on this one and it is being worked through. Not available until that resolves.$d$,
   'PSA 9', 92000, 'RESERVED', '298423457396/front.jpg', 24),

  ('5eed5004-0000-4000-8000-000000000004','33187ec5-ba33-4ac0-806e-08f09244c517',
   $t$Mew · 2021 Celebrations — PSA 8$t$,
   $d$Celebrations Mew (25th Anniversary), PSA 8 NM-MT.

Entry-level slab of a card with real staying power. There is a tiny surface dimple below the artwork that you can only see under angled light — it is in the second photo and it is why this is an 8 and not a 9.

Open to sensible offers. Not open to $120 offers on a $240 card, and I will not go off-platform, so please do not ask.$d$,
   'PSA 8', 24000, 'AVAILABLE', '117231807849/front.jpg', 12),

  ('5eed5005-0000-4000-8000-000000000005','33187ec5-ba33-4ac0-806e-08f09244c517',
   $t$Charizard · 2002 Neo Destiny — PSA 8$t$,
   $d$Neo Destiny Charizard, PSA 8 NM-MT.

End-of-era WOTC Charizard and genuinely scarce compared to the Base Set copies everyone chases. Holo is unscratched, edges are clean, one soft top-right corner.

Happy to trade this against Japanese vintage or another high-grade Charizard, cash either way to balance it out. Send me an offer through the trade flow and I will look at anything reasonable.$d$,
   'PSA 8', 118000, 'AVAILABLE', 'v1_800156002201_0/front.jpg', 9),

  ('5eed5006-0000-4000-8000-000000000006','33187ec5-ba33-4ac0-806e-08f09244c517',
   $t$Mew · 2021 PCP 25th Anniversary (JPN) — PSA 10$t$,
   $d$Japanese Pokémon Center 25th Anniversary Mew promo, PSA 10.

Traded away in a 2-way collateral-backed swap against a Terastal Fest Umbreon. Both holds released the same day we accepted. Kept listed so the trade has a paper trail on both sides.$d$,
   'PSA 10', 162000, 'SOLD', 'v1_366470551557_0/front.jpg', 33),

  ('5eed5007-0000-4000-8000-000000000007','33187ec5-ba33-4ac0-806e-08f09244c517',
   $t$Dragonite · 1997 Fossil (JPN) — PSA 9$t$,
   $d$1997 Japanese Fossil Dragonite holo, PSA 9.

Japanese vintage in a 9 with strong back centring, which is the hard part on these. Holo is bright with no scratching under a loupe.

In transit as part of an active 2-way trade — collateral is locked on both sides.$d$,
   'PSA 9', 66000, 'RESERVED', '307004561950/front.jpg', 20),

  ('5eed5008-0000-4000-8000-000000000008','33187ec5-ba33-4ac0-806e-08f09244c517',
   $t$Mew · 2023 151 Ultra Premium Collection — PSA 10$t$,
   $d$151 UPC Mew special illustration, PSA 10 Gem Mint.

Shipped in a 2-way trade that the other party never honoured — an empty case came back. The collateral hold covered the full value and the platform generated the evidence pack from their identity data.

Left listed as part of the fraud record.$d$,
   'PSA 10', 225000, 'SOLD', 'v1_377269467368_0/front.jpg', 18),

  ('5eed5009-0000-4000-8000-000000000009','33187ec5-ba33-4ac0-806e-08f09244c517',
   $t$Snorlax · 1998 Vending Series 1 (JPN) — PSA 10$t$,
   $d$1998 Japanese Vending Series 1 Snorlax, PSA 10.

Vending sheet singles almost never grade a 10 because of how they were cut and folded. This one is immaculate: perfect edges, no fold impression, glossy surface.

Received and under inspection as part of an active trade.$d$,
   'PSA 10', 54000, 'RESERVED', '307004157046/front.jpg', 16),

  ('5eed500a-0000-4000-8000-00000000000a','33187ec5-ba33-4ac0-806e-08f09244c517',
   $t$Alakazam · 2002 Expedition — PSA 7$t$,
   $d$Expedition Alakazam holo, PSA 7.

Expedition holos are notorious for surface scratching and this one is better than most, with light edge wear along the bottom border.

Sold through a private deal room with collateral on both sides — the buyer and I negotiated it directly and the platform held the money.$d$,
   'PSA 7', 19500, 'SOLD', 'v1_377264661382_0/front.jpg', 29),

  ('5eed500b-0000-4000-8000-00000000000b','33187ec5-ba33-4ac0-806e-08f09244c517',
   $t$Pikachu · 2016 Evolutions — CGC 9$t$,
   $d$Evolutions Pikachu #35/108, CGC 9 Mint.

Cheap, clean, and a good first slab for someone. No scratches, sharp corners, centring 55/45.

Committed to a 2-way trade — collateral is locked, waiting on both sides to ship.$d$,
   'CGC 9', 15900, 'RESERVED', 'v1_403629858891_0/front.jpg', 26),

  ('5eed500c-0000-4000-8000-00000000000c','33187ec5-ba33-4ac0-806e-08f09244c517',
   $t$Pikachu · 2025 Special Box Pokémon Center (JPN) — PSA 9$t$,
   $d$Japanese Pokémon Center special box Pikachu promo, PSA 9.

Clean modern promo. Currently tied up in a condition dispute on a trade — the card I received back is not what was listed, so the friction tax has been applied while we sort out the return.$d$,
   'PSA 9', 31000, 'RESERVED', '306997408050/front.jpg', 21),

  -- Counterparties' items, sized to make each trade read sensibly ----------
  ('5eed5202-0000-4000-8000-000000000202','5eed0001-0000-4000-8000-000000000001',
   $t$Pikachu · 2015 XY Promo (JPN) — PSA 10$t$,
   $d$Japanese XY-era Pikachu promo, PSA 10 Gem Mint. Small card, perfect slab: sharp corners, no edge silvering, centred label.

Committed to a 2-way trade with collateral locked on both sides.$d$,
   'PSA 10', 14500, 'RESERVED', '298420164592/front.jpg', 27),

  ('5eed5203-0000-4000-8000-000000000203','5eed0006-0000-4000-8000-000000000006',
   $t$Vaporeon · 2000 Team Rocket 1st Edition — PSA 8$t$,
   $d$1st Edition Team Rocket Vaporeon, PSA 8 NM-MT. Crisp 1st Edition stamp, clean holo, minor edge whitening on the reverse.

In transit as part of an active 2-way trade.$d$,
   'PSA 8', 62000, 'RESERVED', 'v1_377264759882_0/front.jpg', 20),

  ('5eed5204-0000-4000-8000-000000000204','5eed0003-0000-4000-8000-000000000003',
   $t$Mew · 2001 CoroCoro Comics Promo (JPN) — PSA 9$t$,
   $d$2001 Japanese CoroCoro Comics Mew promo, PSA 9. Mail-away promo, scarce in high grade, holo fully intact.

Received by the other party and under inspection as part of an active trade.$d$,
   'PSA 9', 56000, 'RESERVED', 'v1_377251451647_0/front.jpg', 16),

  ('5eed5208-0000-4000-8000-000000000208','5eed0003-0000-4000-8000-000000000003',
   $t$Pikachu · 1999 Jungle — PSA 6$t$,
   $d$Jungle Pikachu, PSA 6 EX-MT. Honest wear on the corners and a light surface line, priced for it.

Tied up in a condition dispute on a trade.$d$,
   'PSA 6', 29000, 'RESERVED', '117247444878/front.jpg', 21),

  ('5eed5206-0000-4000-8000-000000000206','5eed0007-0000-4000-8000-000000000007',
   $t$Pikachu · 2025 McDonalds Promo (JPN) — PSA 10$t$,
   $d$2025 Japanese McDonald's promo Pikachu, PSA 10. Straight from the promo pack into a semi-rigid, never sleeved by anyone else.

Offered as part of a trade proposal (plus cash) — still available if that falls through.$d$,
   'PSA 10', 9500, 'AVAILABLE', '306993372610/front.jpg', 6),

  ('5eed5207-0000-4000-8000-000000000207','5eed000b-0000-4000-8000-00000000000b',
   $t$Vaporeon · 2016 XY Generations — PSA 6$t$,
   $d$XY Generations Vaporeon, PSA 6. Modern card with a 6 grade, which tells you it had a rough life before it got slabbed: rounded corners and a visible surface scuff.

Cheap way into a nice piece of art. Offered in a trade proposal.$d$,
   'PSA 6', 8900, 'AVAILABLE', '307004271831/front.jpg', 5)
) as v(id, owner, title, descr, cond, fmv, status, front, age_days)
cross join (select 'https://emojqulpbiyqoyggespp.supabase.co/storage/v1/object/public/card-images/' as base) b
on conflict (id) do nothing;

-- Two catalogue items move state because a demo contract now depends on them.
update cardtrade.items set status = 'RESERVED'
where id in ('5eed100f-0000-4000-8000-00000000000f'::uuid)  -- Tom's BGS 5 Dragonite: terms being agreed
  and status = 'AVAILABLE';

-- =============================================================================
-- 2. Conversations (item threads) — created first so contracts can link to them
-- =============================================================================
-- participant_a < participant_b is enforced by a check constraint; the demo
-- user's uuid sorts before every seeded persona, so it is always participant_a.

insert into cardtrade.conversations (id, item_id, participant_a, participant_b, last_message_at, created_at)
values
  ('5eed7001-0000-4000-8000-000000000001','5eed1001-0000-4000-8000-000000000001','33187ec5-ba33-4ac0-806e-08f09244c517','5eed0001-0000-4000-8000-000000000001', now() - interval '26 days', now() - interval '32 days'),
  ('5eed7002-0000-4000-8000-000000000002','5eed100e-0000-4000-8000-00000000000e','33187ec5-ba33-4ac0-806e-08f09244c517','5eed0002-0000-4000-8000-000000000002', now() - interval '4 hours', now() - interval '10 days'),
  ('5eed7003-0000-4000-8000-000000000003','5eed1010-0000-4000-8000-000000000010','33187ec5-ba33-4ac0-806e-08f09244c517','5eed000b-0000-4000-8000-00000000000b', now() - interval '5 days', now() - interval '8 days'),
  ('5eed7004-0000-4000-8000-000000000004','5eed1005-0000-4000-8000-000000000005','33187ec5-ba33-4ac0-806e-08f09244c517','5eed0005-0000-4000-8000-000000000005', now() - interval '9 days', now() - interval '15 days'),
  ('5eed7005-0000-4000-8000-000000000005','5eed100b-0000-4000-8000-00000000000b','33187ec5-ba33-4ac0-806e-08f09244c517','5eed000a-0000-4000-8000-00000000000a', now() - interval '4 days', now() - interval '19 days'),
  ('5eed7006-0000-4000-8000-000000000006','5eed100f-0000-4000-8000-00000000000f','33187ec5-ba33-4ac0-806e-08f09244c517','5eed0003-0000-4000-8000-000000000003', now() - interval '20 hours', now() - interval '3 days'),
  ('5eed7007-0000-4000-8000-000000000007','5eed100c-0000-4000-8000-00000000000c','33187ec5-ba33-4ac0-806e-08f09244c517','5eed000b-0000-4000-8000-00000000000b', now() - interval '13 days', now() - interval '36 days'),
  ('5eed7102-0000-4000-8000-000000000102','5eed5002-0000-4000-8000-000000000002','33187ec5-ba33-4ac0-806e-08f09244c517','5eed0100-0000-4000-8000-000000000100', now() - interval '2 days', now() - interval '5 days'),
  ('5eed7103-0000-4000-8000-000000000103','5eed5003-0000-4000-8000-000000000003','33187ec5-ba33-4ac0-806e-08f09244c517','5eed0101-0000-4000-8000-000000000101', now() - interval '6 days', now() - interval '22 days'),
  ('5eed7104-0000-4000-8000-000000000104','361fa082-c1f9-4da3-b281-963677ff8c81','33187ec5-ba33-4ac0-806e-08f09244c517','5eed0102-0000-4000-8000-000000000102', now() - interval '2 hours', now() - interval '4 days'),
  ('5eed7105-0000-4000-8000-000000000105','5eed5004-0000-4000-8000-000000000004','33187ec5-ba33-4ac0-806e-08f09244c517','5eed0104-0000-4000-8000-000000000104', now() - interval '3 hours', now() - interval '1 day'),
  ('5eed7106-0000-4000-8000-000000000106','5eed5005-0000-4000-8000-000000000005','33187ec5-ba33-4ac0-806e-08f09244c517','5eed0103-0000-4000-8000-000000000103', now() - interval '2 days', now() - interval '7 days')
on conflict (id) do nothing;

-- =============================================================================
-- 3. Cash sales where the demo user is the BUYER (/purchases)
-- =============================================================================

-- 3.1 COMPLETED — the happy path, start to finish.
insert into cardtrade.cash_sales (
  id, item_id, buyer_id, seller_id, agreed_price_cents, platform_fee_cents,
  shipping_cost_cents, amount_cents, status, version, conversation_id,
  transfer_id, payment_nonce, payment_requested_at, payment_settled_at,
  item_title, item_description, item_condition, item_image_paths,
  fulfillment_method, delivery_address_configured, shipping_notes,
  terms_version, terms_updated_at,
  buyer_terms_accepted_version, seller_terms_accepted_version,
  buyer_terms_accepted_at, seller_terms_accepted_at,
  tracking_carrier, tracking_number, tracking_url, tracking_status,
  shipped_at, carrier_delivered_at, received_at, inspection_deadline_at,
  inspection_accepted_at, completed_at,
  seller_identity_version, seller_legal_entity_name, seller_trading_name,
  seller_registration_number, seller_organisation_type, seller_identity_verified_at,
  buyer_seller_identity_confirmed_at, created_at, updated_at
)
select
  '5eed6001-0000-4000-8000-000000000001', i.id, '33187ec5-ba33-4ac0-806e-08f09244c517', i.owner_id,
  245000, 12250, 1500, 258750, 'COMPLETED', 7, '5eed7001-0000-4000-8000-000000000001',
  'tr_demo_6001', 'nonce_demo_6001', now() - interval '31 days', now() - interval '30 days',
  i.title, i.description, i.condition, i.image_paths,
  'DELIVERY', true, 'Signature on delivery, insured for full value.',
  1, now() - interval '32 days', 1, 1, now() - interval '31 days', now() - interval '31 days',
  'Australia Post', 'AP7739142200XZ', 'https://auspost.com.au/mypost/track/#/details/AP7739142200XZ', 'Delivered',
  now() - interval '29 days', now() - interval '27 days', now() - interval '27 days', now() - interval '24 days',
  now() - interval '26 days', now() - interval '26 days',
  s.merchant_identity_version, s.merchant_legal_entity_name, s.merchant_trading_name,
  s.merchant_registration_number, s.merchant_organisation_type, s.merchant_identity_verified_at,
  now() - interval '31 days', now() - interval '32 days', now() - interval '26 days'
from cardtrade.items i join cardtrade.profiles s on s.id = i.owner_id
where i.id = '5eed1001-0000-4000-8000-000000000001'
on conflict (id) do nothing;

-- 3.2 INSPECTION — arrived, clock ticking, needs the demo user to accept.
insert into cardtrade.cash_sales (
  id, item_id, buyer_id, seller_id, agreed_price_cents, platform_fee_cents,
  shipping_cost_cents, amount_cents, status, version, conversation_id,
  transfer_id, payment_nonce, payment_requested_at, payment_settled_at,
  item_title, item_description, item_condition, item_image_paths,
  fulfillment_method, delivery_address_configured,
  terms_version, terms_updated_at,
  buyer_terms_accepted_version, seller_terms_accepted_version,
  buyer_terms_accepted_at, seller_terms_accepted_at,
  tracking_carrier, tracking_number, tracking_url, tracking_status,
  shipped_at, carrier_delivered_at, received_at, inspection_deadline_at,
  seller_identity_version, seller_legal_entity_name, seller_trading_name,
  seller_registration_number, seller_organisation_type, seller_identity_verified_at,
  buyer_seller_identity_confirmed_at, created_at, updated_at
)
select
  '5eed6002-0000-4000-8000-000000000002', i.id, '33187ec5-ba33-4ac0-806e-08f09244c517', i.owner_id,
  47000, 2350, 1500, 50850, 'INSPECTION', 6, '5eed7002-0000-4000-8000-000000000002',
  'tr_demo_6002', 'nonce_demo_6002', now() - interval '10 days', now() - interval '9 days',
  i.title, i.description, i.condition, i.image_paths,
  'DELIVERY', true,
  1, now() - interval '10 days', 1, 1, now() - interval '10 days', now() - interval '10 days',
  'Australia Post', 'AP8812470039QQ', 'https://auspost.com.au/mypost/track/#/details/AP8812470039QQ', 'Delivered',
  now() - interval '8 days', now() - interval '2 days', now() - interval '2 days', now() + interval '5 days',
  s.merchant_identity_version, s.merchant_legal_entity_name, s.merchant_trading_name,
  s.merchant_registration_number, s.merchant_organisation_type, s.merchant_identity_verified_at,
  now() - interval '10 days', now() - interval '10 days', now() - interval '2 days'
from cardtrade.items i join cardtrade.profiles s on s.id = i.owner_id
where i.id = '5eed100e-0000-4000-8000-00000000000e'
on conflict (id) do nothing;

-- 3.3 IN_TRANSIT — paid, shipped, tracking moving.
insert into cardtrade.cash_sales (
  id, item_id, buyer_id, seller_id, agreed_price_cents, platform_fee_cents,
  shipping_cost_cents, amount_cents, status, version, conversation_id,
  transfer_id, payment_nonce, payment_requested_at, payment_settled_at,
  item_title, item_description, item_condition, item_image_paths,
  fulfillment_method, delivery_address_configured,
  terms_version, terms_updated_at,
  buyer_terms_accepted_version, seller_terms_accepted_version,
  buyer_terms_accepted_at, seller_terms_accepted_at,
  tracking_carrier, tracking_number, tracking_url, tracking_status, shipped_at,
  seller_identity_version, seller_legal_entity_name, seller_trading_name,
  seller_registration_number, seller_organisation_type, seller_identity_verified_at,
  buyer_seller_identity_confirmed_at, created_at, updated_at
)
select
  '5eed6003-0000-4000-8000-000000000003', i.id, '33187ec5-ba33-4ac0-806e-08f09244c517', i.owner_id,
  21000, 1050, 1200, 23250, 'IN_TRANSIT', 5, '5eed7003-0000-4000-8000-000000000003',
  'tr_demo_6003', 'nonce_demo_6003', now() - interval '7 days', now() - interval '6 days',
  i.title, i.description, i.condition, i.image_paths,
  'DELIVERY', true,
  1, now() - interval '7 days', 1, 1, now() - interval '7 days', now() - interval '7 days',
  'Australia Post', 'AP4410028873RB', 'https://auspost.com.au/mypost/track/#/details/AP4410028873RB',
  'In transit — departed Perth facility', now() - interval '5 days',
  s.merchant_identity_version, s.merchant_legal_entity_name, s.merchant_trading_name,
  s.merchant_registration_number, s.merchant_organisation_type, s.merchant_identity_verified_at,
  now() - interval '7 days', now() - interval '7 days', now() - interval '5 days'
from cardtrade.items i join cardtrade.profiles s on s.id = i.owner_id
where i.id = '5eed1010-0000-4000-8000-000000000010'
on conflict (id) do nothing;

-- 3.4 DISPUTED — the slab arrived cracked and the cert does not match.
insert into cardtrade.cash_sales (
  id, item_id, buyer_id, seller_id, agreed_price_cents, platform_fee_cents,
  shipping_cost_cents, amount_cents, status, version, conversation_id,
  transfer_id, payment_nonce, payment_requested_at, payment_settled_at,
  item_title, item_description, item_condition, item_image_paths,
  fulfillment_method, delivery_address_configured,
  terms_version, terms_updated_at,
  buyer_terms_accepted_version, seller_terms_accepted_version,
  buyer_terms_accepted_at, seller_terms_accepted_at,
  tracking_carrier, tracking_number, tracking_status,
  shipped_at, carrier_delivered_at, received_at, inspection_deadline_at,
  disputed_at, disputed_by, dispute_reason,
  seller_identity_version, seller_legal_entity_name, seller_trading_name,
  seller_registration_number, seller_organisation_type, seller_identity_verified_at,
  buyer_seller_identity_confirmed_at, created_at, updated_at
)
select
  '5eed6004-0000-4000-8000-000000000004', i.id, '33187ec5-ba33-4ac0-806e-08f09244c517', i.owner_id,
  42000, 2100, 1500, 45600, 'DISPUTED', 8, '5eed7004-0000-4000-8000-000000000004',
  'tr_demo_6004', 'nonce_demo_6004', now() - interval '15 days', now() - interval '14 days',
  i.title, i.description, i.condition, i.image_paths,
  'DELIVERY', true,
  1, now() - interval '15 days', 1, 1, now() - interval '15 days', now() - interval '15 days',
  'Sendle', 'SNDL66301992', 'Delivered',
  now() - interval '13 days', now() - interval '10 days', now() - interval '10 days', now() - interval '7 days',
  now() - interval '9 days', '33187ec5-ba33-4ac0-806e-08f09244c517',
  E'The slab arrived with a crack running along the top seam and the cert number on the label does not match the number in the listing photos. I photographed the parcel before opening it — the box is undamaged, so this did not happen in transit.\nSeller told me to "just crack it and press it, it will grade fine". I want the full refund, not a re-grade.',
  s.merchant_identity_version, s.merchant_legal_entity_name, s.merchant_trading_name,
  s.merchant_registration_number, s.merchant_organisation_type, s.merchant_identity_verified_at,
  now() - interval '15 days', now() - interval '15 days', now() - interval '9 days'
from cardtrade.items i join cardtrade.profiles s on s.id = i.owner_id
where i.id = '5eed1005-0000-4000-8000-000000000005'
on conflict (id) do nothing;

-- 3.5 CANCELLED — the seller never shipped and cancelled on day fourteen.
insert into cardtrade.cash_sales (
  id, item_id, buyer_id, seller_id, agreed_price_cents, platform_fee_cents,
  shipping_cost_cents, amount_cents, status, version, conversation_id,
  payment_requested_at, item_title, item_description, item_condition, item_image_paths,
  fulfillment_method, delivery_address_configured,
  terms_version, terms_updated_at,
  buyer_terms_accepted_version, seller_terms_accepted_version,
  buyer_terms_accepted_at, seller_terms_accepted_at,
  cancelled_at, cancelled_by, cancel_reason, created_at, updated_at
)
select
  '5eed6005-0000-4000-8000-000000000005', i.id, '33187ec5-ba33-4ac0-806e-08f09244c517', i.owner_id,
  12500, 625, 1500, 14625, 'CANCELLED', 4, '5eed7005-0000-4000-8000-000000000005',
  now() - interval '18 days', i.title, i.description, i.condition, i.image_paths,
  'DELIVERY', true,
  1, now() - interval '19 days', 1, 1, now() - interval '18 days', now() - interval '18 days',
  now() - interval '4 days', i.owner_id,
  'Seller cancelled after 14 days without shipping. No tracking was ever provided and messages went unanswered from day three. Payment was never released, so the buyer was not out of pocket.',
  now() - interval '19 days', now() - interval '4 days'
from cardtrade.items i
where i.id = '5eed100b-0000-4000-8000-00000000000b'
on conflict (id) do nothing;

-- 3.6 REFUNDED — packed and posted properly, then the courier lost it.
insert into cardtrade.cash_sales (
  id, item_id, buyer_id, seller_id, agreed_price_cents, platform_fee_cents,
  shipping_cost_cents, amount_cents, status, version, conversation_id,
  transfer_id, payment_nonce, payment_requested_at, payment_settled_at,
  item_title, item_description, item_condition, item_image_paths,
  fulfillment_method, delivery_address_configured,
  terms_version, terms_updated_at,
  buyer_terms_accepted_version, seller_terms_accepted_version,
  buyer_terms_accepted_at, seller_terms_accepted_at,
  tracking_carrier, tracking_number, tracking_status, shipped_at,
  seller_identity_version, seller_legal_entity_name, seller_trading_name,
  seller_registration_number, seller_organisation_type, seller_identity_verified_at,
  buyer_seller_identity_confirmed_at, created_at, updated_at
)
select
  '5eed6006-0000-4000-8000-000000000006', i.id, '33187ec5-ba33-4ac0-806e-08f09244c517', i.owner_id,
  26000, 1300, 1500, 28800, 'REFUNDED', 7, '5eed7007-0000-4000-8000-000000000007',
  'tr_demo_6006', 'nonce_demo_6006', now() - interval '35 days', now() - interval '34 days',
  i.title, i.description, i.condition, i.image_paths,
  'DELIVERY', true,
  1, now() - interval '36 days', 1, 1, now() - interval '35 days', now() - interval '35 days',
  'Australia Post', 'AP1180934472KL', 'Investigation closed — parcel declared lost', now() - interval '33 days',
  s.merchant_identity_version, s.merchant_legal_entity_name, s.merchant_trading_name,
  s.merchant_registration_number, s.merchant_organisation_type, s.merchant_identity_verified_at,
  now() - interval '35 days', now() - interval '36 days', now() - interval '13 days'
from cardtrade.items i join cardtrade.profiles s on s.id = i.owner_id
where i.id = '5eed100c-0000-4000-8000-00000000000c'
on conflict (id) do nothing;

-- 3.7 AGREEMENT — terms were renegotiated, so the demo user must re-accept.
insert into cardtrade.cash_sales (
  id, item_id, buyer_id, seller_id, agreed_price_cents, platform_fee_cents,
  shipping_cost_cents, amount_cents, status, version, conversation_id,
  item_title, item_description, item_condition, item_image_paths,
  fulfillment_method, meeting_location, meeting_at,
  terms_version, terms_updated_at,
  buyer_terms_accepted_version, seller_terms_accepted_version,
  buyer_terms_accepted_at, seller_terms_accepted_at,
  seller_identity_version, seller_legal_entity_name, seller_trading_name,
  seller_registration_number, seller_organisation_type, seller_identity_verified_at,
  created_at, updated_at
)
select
  '5eed6007-0000-4000-8000-000000000007', i.id, '33187ec5-ba33-4ac0-806e-08f09244c517', i.owner_id,
  34000, 1700, 0, 35700, 'AGREEMENT', 3, '5eed7006-0000-4000-8000-000000000006',
  i.title, i.description, i.condition, i.image_paths,
  'IN_PERSON', 'Novotel lobby, Sydney Olympic Park — weekday evening', now() + interval '3 days',
  2, now() - interval '20 hours', 1, 2, now() - interval '2 days', now() - interval '20 hours',
  s.merchant_identity_version, s.merchant_legal_entity_name, s.merchant_trading_name,
  s.merchant_registration_number, s.merchant_organisation_type, s.merchant_identity_verified_at,
  now() - interval '3 days', now() - interval '20 hours'
from cardtrade.items i join cardtrade.profiles s on s.id = i.owner_id
where i.id = '5eed100f-0000-4000-8000-00000000000f'
on conflict (id) do nothing;

-- =============================================================================
-- 4. Cash sales where the demo user is the SELLER (/sales)
-- =============================================================================

-- 4.1 COMPLETED — settled and reviewed.
insert into cardtrade.cash_sales (
  id, item_id, buyer_id, seller_id, agreed_price_cents, platform_fee_cents,
  shipping_cost_cents, amount_cents, status, version,
  transfer_id, payment_nonce, payment_requested_at, payment_settled_at,
  item_title, item_description, item_condition, item_image_paths,
  fulfillment_method, delivery_address_configured,
  terms_version, terms_updated_at,
  buyer_terms_accepted_version, seller_terms_accepted_version,
  buyer_terms_accepted_at, seller_terms_accepted_at,
  tracking_carrier, tracking_number, tracking_status,
  shipped_at, carrier_delivered_at, received_at, inspection_deadline_at,
  inspection_accepted_at, completed_at,
  seller_identity_version, seller_legal_entity_name, seller_trading_name,
  seller_registration_number, seller_organisation_type, seller_identity_verified_at,
  buyer_seller_identity_confirmed_at, created_at, updated_at
)
select
  '5eed6101-0000-4000-8000-000000000101', i.id, '5eed0007-0000-4000-8000-000000000007', i.owner_id,
  78000, 3900, 1500, 83400, 'COMPLETED', 7,
  'tr_demo_6101', 'nonce_demo_6101', now() - interval '41 days', now() - interval '41 days',
  i.title, i.description, i.condition, i.image_paths,
  'DELIVERY', true,
  1, now() - interval '41 days', 1, 1, now() - interval '41 days', now() - interval '41 days',
  'Australia Post', 'AP9902114466TT', 'Delivered',
  now() - interval '40 days', now() - interval '39 days', now() - interval '39 days', now() - interval '36 days',
  now() - interval '38 days', now() - interval '38 days',
  s.merchant_identity_version, s.merchant_legal_entity_name, s.merchant_trading_name,
  s.merchant_registration_number, s.merchant_organisation_type, s.merchant_identity_verified_at,
  now() - interval '41 days', now() - interval '41 days', now() - interval '38 days'
from cardtrade.items i join cardtrade.profiles s on s.id = i.owner_id
where i.id = '5eed5001-0000-4000-8000-000000000001'
on conflict (id) do nothing;

-- 4.2 ESCROW_HELD — money is held, the demo user needs to ship.
insert into cardtrade.cash_sales (
  id, item_id, buyer_id, seller_id, agreed_price_cents, platform_fee_cents,
  shipping_cost_cents, amount_cents, status, version, conversation_id,
  transfer_id, payment_nonce, payment_requested_at, payment_settled_at,
  item_title, item_description, item_condition, item_image_paths,
  fulfillment_method, delivery_address_configured, shipping_notes,
  terms_version, terms_updated_at,
  buyer_terms_accepted_version, seller_terms_accepted_version,
  buyer_terms_accepted_at, seller_terms_accepted_at,
  seller_identity_version, seller_legal_entity_name, seller_trading_name,
  seller_registration_number, seller_organisation_type, seller_identity_verified_at,
  buyer_seller_identity_confirmed_at, created_at, updated_at
)
select
  '5eed6102-0000-4000-8000-000000000102', i.id, '5eed0100-0000-4000-8000-000000000100', i.owner_id,
  145000, 7250, 2500, 154750, 'ESCROW_HELD', 5, '5eed7102-0000-4000-8000-000000000102',
  'tr_demo_6102', 'nonce_demo_6102', now() - interval '4 days', now() - interval '3 days',
  i.title, i.description, i.condition, i.image_paths,
  'DELIVERY', true,
  'Express post, signature on delivery, insured. Buyer asked for double boxing.',
  1, now() - interval '4 days', 1, 1, now() - interval '4 days', now() - interval '4 days',
  s.merchant_identity_version, s.merchant_legal_entity_name, s.merchant_trading_name,
  s.merchant_registration_number, s.merchant_organisation_type, s.merchant_identity_verified_at,
  now() - interval '4 days', now() - interval '5 days', now() - interval '3 days'
from cardtrade.items i join cardtrade.profiles s on s.id = i.owner_id
where i.id = '5eed5002-0000-4000-8000-000000000002'
on conflict (id) do nothing;

-- 4.3 DISPUTED — the demo user on the receiving end of a condition complaint.
insert into cardtrade.cash_sales (
  id, item_id, buyer_id, seller_id, agreed_price_cents, platform_fee_cents,
  shipping_cost_cents, amount_cents, status, version, conversation_id,
  transfer_id, payment_nonce, payment_requested_at, payment_settled_at,
  item_title, item_description, item_condition, item_image_paths,
  fulfillment_method, delivery_address_configured,
  terms_version, terms_updated_at,
  buyer_terms_accepted_version, seller_terms_accepted_version,
  buyer_terms_accepted_at, seller_terms_accepted_at,
  tracking_carrier, tracking_number, tracking_status,
  shipped_at, carrier_delivered_at, received_at, inspection_deadline_at,
  disputed_at, disputed_by, dispute_reason,
  seller_identity_version, seller_legal_entity_name, seller_trading_name,
  seller_registration_number, seller_organisation_type, seller_identity_verified_at,
  buyer_seller_identity_confirmed_at, created_at, updated_at
)
select
  '5eed6103-0000-4000-8000-000000000103', i.id, '5eed0101-0000-4000-8000-000000000101', i.owner_id,
  92000, 4600, 1500, 98100, 'DISPUTED', 8, '5eed7103-0000-4000-8000-000000000103',
  'tr_demo_6103', 'nonce_demo_6103', now() - interval '21 days', now() - interval '21 days',
  i.title, i.description, i.condition, i.image_paths,
  'DELIVERY', true,
  1, now() - interval '22 days', 1, 1, now() - interval '21 days', now() - interval '21 days',
  'Australia Post', 'AP5567110284MM', 'Delivered',
  now() - interval '20 days', now() - interval '18 days', now() - interval '18 days', now() - interval '15 days',
  now() - interval '6 days', '5eed0101-0000-4000-8000-000000000101',
  E'There is a hairline scratch across the case over the artwork that I cannot see in any of the listing photos. The card underneath looks fine, so this is a slab condition issue rather than a grading one.\nI am not claiming it was deliberate — it may have happened in transit — but I would like a partial resolution rather than eating it.',
  s.merchant_identity_version, s.merchant_legal_entity_name, s.merchant_trading_name,
  s.merchant_registration_number, s.merchant_organisation_type, s.merchant_identity_verified_at,
  now() - interval '21 days', now() - interval '22 days', now() - interval '6 days'
from cardtrade.items i join cardtrade.profiles s on s.id = i.owner_id
where i.id = '5eed5003-0000-4000-8000-000000000003'
on conflict (id) do nothing;

-- 4.4 HANDOVER — in-person meet, buyer has confirmed, demo user has not.
insert into cardtrade.cash_sales (
  id, item_id, buyer_id, seller_id, agreed_price_cents, platform_fee_cents,
  shipping_cost_cents, amount_cents, status, version, conversation_id,
  transfer_id, payment_nonce, payment_requested_at, payment_settled_at,
  item_title, item_description, item_condition, item_image_paths,
  fulfillment_method, meeting_location, meeting_at,
  terms_version, terms_updated_at,
  buyer_terms_accepted_version, seller_terms_accepted_version,
  buyer_terms_accepted_at, seller_terms_accepted_at,
  buyer_handover_confirmed_at,
  seller_identity_version, seller_legal_entity_name, seller_trading_name,
  seller_registration_number, seller_organisation_type, seller_identity_verified_at,
  buyer_seller_identity_confirmed_at, created_at, updated_at
)
select
  '5eed6104-0000-4000-8000-000000000104', i.id, '5eed0102-0000-4000-8000-000000000102', i.owner_id,
  18000, 900, 0, 18900, 'HANDOVER', 6, '5eed7104-0000-4000-8000-000000000104',
  'tr_demo_6104', 'nonce_demo_6104', now() - interval '4 days', now() - interval '3 days',
  i.title, i.description, i.condition, i.image_paths,
  'IN_PERSON', 'Central Station, Grand Concourse — under the clocks, Saturday 11am', now() - interval '3 hours',
  1, now() - interval '4 days', 1, 1, now() - interval '4 days', now() - interval '4 days',
  now() - interval '2 hours',
  s.merchant_identity_version, s.merchant_legal_entity_name, s.merchant_trading_name,
  s.merchant_registration_number, s.merchant_organisation_type, s.merchant_identity_verified_at,
  now() - interval '4 days', now() - interval '4 days', now() - interval '2 hours'
from cardtrade.items i join cardtrade.profiles s on s.id = i.owner_id
where i.id = '361fa082-c1f9-4da3-b281-963677ff8c81'
on conflict (id) do nothing;

-- 4.5 CANCELLED — buyer changed their mind before paying.
insert into cardtrade.cash_sales (
  id, item_id, buyer_id, seller_id, agreed_price_cents, platform_fee_cents,
  shipping_cost_cents, amount_cents, status, version, conversation_id,
  item_title, item_description, item_condition, item_image_paths,
  fulfillment_method, terms_version, terms_updated_at,
  buyer_terms_accepted_version, seller_terms_accepted_version,
  buyer_terms_accepted_at, seller_terms_accepted_at,
  cancelled_at, cancelled_by, cancel_reason, created_at, updated_at
)
select
  '5eed6105-0000-4000-8000-000000000105', i.id, '5eed0103-0000-4000-8000-000000000103', i.owner_id,
  24000, 1200, 1500, 26700, 'CANCELLED', 3, '5eed7106-0000-4000-8000-000000000106',
  i.title, i.description, i.condition, i.image_paths,
  'DELIVERY', 1, now() - interval '7 days', 1, 1, now() - interval '7 days', now() - interval '7 days',
  now() - interval '2 days', '5eed0103-0000-4000-8000-000000000103',
  'Buyer found the same card in a 9 and pulled out before payment was requested. No hard feelings, item relisted.',
  now() - interval '7 days', now() - interval '2 days'
from cardtrade.items i
where i.id = '5eed5004-0000-4000-8000-000000000004'
on conflict (id) do nothing;

-- Residential addresses live outside the Realtime-published cash_sales row.
insert into cardtrade.cash_sale_delivery_details (
  cash_sale_id, buyer_id, address_label, place_id
)
select id, buyer_id, 'Demo delivery address on file', 'legacy:seed:' || id::text
from cardtrade.cash_sales
where delivery_address_configured
on conflict (cash_sale_id) do nothing;