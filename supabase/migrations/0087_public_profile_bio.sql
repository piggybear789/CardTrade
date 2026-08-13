-- 0087_public_profile_bio.sql
--
-- Exposes `profiles.bio` on the catalog-safe `public_profiles` view.
--
-- WHY THIS IS A SEPARATE MIGRATION. 0086 added the column but did not recreate the
-- view, so the bio was WRITE-ONLY: a member could set it on their settings page
-- (which reads `profiles` directly under RLS) but nobody else could ever see it,
-- because the seller profile reads through this view. Half a feature.
--
-- The view uses an explicit column list (0069), so adding a column to the table
-- does not surface it — the view has to be recreated. Every column from 0085 is
-- preserved below; dropping one would break the catalog and seller pages.
--
-- `is_verified` IS REPRODUCED BYTE-FOR-BYTE from 0085 deliberately. The
-- denormalisation-agreement property in `tests/property/identityGate.test.ts` reads
-- the NEWEST migration defining this expression and evaluates it against
-- `satisfiesIdentityGate`; it fails loudly on a shape it cannot interpret, and it
-- throws outright if a Connect column (`merchant_status`,
-- `merchant_settlements_enabled`) appears in a gate expression. Keep it in the plain
-- `identity_check_status = 'VERIFIED'::cardtrade.identity_check_status` form.
--
-- Bio is member-authored free text, unlike every other column here, which is either
-- provider-reported or derived. It is safe to expose because it is already public by
-- intent — but it is NOT part of the identity disclosure and must never be presented
-- as verified. Rendering treats it as untrusted copy.

create or replace view cardtrade.public_profiles as
  select
    id,
    display_name,
    rating,
    rating_count,
    (identity_check_status = 'VERIFIED'::cardtrade.identity_check_status) as is_verified,
    case
      when identity_check_status = 'VERIFIED'::cardtrade.identity_check_status
      then split_part(btrim(coalesce(identity_check_name, merchant_legal_entity_name)), ' '::text, 1)
      else null::text
    end as identity_first_name,
    region_code,
    avatar_path,
    social_links,
    bio
  from cardtrade.profiles;

grant select on cardtrade.public_profiles to anon, authenticated;
