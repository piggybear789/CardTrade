-- 0152_trusted_sellers.sql
--
-- Trusted Seller: a staff-reviewed mark on a seller, requested from the public
-- `/trusted-sellers` page and decided by hand from `/admin?tab=trusted`.
--
-- WHAT IT IS. A member asks for a review and names their Instagram account; staff
-- look into them off-platform, for as long as that takes, and approve or decline.
-- Approval sets `profiles.trusted_seller_at`, which publishes a badge and raises the
-- seller's open-sales limit (`TRUSTED_SELLER_EXPOSURE_MULTIPLIER` in
-- `domain/payouts/releasePolicy.ts`). It is NOT part of the Identity_Gate and never
-- substitutes for it: approval requires the member to be identity-verified already.
--
-- WHO WRITES WHAT.
--   * `trusted_seller_reviews` is written by the service role only: the member's
--     request goes through `requestTrustedSellerReview`, decisions through the
--     admin-gated actions in `lib/actions/admin.ts`. A member may READ their own row,
--     minus the staff notes and the reviewer.
--   * `profiles.trusted_seller_at` is never written directly by anyone. It is derived
--     from the review's status by the trigger below, so the badge and the review can
--     never disagree. It carries no member grant.
--   * A fraud ban or an account closure ends the review (approved becomes REVOKED,
--     pending becomes DECLINED) inside the same transaction as the ban, whichever code
--     path set it.

alter table cardtrade.profiles
  add column if not exists trusted_seller_at timestamptz;

comment on column cardtrade.profiles.trusted_seller_at is
  'When staff approved this member as a Trusted Seller (0152). Derived from trusted_seller_reviews by trigger; never written directly. Null when not trusted.';

create table if not exists cardtrade.trusted_seller_reviews (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique references cardtrade.profiles(id) on delete cascade,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'APPROVED', 'DECLINED', 'REVOKED')),
  -- The username only, normalised the way `social_links` stores it.
  instagram_handle text not null
    check (char_length(instagram_handle) between 1 and 100),
  -- Staff working notes. Never member-readable (see the column grants at the end).
  staff_notes text
    check (staff_notes is null or char_length(staff_notes) <= 4000),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  -- Null when the system ended the review (a ban or a closure), not a staff member.
  decided_by uuid references cardtrade.profiles(id),
  -- A machine reason for a system decision; staff decisions leave it null.
  decision_reason text
    check (decision_reason is null or char_length(decision_reason) <= 200),
  updated_at timestamptz not null default now(),
  constraint trusted_seller_reviews_decided_stamp
    check ((status = 'PENDING') = (decided_at is null))
);

comment on table cardtrade.trusted_seller_reviews is
  'One Trusted Seller review per member (0152). Service-role writes; the member reads their own row without staff_notes.';

create index if not exists trusted_seller_reviews_queue_idx
  on cardtrade.trusted_seller_reviews (status, requested_at desc);

alter table cardtrade.trusted_seller_reviews enable row level security;

