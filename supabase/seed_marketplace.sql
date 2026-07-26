-- CardTrade — seed_marketplace.sql
--
-- Demo-grade marketplace depth. Adds the *cast* and the *catalogue* that make
-- the app look lived-in: sellers with real reputations (good and bad), ~70
-- graded-slab listings with real images, a body of reviews spanning 1-5 stars,
-- and the moderation queue that a real marketplace accumulates.
--
-- The per-account demo data (contracts, trades, disputes, offers, chats,
-- notifications) lives in `seed_demo_kitsunearia.sql` and must run AFTER this
-- file, because it references the personas created here.
--
-- Design notes
-- ------------
-- * Images are real. Every listing points at the public `card-images` bucket on
--   this project, sourced from `public.graded_cards`. `image_paths` accepts
--   absolute URLs (see `itemImageUrl` in lib/format.ts), so no upload is needed.
-- * Ids are deterministic. Hand-authored rows use fixed `5eed…` UUIDs; generated
--   rows derive their id from `md5('…' || source_id)`, so the whole file is
--   idempotent under `on conflict do nothing` and safe to re-run.
-- * Money is integer AUD cents everywhere. The Platform_Fee is 5% of the agreed
--   price (PLATFORM_FEE_BPS = 500, Req 4.7); the Friction_Tax is $20 split
--   $10 return shipping / $10 platform (Req 7.3).
-- * Order matters: auth.users -> profiles -> reviews -> items. Reviews come
--   before items on purpose — `reviews_refresh_rating` recomputes
--   `profiles.rating`, and `items_set_seller_rating` snapshots that rating onto
--   each item at INSERT time.
-- * Inserting into auth.users also fires the shared `handle_new_user` trigger,
--   which adds a matching `public.profiles` row for the other app on this
--   instance. Harmless, but expected.
--
-- Password for every seeded account: password123

-- =============================================================================
-- 1. Auth users — 11 named personas + 20 community reviewers
-- =============================================================================

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data
)
select
  '00000000-0000-0000-0000-000000000000',
  v.id::uuid,
  'authenticated',
  'authenticated',
  v.email,
  crypt('password123', gen_salt('bf')),
  now() - (v.age_days || ' days')::interval,
  now() - (v.age_days || ' days')::interval,
  now(),
  '', '', '', '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('display_name', v.display_name)
from (values
  -- Named personas -----------------------------------------------------------
  ('5eed0001-0000-4000-8000-000000000001', 'marcus.webb@example.com',   'Marcus Webb',   980),
  ('5eed0002-0000-4000-8000-000000000002', 'priya.raman@example.com',   'Priya Raman',   840),
  ('5eed0003-0000-4000-8000-000000000003', 'tom.oakley@example.com',    'Tom Oakley',    610),
  ('5eed0004-0000-4000-8000-000000000004', 'jess.nomura@example.com',   'Jess Nomura',    52),
  ('5eed0005-0000-4000-8000-000000000005', 'danny.rowe@example.com',    'slabking_dan',  300),
  ('5eed0006-0000-4000-8000-000000000006', 'leo.tanaka@example.com',    'cardvault_au',  455),
  ('5eed0007-0000-4000-8000-000000000007', 'hana.wu@example.com',       'Hana Wu',       720),
  ('5eed0008-0000-4000-8000-000000000008', 'omar.haddad@example.com',   'Omar Haddad',     9),
  ('5eed0009-0000-4000-8000-000000000009', 'bec.sullivan@example.com',  'Bec Sullivan',   21),
  ('5eed000a-0000-4000-8000-00000000000a', 'nathan.pike@example.com',   'quick_flip_99',  16),
  ('5eed000b-0000-4000-8000-00000000000b', 'grace.lombardi@example.com','Grace Lombardi',530),
  -- Community members: they buy, they review, they chat -----------------------
  ('5eed0100-0000-4000-8000-000000000100', 'noah.kettle@example.com',    'Noah Kettle',    410),
  ('5eed0101-0000-4000-8000-000000000101', 'mia.donnelly@example.com',   'Mia Donnelly',   395),
  ('5eed0102-0000-4000-8000-000000000102', 'raf.silva@example.com',      'Raf Silva',      388),
  ('5eed0103-0000-4000-8000-000000000103', 'katie.lam@example.com',      'Katie Lam',      370),
  ('5eed0104-0000-4000-8000-000000000104', 'ben.arundel@example.com',    'Ben Arundel',    355),
  ('5eed0105-0000-4000-8000-000000000105', 'sana.iqbal@example.com',     'Sana Iqbal',     341),
  ('5eed0106-0000-4000-8000-000000000106', 'declan.moss@example.com',    'Declan Moss',    322),
  ('5eed0107-0000-4000-8000-000000000107', 'yuki.tanabe@example.com',    'Yuki Tanabe',    310),
  ('5eed0108-0000-4000-8000-000000000108', 'harriet.vane@example.com',   'Harriet Vane',   298),
  ('5eed0109-0000-4000-8000-000000000109', 'toby.mercer@example.com',    'Toby Mercer',    281),
  ('5eed010a-0000-4000-8000-00000000010a', 'lena.brandt@example.com',    'Lena Brandt',    265),
  ('5eed010b-0000-4000-8000-00000000010b', 'josh.paterson@example.com',  'Josh Paterson',  248),
  ('5eed010c-0000-4000-8000-00000000010c', 'amrita.desai@example.com',   'Amrita Desai',   231),
  ('5eed010d-0000-4000-8000-00000000010d', 'cody.wren@example.com',      'Cody Wren',      219),
  ('5eed010e-0000-4000-8000-00000000010e', 'freya.olsen@example.com',    'Freya Olsen',    204),
  ('5eed010f-0000-4000-8000-00000000010f', 'mateo.rivas@example.com',    'Mateo Rivas',    188),
  ('5eed0110-0000-4000-8000-000000000110', 'anh.pham@example.com',       'Anh Pham',       171),
  ('5eed0111-0000-4000-8000-000000000111', 'george.stott@example.com',   'George Stott',   154),
  ('5eed0112-0000-4000-8000-000000000112', 'ivy.chandler@example.com',   'Ivy Chandler',   132),
  ('5eed0113-0000-4000-8000-000000000113', 'sam.okafor@example.com',     'Sam Okafor',     118)
) as v(id, email, display_name, age_days)
on conflict (id) do nothing;

