-- 0170_external_seller_links.sql
--
-- References (0155): a seller's track record on ANOTHER platform (eBay first).
--
-- WHAT IT IS. A handle with no reference post can still be a known quantity: years of
-- eBay feedback say a lot. This table records WHICH eBay account a staff member has
-- checked belongs to a handle (`social_claims`), so the references page can show that
-- account's public feedback beside the references, clearly labelled as another site's
-- numbers and never counted as a NoDitto reference.
--
-- WHAT IT DOES NOT STORE. eBay's numbers (feedback score, percentage positive). They are
-- read live from eBay's own API when a page is built and cached for an hour, so they are
-- never stale here, and eBay's content is not kept in our database. Only the link is ours.
--
-- A NAME MATCH IS NOT A LINK. Anyone can register `serialcollect_` on eBay, and a scammer
-- can copy a known seller's handle to borrow their record. So a row is written only by an
-- admin, who must say what they checked (`staff_note`, 10 characters or more to confirm).
-- The finder suggests candidates and shows eBay's own details; it never writes a row.
-- A member who signs in with eBay (0155 claim flow) needs no row at all: the page reads
-- that claim directly, because their sign-in is stronger proof than any staff note.
--
-- ONE ACCOUNT, ONE HANDLE. A confirmed eBay account belongs to exactly one handle
-- (`external_seller_links_one_confirmed`), so a second handle cannot attach to the same
-- record. REJECTED rows remember "not them" so the finder does not suggest it again.
--
-- ACCESS. Service role only, like the other reference tables. Nothing member-facing reads
-- the table: the page loader reads it on the service role and exposes the eBay username
-- and the live numbers, never the staff note or who decided.

create table if not exists cardtrade.external_seller_links (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references cardtrade.social_claims(id) on delete cascade,
  platform text not null
    check (platform in ('ebay')),
  external_username text not null
    check (char_length(external_username) between 1 and 64
           and external_username ~ '^[A-Za-z0-9._*-]+$'),
  username_norm text generated always as (lower(external_username)) stored,
  status text not null
    check (status in ('CONFIRMED', 'REJECTED')),
  -- What the admin checked, in their own words. Staff-only.
  staff_note text not null
    check (char_length(btrim(staff_note)) between 3 and 1000),
  decided_by uuid references cardtrade.profiles(id) on delete set null,
  decided_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_seller_links_confirm_note
    check (status <> 'CONFIRMED' or char_length(btrim(staff_note)) >= 10),
  constraint external_seller_links_unique
    unique (claim_id, platform, username_norm)
);

comment on table cardtrade.external_seller_links is
  'Which account on another platform a staff member checked belongs to a handle (0170). The platform''s numbers are read live, never stored. Service role only.';

-- A confirmed account belongs to one handle: two handles cannot share one record.
create unique index if not exists external_seller_links_one_confirmed
  on cardtrade.external_seller_links (platform, username_norm)
  where status = 'CONFIRMED';

-- The page loader's read: a handle's confirmed links.
create index if not exists external_seller_links_claim_idx
  on cardtrade.external_seller_links (claim_id)
  where status = 'CONFIRMED';

alter table cardtrade.external_seller_links enable row level security;

revoke all on cardtrade.external_seller_links from public, anon, authenticated;
grant select, insert, update, delete on cardtrade.external_seller_links to service_role;
