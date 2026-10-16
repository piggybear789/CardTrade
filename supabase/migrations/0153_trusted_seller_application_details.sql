-- 0153_trusted_seller_application_details.sql
--
-- A Trusted Seller application is one free-text answer plus optional photos (0152
-- follow-up). It used to be a single Instagram handle, which assumed every seller
-- sells on Instagram.
--
--   * `details` is whatever the applicant wants to tell us: where they sell, for how
--     long, what, and who can vouch for them.
--   * `photo_paths` are screenshots or photos (feedback, vouches, sold listings, a
--     stall), stored in the private `trusted-seller-photos` bucket under the
--     applicant's own id. Staff read them through signed URLs.
--   * `instagram_handle` becomes nullable and stays only for rows written before this.
--
-- None of it is member-readable: 0152 granted the member six named columns, and the
-- new ones are not among them. The applicant's own edit form reads them through the
-- service role after checking who is asking.

alter table cardtrade.trusted_seller_reviews
  alter column instagram_handle drop not null,
  add column if not exists details text
    check (details is null or char_length(details) <= 4000),
  add column if not exists photo_paths text[] not null default '{}'
    check (cardinality(photo_paths) <= 10);

comment on column cardtrade.trusted_seller_reviews.details is
  'The applicant''s own account of their selling, free text (0153). Staff only.';
comment on column cardtrade.trusted_seller_reviews.photo_paths is
  'Object paths in the private trusted-seller-photos bucket, under <profile_id>/ (0153). Staff only.';

-- Private: nothing here is ever public, and reads are signed by the server after an
-- owner or staff check.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'trusted-seller-photos',
  'trusted-seller-photos',
  false,
  10485760, -- 10 MB
  array['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