-- =============================================================================
-- 2. Profiles
-- =============================================================================
-- KYC/merchant state is deliberately mixed so the demo can show every gate:
--   VERIFIED + APPROVED  -> can list, buy, trade, and shows the Verified badge
--   PENDING              -> Omar: submitted, waiting; listings stay drafts
--   REJECTED             -> Bec: knocked back with a reason on file
--   UNVERIFIED + NONE    -> Nathan: the account that keeps getting reported

insert into cardtrade.profiles (
  id, display_name, contact_email, kyc_status, kyc_reason, payer_id,
  payment_token, payment_token_type, payment_method_label,
  merchant_ref, merchant_status, merchant_compliance_status,
  merchant_live_enabled, merchant_transactions_enabled, merchant_settlements_enabled,
  merchant_submitted_at, merchant_decision_at, merchant_notes,
  merchant_legal_entity_name, merchant_trading_name, merchant_registration_number,
  merchant_organisation_type, merchant_identity_version,
  merchant_identity_disclosure_consented_at, merchant_identity_verified_at,
  created_at, updated_at
)
select
  v.id::uuid, v.display_name, v.email, v.kyc::cardtrade.kyc_status, v.kyc_reason, v.payer_id,
  v.token, v.token_type, v.token_label,
  v.merchant_ref, v.merchant_status::cardtrade.merchant_status, v.compliance,
  v.enabled, v.enabled, v.enabled,
  case when v.merchant_status = 'NONE' then null else now() - ((v.age_days - 2) || ' days')::interval end,
  case when v.merchant_status in ('NONE','PENDING') then null else now() - ((v.age_days - 3) || ' days')::interval end,
  v.notes,
  v.legal_name, v.trading_name, v.abn, v.org_type,
  case when v.merchant_status = 'APPROVED' then 'seed-identity-' || v.abn || '-v1' else null end,
  case when v.merchant_status = 'APPROVED' then now() - ((v.age_days - 2) || ' days')::interval else null end,
  case when v.merchant_status = 'APPROVED' then now() - ((v.age_days - 3) || ' days')::interval else null end,
  now() - (v.age_days || ' days')::interval,
  now() - ((v.age_days / 8) || ' days')::interval
from (values
  ('5eed0001-0000-4000-8000-000000000001','Marcus Webb','marcus.webb@example.com','VERIFIED',null,
   'payer_seed_marcus','tok_seed_marcus','bank-account','BSB 083-004 acct ••••4417',
   'mch_seed_marcus','APPROVED','approved',true,'Long-standing vintage consignor; no compliance flags.',
   'M J Webb Collectibles Pty Ltd','Webb Vintage Slabs','51824753556','company',980),

  ('5eed0002-0000-4000-8000-000000000002','Priya Raman','priya.raman@example.com','VERIFIED',null,
   'payer_seed_priya','tok_seed_priya','bank-account','BSB 062-000 acct ••••9082',
   'mch_seed_priya','APPROVED','approved',true,'High-value Japanese singles; two-person review passed.',
   'Raman Slab Co Pty Ltd','Raman Slab Co','29671443190','company',840),

  ('5eed0003-0000-4000-8000-000000000003','Tom Oakley','tom.oakley@example.com','VERIFIED',null,
   'payer_seed_tom','tok_seed_tom','credit-card','Visa ••••4242',
   'mch_seed_tom','APPROVED','approved',true,'Sole trader. One packaging complaint on file.',
   'Thomas Oakley','Oakley Cards','88347119206','sole_trader',610),

  ('5eed0004-0000-4000-8000-000000000004','Jess Nomura','jess.nomura@example.com','VERIFIED',null,
   'payer_seed_jess','tok_seed_jess','bank-account','BSB 013-006 acct ••••2210',
   'mch_seed_jess','APPROVED','approved',true,'New seller, expedited verification.',
   'Jessica Nomura','Nomura Slabs','40915568871','sole_trader',52),

  ('5eed0005-0000-4000-8000-000000000005','slabking_dan','danny.rowe@example.com','VERIFIED',null,
   'payer_seed_danny','tok_seed_danny','credit-card','Mastercard ••••5100',
   'mch_seed_danny','APPROVED','approved',true,'Verified at signup. Two substantiated buyer complaints since; escalated to fraud once.',
   'D. Rowe Trading','slabking_dan','67290418833','sole_trader',300),

  ('5eed0006-0000-4000-8000-000000000006','cardvault_au','leo.tanaka@example.com','VERIFIED',null,
   'payer_seed_leo','tok_seed_leo','bank-account','BSB 923-100 acct ••••7734',
   'mch_seed_leo','APPROVED','approved',true,'One condition dispute settled by Friction_Tax; no fraud history.',
   'Cardvault AU Pty Ltd','cardvault_au','13774920655','company',455),

  ('5eed0007-0000-4000-8000-000000000007','Hana Wu','hana.wu@example.com','VERIFIED',null,
   'payer_seed_hana','tok_seed_hana','bank-account','BSB 082-001 acct ••••6613',
   'mch_seed_hana','APPROVED','approved',true,'Mostly buys. Clean record.',
   'Hana Wu','Hana Wu','76118803492','sole_trader',720),

  ('5eed0008-0000-4000-8000-000000000008','Omar Haddad','omar.haddad@example.com','PENDING',null,
   'payer_seed_omar',null,null,null,
   'mch_seed_omar','PENDING','under_review',false,'Identity documents submitted; awaiting provider decision.',
   'Omar Haddad',null,'34889201776','sole_trader',9),

  ('5eed0009-0000-4000-8000-000000000009','Bec Sullivan','bec.sullivan@example.com','REJECTED',
   'Identity document did not match the account holder name. Re-submit a current photo ID in the name of the account holder.',
   'payer_seed_bec',null,null,null,
   'mch_seed_bec','REJECTED','declined',false,'Declined: document name mismatch, second attempt also failed OCR.',
   'Rebecca Sullivan',null,'92044170358','sole_trader',21),

  ('5eed000a-0000-4000-8000-00000000000a','quick_flip_99','nathan.pike@example.com','UNVERIFIED',null,
   null,null,null,null,
   '','NONE',null,false,null,
   null,null,'00000000000',null,16),

  ('5eed000b-0000-4000-8000-00000000000b','Grace Lombardi','grace.lombardi@example.com','VERIFIED',null,
   'payer_seed_grace','tok_seed_grace','bank-account','BSB 633-000 acct ••••1187',
   'mch_seed_grace','APPROVED','approved',true,'Coins and vintage promos. Clean record.',
   'Lombardi Collectables Pty Ltd','Lombardi Collectables','58330927641','company',530)
) as v(id, display_name, email, kyc, kyc_reason, payer_id, token, token_type, token_label,
       merchant_ref, merchant_status, compliance, enabled, notes,
       legal_name, trading_name, abn, org_type, age_days)
