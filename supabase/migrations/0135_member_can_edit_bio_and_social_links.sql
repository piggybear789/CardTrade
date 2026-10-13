-- 0135_member_can_edit_bio_and_social_links.sql
--
-- Members could not save their bio or social links.
--
-- 0072 narrowed the member UPDATE grant on profiles to a column list, and `bio` (0086)
-- and `social_links` (0085) were never added to it, so `updateBio` and the social-links
-- action were refused with a permission error on every save ("Could not save your
-- bio."). RLS still limits the update to the member's own row.
--
-- The grant lets a member write these columns straight through PostgREST, not only via
-- the server action, so the action's own limits are mirrored as CHECKs here: a bio of at
-- most 280 characters, and social links as a small JSON object.

alter table cardtrade.profiles
  add constraint profiles_bio_length
    check (bio is null or char_length(bio) <= 280);

alter table cardtrade.profiles
  add constraint profiles_social_links_shape
    check (
      social_links is null
      or (jsonb_typeof(social_links) = 'object' and pg_column_size(social_links) <= 4096)
    );

grant update (bio, social_links) on cardtrade.profiles to authenticated;