create policy trusted_seller_reviews_owner_select
  on cardtrade.trusted_seller_reviews
  for select
  to authenticated
  using (profile_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Approval guard. Belt and braces behind the admin action's own checks: a member
-- who is not identity-verified, is fraud-banned or has closed their account is
-- never approved, whichever path writes the row.
-- ---------------------------------------------------------------------------
create or replace function cardtrade.trusted_seller_reviews_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_profile record;
begin
  new.updated_at := now();

  if new.status = 'APPROVED' and (tg_op = 'INSERT' or old.status is distinct from 'APPROVED') then
    select p.identity_check_status, p.fraud_banned_at, p.closed_at
      into v_profile
      from cardtrade.profiles p
     where p.id = new.profile_id;

    -- Two checks, not one OR: the record's fields cannot be read until it is assigned.
    if not found then
      raise exception 'trusted-seller-ineligible' using errcode = 'P0001';
    end if;
    if v_profile.identity_check_status is distinct from 'VERIFIED'::cardtrade.identity_check_status
       or v_profile.fraud_banned_at is not null
       or v_profile.closed_at is not null then
      raise exception 'trusted-seller-ineligible' using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$function$;

create trigger trusted_seller_reviews_guard
  before insert or update on cardtrade.trusted_seller_reviews
  for each row execute function cardtrade.trusted_seller_reviews_guard();

-- ---------------------------------------------------------------------------
-- The one writer of profiles.trusted_seller_at. APPROVED stamps it (keeping an
-- existing stamp), anything else clears it. Skips the write when nothing changes,
-- so a notes edit or a re-save does not touch the profile row.
-- ---------------------------------------------------------------------------
create or replace function cardtrade.trusted_seller_reviews_sync_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.status = 'APPROVED' then
    update cardtrade.profiles
       set trusted_seller_at = now()
     where id = new.profile_id
       and trusted_seller_at is null;
  else
    update cardtrade.profiles
       set trusted_seller_at = null
     where id = new.profile_id
       and trusted_seller_at is not null;
  end if;
  return null;
end;
$function$;

create trigger trusted_seller_reviews_sync_profile
  after insert or update of status on cardtrade.trusted_seller_reviews
  for each row execute function cardtrade.trusted_seller_reviews_sync_profile();

-- ---------------------------------------------------------------------------
-- A ban or a closure ends the review. Fires only on the transition into banned or
-- closed, so it runs once. The review update above then clears trusted_seller_at.
-- ---------------------------------------------------------------------------
create or replace function cardtrade.profiles_end_trusted_seller_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  update cardtrade.trusted_seller_reviews
     set status = case when status = 'APPROVED' then 'REVOKED' else 'DECLINED' end,
         decided_at = now(),
         decided_by = null,
         decision_reason = case
           when new.fraud_banned_at is not null then 'ACCOUNT_SUSPENDED'
           else 'ACCOUNT_CLOSED'
         end
   where profile_id = new.id
     and status in ('PENDING', 'APPROVED');
  return null;
end;
$function$;

create trigger profiles_end_trusted_seller_review
  after update of fraud_banned_at, closed_at on cardtrade.profiles
  for each row
  when (
    (new.fraud_banned_at is not null and old.fraud_banned_at is null)
    or (new.closed_at is not null and old.closed_at is null)
  )
  execute function cardtrade.profiles_end_trusted_seller_review();

-- ---------------------------------------------------------------------------
-- The public badge. Every column from 0127 is kept in order and one is appended,
-- so `create or replace` is enough; `discoverable_profiles` is re-created to pick
-- it up because Postgres expands its `*` at creation. Grants survive.
-- ---------------------------------------------------------------------------
create or replace view cardtrade.public_profiles as
  select
    id,
    case
      when closed_at is null then display_name
      else 'Closed account'::text
    end as display_name,
    rating,
    rating_count,
    (identity_check_status = 'VERIFIED'::cardtrade.identity_check_status) as is_verified,
    case
      when identity_check_status = 'VERIFIED'::cardtrade.identity_check_status
      then split_part(btrim(coalesce(identity_check_name, merchant_legal_entity_name)), ' '::text, 1)
      else null::text
    end as identity_first_name,
    region_code,
    case when closed_at is null then avatar_path else null::text end as avatar_path,
    case when closed_at is null then social_links else null::jsonb end as social_links,
    case when closed_at is null then bio else null::text end as bio,
    closed_at,
    date_trunc('month', created_at) as member_since,
    (trusted_seller_at is not null and closed_at is null) as is_trusted_seller
  from cardtrade.profiles;

create or replace view cardtrade.discoverable_profiles as
  select *
  from cardtrade.public_profiles
  where closed_at is null;

-- ---------------------------------------------------------------------------
-- Grants last, per the convention in the tech steering doc.
-- ---------------------------------------------------------------------------
revoke all on function cardtrade.trusted_seller_reviews_guard() from public, anon, authenticated;
revoke all on function cardtrade.trusted_seller_reviews_sync_profile() from public, anon, authenticated;
revoke all on function cardtrade.profiles_end_trusted_seller_review() from public, anon, authenticated;

revoke all on cardtrade.trusted_seller_reviews from anon, authenticated;
grant select (id, profile_id, status, instagram_handle, requested_at, decided_at)
  on cardtrade.trusted_seller_reviews to authenticated;
grant select, insert, update on cardtrade.trusted_seller_reviews to service_role;
