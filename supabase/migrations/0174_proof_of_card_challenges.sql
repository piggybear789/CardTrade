-- 0171_proof_of_card_challenges.sql
--
-- 1-click Live Proof-of-Card Challenges: catches hijacked real accounts (e.g. aged
-- Facebook profiles with stolen eBay slab photos) BEFORE Victim #1 ever sends money.
--
-- HOW IT WORKS. A buyer creates a short-lived challenge with a random 1-time code
-- (e.g. `ND-7492`) and shares `/references/verify/<token>` in Messenger or Instagram DM.
-- The seller takes a live camera photo of the card next to that handwritten code.
-- A hijacked account without physical possession cannot complete it; refusal itself
-- exposes the scammer.
--
-- ACCESS. Service-role only, RLS enabled, private storage bucket (`proof-of-card`).
-- Photos are served only via short-lived signed URLs to callers who hold the unguessable
-- challenge token.

create table if not exists cardtrade.proof_of_card_challenges (
  id uuid primary key default gen_random_uuid(),
  token text not null unique
    check (token ~ '^[A-Za-z0-9_-]{16,64}$'),
  code text not null
    check (code ~ '^ND-[A-Z0-9]{4,8}$'),
  target_label text not null
    check (char_length(target_label) between 1 and 160),
  target_key text
    check (target_key is null or char_length(target_key) <= 240),
  item_description text not null
    check (char_length(item_description) between 2 and 240),
  psa_cert_number text
    check (psa_cert_number is null or psa_cert_number ~ '^[0-9]{7,10}$'),
  created_by uuid references cardtrade.profiles(id) on delete set null,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'SUBMITTED', 'EXPIRED')),
  proof_photo_path text
    check (proof_photo_path is null or char_length(proof_photo_path) <= 240),
  capture_metadata jsonb not null default '{}'::jsonb,
  ai_verdict jsonb,
  submitted_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table cardtrade.proof_of_card_challenges is
  'Expiring 1-time Proof-of-Card live photo challenges shared with off-platform sellers (0171). Service-role only.';

create index if not exists proof_of_card_challenges_target_idx
  on cardtrade.proof_of_card_challenges (target_key, created_at desc)
  where target_key is not null;

create index if not exists proof_of_card_challenges_expires_idx
  on cardtrade.proof_of_card_challenges (expires_at);

-- Private bucket: read only through server-signed URLs for holders of the challenge token.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'proof-of-card',
  'proof-of-card',
  false,
  10485760,
  array['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

alter table cardtrade.proof_of_card_challenges enable row level security;

revoke all on cardtrade.proof_of_card_challenges from public, anon, authenticated;
grant select, insert, update, delete on cardtrade.proof_of_card_challenges to service_role;