on conflict (id) do nothing;

-- Community members: verified buyers with a payment method, no storefront.
insert into cardtrade.profiles (
  id, display_name, contact_email, kyc_status, payer_id,
  payment_token, payment_token_type, payment_method_label,
  merchant_ref, merchant_status, merchant_compliance_status,
  merchant_live_enabled, merchant_transactions_enabled, merchant_settlements_enabled,
  merchant_submitted_at, merchant_decision_at,
  merchant_legal_entity_name, merchant_registration_number, merchant_organisation_type,
  merchant_identity_version, merchant_identity_disclosure_consented_at,
  merchant_identity_verified_at, created_at, updated_at
)
select
  u.id, coalesce(u.raw_user_meta_data->>'display_name', 'Member'), u.email, 'VERIFIED',
  'payer_seed_' || substr(u.id::text, 1, 8),
  'tok_seed_' || substr(u.id::text, 1, 8), 'bank-account',
  'BSB 062-000 acct ••••' || lpad((('x0' || substr(md5(u.id::text), 1, 7))::bit(32)::int % 10000)::text, 4, '0'),
  'mch_seed_' || substr(u.id::text, 1, 8), 'APPROVED', 'approved',
  true, true, true,
  u.created_at + interval '1 day', u.created_at + interval '2 days',
  coalesce(u.raw_user_meta_data->>'display_name', 'Member'),
  lpad((('x0' || substr(md5(u.id::text || 'abn'), 1, 7))::bit(32)::int)::text, 11, '0'),
  'sole_trader',
  'seed-identity-' || substr(u.id::text, 1, 8) || '-v1',
  u.created_at + interval '1 day', u.created_at + interval '2 days',
  u.created_at, u.created_at + interval '3 days'
from auth.users u
where u.id::text like '5eed01%'
on conflict (id) do nothing;

-- =============================================================================
-- 3. Reviews — the reputation layer, good and bad
-- =============================================================================
-- `reviews_refresh_rating` recomputes profiles.rating / rating_count on every
-- insert, so these rows ARE the ratings. Each seller gets a deterministic
-- rating distribution (`dist`, cycled per review) plus a comment drawn from a
-- pool for that star band. `source_id` is a synthetic per-review uuid: reviews
-- carry no FK to their source, and the unique key is
-- (reviewer_id, source_type, source_id).
--
-- Targets: Marcus ~4.9, Priya ~4.8, Grace ~4.7, Hana ~4.9, Tom ~4.4,
--          Leo ~4.0, Jess 5.0 (only 4 sales), slabking_dan ~1.6,
--          quick_flip_99 ~1.3. Omar and Bec have never transacted.

with reviewers as (
  select p.id, row_number() over (order by p.created_at desc) - 1 as rn
  from cardtrade.profiles p
  where p.id::text like '5eed01%'
),
reviewer_count as (select count(*)::int as n from reviewers),
spec(seller, dist, n, seed) as (values
  ('5eed0001-0000-4000-8000-000000000001', '55555554555555555543555555555', 29, 3),
  ('5eed0002-0000-4000-8000-000000000002', '5555545555555555454',           24, 7),
  ('5eed0003-0000-4000-8000-000000000003', '5445435545444354553',           17, 11),
  ('5eed0004-0000-4000-8000-000000000004', '5555',                           4, 5),
  ('5eed0005-0000-4000-8000-000000000005', '1112111213211112',              13, 13),
  ('5eed0006-0000-4000-8000-000000000006', '4444535444344454344',           18, 17),
  ('5eed0007-0000-4000-8000-000000000007', '55555455555',                    9, 19),
  ('5eed000a-0000-4000-8000-00000000000a', '1121112',                        5, 23),
  ('5eed000b-0000-4000-8000-00000000000b', '5545545555444555',              13, 29)
),
pool(rating, idx, body) as (values
  (5, 0, 'Slab arrived exactly as described. Double boxed, bubble wrapped, tracking up within the hour. Escrow released same day.'),
  (5, 1, 'Third purchase from this seller and the standard has not moved. Photos match the card in hand, no surprises.'),
  (5, 2, 'Fast, straightforward, answered every question about centring before I committed. Would buy again.'),
  (5, 3, 'Card was better in hand than in the photos. Packed in a team bag inside a card saver inside a bubble mailer.'),
  (5, 4, null),
  (5, 5, 'Agreed terms in the morning, shipped that afternoon. This is how it is supposed to work.'),
  (4, 0, 'Good card, honest description. Took three days to post which is why this is four and not five.'),
  (4, 1, 'No complaints on the item. Communication was a bit slow over the weekend.'),
  (4, 2, 'Exactly what was listed. Packaging was fine but not amazing — one layer of bubble wrap on a four figure slab.'),
  (4, 3, null),
  (4, 4, 'Happy overall. Would have liked a photo of the back before paying, but the card is clean.'),
  (4, 5, 'Solid transaction. Slight delay getting tracking but it turned up on time.'),
  (3, 0, 'Card is fine. Getting a straight answer about postage took four messages and a nudge.'),
  (3, 1, 'Arrived in a plain envelope with no rigid protection. Slab survived, but I was sweating.'),
  (3, 2, 'Description said "no scratches" and there is a light scuff on the case. Not worth a dispute, but worth knowing.'),
  (3, 3, 'Shipped nine days after payment cleared with no update until I chased it.'),
  (3, 4, null),
  (3, 5, 'Middle of the road. Item as described, everything else was hard work.'),
  (2, 0, 'Photos were stock images of a different copy. The card I got has a soft corner the listing never mentioned.'),
  (2, 1, 'Took two weeks to ship and only moved after I opened a dispute. Card itself is okay.'),
  (2, 2, 'Sent me the wrong grade and then argued about it. Ended up settling rather than fighting over $40.'),
  (2, 3, 'Case had a crack across the front that is not in any of the listing photos. Seller blamed the courier.'),
  (2, 4, 'Would not confirm the cert number before payment. Now I know why.'),
  (2, 5, 'Zero communication after payment. Turned up eventually in a bent envelope.'),
  (1, 0, 'Do not deal with this account. Asked me to pay by direct bank transfer for a "discount" to skip escrow.'),
  (1, 1, 'Empty box. The escrow hold is the only reason I am not out $2,000.'),
  (1, 2, 'Slab in the photos is not the slab I received. Different cert, two grades lower.'),
  (1, 3, 'Never shipped, never replied, cancelled on day fourteen. Complete waste of two weeks.'),
  (1, 4, 'Card arrived with the case cracked and the label peeled. Refused a return, went straight to dispute.'),
  (1, 5, 'Listing said PSA 10, what came was raw with a re-sealed case. Reported to the platform.')
)
insert into cardtrade.reviews (id, reviewer_id, reviewee_id, rating, comment, source_type, source_id, created_at)
select
  md5('cardtrade.seed.review:' || s.seller || ':' || g.i)::uuid,
  r.id,
  s.seller::uuid,
  substr(s.dist, 1 + ((g.i - 1) % length(s.dist)), 1)::int,
  p.body,
  case when (g.i + s.seed) % 4 = 0 then 'trade' else 'cash_sale' end,
  md5('cardtrade.seed.review.src:' || s.seller || ':' || g.i)::uuid,
  now() - (((g.i * 13 + s.seed) % 400) || ' days')::interval - ((g.i % 19) || ' hours')::interval
