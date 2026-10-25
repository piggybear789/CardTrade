-- 0163_reference_edits.sql
--
-- A member can edit or withdraw a reference they left. Withdrawal already exists as
-- status WITHDRAWN (0155). An edit changes what readers see after they may have read
-- it, so the reference says when it was last edited: `edited_at`, public on the view.
--
-- Appended at the end of the view's columns, which CREATE OR REPLACE allows.

alter table cardtrade.member_references
  add column if not exists edited_at timestamptz;

comment on column cardtrade.member_references.edited_at is
  'When the author last changed the reference after publishing it (0163). Null if never.';

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
    edited_at
  from cardtrade.member_references
  where status = 'LIVE';

grant select on cardtrade.reference_edges_public to anon, authenticated, service_role;
