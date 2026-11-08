-- 0166_imported_references.sql
--
-- References (0155) imported from Instagram.
--
-- AUTHORED BY A HANDLE. A member reference is written by an ID-verified member
-- (`voucher_id`). An imported one was written on Instagram by someone who may never have
-- visited NoDitto: a comment on a seller's "reference post", a buyer's thank-you story,
-- a public call-out. Its author is the handle that wrote it (`voucher_claim_id`, a
-- `social_claims` row), exactly as an unclaimed TARGET already is (`target_claim_id`).
-- `voucher_id` is therefore nullable, and exactly the member-written rows must carry it.
--
-- CLAIMING THE HANDLE MAKES THEM THE CLAIMANT'S OWN. When a member claims the handle,
-- `social_claims_move_references` now sets `voucher_id` and the claimant's person key on
-- every imported reference that handle wrote, so the existing author actions (edit,
-- withdraw, attach a receipt, all scoped by `voucher_id`) reach them. One the claimant
-- already left the same person for the same sentiment folds into theirs, and one about
-- themselves ends, as for references left FOR a handle. Releasing a wrongly claimed
-- handle (`release_social_claim`) gives them back to the handle.
--
-- PERSON KEY. An unclaimed author's `voucher_person_key` is `handle:<social_claims.id>`,
-- a namespace `person_key_for` never returns, so one handle is one person to the
-- uniqueness indexes and to the counts, and never collides with a member.
--
-- WHAT IS NOT STORED. The importer drops what it judges is not a genuine first-hand
-- account of a deal before anything is written: speculation, slurs, posts naming nobody.
-- `reference_imports` records only what was ACCEPTED, so a re-run is idempotent.
--
-- `ig_crawl_accounts` is the importer's queue: which handles it has found, from where,
-- whether they are trading-card accounts, and when it last read them. Staff and the
-- importer only; nothing member-facing reads it.
--
-- The ban fold (0164/0165) compared authors by `voucher_id`; with a handle author that
-- is null and never equal, so a ban could move an imported row onto a handle that
-- already held one from the same author and fail on the new unique index. Authors are
-- now compared by `voucher_id` OR person key there and in `release_social_claim`.

alter table cardtrade.member_references
  alter column voucher_id drop not null,
  add column if not exists voucher_claim_id uuid references cardtrade.social_claims(id) on delete cascade,
  add column if not exists source text not null default 'MEMBER',
  add column if not exists source_url text,
  add column if not exists imported_at timestamptz;

alter table cardtrade.member_references
  drop constraint if exists member_references_source_check,
  add constraint member_references_source_check
    check (source in ('MEMBER', 'INSTAGRAM_IMPORT')),
  drop constraint if exists member_references_source_url_check,
  add constraint member_references_source_url_check
    check (source_url is null or char_length(source_url) <= 500),
  drop constraint if exists member_references_one_author,
  add constraint member_references_one_author
    check (voucher_id is not null or voucher_claim_id is not null),
  drop constraint if exists member_references_member_authored,
  add constraint member_references_member_authored
    check (source <> 'MEMBER' or voucher_id is not null),
  drop constraint if exists member_references_import_traced,
  add constraint member_references_import_traced
    check (source = 'MEMBER' or (source_url is not null and voucher_claim_id is not null)),
  drop constraint if exists member_references_not_self_handle,
  add constraint member_references_not_self_handle
    check (voucher_claim_id is null or target_claim_id is null or voucher_claim_id <> target_claim_id);

comment on column cardtrade.member_references.voucher_id is
  'The member who wrote it. Null for a reference imported from a handle nobody has claimed (0166).';
comment on column cardtrade.member_references.voucher_claim_id is
  'The handle that wrote an imported reference (0166). Kept after the handle is claimed.';
comment on column cardtrade.member_references.source is
  'MEMBER: written on NoDitto. INSTAGRAM_IMPORT: read from a public Instagram post (0166).';
comment on column cardtrade.member_references.source_url is
  'Where an imported reference was read, for readers to check the original (0166).';

-- One LIVE edge per unclaimed author handle per person per sentiment, as for members.
create unique index if not exists member_references_handle_author_unique
  on cardtrade.member_references (voucher_claim_id, coalesce(target_profile_id, target_claim_id), sentiment)
  where status = 'LIVE' and voucher_id is null;