from spec s
cross join generate_series(1, s.n) as g(i)
cross join reviewer_count rc
join reviewers r on r.rn = ((g.i * 7 + s.seed) % rc.n)
join pool p
  on p.rating = substr(s.dist, 1 + ((g.i - 1) % length(s.dist)), 1)::int
 and p.idx = (g.i + s.seed) % 6
on conflict (id) do nothing;

-- Hand-written reviews that belong to the narrative arcs seeded in section 5.
-- These are the ones a demo should actually read out loud.
insert into cardtrade.reviews (id, reviewer_id, reviewee_id, rating, comment, source_type, source_id, created_at)
values
  -- Marcus: the reference-quality seller.
  ('5eed2001-0000-4000-8000-000000000001','5eed0007-0000-4000-8000-000000000007','5eed0001-0000-4000-8000-000000000001',
   5, E'Bought a $2,450 Base Set Charizard sight-unseen and it was the least stressful big purchase I have made.\nMarcus sent extra photos of the label and the back before I paid, shipped with signature on delivery, and the escrow released the same afternoon I confirmed. This is the benchmark.',
   'cash_sale','5eed3001-0000-4000-8000-000000000001', now() - interval '26 days'),

  -- Priya <-> Leo: a clean 2-way trade.
  ('5eed2002-0000-4000-8000-000000000002','5eed0006-0000-4000-8000-000000000006','5eed0002-0000-4000-8000-000000000002',
   5, 'Even-value swap, both holds released the day we accepted. Priya shipped first without being asked and sent the tracking straight into the trade chat.',
   'trade','5eed4001-0000-4000-8000-000000000001', now() - interval '19 days'),
  ('5eed2003-0000-4000-8000-000000000003','5eed0002-0000-4000-8000-000000000002','5eed0006-0000-4000-8000-000000000006',
   5, 'Textbook trade. Card was packed better than most dealers manage.',
   'trade','5eed4001-0000-4000-8000-000000000001', now() - interval '19 days'),

  -- The condition dispute: nobody is a villain, both are annoyed.
  ('5eed2004-0000-4000-8000-000000000004','5eed0003-0000-4000-8000-000000000003','5eed0006-0000-4000-8000-000000000006',
   2, E'Traded my PSA 6 Lugia for a Gym Challenge Gengar listed as "clean 8". It arrived with a scratch straight through the holo that is not in any of the five listing photos.\nRaised a condition dispute, the $20 friction tax came out of his hold and I sent it back. To be fair he did not stonewall me — but I would not trade with him again without a video.',
   'trade','5eed4002-0000-4000-8000-000000000002', now() - interval '11 days'),
  ('5eed2005-0000-4000-8000-000000000005','5eed0006-0000-4000-8000-000000000006','5eed0003-0000-4000-8000-000000000003',
   2, 'Opened a dispute before messaging me once. The scratch is real, I accept that, but a message first would have saved us both $20 and two weeks.',
   'trade','5eed4002-0000-4000-8000-000000000002', now() - interval '11 days'),

  -- slabking_dan: the substantiated fraud, and the disputed sale that preceded it.
  ('5eed2006-0000-4000-8000-000000000006','5eed0001-0000-4000-8000-000000000001','5eed0005-0000-4000-8000-000000000005',
   1, E'Shipped him a CGC 9 Celebrations Venusaur. What came back to me was a weighted empty case in a padded satchel — no card, label peeled off.\nThe pre-auth hold on his side covered the full $2,300 and the platform generated the evidence pack from his KYC identity. Police report lodged. Avoid this account.',
   'trade','5eed4003-0000-4000-8000-000000000003', now() - interval '6 days'),
  ('5eed2007-0000-4000-8000-000000000007','5eed0007-0000-4000-8000-000000000007','5eed0005-0000-4000-8000-000000000005',
   1, E'Listing was a PSA 10 Paldean Fates Mew with beautiful photos. The slab that arrived is cracked along the top seam and the cert number does not match the photos.\nHe told me to "just crack it and press it, it will grade fine". Disputed. Escrow is the only reason this is recoverable.',
   'cash_sale','5eed3004-0000-4000-8000-000000000004', now() - interval '9 days'),
  ('5eed2008-0000-4000-8000-000000000008','5eed0100-0000-4000-8000-000000000100','5eed0005-0000-4000-8000-000000000005',
   1, 'Asked me to pay by bank transfer directly and skip the platform "because the fee is a rip off". Reported it instead.',
   'cash_sale','5eed3009-0000-4000-8000-000000000009', now() - interval '31 days'),

  -- quick_flip_99: the ghoster.
  ('5eed2009-0000-4000-8000-000000000009','5eed0007-0000-4000-8000-000000000007','5eed000a-0000-4000-8000-00000000000a',
   1, E'Agreed terms, paid, then nothing for twelve days. No tracking, no replies, cancelled on day fourteen.\nGot every cent back because the money never left escrow, but that is two weeks I will not get back.',
   'cash_sale','5eed3005-0000-4000-8000-000000000005', now() - interval '4 days'),
  ('5eed200a-0000-4000-8000-00000000000a','5eed0101-0000-4000-8000-000000000101','5eed000a-0000-4000-8000-00000000000a',
   1, 'The photos on this account are lifted from completed eBay listings. Reverse image search them before you buy anything.',
   'cash_sale','5eed300a-0000-4000-8000-00000000000a', now() - interval '7 days'),

  -- Grace: the courier lost it, and she handled it properly.
  ('5eed200b-0000-4000-8000-00000000000b','5eed0007-0000-4000-8000-000000000007','5eed000b-0000-4000-8000-00000000000b',
   3, E'Grace did everything right — packed well, posted next day, sent tracking. Australia Post lost the parcel between Sydney and Perth and it was declared missing after three weeks.\nShe agreed to the refund without argument, so this rating is about the outcome, not about her.',
   'cash_sale','5eed3006-0000-4000-8000-000000000006', now() - interval '13 days'),

  -- Tom: honest about flaws, sloppy about postage.
  ('5eed200c-0000-4000-8000-00000000000c','5eed0102-0000-4000-8000-000000000102','5eed0003-0000-4000-8000-000000000003',
   3, 'Description was refreshingly honest about the corner wear — the listing literally says "do not expect a 9". Then it took nine days to post. Both things are true.',
   'cash_sale','5eed300b-0000-4000-8000-00000000000b', now() - interval '22 days'),

  -- Jess: new, tiny sample size, perfect so far.
  ('5eed200d-0000-4000-8000-00000000000d','5eed0103-0000-4000-8000-000000000103','5eed0004-0000-4000-8000-000000000004',
   5, 'Four sales in and she is already better than dealers who have been doing this for years. Handwritten note in the parcel.',
   'cash_sale','5eed300c-0000-4000-8000-00000000000c', now() - interval '5 days')
