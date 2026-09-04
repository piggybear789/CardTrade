--
-- Person-level Identity bans (0105).
--
-- A staff-confirmed Objective_Fraud finding already locks the offender's Profile
-- and Auth user (0059). That is one login. A banned scammer can otherwise open a
-- new email, pass Stripe Identity as the same government identity, and list again.
--
-- These tables hold HMAC fingerprints of the document Stripe already verified —
-- never the ID number, name, or date of birth. Writes are service-role only.
-- `public_profiles` is an explicit column list and is not recreated here, so the
-- hashes cannot leak onto a catalog or seller page.
--
-- `identity_person_keys` records every key produced at verification (government
-- ID, and name+DOB when both are present). `identity_bans` is the blocklist:
-- a later verification whose key is in that table must not become VERIFIED.

create table if not exists cardtrade.identity_person_keys (
  fingerprint text not null,
  profile_id uuid not null references cardtrade.profiles(id) on delete cascade,
  kind text not null check (kind in ('document-id', 'name-dob')),
  created_at timestamptz not null default now(),
  primary key (fingerprint, profile_id)
);

create index if not exists identity_person_keys_profile_idx
  on cardtrade.identity_person_keys (profile_id);

comment on table cardtrade.identity_person_keys is
  'HMAC person keys from Stripe Identity verified_outputs. Service-role only. Never the raw ID.';

create table if not exists cardtrade.identity_bans (
  fingerprint text primary key,
  created_at timestamptz not null default now(),
  banned_by uuid references cardtrade.profiles(id) on delete set null,
  source_profile_id uuid references cardtrade.profiles(id) on delete set null,
  source_trade_id uuid references cardtrade.trades(id) on delete set null
);

comment on table cardtrade.identity_bans is
  'Blocklist of Identity person keys. A matching verification must not open the Identity_Gate.';

alter table cardtrade.identity_person_keys enable row level security;
alter table cardtrade.identity_bans enable row level security;

revoke all on table cardtrade.identity_person_keys from public, anon, authenticated;
revoke all on table cardtrade.identity_bans from public, anon, authenticated;
