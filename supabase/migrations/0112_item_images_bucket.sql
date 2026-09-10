-- 0112_item_images_bucket.sql
-- Codify the `item-images` bucket as schema rather than as a runtime side effect.
--
-- WHY THIS EXISTS
-- ---------------
-- Every other bucket the marketplace owns is created by a migration: `profile-images`
-- in 0066, `dispute-evidence` in 0082, `message-attachments` in 0100. `item-images` was
-- the exception — it was only ever created by the app's ensure-bucket path in
-- `lib/storage/` the first time somebody uploaded a listing photo.
--
-- That went unnoticed until the marketplace was stood up in a second region and the
-- catalog came up with no bucket to read images from. A listing's photos are not
-- optional decoration: `items.image_paths` is non-empty by validation (1-10 images), so
-- a missing bucket means every listing renders broken, and the failure only appears once
-- a human looks at the page. Provisioning that depends on someone having previously
-- uploaded a file is not provisioning.
--
-- Values match the bucket as it exists in the original project, so applying this to that
-- project is a no-op:
--   public             = true      (public read; see below)
--   file_size_limit    = 10 MB
--   allowed_mime_types = png, jpeg, jpg, webp, gif
--
-- Idempotent, so it converges an environment where the app's ensure-bucket path got
-- there first — the same reasoning 0066 records for `profile-images`.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'item-images',
  'item-images',
  true,
  10485760, -- 10 MB
  array['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- NO storage.objects policies, deliberately. Public read comes from `public = true` on
-- the bucket, and writes go through the server-side upload path rather than direct
-- client inserts — the same shape 0066 chose for `profile-images` and documents there.
-- Adding an `authenticated` write policy here would let any signed-in member write into
-- any listing's folder.
