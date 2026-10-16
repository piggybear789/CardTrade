-- 0154_scam_reports.sql
--
-- Off-platform scam reports (.kiro/specs/scam-reports).
--
-- An ID-verified member reports a scam that happened outside NoDitto. The payment
-- details and handles the scammer used are stored ONLY as HMAC fingerprints
-- (`domain/risk/scamReports.ts`), with a masked hint for staff. Reports that share a
-- fingerprint form a cluster; NoDitto members whose own details share one are flagged
-- to staff as a match. Nothing here is public and nothing acts automatically.
--
-- ACCESS. Every table has RLS on and NO member policy or grant: members file reports
-- and respond to matches through server actions on the service role, and staff read
-- through the admin console on the service role.
--
-- RETENTION. Live reports are kept indefinitely (spec Req 9). Dismissed and withdrawn
-- reports are deleted 90 days later by the `:17` job, with their fingerprints, matches
-- and evidence objects.

create table if not exists cardtrade.scam_reports (
  id uuid primary key default gen_random_uuid(),
  -- Null once the reporter closes their account: the fingerprints still protect others.
  reporter_id uuid references cardtrade.profiles(id) on delete set null,
  status text not null default 'SUBMITTED'
    check (status in ('SUBMITTED', 'REVIEWED', 'CORROBORATED', 'DISMISSED', 'WITHDRAWN')),
  narrative text not null
    check (char_length(narrative) between 50 and 4000),
  occurred_month date not null,
  amount_minor bigint check (amount_minor is null or amount_minor > 0),
  currency text check (currency is null or currency ~ '^[a-z]{3}$'),
  payment_method text not null
    check (payment_method in
      ('BANK_TRANSFER', 'PAYID', 'PAYPAL_FF', 'PAYPAL_GS', 'CRYPTO', 'GIFT_CARD', 'CASH', 'OTHER')),
  -- Free text, staff only, never fingerprinted or matched.
  scammer_name_text text check (scammer_name_text is null or char_length(scammer_name_text) <= 120),
  evidence_paths text[] not null
    check (cardinality(evidence_paths) between 1 and 10),
  declared_at timestamptz not null,
  staff_notes text check (staff_notes is null or char_length(staff_notes) <= 4000),
  reviewed_by uuid references cardtrade.profiles(id),
  reviewed_at timestamptz,
  dismiss_reason text check (dismiss_reason is null or char_length(dismiss_reason) <= 500),
  dismissed_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scam_reports_reporter_idx
  on cardtrade.scam_reports (reporter_id, created_at desc);
create index if not exists scam_reports_cleanup_idx
  on cardtrade.scam_reports (status, coalesce(dismissed_at, withdrawn_at))
  where status in ('DISMISSED', 'WITHDRAWN');

create table if not exists cardtrade.scam_report_identifiers (
  report_id uuid not null references cardtrade.scam_reports(id) on delete cascade,
  kind text not null
    check (kind in ('PAYID_EMAIL', 'PAYID_PHONE', 'BANK_ACCOUNT', 'BANK_PARTIAL',
                    'PAYPAL_EMAIL', 'CRYPTO_WALLET', 'PHONE', 'HANDLE')),
  platform text not null default '',
  value_hash text not null check (char_length(value_hash) = 64),
  hint text not null check (char_length(hint) <= 120),
  primary key (report_id, kind, platform, value_hash)
);

create index if not exists scam_report_identifiers_hash_idx
  on cardtrade.scam_report_identifiers (value_hash);

-- What NoDitto derives for each member from data it already holds: contact email,
-- profile social handles, and (when the provider exposes it) payout BSB plus last 4.
create table if not exists cardtrade.member_match_keys (
  profile_id uuid not null references cardtrade.profiles(id) on delete cascade,
  kind text not null
    check (kind in ('PAYID_EMAIL', 'PAYPAL_EMAIL', 'BANK_PARTIAL', 'HANDLE')),
  platform text not null default '',
  value_hash text not null check (char_length(value_hash) = 64),
  source text not null check (source in ('CONTACT_EMAIL', 'SOCIAL_LINK', 'PAYOUT_ACCOUNT')),
  updated_at timestamptz not null default now(),
  primary key (profile_id, kind, platform, value_hash)
);

create index if not exists member_match_keys_hash_idx
  on cardtrade.member_match_keys (value_hash);

-- When this member's match keys were last derived. Null means never: the `:17` job
-- picks those up, which is how new sign-ups and pre-0154 members get keys without a
-- hook in every provisioning path. No member grant (0072 lists the member's columns).
alter table cardtrade.profiles
  add column if not exists match_keys_refreshed_at timestamptz;

create index if not exists profiles_match_keys_pending_idx
  on cardtrade.profiles (created_at desc)
  where match_keys_refreshed_at is null;

create table if not exists cardtrade.scam_report_matches (
  report_id uuid not null references cardtrade.scam_reports(id) on delete cascade,
  profile_id uuid not null references cardtrade.profiles(id) on delete cascade,
  kinds text[] not null check (cardinality(kinds) between 1 and 8),
  strength text not null check (strength in ('STRONG', 'MEDIUM', 'WEAK')),
  status text not null default 'OPEN' check (status in ('OPEN', 'CONFIRMED')),
  notified_at timestamptz,
  response_due_at timestamptz,
  responded_at timestamptz,
  member_response text check (member_response is null or char_length(member_response) <= 4000),
  member_response_paths text[] not null default '{}'
    check (cardinality(member_response_paths) <= 10),
  decided_by uuid references cardtrade.profiles(id),
  decided_at timestamptz,
  -- A fraud ban on off-platform reports is a proposal until a second admin approves
  -- it (`canApprove`; a solo operator after 24 hours), like any fraud finding.
  ban_proposed_by uuid references cardtrade.profiles(id),
  ban_proposed_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (report_id, profile_id)
);

create index if not exists scam_report_matches_profile_idx
  on cardtrade.scam_report_matches (profile_id);

comment on table cardtrade.scam_reports is
  'Off-platform scam reports (0154). Staff only; service role writes. Never public.';
comment on table cardtrade.scam_report_identifiers is
  'HMAC fingerprints of the payment details and handles in a scam report, with masked hints (0154).';
comment on table cardtrade.member_match_keys is
  'HMAC fingerprints NoDitto derives for each member, matched against scam reports (0154).';
comment on table cardtrade.scam_report_matches is
  'Members whose own fingerprints match a scam report (0154). Staff only. A dismissed match is deleted, not kept.';

alter table cardtrade.scam_reports enable row level security;
alter table cardtrade.scam_report_identifiers enable row level security;
alter table cardtrade.member_match_keys enable row level security;
alter table cardtrade.scam_report_matches enable row level security;

-- Private: reads are signed by the server after an owner or staff check.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'scam-report-evidence',
  'scam-report-evidence',
  false,
  10485760, -- 10 MB
  array['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Grants last. No member access of any kind.
revoke all on cardtrade.scam_reports from anon, authenticated;
revoke all on cardtrade.scam_report_identifiers from anon, authenticated;
revoke all on cardtrade.member_match_keys from anon, authenticated;
revoke all on cardtrade.scam_report_matches from anon, authenticated;
grant select, insert, update, delete on cardtrade.scam_reports to service_role;
grant select, insert, update, delete on cardtrade.scam_report_identifiers to service_role;
grant select, insert, update, delete on cardtrade.member_match_keys to service_role;
grant select, insert, update, delete on cardtrade.scam_report_matches to service_role;
