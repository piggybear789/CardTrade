-- 0120_member_feedback.sql
--
-- What a member wants to tell US: a bug in the product, or a feature they want.
--
-- WHY THIS IS NOT `reports`. Both are "a member typed something for staff to read", so
-- the pull to reuse the reports table is real, and it is wrong for three reasons that
-- are all load-bearing:
--
--   1. A report is ABOUT SOMETHING. `target_type` + `target_id` address a listing or a
--      member, the admin console renders them as a link to that thing, and every triage
--      control is an action ON the target — hide the item, look at the account. Feedback
--      has no target. Giving it a synthetic one puts a row in a moderation queue whose
--      "View listing" link goes nowhere.
--   2. 0094 added `reports_one_open_per_reporter_target`, a unique index over
--      (reporter_id, target_type, target_id) where status = 'OPEN'. That is correct for
--      reports — one open complaint per member per thing — and fatal here: with a
--      constant target it caps a member at ONE open piece of feedback for the life of
--      their account, and the second submission fails as a unique violation.
--   3. Moderation and product intake are answered by different people with different
--      urgency. A counterfeit listing is a safety queue; "the price filter is confusing"
--      is not, and interleaving them makes the safety queue slower to read.
--
-- WHAT IT DELIBERATELY DOES NOT DO. It never notifies anyone, never touches money, and
-- never mutates anything else — same as a report. It is an inbox.

create type cardtrade.feedback_kind as enum (
  -- Something is broken.
  'BUG',
  -- Something is missing.
  'IDEA',
  -- Neither, and forcing a choice would mislabel it. The existing report dialog keeps
  -- the same escape hatch, for the same reason: a member who cannot describe their
  -- thing in our words abandons the form rather than picking the closest lie.
  'OTHER'
);

comment on type cardtrade.feedback_kind is
  'Which of the two intake questions a feedback row answers: a bug, a feature idea, or '
  'neither. NOT a priority and NOT a status — see the status column.';

create table cardtrade.feedback (
  id uuid primary key default gen_random_uuid(),

  -- `on delete cascade`, matching `region_waitlist` and the 0059 fraud-ban cleanup: a
  -- deleted account's feedback goes with it. The alternative — keeping orphan rows for
  -- the product signal — means retaining what a named person wrote after their account
  -- is gone, which is not a trade this table is important enough to make.
  author_id uuid not null references cardtrade.profiles(id) on delete cascade,

  kind cardtrade.feedback_kind not null,
  message text not null,

  -- WHERE THEY WERE STANDING. The single most useful field on a bug report and the one
  -- a member should never have to type. Captured from the router, so it is a PATH and
  -- not a URL: the query string is dropped on purpose, because `?region=`, `?tab=` and
  -- friends add nothing and a path like `/t/<token>` is already as much as we want in
  -- here. Nullable, because feedback can be about the product in general.
  page_path text,

  -- REUSES `report_status` RATHER THAN DECLARING A TWIN. The question this column
  -- answers is identical to the one on reports — has an operator dealt with this yet —
  -- and its three answers are the same three words. A `feedback_status` enum with the
  -- values OPEN/ACTIONED/DISMISSED would be a second definition of one idea, which is
  -- the shape of drift this schema has paid for before.
  status cardtrade.report_status not null default 'OPEN',
  reviewed_by uuid references cardtrade.profiles(id),
  reviewed_at timestamptz,

  created_at timestamptz not null default now(),

  -- Mirrors `validateFeedback` in `lib/actions/feedback.ts`, per the enforce-twice
  -- convention. The action is not the only way in: the grant below makes this row
  -- writable by anything holding the member's JWT, so the action's own bounds are
  -- advisory on their own. A lower bound at all is the point — a one-character row is
  -- not feedback, and an inbox of them is an inbox nobody reads.
  constraint feedback_message_length
    check (char_length(btrim(message)) between 10 and 2000),

  -- A path, not a URL. Rejects `https://...` and anything absurd in length.
  constraint feedback_page_path_shape
    check (
      page_path is null
      or (page_path like '/%' and char_length(page_path) <= 512)
    ),

  -- The two triage columns move together or not at all. Without this, a half-stamped
  -- row reads as reviewed by nobody, or at no time, and neither is a state that means
  -- anything.
  constraint feedback_review_stamp_complete
    check ((reviewed_by is null) = (reviewed_at is null))
);

-- The operator's read is "what is still open, newest first", which is the console's
-- only query against this table. Partial, so it stays the size of the backlog rather
-- than the size of the archive.
create index feedback_open_idx
  on cardtrade.feedback (created_at desc)
  where status = 'OPEN';

-- Supports the author's own read, and the cascade above.
create index feedback_author_idx
  on cardtrade.feedback (author_id);

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table cardtrade.feedback enable row level security;

-- An author sees their own rows; an admin sees all of them. Same split as
-- `reports_select`, and `(select auth.uid())` / `(select cardtrade.is_admin())` are
-- wrapped for 0078's reason: neither depends on the row, so the planner should
-- evaluate them once per statement instead of once per row.
create policy feedback_author_select
  on cardtrade.feedback for select to authenticated
  using (
    author_id = (select auth.uid())
    or (select cardtrade.is_admin())
  );

create policy feedback_author_insert
  on cardtrade.feedback for insert to authenticated
  with check (author_id = (select auth.uid()));

-- Triage. Mirrors `reports_admin_update`: the queue's own state belongs to whoever
-- works the queue.
create policy feedback_admin_update
  on cardtrade.feedback for update to authenticated
  using ((select cardtrade.is_admin()))
  with check ((select cardtrade.is_admin()));

-- ---------------------------------------------------------------------------
-- Grants
--
-- RLS decides WHICH row; these decide WHAT may be done to it. Kept at the foot of the
-- file, after everything else, per the ordering note in the tech steering doc.
--
-- THE INSERT GRANT IS COLUMN-SCOPED, AND THE OMISSIONS ARE THE POINT. `status`,
-- `reviewed_by` and `reviewed_at` are the queue's workflow state, not the author's, and
-- 0094 revoked exactly these three from the reports insert for exactly this reason. A
-- member could only ever have pre-resolved their OWN row out of the backlog, which is
-- harmless and still not theirs to write.
--
-- No UPDATE and no DELETE for the author: an admin reading a backlog needs the row to
-- say what it said when it was filed, and "edit your feedback" is not a flow the product
-- offers. `feedback_admin_update` has no member grant behind it deliberately — admin
-- triage runs through the service role, the same arrangement `policies.test.ts` records
-- for `reports:UPDATE`.
-- ---------------------------------------------------------------------------

revoke all on cardtrade.feedback from anon, authenticated;
grant select on cardtrade.feedback to authenticated;
grant insert (author_id, kind, message, page_path) on cardtrade.feedback to authenticated;
grant all on cardtrade.feedback to service_role;

comment on table cardtrade.feedback is
  'Product intake: a member reporting a problem with NoDitto itself, or suggesting a '
  'feature. NOT cardtrade.reports, which is moderation and always addresses a listing '
  'or a member — feedback has no target, and 0094''s one-open-per-target index would '
  'cap a member at a single open row. Never notifies, never moves money.';
