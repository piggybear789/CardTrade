-- 0156_neutral_reference_sentiment.sql
--
-- Adds NEUTRAL as a third sentiment and a 1..5 `rating` column on
-- `member_references`, and removes `in-person` as a reference platform.

update cardtrade.member_references
   set platform = 'instagram'
 where platform = 'in-person';

alter table cardtrade.member_references
  add column if not exists rating smallint not null default 5
    check (rating between 1 and 5);

update cardtrade.member_references
   set rating = case
     when sentiment = 'NEGATIVE' then 1
     when sentiment = 'NEUTRAL' then 3
     else 5
   end;

alter table cardtrade.member_references
  drop constraint if exists member_references_sentiment_check,
  drop constraint if exists member_references_negative_category,
  drop constraint if exists member_references_platform_check,
  add constraint member_references_sentiment_check
    check (sentiment in ('POSITIVE', 'NEUTRAL', 'NEGATIVE')),
  add constraint member_references_negative_category
    check (sentiment <> 'NEGATIVE' or category is not null),
  add constraint member_references_platform_check
    check (platform in ('instagram', 'facebook', 'discord', 'ebay', 'whatnot', 'noditto', 'other'));

alter table cardtrade.social_claims
  drop constraint if exists social_claims_claim_method_check,
  add constraint social_claims_claim_method_check
    check (claim_method in ('UNCLAIMED', 'PROFILE_LINK', 'BIO_CODE', 'OAUTH', 'DM_BOT', 'STAFF'));

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
    proof_paths
  from cardtrade.member_references
  where status = 'LIVE';

grant select on cardtrade.reference_edges_public to anon, authenticated;
