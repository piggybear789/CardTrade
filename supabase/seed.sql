-- CardTrade — seed.sql
-- Deterministic sample data for local development and demos.
--
-- What this seeds:
--   * 5 VERIFIED profiles (Req 1, 2) — every seeded user has passed KYC so they
--     can immediately list, buy, and trade (the VERIFIED gate, Req 2.4/3.1/4.1/5.1).
--   * A catalog of items exercising the catalog filter (Req 3.8): a mix of
--     AVAILABLE, RESERVED, and SOLD statuses so only AVAILABLE items surface.
--   * Two equal-Fair-Market-Value AVAILABLE pairs (Req 5.1) so a 2-way trade can
--     be proposed end-to-end from the UI without any data setup.
--
-- Conventions:
--   * All ids are FIXED UUIDs so items/trades/holds can reference profiles and
--     items deterministically across runs.
--   * profiles.id references auth.users(id); because of that FK we insert the
--     corresponding auth.users rows FIRST. These are minimal email/password
--     identities suitable for local Supabase Auth only.
--   * All monetary values are integer AUD cents (fmv_cents in 1..99999999999).
--   * Inserts use ON CONFLICT DO NOTHING so the seed is safe to re-run.
--
-- Password for every seeded auth user is: password123

-- =============================================================================
-- Auth users (must exist before profiles due to the profiles.id FK)
-- =============================================================================
-- crypt()/gen_salt() come from pgcrypto, which Supabase enables by default.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'authenticated', 'authenticated', 'alice@example.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Alice Nguyen"}'),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'authenticated', 'authenticated', 'bob@example.com',   crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Bob Carter"}'),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333', 'authenticated', 'authenticated', 'carol@example.com', crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Carol Diaz"}'),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-4444-444444444444', 'authenticated', 'authenticated', 'dave@example.com',  crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Dave Ellis"}'),
  ('00000000-0000-0000-0000-000000000000', '55555555-5555-5555-5555-555555555555', 'authenticated', 'authenticated', 'erin@example.com',  crypt('password123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"display_name":"Erin Frost"}')
on conflict (id) do nothing;

-- =============================================================================
-- Profiles (all VERIFIED so seeded users can transact immediately)
-- =============================================================================

insert into profiles (
  id, display_name, contact_email, payer_id,
  merchant_ref, merchant_status, merchant_compliance_status,
  merchant_live_enabled, merchant_transactions_enabled, merchant_settlements_enabled,
  merchant_legal_entity_name, merchant_trading_name, merchant_registration_number,
  merchant_organisation_type, merchant_identity_version,
  merchant_identity_disclosure_consented_at, merchant_identity_verified_at
)
values
  ('11111111-1111-1111-1111-111111111111', 'Alice Nguyen', 'alice@example.com', 'payer_alice', 'mch_seed_alice', 'APPROVED', 'approved', true, true, true, 'Alice Nguyen Collectibles Pty Ltd', 'Alice Cards', '00000000001', 'company', 'seed-identity-alice-v1', now(), now()),
  ('22222222-2222-2222-2222-222222222222', 'Bob Carter',   'bob@example.com',   'payer_bob',   'mch_seed_bob',   'APPROVED', 'approved', true, true, true, 'Bob Carter Collectibles Pty Ltd', 'Carter Cards', '00000000002', 'company', 'seed-identity-bob-v1', now(), now()),
  ('33333333-3333-3333-3333-333333333333', 'Carol Diaz',   'carol@example.com', 'payer_carol', 'mch_seed_carol', 'APPROVED', 'approved', true, true, true, 'Carol Diaz Collectibles Pty Ltd', 'Diaz Collectibles', '00000000003', 'company', 'seed-identity-carol-v1', now(), now()),
  ('44444444-4444-4444-4444-444444444444', 'Dave Ellis',   'dave@example.com',  'payer_dave',  'mch_seed_dave',  'APPROVED', 'approved', true, true, true, 'Dave Ellis Collectibles Pty Ltd', 'Ellis Comics', '00000000004', 'company', 'seed-identity-dave-v1', now(), now()),
  ('55555555-5555-5555-5555-555555555555', 'Erin Frost',   'erin@example.com',  'payer_erin',  'mch_seed_erin',  'APPROVED', 'approved', true, true, true, 'Erin Frost Collectibles Pty Ltd', 'Frost Coins', '00000000005', 'company', 'seed-identity-erin-v1', now(), now())
on conflict (id) do nothing;

-- =============================================================================
-- Items
-- =============================================================================
-- Equal-FMV AVAILABLE pairs (ready for a 2-way trade proposal, Req 5.1):
--   Pair A: item aaaa1 (Alice) <-> item aaaa2 (Bob)   @ 25,000 cents ($250.00)
--   Pair B: item bbbb1 (Carol) <-> item bbbb2 (Dave)  @ 120,000 cents ($1,200.00)
-- Plus extra AVAILABLE items, and RESERVED/SOLD items to exercise the
-- AVAILABLE-only catalog filter (Req 3.8).

insert into items (id, owner_id, title, description, category, condition, fmv_cents, status, image_paths)
values
  -- Equal-FMV pair A (AVAILABLE, $250.00) --------------------------------------
  ('aaaaaaa1-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   '1999 Pokémon Base Set Charizard #4 PSA 8',
   'Holographic Charizard from the 1999 Base Set, graded PSA 8 NM-MT. Sharp corners, minor holo scratch. Stored in a protective case since grading.',
   'Trading Cards', 'PSA 8', 25000, 'AVAILABLE', array['items/aaaaaaa1/front.jpg','items/aaaaaaa1/back.jpg']),

  ('aaaaaaa2-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
   '1986 Fleer Michael Jordan Rookie #57 BGS 7',
   'Iconic Michael Jordan rookie card, Fleer #57, BGS 7 Near Mint. Centering 60/40, strong color. A cornerstone basketball rookie.',
   'Trading Cards', 'BGS 7', 25000, 'AVAILABLE', array['items/aaaaaaa2/front.jpg','items/aaaaaaa2/back.jpg']),

  -- Equal-FMV pair B (AVAILABLE, $1,200.00) ------------------------------------
  ('bbbbbbb1-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333',
   '1909-1911 T206 Ty Cobb (Red Portrait) SGC 3',
   'Classic T206 Ty Cobb red portrait, SGC 3 VG. Even wear, no creases, tobacco-era cardboard. A blue-chip vintage baseball card.',
   'Trading Cards', 'SGC 3', 120000, 'AVAILABLE', array['items/bbbbbbb1/front.jpg']),

  ('bbbbbbb2-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444',
   '1963 Fantastic Four #1 CGC 4.0',
   'Silver Age key: first appearance of the Fantastic Four. CGC 4.0 VG, off-white pages, cover gloss retained. Marvel foundation book.',
   'Comics', 'CGC 4.0', 120000, 'AVAILABLE', array['items/bbbbbbb2/cover.jpg','items/bbbbbbb2/spine.jpg']),

  -- Extra AVAILABLE items ------------------------------------------------------
  ('cccccccc-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555',
   '1943 Steel Lincoln Wheat Penny (Uncirculated)',
   'Wartime steel cent in uncirculated condition, bright zinc coating intact. A popular one-year-only US mint issue.',
   'Coins', 'Uncirculated', 4999, 'AVAILABLE', array['items/cccccccc1/obverse.jpg','items/cccccccc1/reverse.jpg']),

  ('cccccccc-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   '1918 Inverted Jenny Reproduction Print (Framed)',
   'Museum-quality framed reproduction of the famous inverted Jenny stamp. Decorative collectible; clearly marked as a reproduction.',
   'Stamps', 'Mint', 899999, 'AVAILABLE', array['items/cccccccc2/framed.jpg']),

  -- RESERVED items (should NOT appear in the AVAILABLE catalog) -----------------
  ('dddddddd-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   '2003 LeBron James Topps Chrome Rookie #111 PSA 9',
   'LeBron James Topps Chrome rookie, PSA 9 Mint. Currently reserved for an in-progress transaction.',
   'Trading Cards', 'PSA 9', 30000, 'RESERVED', array['items/dddddddd1/front.jpg']),

  ('dddddddd-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333',
   '1928 Babe Ruth Signed Baseball (JSA)',
   'Official league baseball signed by Babe Ruth, JSA authenticated. Reserved pending an active trade.',
   'Memorabilia', 'Good', 15000, 'RESERVED', array['items/dddddddd2/ball.jpg','items/dddddddd2/coa.jpg']),

  -- SOLD items (should NOT appear in the AVAILABLE catalog) ---------------------
  ('eeeeeeee-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444',
   '1952 Topps Mickey Mantle #311 (Authentic)',
   'Post-war Topps Mickey Mantle, authentic/ungraded with honest wear. Already sold via a completed cash sale.',
   'Trading Cards', 'Authentic', 75000, 'SOLD', array['items/eeeeeeee1/front.jpg','items/eeeeeeee1/back.jpg']),

  ('eeeeeeee-0000-0000-0000-000000000002', '55555555-5555-5555-5555-555555555555',
   '1954 Superman #100 CGC 3.5',
   'Golden/Silver Age Superman #100, CGC 3.5. Sold in a prior transaction; retained here to exercise catalog filtering.',
   'Comics', 'CGC 3.5', 60000, 'SOLD', array['items/eeeeeeee2/cover.jpg'])
on conflict (id) do nothing;