on conflict (id) do nothing;

-- =============================================================================
-- 4a. Story items — the listings the narrative arcs hang off
-- =============================================================================
-- Fixed ids so section 5 (sales, trades, disputes) can reference them. Images
-- are real objects in the public `card-images` bucket; each row stores the front
-- and the matching back.

insert into cardtrade.items (
  id, owner_id, title, description, category, condition, fmv_cents, status, hidden,
  image_paths, created_at, updated_at
)
select
  v.id::uuid, v.owner::uuid, v.title, v.descr, 'Trading Cards', v.cond, v.fmv,
  v.status::cardtrade.item_status, v.hidden,
  array[b.base || v.front, b.base || replace(v.front, 'front.jpg', 'back.jpg')],
  now() - (v.age_days || ' days')::interval,
  now() - ((v.age_days / 2) || ' days')::interval
from (values
  ('5eed1001-0000-4000-8000-000000000001','5eed0001-0000-4000-8000-000000000001',
   $t$Charizard · 1999 Base Set — CGC 9$t$,
   $d$1999 Base Set Charizard #4/102, CGC 9 Mint.

Centring is 55/45 left-to-right and dead-on top-to-bottom. Holo is clean under a loupe with no print lines through the flame. Two microscopic edge nicks on the reverse bottom border are what kept this off a 9.5 — they are visible in the back photo under angled light.

Sourced from an original Australian collection, unsearched since 1999. Cert verifies on CGC's lookup. Ships signature-on-delivery, double boxed, insured for full value. Happy to send extra photos or a short video before you commit.$d$,
   'CGC 9', 245000, 'SOLD', false, 'v1_800179174359_0/front.jpg', 34),

  ('5eed1002-0000-4000-8000-000000000002','5eed0001-0000-4000-8000-000000000001',
   $t$Blastoise · 1999 Base Set Shadowless 1st Edition — PSA 9$t$,
   $d$Shadowless 1st Edition Blastoise #2/102, PSA 9 Mint.

The 1st Edition stamp is crisp with no ghosting. Shadowless border is unmistakable next to an unlimited copy. Surface is flawless under light; centring 60/40 top-to-bottom, which is the only thing between this and a 10.

This is a four-figure card and I will treat it like one: rigid case, team bag, double box, signature on delivery, insured. Escrow only — I do not do off-platform deals, and neither should you.$d$,
   'PSA 9', 890000, 'AVAILABLE', false, 'v1_366472909285_0/front.jpg', 12),

  ('5eed1003-0000-4000-8000-000000000003','5eed0002-0000-4000-8000-000000000002',
   $t$Umbreon · 2024 SV8a Terastal Fest — PSA 10$t$,
   $d$SV8a Terastal Festival Umbreon Special Art Rare, PSA 10 Gem Mint. Japanese.

Pulled from a sealed booster box on stream, submitted straight to PSA in a semi-rigid, never sleeved by anyone else. Texture is untouched, corners are sharp, no silvering on the edges.

Population on this one is climbing but 10s still trade at a premium. Cert photo in the second image. Ships tracked and insured from Melbourne, 1-3 business days domestic.$d$,
   'PSA 10', 168000, 'SOLD', false, '298419855847/front.jpg', 22),

  ('5eed1004-0000-4000-8000-000000000004','5eed0006-0000-4000-8000-000000000006',
   $t$Blastoise · 1997 Rocket Gang (JPN) — PSA 10$t$,
   $d$1997 Japanese Team Rocket Blastoise holo, PSA 10.

Japanese vintage in a 10 is a different animal — the back centring on these is usually what kills them, and this one is close to perfect. Holo pattern is bright with no scratching, and the yellow border shows no wear at all.

Owned for six years, stored in a dark box at stable humidity. Never cracked, never re-holdered. Open to a trade against comparable Japanese vintage plus or minus cash.$d$,
   'PSA 10', 165000, 'SOLD', false, 'v1_800185874751_0/front.jpg', 22),

  ('5eed1005-0000-4000-8000-000000000005','5eed0005-0000-4000-8000-000000000005',
   $t$Mew · 2024 Paldean Fates Special — PSA 10$t$,
   $d$PSA 10 Mew, Paldean Fates. Gem mint, absolute banger, photos speak for themselves.

Priced to move, first in gets it. No returns, no refunds, sold as is. If you want to muck around with questions for three days please buy from someone else. Cash on pickup in Western Sydney gets you a better price than the listed one.$d$,
   'PSA 10', 42000, 'SOLD', false, 'v1_377261620400_0/front.jpg', 12),

  ('5eed1006-0000-4000-8000-000000000006','5eed0005-0000-4000-8000-000000000005',
   $t$Charizard · 2002 Legendary Collection — PSA 9$t$,
   $d$Legendary Collection Charizard, PSA 9. Reverse holo pattern, hard card to find in high grade.

Happy to trade this against another Charizard of similar value. Collateral both ways is fine by me, I have done plenty of these.$d$,
   'PSA 9', 230000, 'SOLD', false, 'v1_377265295043_0/front.jpg', 10),

  ('5eed1007-0000-4000-8000-000000000007','5eed0001-0000-4000-8000-000000000001',
   $t$Venusaur · 2021 Celebrations Classic Collection — CGC 9$t$,
   $d$Celebrations Classic Collection Venusaur, CGC 9.

Modern reprint of the Base Set art on the thicker Celebrations stock. Clean slab, no scratches on the case, label is straight. Traded away in a 2-way swap — kept listed for the audit trail.$d$,
   'CGC 9', 230000, 'SOLD', false, 'v1_366474986902_0/front.jpg', 10),

  ('5eed1008-0000-4000-8000-000000000008','5eed0006-0000-4000-8000-000000000006',
   $t$Gengar · 2000 Gym Challenge — PSA 8$t$,
   $d$Gym Challenge Gengar holo #6/132, PSA 8 NM-MT.

Strong eye appeal for an 8. Centring is 60/40, corners are sharp front and back. There is a light surface line through the holo that I could not photograph well — it catches under direct light at an angle. Calling it out so nobody is surprised.

Ships in a rigid mailer, tracked, from Brisbane.$d$,
   'PSA 8', 58000, 'SOLD', false, 'v1_377264763793_0/front.jpg', 15),

  ('5eed1009-0000-4000-8000-000000000009','5eed0003-0000-4000-8000-000000000003',
   $t$Lugia · 2001 Game Boy Promo (JPN) — PSA 6$t$,
   $d$Japanese Game Boy promo Lugia, PSA 6 EX-MT.

Do not expect a 9 here. There is honest edge wear along the top border and a soft bottom-left corner, both visible in the photos. What you are buying is a scarce promo at a price a 9 will never be.

Holo is fully intact with no scratching, and the print is sharp. I would rather undersell the grade than argue about it later.$d$,
   'PSA 6', 58000, 'SOLD', false, 'v1_800191123128_0/front.jpg', 15),

  ('5eed100a-0000-4000-8000-00000000000a','5eed000a-0000-4000-8000-00000000000a',
   $t$Pikachu · 2021 25th Anniversary Collection (JPN) — PSA 10$t$,
   $d$PSA 10 PIKACHU 25TH ANNIVERSARY!!! GEM MINT INVESTMENT GRADE

BEST PRICE ON THE PLATFORM GUARANTEED. Stock photo shown, you will receive an equivalent card in the same grade. Payment by bank transfer preferred, I can do 10% off the listed price if we sort it out directly instead of through the site fees.

NO REFUNDS. NO RETURNS. SERIOUS BUYERS ONLY.$d$,
   'PSA 10', 39000, 'AVAILABLE', false, '117250520638/front.jpg', 6),

  ('5eed100b-0000-4000-8000-00000000000b','5eed000a-0000-4000-8000-00000000000a',
   $t$Eevee · 2025 Prismatic Evolutions Reverse — PSA 8.5$t$,
   $d$Eevee prismatic reverse, PSA 8.5. Grabbed a few of these, will have more.

Quick sale, don't message me asking for extra pics, everything you need is in the photo. Postage is $15 flat and I post when I get around to it.$d$,
   'PSA 8.5', 12500, 'AVAILABLE', false, '307000594924/front.jpg', 5),

  ('5eed100c-0000-4000-8000-00000000000c','5eed000b-0000-4000-8000-00000000000b',
   $t$Snorlax · 2023 SVP Black Star Promo (151 ETB) — PSA 10$t$,
   $d$151 Elite Trainer Box Snorlax promo, PSA 10 Gem Mint.

Straight from a sealed ETB into a semi-rigid and off to grading. Centring is excellent, no dimples on the surface, holo foil is even.

Packed in a card saver inside a bubble mailer inside a box, tracked and insured. If a courier loses it I will wear it — the escrow refund path exists for a reason.$d$,
   'PSA 10', 26000, 'SOLD', false, '307003630699/front.jpg', 20),

  ('5eed100d-0000-4000-8000-00000000000d','5eed0004-0000-4000-8000-000000000004',
   $t$Pikachu · 2025 McDonalds Promo (JPN) — PSA 9$t$,
   $d$2025 Japanese McDonald's promo Pikachu, PSA 9 Mint.

Cheap, cheerful, and genuinely hard to find graded because most of these got played with. Slab is clean, label is centred, no scratches.

First card I have listed since getting verified. Posted within 24 hours of escrow clearing, with tracking, and I will send a photo of the parcel before it goes.$d$,
   'PSA 9', 8500, 'SOLD', false, '306993372841/front.jpg', 7),

  ('5eed100e-0000-4000-8000-00000000000e','5eed0002-0000-4000-8000-000000000002',
   $t$Gengar · 2010 HeartGold SoulSilver Triumphant — PSA 6$t$,
   $d$HS Triumphant Gengar Prime, PSA 6.

Prime cards from this era warp and chip along the gold edging, and this one has the typical edge chipping on the right border plus a small crease at the bottom-left that the grader flagged. Both are in the photos.

Priced accordingly. This is a player's copy of a card that costs four times as much in a 9.$d$,
   'PSA 6', 47000, 'RESERVED', false, 'v1_377251815243_0/front.jpg', 9),

  ('5eed100f-0000-4000-8000-00000000000f','5eed0003-0000-4000-8000-000000000003',
   $t$Dragonite · 1998 Game Boy Promo Insert (JPN) — BGS 5$t$,
   $d$1998 Japanese Game Boy colour-insert Dragonite, BGS 5 Excellent.

Subgrades: 6 centring, 5 corners, 6.5 edges, 5.5 surface. There is a visible indent near the top-right of the holo and the corners have handling wear. It is a 27-year-old insert that lived in a Game Boy box, not a vault.

I list flaws up front because I would rather sell one card honestly than three cards twice.$d$,
   'BGS 5', 34000, 'AVAILABLE', false, 'v1_377269332594_0/front.jpg', 18),

  ('5eed1010-0000-4000-8000-000000000010','5eed000b-0000-4000-8000-00000000000b',
   $t$Flareon · 1996 Amada Sticker Collection (JPN) — PSA 7$t$,
   $d$1996 Amada Pokémon sticker collection Flareon, PSA 7.

Not a TCG card — this is the Amada sticker set, which is why the stock and the back look different to what most people expect. Prism finish is bright, no peeling, no residue.

Odd little corner of the hobby and one of my favourite pieces. Reserved for a buyer who countered and we agreed a price.$d$,
   'PSA 7', 21000, 'RESERVED', false, '298413568040/front.jpg', 14),

  ('5eed1011-0000-4000-8000-000000000011','5eed0007-0000-4000-8000-000000000007',
   $t$Pikachu · 1999 Topps Movie Edition — PSA 7$t$,
   $d$1999 Topps Pokémon the First Movie Pikachu, PSA 7.

Topps cards get overlooked and I love them for it. Blue back, clean gloss, one soft corner top-right which is why it graded a 7.

I mostly buy rather than sell, so this is a one-off from my own binder. Ships in a rigid mailer, tracked, Sydney.$d$,
   'PSA 7', 6900, 'AVAILABLE', false, 'v1_366470585568_0/front.jpg', 8),

  ('5eed1012-0000-4000-8000-000000000012','5eed0008-0000-4000-8000-000000000008',
   $t$Vaporeon · 1997 Rocket Gang (JPN) — PSA 9$t$,
   $d$Japanese Team Rocket Vaporeon, PSA 9.

Draft listing — my identity verification is still with the provider, so I cannot publish this yet. Holding it here until the KYC check clears so I can list and sell properly rather than trying to work around the rules.$d$,
   'PSA 9', 44000, 'AVAILABLE', true, '117250083801/front.jpg', 3),

  ('5eed1013-0000-4000-8000-000000000013','5eed0009-0000-4000-8000-000000000009',
   $t$Pikachu · 1999 Base Set 1st Edition Red Cheeks — PSA 8$t$,
   $d$1st Edition red-cheeks Pikachu, PSA 8. The good variant, not the yellow-cheeks reprint.

Cannot publish this one — my verification was declined because the ID I uploaded is in my maiden name. Re-submitting with a current licence. Leaving the draft here so I do not have to type it all out again.$d$,
   'PSA 8', 76000, 'AVAILABLE', true, '298418370072/front.jpg', 14),

  ('5eed1014-0000-4000-8000-000000000014','5eed0001-0000-4000-8000-000000000001',
   $t$Pikachu · 2022 Scarlet & Violet Promo (JPN) — BGS 10$t$,
   $d$Japanese Scarlet & Violet promo Pikachu, BGS 10 Pristine.

Black label territory — 10s across centring, corners, and surface with a 9.5 on edges. These are genuinely rare in a BGS 10 because the foil shows every handling mark.

Sold through a private deal room with collateral on both sides. Kept visible for provenance.$d$,
   'BGS 10', 52000, 'SOLD', false, '298419885714/front.jpg', 28),

  ('5eed1015-0000-4000-8000-000000000015','5eed0005-0000-4000-8000-000000000005',
   $t$Charizard · 2021 25th Anniversary Promo (JPN) — BGS 9.5$t$,
   $d$BGS 9.5 GEM MINT CHARIZARD 25TH ANNIVERSARY JAPANESE PROMO

Cheapest one anywhere, I know what these go for and I am not budging much. Photos are of the actual card (mostly). Sold as is, no returns, no dispute nonsense — if you open a dispute over centring I will fight it.

Can do a better price outside the platform. Message me.$d$,
   'BGS 9.5', 96000, 'AVAILABLE', false, 'v1_377254022721_0/front.jpg', 2),

  ('5eed1016-0000-4000-8000-000000000016','5eed0001-0000-4000-8000-000000000001',
   $t$Mewtwo · 1996 Base Set (JPN) — PSA 1$t$,
   $d$1996 Japanese Base Set Mewtwo holo, PSA 1 Poor.

Yes, a 1. There is a crease through the centre of the artwork, the corners are rounded, and the back has scuffing. It is graded, authenticated, and honest about what it is.

Buy this if you want the art on your shelf for a tenth of what a clean copy costs, or if you collect low-pop grade extremes. Do not buy it expecting to crack and re-grade.$d$,
   'PSA 1', 12000, 'AVAILABLE', false, '298419679393/front.jpg', 40)
) as v(id, owner, title, descr, cond, fmv, status, hidden, front, age_days)
cross join (select 'https://emojqulpbiyqoyggespp.supabase.co/storage/v1/object/public/card-images/' as base) b
on conflict (id) do nothing;

