-- 0082_dispute_evidence.sql
--
-- PARTICIPANT-SUBMITTED DISPUTE EVIDENCE.
--
-- WHY THIS EXISTS. Before this, a disputed contract gave an arbitrator exactly one
-- sentence: the `dispute_reason` typed by whoever raised it. The other party had no
-- way to answer at all, and neither side could attach a photo of what actually
-- arrived. A decision that captures collateral or refunds four figures was being made
-- on one paragraph from one side.
--
-- The chat thread was the de-facto substitute, which is worse than it sounds: chat is
-- unstructured, interleaved with coordination messages, and has no notion of "this is
-- my formal account of what happened". An arbitrator had to read a conversation and
-- infer a case from it.
--
-- ONE TABLE FOR BOTH FLOWS. A Cash_Sale and a Trade dispute need the same thing, so
-- this is keyed by (case_kind, case_ref) exactly like `arbitration_notes` — the same
-- addressing the arbitration queue already uses, so a case page can read notes and
-- evidence with the same pair and no join table.
--
-- APPEND-ONLY, DELIBERATELY. A statement is what a party asserted at a moment in a
-- dispute. If it can be edited after staff have read it, it stops being evidence and
-- becomes a moving target — the same reasoning as `arbitration_notes` in 0047. A party
-- who wants to add something submits again; the record keeps both.
--
-- VISIBILITY IS MUTUAL, NOT SECRET. Both participants can read each other's
-- submissions. A hidden-evidence model would mean deciding against someone on material
-- they never saw, which is not a process anyone can trust. Staff read everything.

-- =============================================================================
-- 1. The table
-- =============================================================================

create table if not exists cardtrade.dispute_evidence (
  id uuid primary key default gen_random_uuid(),

  -- Same addressing as arbitration_notes (0047). Not a foreign key to either table,
  -- because one column cannot reference two, and a CHECK on the kind plus the
  -- application guard is what keeps it honest.
  case_kind text not null check (case_kind in ('CASH_SALE', 'TRADE')),
  case_ref uuid not null,

  -- Who submitted it. Never null: an unattributed statement is worthless to an
  -- arbitrator, and every submission comes from an authenticated participant.
  author_id uuid not null references cardtrade.profiles (id) on delete cascade,

  -- The party's own account of what happened. Required — an attachment with no
  -- explanation asks the arbitrator to guess what they are looking at.
  statement text not null check (
    length(trim(statement)) between 10 and 4000
  ),

  -- Storage object paths in the `dispute-evidence` bucket. Photos and video of the
  -- goods, the packaging, the tracking screen. Empty is valid: not every dispute has
  -- something to photograph ("it never arrived" has no photo).
  media_paths text[] not null default '{}',

  created_at timestamptz not null default now()
);

comment on table cardtrade.dispute_evidence is
  'Append-only participant statements and media for a disputed Cash_Sale or Trade. Read by both parties and by staff; never edited.';

comment on column cardtrade.dispute_evidence.case_kind is
  'CASH_SALE or TRADE. Mirrors arbitration_notes addressing so a case page reads both with one pair.';

comment on column cardtrade.dispute_evidence.media_paths is
  'Object paths in the dispute-evidence storage bucket. Photos or video of the goods, packaging, or tracking.';

-- Read path is always "everything for this case, newest first".
create index if not exists dispute_evidence_case_idx
  on cardtrade.dispute_evidence (case_kind, case_ref, created_at desc);

-- The author FK is on the hot path for "did I already submit?" checks.
create index if not exists dispute_evidence_author_idx
  on cardtrade.dispute_evidence (author_id);

-- =============================================================================
-- 2. RLS
-- =============================================================================

alter table cardtrade.dispute_evidence enable row level security;

-- READ: participants of the underlying contract, plus staff.
--
-- The participant test has to branch on `case_kind` because the two contract tables
-- name their parties differently. Written as one policy rather than two so there is a
-- single place the visibility rule lives.
drop policy if exists dispute_evidence_select on cardtrade.dispute_evidence;
create policy dispute_evidence_select
  on cardtrade.dispute_evidence
  for select
  to authenticated
  using (
    -- Staff see every case.
    exists (
      select 1 from cardtrade.profiles p
      where p.id = (select auth.uid())
        and (p.is_support or p.is_admin)
    )
    or (
      case_kind = 'CASH_SALE'
      and exists (
        select 1 from cardtrade.cash_sales cs
        where cs.id = case_ref
          and (select auth.uid()) in (cs.buyer_id, cs.seller_id)
      )
    )
    or (
      case_kind = 'TRADE'
      and exists (
        select 1 from cardtrade.trades t
        where t.id = case_ref
          and (select auth.uid()) in (t.initiator_id, t.counterpart_id)
      )
    )
  );

-- INSERT: only a participant, only as themselves, and only while the contract is
-- actually disputed.
--
-- The status test is the important half. Without it a member could file "evidence" on
-- a contract that was never disputed, or keep filing after it was resolved — in both
-- cases writing into a record staff have already closed.
drop policy if exists dispute_evidence_insert on cardtrade.dispute_evidence;
create policy dispute_evidence_insert
  on cardtrade.dispute_evidence
  for insert
  to authenticated
  with check (
    author_id = (select auth.uid())
    and (
      (
        case_kind = 'CASH_SALE'
        and exists (
          select 1 from cardtrade.cash_sales cs
          where cs.id = case_ref
            and cs.status = 'DISPUTED'
            and (select auth.uid()) in (cs.buyer_id, cs.seller_id)
        )
      )
      or (
        case_kind = 'TRADE'
        and exists (
          select 1 from cardtrade.trades t
          where t.id = case_ref
            and t.state = 'DISPUTED'
            and (select auth.uid()) in (t.initiator_id, t.counterpart_id)
        )
      )
    )
  );

-- NO update or delete policy, deliberately. Append-only: see the header.

-- =============================================================================
-- 3. The storage bucket
-- =============================================================================

-- Video is the reason for the 50 MB ceiling. A phone clip of an unboxing is the single
-- most useful artefact in a condition dispute and a 2 MB image limit would exclude it.
--
-- NOT public, unlike item-images and profile-images. Evidence is participant-and-staff
-- only, so reads go through a server-minted signed URL rather than a public path. A
-- world-readable bucket here would publish a member's dispute material to anyone who
-- learned the object path.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dispute-evidence',
  'dispute-evidence',
  false,
  52428800, -- 50 MB
  array[
    'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic',
    'video/mp4', 'video/quicktime', 'video/webm'
  ]
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- No storage.objects policies for `authenticated`. Uploads are authorised by a
-- single-use signed upload URL minted server-side against a path the server chooses,
-- and reads by a signed download URL — the same design as item-images and
-- profile-images, except that reads are signed too because the bucket is private.

-- =============================================================================
-- 4. Grants
-- =============================================================================

-- Column grants last, and never `select (` in a comment above this line — the
-- identity-gate agreement test parses this file with regexes that match that literal.
grant select on cardtrade.dispute_evidence to authenticated;
grant insert (case_kind, case_ref, author_id, statement, media_paths)
  on cardtrade.dispute_evidence to authenticated;
