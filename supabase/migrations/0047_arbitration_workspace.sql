-- 0047_arbitration_workspace.sql
--
-- A dedicated arbitration workspace for support staff.
--
-- WHY. Dispute resolution had been bolted onto `/admin`, which already carries
-- reports, owed releases, chargebacks and flagged trades. Deciding a dispute needs
-- context a card in a list cannot hold: the full contract timeline, both parties'
-- history, what each side actually said, what money is at stake on each outcome, and
-- a record of what staff have already looked at. It also needs to be doable by
-- someone who is NOT a full administrator.
--
-- TWO CAPABILITIES, NOT TWO ROLES FOR ONE THING. `is_support` is added alongside
-- `is_admin` rather than replacing it with a single role column. That looks like the
-- two-sources-of-truth mistake this codebase just finished unpicking (kyc_status vs
-- merchant_status), but it is not: those were two answers to ONE question ("is this
-- member verified"). These are two DIFFERENT questions —
--
--   is_support : may arbitrate. See cases, take them, decide them, write notes.
--   is_admin   : may arbitrate AND moderate (hide listings, action reports, clear
--                reconciliation flags, drain payout queues).
--
-- An admin implicitly satisfies the support gate; a support worker does not satisfy
-- the admin gate. Nothing derives one from the other, so they cannot disagree.
--
-- CASES ARE NOT A TABLE. A case is a view over an existing record — a disputed
-- Cash_Sale, a disputed Trade, or a Charge_Dispute. Copying those into an
-- `arbitration_cases` table would mean keeping two representations of the same money
-- in sync, and the losing copy would eventually be the one staff act on. Instead the
-- two things a case needs that its source record cannot hold — who is working it, and
-- what staff have written about it — are keyed by (kind, ref) here.

-- ---------------------------------------------------------------------------
-- 1. The support capability.
-- ---------------------------------------------------------------------------

alter table cardtrade.profiles
  add column if not exists is_support boolean not null default false;

comment on column cardtrade.profiles.is_support is
  'May arbitrate disputes: view cases, assign, decide, and write internal notes. '
  'Separate capability from is_admin, which additionally allows moderation. An '
  'admin satisfies the support gate; a support worker does not satisfy the admin '
  'gate. Provider-controlled: not writable by the authenticated role.';

-- `0005_merchant_onboarding.sql` revoked column UPDATE on `profiles` from
-- `authenticated` and re-granted only display_name/contact_email, specifically to
-- stop privilege escalation. A newly added column inherits nothing, so is_support is
-- already unwritable by members — but assert it, because a future blanket re-grant
-- would silently make staff access self-service.
revoke update (is_support) on cardtrade.profiles from authenticated;

-- ---------------------------------------------------------------------------
-- 2. What kind of thing is under arbitration.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'arbitration_case_kind') then
    create type cardtrade.arbitration_case_kind as enum (
      'CASH_SALE',
      'TRADE',
      'CHARGEBACK'
    );
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Who is working a case.
--
-- One assignee at a time, so the primary key is the case itself. Unassigning is a
-- delete rather than a null assignee, which keeps "nobody has picked this up" and
-- "somebody explicitly cleared it" from looking identical in the queue.
-- ---------------------------------------------------------------------------

create table if not exists cardtrade.arbitration_assignments (
  case_kind   cardtrade.arbitration_case_kind not null,
  case_ref    uuid not null,
  assignee_id uuid not null references cardtrade.profiles(id) on delete cascade,
  assigned_by uuid references cardtrade.profiles(id),
  assigned_at timestamptz not null default now(),
  primary key (case_kind, case_ref)
);

comment on table cardtrade.arbitration_assignments is
  'Which staff member is working an arbitration case. Keyed by (kind, ref) because '
  'a case is a view over a cash sale, trade, or chargeback rather than a row of its '
  'own.';

-- ---------------------------------------------------------------------------
-- 4. Internal case notes.
--
-- STAFF-ONLY, and that is the whole point: an arbitrator needs somewhere to record
-- "called the seller, no answer" or "photos look doctored" without it being visible
-- to the parties. There is deliberately no member-facing read path, and none should
-- be added — member-visible communication belongs in the contract conversation.
-- ---------------------------------------------------------------------------

create table if not exists cardtrade.arbitration_notes (
  id         uuid primary key default gen_random_uuid(),
  case_kind  cardtrade.arbitration_case_kind not null,
  case_ref   uuid not null,
  author_id  uuid not null references cardtrade.profiles(id),
  body       text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists arbitration_notes_case_idx
  on cardtrade.arbitration_notes (case_kind, case_ref, created_at desc);

comment on table cardtrade.arbitration_notes is
  'Internal staff notes on an arbitration case. NOT visible to the parties — there '
  'is no member read policy and one must not be added. Member-facing messages '
  'belong in the contract conversation.';

-- ---------------------------------------------------------------------------
-- 5. Row-level security.
--
-- Both tables are staff-only in every direction. Members get no policy at all, which
-- under RLS means no access, rather than a policy that could be loosened by mistake.
-- ---------------------------------------------------------------------------

alter table cardtrade.arbitration_assignments enable row level security;
alter table cardtrade.arbitration_notes enable row level security;

-- Reusable predicate so every policy agrees on what "staff" means, and so widening
-- it later is one edit rather than four.
create or replace function cardtrade.is_staff()
returns boolean
language sql
stable
security definer
set search_path to 'cardtrade', 'pg_temp'
as $function$
  select exists (
    select 1 from cardtrade.profiles p
    where p.id = auth.uid() and (p.is_support or p.is_admin)
  );
$function$;

comment on function cardtrade.is_staff is
  'True when the caller may arbitrate: is_support OR is_admin. The single predicate '
  'every arbitration policy reads.';

drop policy if exists arbitration_assignments_staff_all on cardtrade.arbitration_assignments;
create policy arbitration_assignments_staff_all
  on cardtrade.arbitration_assignments for all to authenticated
  using (cardtrade.is_staff())
  with check (cardtrade.is_staff());

drop policy if exists arbitration_notes_staff_read on cardtrade.arbitration_notes;
create policy arbitration_notes_staff_read
  on cardtrade.arbitration_notes for select to authenticated
  using (cardtrade.is_staff());

-- Insert requires the author to be the caller, so a note cannot be attributed to
-- another staff member.
drop policy if exists arbitration_notes_staff_insert on cardtrade.arbitration_notes;
create policy arbitration_notes_staff_insert
  on cardtrade.arbitration_notes for insert to authenticated
  with check (cardtrade.is_staff() and author_id = auth.uid());

-- Notes are an audit trail: append-only. No update or delete policy, deliberately.

grant select, insert, update, delete on cardtrade.arbitration_assignments to authenticated;
grant select, insert on cardtrade.arbitration_notes to authenticated;
revoke update, delete on cardtrade.arbitration_notes from authenticated;
