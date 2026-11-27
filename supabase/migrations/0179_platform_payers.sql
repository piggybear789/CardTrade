-- 0179_platform_payers.sql
--
-- Cross-platform cash sales. An Australian may buy a US listing (and a US, UK or EEA
-- member an Australian one). The sale runs entirely on the SELLER's Stripe platform:
-- its currency is the seller's (0068), the money is held in that platform's balance
-- and paid out to a seller that platform can reach.
--
-- The buyer pays by card on that platform, and a Stripe Customer and its saved cards
-- belong to ONE platform account: a card saved on the AU platform cannot be charged by
-- the US one. `profiles.payer_id` / `payment_source_id` stay the member's HOME platform
-- pair; this table holds the pair for any OTHER platform they have bought on, one row
-- per (member, platform).
--
-- Written and read by the server alone (service role), like the profile columns it
-- mirrors: no member grant. The card itself never touches our server; these are
-- Stripe references and the display label read back from Stripe.

create table if not exists cardtrade.platform_payers (
  profile_id uuid not null references cardtrade.profiles(id) on delete cascade,
  -- The PLATFORM region (`RegionDefinition.platform`): 'AU' or 'US' today.
  platform text not null check (platform ~ '^[A-Z]{2}$'),
  -- The Stripe Customer on that platform.
  payer_id text not null,
  -- The saved card on that platform, null until one is saved.
  payment_source_id text,
  -- "Visa •••• 4242", read back from Stripe, never from the client.
  payment_method_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (profile_id, platform)
);

comment on table cardtrade.platform_payers is
  'A member''s Stripe Customer and saved card on a platform other than their own (0179). '
  'Service role only.';

alter table cardtrade.platform_payers enable row level security;
revoke all on cardtrade.platform_payers from public, anon, authenticated;
grant select, insert, update, delete on cardtrade.platform_payers to service_role;

notify pgrst, 'reload schema';
