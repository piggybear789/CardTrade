-- 0168_social_claim_avatars.sql
--
-- A picture for an unclaimed handle (0155), copied from its public Instagram profile by
-- the reference importer (0166).
--
-- A COPY, NOT A LINK. Instagram's picture URLs are signed and expire within days, so the
-- importer downloads the picture once and stores it in the public `profile-images` bucket
-- at `instagram/<social_claims.id>.<ext>`. `avatar_path` is that object path, never a URL,
-- exactly like `profiles.avatar_path` (0066), so `avatarUrl()` resolves both.
--
-- A CLAIMED HANDLE SHOWS ITS MEMBER. Once a member claims the handle, their own profile
-- picture is what every read path shows; this one is only for handles nobody has claimed.
-- Staff remove one by nulling the column and deleting the object.

alter table cardtrade.social_claims
  add column if not exists avatar_path text,
  add column if not exists avatar_fetched_at timestamptz;

alter table cardtrade.social_claims
  drop constraint if exists social_claims_avatar_path_check,
  add constraint social_claims_avatar_path_check
    check (avatar_path is null or avatar_path ~ '^instagram/[0-9a-f-]{36}\.(jpg|png|webp)$');

comment on column cardtrade.social_claims.avatar_path is
  'Object path in profile-images (instagram/<id>.<ext>) of the handle''s copied public profile picture, or null (0168).';
comment on column cardtrade.social_claims.avatar_fetched_at is
  'When the importer last tried to copy the picture, found or not, so it is not retried every run (0168).';
