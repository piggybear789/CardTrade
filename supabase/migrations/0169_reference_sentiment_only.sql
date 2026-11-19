-- 0169_reference_sentiment_only.sql
--
-- References are Good / So-so / Bad, not 1..5 stars.
--
-- 0156 added `member_references.rating` as a 1..5 star score with `sentiment` derived
-- from it (4-5 POSITIVE, 3 NEUTRAL, 1-2 NEGATIVE). Most references are read from
-- Instagram comments like "did a deal with this guy, legit", and nobody, a person or
-- the importer, can tell a 4 from a 5 in that. `sentiment` was always the column every
-- rule reads (the unique indexes, the ban and closure folds, claim moves, the people
-- counts); `rating` was display only. It goes.
--
-- Backfill: none needed. Every write path stored both columns together, and on
-- 2026-11-10 every row's sentiment matched its rating's band. The UPDATE below re-derives
-- it anyway so the column cannot be dropped out from under a row that disagrees; it
-- touches nothing when the data is consistent. A row it would turn NEGATIVE gets the
-- category a negative needs (0156's `member_references_negative_category`).
--
-- `create or replace view` cannot remove a column, so the public view is dropped and
-- recreated with the same columns minus `rating`, in the same order, and re-granted.

begin;

update cardtrade.member_references
   set sentiment = case
         when rating >= 4 then 'POSITIVE'
         when rating = 3 then 'NEUTRAL'
         else 'NEGATIVE'
       end,
       category = case
         when rating <= 2 then coalesce(category, 'OTHER')
         else category
       end,
       updated_at = now()
 where sentiment is distinct from case
         when rating >= 4 then 'POSITIVE'
         when rating = 3 then 'NEUTRAL'
         else 'NEGATIVE'
       end;

drop view if exists cardtrade.reference_edges_public;

alter table cardtrade.member_references drop column if exists rating;

create view cardtrade.reference_edges_public as
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
    edited_at,
    voucher_claim_id,
    source,
    source_url
  from cardtrade.member_references
  where status = 'LIVE';

comment on view cardtrade.reference_edges_public is
  'LIVE reference edges (0155, 0161, 0169). Public projection: no person keys, no proof paths, no staff fields.';

grant select on cardtrade.reference_edges_public to anon, authenticated, service_role;

commit;