-- =============================================================================
-- 4b. Bulk catalogue — ~70 generated listings with real images
-- =============================================================================
-- Sourced from public.graded_cards (the same table the existing app listings use).
-- Everything is derived deterministically from md5(source id): the item id, the
-- owner, the status split, the price band, the description template, and the age.
-- Cards already used by an existing listing are skipped, so re-running adds
-- nothing and changes nothing.

with base as (select 'https://emojqulpbiyqoyggespp.supabase.co/storage/v1/object/public/card-images/' as b),
used as (select unnest(image_paths) as url from cardtrade.items),
sellers(rn, id) as (values
  (0, '5eed0001-0000-4000-8000-000000000001'),  -- Marcus: the biggest shelf
  (1, '5eed0001-0000-4000-8000-000000000001'),
  (2, '5eed0002-0000-4000-8000-000000000002'),
  (3, '5eed0002-0000-4000-8000-000000000002'),
  (4, '5eed0003-0000-4000-8000-000000000003'),
  (5, '5eed0006-0000-4000-8000-000000000006'),
  (6, '5eed000b-0000-4000-8000-00000000000b'),
  (7, '5eed0004-0000-4000-8000-000000000004'),
  (8, '5eed0005-0000-4000-8000-000000000005'),  -- slabking_dan
  (9, '5eed000a-0000-4000-8000-00000000000a')   -- quick_flip_99
),
pool as (
  select
    gc.id,
    ('x0' || substr(md5('cardtrade.seed.item:' || gc.id::text), 1, 7))::bit(32)::int as h,
    ('x0' || substr(md5('cardtrade.seed.item2:' || gc.id::text), 1, 7))::bit(32)::int as h2,
    initcap(lower(gc.pokemon_name)) as mon,
    gc.year,
    gc.grading_agency as agency,
    gc.grade,
    coalesce(gc.grade_numeric, 8) as gn,
    nullif(initcap(lower(coalesce(gc.rarity, ''))), '') as rarity,
    gc.language as lang,
    regexp_replace(
      regexp_replace(
        regexp_replace(initcap(lower(gc.set_name)), '([0-9])St', '\1st', 'g'),
      '([0-9])Nd', '\1nd', 'g'),
    '([0-9])Th', '\1th', 'g') as set_pretty,
    gc.front_image_url as front,
    gc.back_image_url as back
  from public.graded_cards gc
  where gc.hidden is not true
    and gc.front_image_url is not null
    and gc.back_image_url is not null
    and gc.pokemon_name is not null
    and gc.year is not null
    and gc.set_name is not null
    and char_length(gc.set_name) between 4 and 40
    and gc.grading_agency in ('PSA','BGS','CGC','TAG')
    and gc.front_image_url like 'https://emojqulpbiyqoyggespp.supabase.co/%'
    and not exists (select 1 from used u where u.url = gc.front_image_url)
  order by md5('cardtrade.seed.pool:' || gc.id::text)
  limit 70
),
priced as (
  select
    p.*,
    s.id as owner_id,
    -- Price bands by grade, jittered deterministically, with a premium on the
    -- names that actually carry a premium.
    (case
       when p.gn >= 10 then 45000 + (p.h % 3000) * 100
       when p.gn >= 9  then 18000 + (p.h % 1500) * 100
       when p.gn >= 8  then  9000 + (p.h %  800) * 100
       when p.gn >= 6  then  4500 + (p.h %  400) * 100
       else                  1900 + (p.h %  250) * 100
     end
     * case when p.mon in ('Charizard','Umbreon','Mewtwo','Lugia','Rayquaza','Mew') then 2 else 1 end
    ) as fmv_cents,
    case
      when p.h2 % 100 < 76 then 'AVAILABLE'
      when p.h2 % 100 < 89 then 'RESERVED'
      else 'SOLD'
    end as status
  from pool p
  join sellers s on s.rn = p.h % 10
)
insert into cardtrade.items (
  id, owner_id, title, description, category, condition, fmv_cents, status, hidden,
  image_paths, created_at, updated_at
)
select
  md5('cardtrade.seed.item:' || p.id::text)::uuid,
  p.owner_id::uuid,
  left(
    p.mon || ' · ' || p.year || ' ' || p.set_pretty
      || case when p.lang = 'JPN' then ' (JPN)' when p.lang = 'CHN' then ' (CHN)' else '' end
      || ' — ' || p.agency || ' ' || p.grade,
    120),
  -- Ten description voices. The last two belong to the two accounts that keep
  -- getting reported, so a demo can compare a good listing to a bad one.
  case
    when p.owner_id = '5eed000a-0000-4000-8000-00000000000a' then
      upper(p.mon) || ' ' || p.agency || ' ' || p.grade || ' — CHEAPEST ON THE PLATFORM.' || E'\n\n'
      || 'Stock photo, you will get one in the same grade. Bank transfer preferred, saves us both the fees. No returns, no refunds, do not message me asking for the cert number.'
    when p.owner_id = '5eed0005-0000-4000-8000-000000000005' then
      p.mon || ' in a ' || p.agency || ' ' || p.grade || '. Photos speak for themselves.' || E'\n\n'
      || 'Priced to move, first in gets it. Sold as is — I do not do returns and I do not do long back-and-forths. Cash pickup in Western Sydney beats the listed price.'
    else
      case p.h % 8
        when 0 then p.year || ' ' || p.set_pretty || ' ' || p.mon || ', graded ' || p.agency || ' ' || p.grade || '.' || E'\n\n'
          || 'Centring is strong front and back, corners are sharp, and the surface is clean under a loupe. Cert verifies on the ' || p.agency || ' lookup and the label is in the second photo.' || E'\n\n'
          || 'Ships tracked and insured in a rigid mailer inside a box. Posted within one business day of escrow clearing.'
        when 1 then p.mon || ' from ' || p.set_pretty || ' (' || p.year || '), ' || p.agency || ' ' || p.grade || '.' || E'\n\n'
          || 'Bought raw, submitted myself, so the chain of custody is short: sleeve, semi-rigid, grader, slab. Never re-holdered.' || E'\n\n'
          || 'Happy to send extra photos or a short video before you commit — just ask in the chat.'
        when 2 then p.year || ' ' || p.mon || ', ' || p.agency || ' ' || p.grade || '. ' || coalesce(p.rarity || ' finish. ', '') || E'\n'
          || 'Honest notes: there is light edge wear along the top border and the bottom-left corner is slightly soft. Both are visible in the photos. Nothing structural, no creases.' || E'\n\n'
          || 'Priced below the last few comps because of it. I would rather undersell the grade than argue about it later.'
        when 3 then p.set_pretty || ' ' || p.mon || ', ' || p.agency || ' ' || p.grade || ', ' || p.year || '.' || E'\n\n'
          || 'Part of a long-term collection I am slowly thinning out. Stored in a dark box at stable humidity since the day it came back from grading.' || E'\n\n'
          || 'Open to a 2-way trade against something of comparable value, with or without cash on top.'
        when 4 then p.mon || ' — ' || p.agency || ' ' || p.grade || ' — ' || p.year || ' ' || p.set_pretty || '.' || E'\n\n'
          || 'Population in this grade is thin and the last three sales I can find all cleared above this ask. I am not chasing the top of the market, I just want it gone to someone who will keep it.' || E'\n\n'
          || 'Escrow only. Signature on delivery for anything over $500.'
        when 5 then p.year || ' ' || p.set_pretty || ' ' || p.mon || ' in a ' || p.agency || ' ' || p.grade || '.' || E'\n\n'
          || 'Slab itself is clean: no scratches on the case, no scuffing on the label, hinge is tight. Worth saying because a scratched case costs you money when you resell.' || E'\n\n'
          || 'Packed in a team bag, card saver, bubble mailer, then a box. Tracked both ways if a return is ever needed.'
        when 6 then p.mon || ', ' || p.agency || ' ' || p.grade || '. ' || p.year || ' ' || p.set_pretty || '.' || E'\n\n'
          || 'Straightforward listing: the photos are of this exact slab, front and back, unedited and uncropped. What you see is what ships.' || E'\n\n'
          || 'Ask me anything about condition before you buy. I will always answer, and I will always tell you the flaws.'
        else p.year || ' ' || p.mon || ' ' || coalesce(p.rarity, 'holo') || ' from ' || p.set_pretty || ', ' || p.agency || ' ' || p.grade || '.' || E'\n\n'
          || 'This one sat in my personal collection for years and it shows in the best way — never handled outside the slab, never lent out, never in sunlight.' || E'\n\n'
          || 'Interstate shipping is $15 tracked and insured, or free on anything over $1,000.'
      end
  end,
  'Trading Cards',
  p.agency || ' ' || p.grade,
  p.fmv_cents,
  p.status::cardtrade.item_status,
  false,
  array[p.front, p.back],
  now() - ((p.h % 120) || ' days')::interval - ((p.h2 % 24) || ' hours')::interval,
  now() - ((p.h % 40) || ' days')::interval
from priced p
on conflict (id) do nothing;
