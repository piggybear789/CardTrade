-- 0167_ig_reference_posts.sql
--
-- The Instagram posts the reference importer (0166) reads comments from, with the comment
-- count it last saw on each.
--
-- WHY. Comments are the expensive read (SocialCrawl bills 5 credits per page of 15), and a
-- refresh only needs the comments that arrived since the last check. Reading a post's
-- current comment count costs 1 credit; comparing it with `comments_count` says whether
-- there is anything new at all, so a refresh pages comments only on posts that changed,
-- and only back to `checked_at`.
--
-- Service role only, like the rest of the importer's bookkeeping (0166). Nothing
-- member-facing reads it.

create table if not exists cardtrade.ig_reference_posts (
  shortcode text primary key
    check (shortcode ~ '^[A-Za-z0-9_-]{5,40}$'),
  owner_handle_norm text not null
    check (char_length(owner_handle_norm) between 1 and 30),
  -- REFERENCE: the owner asked people they dealt with to comment. WARNING: a post calling
  -- out a named handle, whose comments may hold other victims' first-hand accounts.
  kind text not null default 'REFERENCE'
    check (kind in ('REFERENCE', 'WARNING')),
  comments_count integer
    check (comments_count is null or comments_count >= 0),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table cardtrade.ig_reference_posts is
  'Instagram posts the reference importer reads comments from, with the comment count last seen (0167). Service role only.';

create index if not exists ig_reference_posts_owner_idx
  on cardtrade.ig_reference_posts (owner_handle_norm);

alter table cardtrade.ig_reference_posts enable row level security;
revoke all on cardtrade.ig_reference_posts from public, anon, authenticated;
grant select, insert, update, delete on cardtrade.ig_reference_posts to service_role;

-- The reference posts already imported from (0166), recovered from the comment URLs in
-- `reference_imports` (`.../p/<shortcode>/c/<id>`). Their count is unknown, so the first
-- refresh reads one page of each and records it.
insert into cardtrade.ig_reference_posts (shortcode, owner_handle_norm, kind)
select distinct on (shortcode) shortcode, owner_handle_norm, 'REFERENCE'
  from (
    select substring(i.source_url from 'instagram\.com/(?:[^/]+/)?(?:p|reel)/([A-Za-z0-9_-]+)') as shortcode,
           t.handle_norm as owner_handle_norm
      from cardtrade.reference_imports i
      join cardtrade.member_references m on m.id = i.reference_id
      join cardtrade.social_claims t on t.id = m.target_claim_id
     where i.source_ref like 'instagram:comment:%'
  ) found
 where shortcode is not null
   and shortcode ~ '^[A-Za-z0-9_-]{5,40}$'
   and char_length(owner_handle_norm) between 1 and 30
on conflict (shortcode) do nothing;

-- Accounts a network error failed in the first crawl get another go.
update cardtrade.ig_crawl_accounts
   set status = 'QUEUED', skip_reason = null, updated_at = now()
 where status = 'FAILED';
