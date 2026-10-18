-- 0155_references.sql
--
-- References: a public trust graph of off-platform (and NoDitto) deals.
--
-- WHAT IT IS. Any Stage-1 ID-verified member can vouch for another trader for a
-- deal done anywhere (Instagram, Facebook, Discord, in person, ...). A vouch is
-- a positive, structured attestation (platform, role, month) that goes LIVE
-- immediately; there is no negative reference. Bad experiences go through the
-- existing off-platform scam reports (0154), and a confirmed fraud ban removes
-- the person and every edge touching them.
--
-- SOCIAL CLAIMS. `social_claims` is the ownership source of truth for a
-- (platform, handle) pair: at most one row ever exists for a pair, claimed by
-- at most one profile. Backfilled from `profiles.social_links` (0085), which
-- stays the display source. A claim with no profile is an "unclaimed node":
-- searchable and vouchable before its owner joins. When a claim is later
-- claimed, the trigger below moves its references onto the profile.
--
-- EDGES. `member_references` holds one LIVE edge per pair of PEOPLE (not
-- accounts) per sentiment: person keys come from `identity_person_keys`
-- (0105), so repeat deals raise `deal_count` instead of the people count, and
-- a person cannot reference themselves through a second account. A negative
-- experience is a public NEGATIVE edge (category + optional comment) that
-- also goes LIVE immediately — no staff review on either sentiment. The
-- voucher's verified identity is public either way, which is the
-- accountability that makes instant publication workable.
--
-- ACCESS. Tables are service-role only. The public reads go through the two
-- views, which expose no staff fields, no person keys and no proof paths.
-- Proof screenshots (receipt-checked tier) live in a private bucket, staff
-- read them through signed URLs, mirroring trusted-seller-photos (0153).

create table if not exists cardtrade.social_claims (
  id uuid primary key default gen_random_uuid(),
  platform text not null
    check (platform in ('instagram', 'facebook', 'x', 'youtube', 'tiktok', 'discord')),
  handle text not null
    check (char_length(handle) between 1 and 100),
  handle_norm text generated always as (lower(btrim(handle))) stored,
  claimed_profile_id uuid references cardtrade.profiles(id) on delete cascade,
  created_by uuid references cardtrade.profiles(id) on delete set null,
  claim_method text not null default 'UNCLAIMED'
    check (claim_method in ('UNCLAIMED', 'PROFILE_LINK', 'BIO_CODE', 'STAFF')),
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint social_claims_claim_stamp
    check ((claimed_profile_id is null) = (claimed_at is null)),
  constraint social_claims_platform_handle_unique unique (platform, handle_norm)
);

comment on table cardtrade.social_claims is
  'One row per (platform, handle) (0155). claimed_profile_id null = unclaimed node. Service-role only; public reads via public_social_claims.';

create index if not exists social_claims_profile_idx
  on cardtrade.social_claims (claimed_profile_id)
  where claimed_profile_id is not null;

create table if not exists cardtrade.member_references (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references cardtrade.profiles(id) on delete cascade,
  target_profile_id uuid references cardtrade.profiles(id) on delete cascade,
  target_claim_id uuid references cardtrade.social_claims(id) on delete cascade,
  -- Exactly one target: a member, or an unclaimed handle.
  constraint member_references_one_target
    check ((target_profile_id is null) <> (target_claim_id is null)),
  platform text not null
    check (platform in ('instagram', 'facebook', 'discord', 'ebay', 'whatnot', 'in-person', 'noditto', 'other')),
  sentiment text not null default 'POSITIVE'
    check (sentiment in ('POSITIVE', 'NEGATIVE')),
  -- Required for a negative experience; null for a positive vouch.
  category text
    check (category is null or category in ('NEVER_ARRIVED', 'NOT_AS_DESCRIBED', 'SWITCHED', 'PAYMENT', 'OTHER')),
  comment text
    check (comment is null or char_length(comment) <= 500),
  constraint member_references_negative_category
    check (sentiment = 'POSITIVE' or category is not null),
  role text not null
    check (role in ('BOUGHT', 'SOLD', 'TRADED')),
  occurred_month date not null,
  status text not null default 'LIVE'
    check (status in ('LIVE', 'WITHDRAWN', 'REMOVED')),
  -- Canonical 0105 person keys (HMAC hex), never raw identity data. The target
  -- key is null while the target is an unclaimed handle.
  voucher_person_key text not null,
  target_person_key text,
  deal_count integer not null default 1 check (deal_count >= 1),
  proof_paths text[] not null default '{}'
    check (cardinality(proof_paths) <= 5),
  proof_status text not null default 'NONE'
    check (proof_status in ('NONE', 'PENDING', 'CHECKED')),
  disputed_at timestamptz,
  disputed_by uuid references cardtrade.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table cardtrade.member_references is
  'Positive reference edges between ID-verified people (0155). Service-role writes; public reads via reference_edges_public.';

-- One LIVE edge per pair of people per sentiment, and per voucher per
-- unclaimed handle per sentiment.
create unique index if not exists member_references_person_pair_unique
  on cardtrade.member_references (voucher_person_key, target_person_key, sentiment)
  where status = 'LIVE' and target_person_key is not null;

create unique index if not exists member_references_claim_pair_unique
  on cardtrade.member_references (voucher_id, target_claim_id, sentiment)
  where status = 'LIVE' and target_claim_id is not null;

create index if not exists member_references_target_profile_idx
  on cardtrade.member_references (target_profile_id, created_at desc)
  where status = 'LIVE';

create index if not exists member_references_target_claim_idx
  on cardtrade.member_references (target_claim_id, created_at desc)
  where status = 'LIVE';

create index if not exists member_references_voucher_idx
  on cardtrade.member_references (voucher_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Handle claim requests: an ID-verified member asks to claim an unclaimed
-- handle, proving control by putting a one-time code in the social bio and
-- screenshotting it (no platform API can check a bio). Staff decide; the
-- approval writes the claim, and the trigger above moves the references.
-- ---------------------------------------------------------------------------
create table if not exists cardtrade.handle_claim_requests (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references cardtrade.social_claims(id) on delete cascade,
  claimant_id uuid not null references cardtrade.profiles(id) on delete cascade,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'APPROVED', 'DECLINED')),
  -- The one-time bio code the claimant was asked to show. Staff-only table.
  bio_code text not null check (char_length(bio_code) between 4 and 40),
  screenshot_paths text[] not null default '{}'
    check (cardinality(screenshot_paths) <= 5),
  staff_notes text check (staff_notes is null or char_length(staff_notes) <= 4000),
  decided_by uuid references cardtrade.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint handle_claim_requests_decided_stamp
    check ((status = 'PENDING') = (decided_at is null))
);

