-- 0066: Profile pictures (avatars).
--
-- SEQUENCED AFTER 0065_regional_marketplace, and that ordering is load-bearing.
-- 0065 DROPS and recreates `public_profiles` to add `region_code`, so an avatar
-- added to that view before 0065 ran would be silently deleted by it. This
-- migration therefore re-declares the view carrying BOTH columns.
--
-- WHY
-- ---
-- A marketplace where strangers post physical goods to each other on the strength
-- of an escrow contract runs on recognisability. Until now a member is a display
-- name and a rating, which is identical treatment for a member with forty
-- completed sales and one who signed up this morning.
--
-- WHAT AN AVATAR IS NOT. It is not identity and it must never be read as such.
-- The Identity_Gate (`merchant_status = 'APPROVED'` and
-- `merchant_settlements_enabled`) is the only assurance the platform holds, and
-- the only provider-verified name is `merchant_legal_entity_name`. An avatar is a
-- self-chosen picture with no verification whatsoever, so it sits beside the
-- verified badge and never in place of it.
--
-- STORAGE MODEL MIRRORS ITEM IMAGES EXACTLY.
-- `profile-images` is PUBLIC for read, and has NO write policy for
-- `authenticated`. Every write is authorised by a single-use signed upload URL
-- minted server-side by the service role against a path the server chooses from
-- the caller's own id. That is the same design as `item-images`: without a token
-- there is no way in, and the browser can neither pick a path nor reach another
-- member's prefix.
--
-- The size cap and MIME allowlist live ON THE BUCKET, not only in application
-- code, because a signed-URL upload goes browser -> Storage without passing
-- through our server. Storage is the only thing in that path that can refuse an
-- oversized file or a non-image.
--
-- 2 MB, not the 10 MB items get: an avatar renders at 24-96px, so the cap is
-- generous already, and a smaller ceiling limits what an abusive upload can cost.
--
-- GIF IS DELIBERATELY EXCLUDED, unlike item images. An animated avatar plays
-- unbidden on every surface the member appears on — catalog cards, chat, the
-- contract room — which is a flashing-image accessibility problem and a nuisance
-- vector, and no member needs animation to be recognisable. Item photos keep GIF
-- because they are evidence for a dispute and we do not re-encode what a camera
-- produced.

-- =============================================================================
-- 1. The column
-- =============================================================================

alter table cardtrade.profiles
  add column avatar_path text;

comment on column cardtrade.profiles.avatar_path is
  'Storage object path in the profile-images bucket, or null. NOT a URL: lib/format.ts resolves it for display. Self-chosen and unverified — never treat as identity, which is the Identity_Gate plus merchant_legal_entity_name.';

-- A path, never a URL, and never an escape from the owner's own prefix. Enforced
-- here as well as server-side because this column is writable by its owner: the
-- server check is the real gate, this stops a malformed value being persisted at
-- all if a future call site forgets one.
alter table cardtrade.profiles
  add constraint profiles_avatar_path_shape
  check (
    avatar_path is null
    or (
      avatar_path <> ''
      and char_length(avatar_path) <= 400
      and avatar_path not like '%..%'
      and avatar_path not like 'http://%'
      and avatar_path not like 'https://%'
    )
  );

-- COLUMN GRANT IS NOT OPTIONAL. `authenticated` holds UPDATE on exactly three
-- columns (contact_email, display_name, onboarding_completed_at) from 0032, and a
-- column added by ALTER TABLE inherits nothing. Without this the owner's own
-- update is refused and the feature fails silently at the last step.
grant select (avatar_path) on cardtrade.profiles to authenticated;
grant update (avatar_path) on cardtrade.profiles to authenticated;

-- =============================================================================
-- 2. Expose it to other members
-- =============================================================================

-- `public_profiles` is the ONLY way one member reads another's profile, so an
-- avatar that is not in this view is invisible everywhere except its owner's own
-- settings page.
--
-- EVERY COLUMN 0065 DECLARED IS REPRODUCED HERE, `region_code` included. 0065
-- dropped and recreated this view; this migration runs after it, so omitting a
-- column here would remove it. `avatar_path` is APPENDED LAST so column ORDER is
-- unchanged for anything selecting positionally, and so `create or replace` is
-- legal — it can add a column at the end but cannot insert one mid-list ("cannot
-- change name of view column"), and replacing rather than dropping avoids
-- rebuilding every dependent object.
--
-- The is_verified and identity_first_name expressions are reproduced VERBATIM.
-- They are load-bearing: the denormalisation-agreement property in
-- tests/property/identityGate.test.ts reads the newest migration that defines
-- is_verified and evaluates it against satisfiesIdentityGate, and it fails loudly
-- on an expression it cannot interpret. Keep the plain
-- `merchant_status = 'APPROVED'::cardtrade.merchant_status and merchant_settlements_enabled`
-- form.
--
-- Still NOT a security_invoker view, so it must remain SELECT-only: writes through
-- it would bypass the owner-only RLS on `profiles` (the 0032 fix).
create or replace view cardtrade.public_profiles as
  select
    id,
    display_name,
    rating,
    rating_count,
    merchant_status = 'APPROVED'::cardtrade.merchant_status and merchant_settlements_enabled as is_verified,
    case
      when merchant_status = 'APPROVED'::cardtrade.merchant_status
        and merchant_settlements_enabled
        and merchant_legal_entity_name is not null
      then split_part(btrim(merchant_legal_entity_name), ' '::text, 1)
      else null::text
    end as identity_first_name,
    region_code,
    avatar_path
  from cardtrade.profiles;

comment on view cardtrade.public_profiles is
  'The catalog-safe projection of a Profile: display name, rating, the Identity_Gate as is_verified, the disclosed first name when verified, the trading region (0065), and the avatar path (0066). Never exposes contact_email, merchant refs, legal name, or compliance notes.';

grant select on cardtrade.public_profiles to anon, authenticated;

-- =============================================================================
-- 3. The bucket
-- =============================================================================

-- Idempotent so a re-run cannot fail on an existing bucket, and so it converges
-- an environment where the app's own ensure-bucket path created it first.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-images',
  'profile-images',
  true,
  2097152, -- 2 MB
  array['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- NO write policy for `authenticated`, deliberately — see the header. Public read
-- comes from `public = true` on the bucket, exactly as it does for item-images,
-- which likewise carries no storage.objects policies of its own.
