-- 0161_reference_proofs_private.sql
--
-- Proof screenshots are staff-only (0155): the composer tells the member "Only our team
-- sees these", and staff read them through signed URLs in /admin. 0156 added
-- `proof_paths` to `reference_edges_public`, the anon-readable projection, so the public
-- graph could sign and show them. Rebuild the view without it.
--
-- A view cannot lose a column through CREATE OR REPLACE, so it is dropped and recreated
-- and its grants restated. Nothing depends on it.

drop view if exists cardtrade.reference_edges_public;

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
    rating
  from cardtrade.member_references
  where status = 'LIVE';

comment on view cardtrade.reference_edges_public is
  'LIVE reference edges (0155, 0161). Public projection: no person keys, no proof paths, no staff fields.';

grant select on cardtrade.reference_edges_public to anon, authenticated, service_role;