comment on table cardtrade.handle_claim_requests is
  'Bio-code claim requests for unclaimed handles (0155). Service-role only; staff decide in /admin.';

create index if not exists handle_claim_requests_queue_idx
  on cardtrade.handle_claim_requests (status, created_at);

create unique index if not exists handle_claim_requests_one_pending
  on cardtrade.handle_claim_requests (claim_id, claimant_id)
  where status = 'PENDING';

-- ---------------------------------------------------------------------------
-- Backfill claims from the social links members already publish (0085).
-- ---------------------------------------------------------------------------
insert into cardtrade.social_claims (platform, handle, claimed_profile_id, claim_method, claimed_at, created_at)
select
  entry.key,
  btrim(entry.value),
  p.id,
  'PROFILE_LINK',
  p.created_at,
  now()
from cardtrade.profiles p
cross join lateral jsonb_each_text(coalesce(p.social_links, '{}'::jsonb)) as entry(key, value)
where entry.key in ('instagram', 'facebook', 'x', 'youtube', 'tiktok', 'discord')
  and char_length(btrim(entry.value)) between 1 and 100
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Claiming a handle moves its references onto the profile.
-- ---------------------------------------------------------------------------
create or replace function cardtrade.social_claims_move_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.claimed_profile_id is not null
     and (tg_op = 'INSERT' or old.claimed_profile_id is distinct from new.claimed_profile_id) then
    update cardtrade.member_references r
       set target_profile_id = new.claimed_profile_id,
           target_claim_id = null,
           target_person_key = coalesce(
             r.target_person_key,
             (select k.fingerprint
                from cardtrade.identity_person_keys k
               where k.profile_id = new.claimed_profile_id
               order by (k.kind = 'document-id') desc
               limit 1)
           ),
           updated_at = now()
     where r.target_claim_id = new.id;
  end if;
  return new;
end;
$function$;

create trigger social_claims_move_references
  after insert or update of claimed_profile_id on cardtrade.social_claims
  for each row execute function cardtrade.social_claims_move_references();

-- ---------------------------------------------------------------------------
-- A fraud ban removes the person from the graph: every LIVE edge they gave
-- or received ends, in the same transaction as the ban (mirrors 0152).
-- ---------------------------------------------------------------------------
create or replace function cardtrade.profiles_remove_from_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update cardtrade.member_references
     set status = 'REMOVED',
         updated_at = now()
   where status = 'LIVE'
     and (voucher_id = new.id or target_profile_id = new.id);
  return null;
end;
$function$;

create trigger profiles_remove_from_references
  after update of fraud_banned_at on cardtrade.profiles
  for each row
  when (new.fraud_banned_at is not null and old.fraud_banned_at is null)
  execute function cardtrade.profiles_remove_from_references();

-- ---------------------------------------------------------------------------
-- Public views: the only anon/member-readable surface.
-- ---------------------------------------------------------------------------
create or replace view cardtrade.public_social_claims as
  select
    id,
    platform,
    handle,
    claimed_profile_id,
    (claimed_profile_id is not null) as is_claimed,
    claimed_at
  from cardtrade.social_claims;

create or replace view cardtrade.reference_edges_public as
  select
    id,
    voucher_id,
    target_profile_id,
    target_claim_id,
    platform,
    sentiment,
    category,
    comment,
    role,
    occurred_month,
    deal_count,
    proof_status,
    created_at
  from cardtrade.member_references
  where status = 'LIVE';

-- Private proof + claim-evidence buckets: staff read through signed URLs.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'reference-proof',
  'reference-proof',
  false,
  10485760, -- 10 MB
  array['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic']
),
(
  'handle-claim-evidence',
  'handle-claim-evidence',
  false,
  10485760, -- 10 MB
  array['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- RLS + grants last.
-- ---------------------------------------------------------------------------
alter table cardtrade.social_claims enable row level security;
alter table cardtrade.member_references enable row level security;
alter table cardtrade.handle_claim_requests enable row level security;

revoke all on function cardtrade.social_claims_move_references() from public, anon, authenticated;
revoke all on function cardtrade.profiles_remove_from_references() from public, anon, authenticated;

revoke all on cardtrade.social_claims from anon, authenticated;
revoke all on cardtrade.member_references from anon, authenticated;
revoke all on cardtrade.handle_claim_requests from anon, authenticated;
grant select, insert, update, delete on cardtrade.social_claims to service_role;
grant select, insert, update, delete on cardtrade.member_references to service_role;
grant select, insert, update, delete on cardtrade.handle_claim_requests to service_role;

grant select on cardtrade.public_social_claims to anon, authenticated;
grant select on cardtrade.reference_edges_public to anon, authenticated;
