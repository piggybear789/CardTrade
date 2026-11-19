-- 0171_reference_bios.sql
--
-- References (0155): a short written profile line for a handle, such as "Instagram
-- collector with an Australian flag in their own bio, interested in pokemon and tcg".
--
-- WRITTEN BY A MODEL, PUBLISHED BY A PERSON. Haiku phrases it, but only from a few
-- structured facts (`facts`): which platform, whether the handle has bought, sold or
-- traded with others, a country that came from a flag in the handle's own public bio or
-- from a member's NoDitto profile, and the `#tags` in that bio. The model never sees
-- free text from a third party: staff paste the public bio, and CODE extracts the flag
-- and tags (`domain/references/bio.ts`). The reply is then checked by code (no numbers,
-- handles, links, claims of trust or safety, or a country the facts do not name) and a
-- draft that fails is thrown away.
--
-- A DRAFT IS NOT PUBLIC. A claim has at most one DRAFT and one PUBLISHED bio. Staff read
-- the draft, then publish it; regenerating writes a new draft and leaves the published
-- text alone. Only PUBLISHED rows are read by the references page, which labels the line
-- as AI-written from public information.
--
-- WHAT IT NEVER SAYS. Nothing about how well someone trades: that is what the references
-- and counts are for, and a model's sentence about a person's reliability would be one
-- more claim to defend. The bio describes; it does not vouch.
--
-- ACCESS. Service role only. Staff-facing fields (`source_text`, token counts, who wrote
-- and published it) never leave the server; the page reads `bio` and nothing else.

create table if not exists cardtrade.reference_bios (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references cardtrade.social_claims(id) on delete cascade,
  status text not null
    check (status in ('DRAFT', 'PUBLISHED')),
  bio text not null
    check (char_length(btrim(bio)) between 20 and 300),
  -- The structured facts the model was given, kept as evidence of what it was told.
  facts jsonb not null,
  -- What staff pasted from the handle's own public profile. Staff-only.
  source_text text
    check (source_text is null or char_length(source_text) <= 300),
  model text not null
    check (char_length(model) between 1 and 60),
  input_tokens integer
    check (input_tokens is null or input_tokens >= 0),
  output_tokens integer
    check (output_tokens is null or output_tokens >= 0),
  generated_by uuid references cardtrade.profiles(id) on delete set null,
  generated_at timestamptz not null default now(),
  published_by uuid references cardtrade.profiles(id) on delete set null,
  published_at timestamptz,
  constraint reference_bios_publish_stamp
    check ((status = 'PUBLISHED') = (published_at is not null)),
  constraint reference_bios_one_per_status unique (claim_id, status)
);

comment on table cardtrade.reference_bios is
  'A model-written profile line for a handle, built from structured facts and published by staff (0171). Service role only; the page reads published rows.';

alter table cardtrade.reference_bios enable row level security;

revoke all on cardtrade.reference_bios from public, anon, authenticated;
grant select, insert, update, delete on cardtrade.reference_bios to service_role;