create index if not exists member_references_voucher_claim_idx
  on cardtrade.member_references (voucher_claim_id, created_at desc)
  where voucher_claim_id is not null and status = 'LIVE';

-- ---------------------------------------------------------------------------
-- Accepted import items, so a re-run never writes the same item twice.
-- ---------------------------------------------------------------------------
create table if not exists cardtrade.reference_imports (
  source_ref text primary key
    check (char_length(source_ref) between 3 and 200),
  reference_id uuid references cardtrade.member_references(id) on delete set null,
  source_url text not null
    check (char_length(source_url) <= 500),
  imported_at timestamptz not null default now()
);

comment on table cardtrade.reference_imports is
  'Instagram items the importer turned into a reference (0166). Rejected items are never stored. Service role only.';

alter table cardtrade.reference_imports enable row level security;
revoke all on cardtrade.reference_imports from public, anon, authenticated;
grant select, insert, update, delete on cardtrade.reference_imports to service_role;

-- ---------------------------------------------------------------------------
-- The importer's crawl queue.
-- ---------------------------------------------------------------------------
create table if not exists cardtrade.ig_crawl_accounts (
  handle_norm text primary key
    check (char_length(handle_norm) between 1 and 30),
  status text not null default 'QUEUED'
    check (status in ('QUEUED', 'DONE', 'SKIPPED', 'FAILED')),
  depth integer not null default 0 check (depth >= 0),
  discovered_from text,
  discovered_via text
    check (discovered_via is null or char_length(discovered_via) <= 40),
  is_tcg boolean,
  skip_reason text
    check (skip_reason is null or char_length(skip_reason) <= 200),
  references_found integer not null default 0 check (references_found >= 0),
  crawled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table cardtrade.ig_crawl_accounts is
  'Instagram handles the reference importer has found and read (0166). Service role only.';

create index if not exists ig_crawl_accounts_queue_idx
  on cardtrade.ig_crawl_accounts (status, depth, created_at);

alter table cardtrade.ig_crawl_accounts enable row level security;
revoke all on cardtrade.ig_crawl_accounts from public, anon, authenticated;
grant select, insert, update, delete on cardtrade.ig_crawl_accounts to service_role;

-- ---------------------------------------------------------------------------
-- Public view: the author handle and where an import came from, appended.
-- ---------------------------------------------------------------------------
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
    created_at,
    rating,
    edited_at,
    voucher_claim_id,
    source,
    source_url
  from cardtrade.member_references
  where status = 'LIVE';

grant select on cardtrade.reference_edges_public to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Claiming (0165), plus authorship of imported references.
-- ---------------------------------------------------------------------------
create or replace function cardtrade.social_claims_move_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_key text;
  v_edge record;
  v_existing uuid;
begin
  if new.claimed_profile_id is null
     or (tg_op = 'UPDATE' and old.claimed_profile_id is not distinct from new.claimed_profile_id) then
    return new;
  end if;

  v_key := cardtrade.person_key_for(new.claimed_profile_id);

  -- The claimant's own references to the handle end: nobody references themselves.
  update cardtrade.member_references
     set status = 'REMOVED',
         updated_at = now()
   where target_claim_id = new.id
     and status = 'LIVE'
     and (voucher_id = new.claimed_profile_id or voucher_person_key = v_key);

  -- One person, one edge per sentiment, even from two accounts: the oldest keeps it.
  for v_edge in
    select m.id, m.voucher_person_key, m.sentiment, m.deal_count, m.created_at
      from cardtrade.member_references m
     where m.target_claim_id = new.id
       and m.status = 'LIVE'
     order by m.created_at, m.id
  loop
    select e.id
      into v_existing
      from cardtrade.member_references e
     where e.status = 'LIVE'
       and e.id <> v_edge.id
       and e.voucher_person_key = v_edge.voucher_person_key
       and e.sentiment = v_edge.sentiment
       and (
         e.target_person_key = v_key
         or e.target_profile_id = new.claimed_profile_id
         or (e.target_claim_id = new.id and (e.created_at, e.id) < (v_edge.created_at, v_edge.id))
       )
     order by (e.target_claim_id is null) desc, e.created_at
     limit 1;

    if v_existing is not null then
      update cardtrade.member_references
         set deal_count = deal_count + v_edge.deal_count,
             updated_at = now()
       where id = v_existing;
      update cardtrade.member_references
         set status = 'REMOVED',
             updated_at = now()
       where id = v_edge.id;
    end if;
  end loop;

  update cardtrade.member_references
     set target_profile_id = new.claimed_profile_id,
         target_claim_id = null,
         target_person_key = v_key,
         origin_claim_id = coalesce(origin_claim_id, new.id),
         updated_at = now()
   where target_claim_id = new.id
     and status = 'LIVE';

  -- Imported references this handle WROTE (0166) become the claimant's own. Any about
  -- the claimant themselves end first.
  update cardtrade.member_references
     set status = 'REMOVED',
         updated_at = now()
   where voucher_claim_id = new.id
     and voucher_id is null
     and status = 'LIVE'
     and (target_profile_id = new.claimed_profile_id or target_person_key = v_key);

  for v_edge in
    select m.id, m.sentiment, m.deal_count, m.target_profile_id, m.target_claim_id, m.target_person_key
      from cardtrade.member_references m
     where m.voucher_claim_id = new.id
       and m.voucher_id is null
       and m.status = 'LIVE'
     order by m.created_at, m.id
  loop
    select e.id
      into v_existing
      from cardtrade.member_references e
     where e.status = 'LIVE'
       and e.id <> v_edge.id
       and e.sentiment = v_edge.sentiment
       and (e.voucher_id = new.claimed_profile_id or e.voucher_person_key = v_key)
       and (
         (v_edge.target_person_key is not null and e.target_person_key = v_edge.target_person_key)
         or (v_edge.target_profile_id is not null and e.target_profile_id = v_edge.target_profile_id)
         or (v_edge.target_claim_id is not null and e.target_claim_id = v_edge.target_claim_id)
       )
     order by e.created_at
     limit 1;

    if v_existing is not null then
      update cardtrade.member_references
         set deal_count = deal_count + v_edge.deal_count,
             updated_at = now()
       where id = v_existing;
      update cardtrade.member_references
         set status = 'REMOVED',
             updated_at = now()
       where id = v_edge.id;
    else
      update cardtrade.member_references
         set voucher_id = new.claimed_profile_id,
             voucher_person_key = v_key,
             updated_at = now()
       where id = v_edge.id;
    end if;
  end loop;

  update cardtrade.handle_claim_requests
     set status = 'DECLINED',
         staff_notes = coalesce(staff_notes, 'Closed automatically: the handle was claimed by another member.'),
         decided_at = now(),
         updated_at = now()
   where claim_id = new.id
     and status = 'PENDING'
     and claimant_id <> new.claimed_profile_id;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Ban or closure (0165), comparing authors by person key as well as member id.
-- ---------------------------------------------------------------------------
create or replace function cardtrade.profiles_remove_from_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_banned boolean := new.fraud_banned_at is not null and old.fraud_banned_at is null;
  v_edge record;
  v_claim uuid;
  v_existing uuid;
begin
  if v_banned then
    update cardtrade.member_references
       set status = 'REMOVED',
           updated_at = now()
     where status = 'LIVE'
       and (voucher_id = new.id or (target_profile_id = new.id and sentiment = 'POSITIVE'));
  end if;

  for v_edge in
    select m.id, m.voucher_id, m.voucher_person_key, m.platform, m.sentiment, m.deal_count, m.origin_claim_id
      from cardtrade.member_references m
     where m.status = 'LIVE'
       and m.target_profile_id = new.id
     order by m.created_at
  loop
    select c.id
      into v_claim
      from cardtrade.social_claims c
     where c.claimed_profile_id = new.id
     order by (c.id = v_edge.origin_claim_id) desc nulls last,
              (c.platform = v_edge.platform) desc,
              c.claimed_at,
              c.id
     limit 1;

    if v_claim is null then
      -- Nowhere public to keep it. A ban ends it; a closed member's page is gone anyway.
      if v_banned then
        update cardtrade.member_references
           set status = 'REMOVED',
               updated_at = now()
         where id = v_edge.id;
      end if;
      continue;
    end if;

    select e.id
      into v_existing
      from cardtrade.member_references e
     where e.status = 'LIVE'
       and e.target_claim_id = v_claim
       and (e.voucher_id = v_edge.voucher_id or e.voucher_person_key = v_edge.voucher_person_key)
       and e.sentiment = v_edge.sentiment
     limit 1;

    if v_existing is not null then
      update cardtrade.member_references
         set deal_count = deal_count + v_edge.deal_count,
             updated_at = now()
       where id = v_existing;
      update cardtrade.member_references
         set status = 'REMOVED',
             updated_at = now()
       where id = v_edge.id;
    else
      update cardtrade.member_references
         set target_profile_id = null,
             target_claim_id = v_claim,
             target_person_key = null,
             updated_at = now()
       where id = v_edge.id;
    end if;
  end loop;

  update cardtrade.social_claims
     set claimed_profile_id = null,
         claimed_at = null,
         claim_method = 'UNCLAIMED',
         updated_at = now()
   where claimed_profile_id = new.id;

  return null;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Staff remedy (0165), also handing imported authorship back to the handle.
-- ---------------------------------------------------------------------------
create or replace function cardtrade.release_social_claim(p_claim_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_owner uuid;
  v_edge record;
  v_existing uuid;
  v_moved integer := 0;
begin
  select c.claimed_profile_id
    into v_owner
    from cardtrade.social_claims c
   where c.id = p_claim_id
   for update;

  if v_owner is null then
    return 0;
  end if;

  -- The references left FOR this handle go back to it; the ones left for the member
  -- directly stay with the member.
  for v_edge in
    select m.id, m.voucher_id, m.voucher_person_key, m.sentiment, m.deal_count
      from cardtrade.member_references m
     where m.status = 'LIVE'
       and m.target_profile_id = v_owner
       and m.origin_claim_id = p_claim_id
     order by m.created_at
  loop
    select e.id
      into v_existing
      from cardtrade.member_references e
     where e.status = 'LIVE'
       and e.target_claim_id = p_claim_id
       and (e.voucher_id = v_edge.voucher_id or e.voucher_person_key = v_edge.voucher_person_key)
       and e.sentiment = v_edge.sentiment
     limit 1;

    if v_existing is not null then
      update cardtrade.member_references
         set deal_count = deal_count + v_edge.deal_count,
             updated_at = now()
       where id = v_existing;
      update cardtrade.member_references
         set status = 'REMOVED',
             updated_at = now()
       where id = v_edge.id;
    else
      update cardtrade.member_references
         set target_profile_id = null,
             target_claim_id = p_claim_id,
             target_person_key = null,
             updated_at = now()
       where id = v_edge.id;
    end if;
    v_moved := v_moved + 1;
  end loop;

  -- Imported references the handle wrote go back to the handle (0166).
  for v_edge in
    select m.id, m.sentiment, m.deal_count, m.target_profile_id, m.target_claim_id
      from cardtrade.member_references m
     where m.status = 'LIVE'
       and m.voucher_claim_id = p_claim_id
       and m.voucher_id = v_owner
       and m.source <> 'MEMBER'
     order by m.created_at
  loop
    select e.id
      into v_existing
      from cardtrade.member_references e
     where e.status = 'LIVE'
       and e.voucher_claim_id = p_claim_id
       and e.voucher_id is null
       and e.sentiment = v_edge.sentiment
       and coalesce(e.target_profile_id, e.target_claim_id) = coalesce(v_edge.target_profile_id, v_edge.target_claim_id)
     limit 1;

    if v_existing is not null then
      update cardtrade.member_references
         set deal_count = deal_count + v_edge.deal_count,
             updated_at = now()
       where id = v_existing;
      update cardtrade.member_references
         set status = 'REMOVED',
             updated_at = now()
       where id = v_edge.id;
    else
      update cardtrade.member_references
         set voucher_id = null,
             voucher_person_key = 'handle:' || p_claim_id::text,
             updated_at = now()
       where id = v_edge.id;
    end if;
    v_moved := v_moved + 1;
  end loop;

  update cardtrade.social_claims
     set claimed_profile_id = null,
         claimed_at = null,
         claim_method = 'UNCLAIMED',
         updated_at = now()
   where id = p_claim_id;

  return v_moved;
end;
$function$;

revoke all on function cardtrade.social_claims_move_references() from public, anon, authenticated;
revoke all on function cardtrade.profiles_remove_from_references() from public, anon, authenticated;
revoke all on function cardtrade.release_social_claim(uuid) from public, anon, authenticated;
grant execute on function cardtrade.release_social_claim(uuid) to service_role;
