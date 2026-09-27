-- 0123_error_logs.sql
--
-- Everything that goes wrong on the platform, in one table, grouped so it can be
-- worked as a queue: runtime errors, failed server actions, background money failures,
-- and the reports members file from the error screen.
--
-- ── FIVE SOURCES ──────────────────────────────────────────────────────────────
--
--   SERVER      A request threw on the server (Server Component render, Route Handler,
--               Server Action). Written by `onRequestError` in `instrumentation.ts`.
--               `reference` is the error's Next.js DIGEST, the same value the browser's
--               error screen shows the member as "Ref …".
--   CLIENT      An error thrown in the BROWSER, which never reaches the server: a render
--               error caught by an error boundary, or an uncaught error / unhandled
--               promise rejection anywhere on the page (`instrumentation-client.ts`).
--               The browser mints its own `reference`.
--   ACTION      A Server Action RETURNED `{ ok: false }`. This is where "the sale did not
--               go through" lives: by convention an action reports an expected failure as
--               a value and never throws, so neither of the above ever sees it. Written by
--               the `withActionLog` wrapper every action module exports through.
--   BACKGROUND  A failure with no member present: a cron job, a webhook, a payout,
--               refund, fee or collateral attempt the provider refused.
--   REPORT      A member pressed "Report this problem" on the error screen. Carries the
--               `reference` of the error it is about and an optional note. Its own row
--               rather than an UPDATE of the error row, so a report can never rewrite
--               what was captured.
--
-- ── GROUPING: `fingerprint` ───────────────────────────────────────────────────
--
-- A stable hash computed by the writer (`domain/errors/errorLog.ts`) from WHAT failed,
-- never from who or when: the action name and error code for ACTION rows, the job name
-- and code for BACKGROUND rows, the route and a normalised message for SERVER / CLIENT
-- rows (ids, numbers and quoted values stripped). A REPORT copies the fingerprint of the
-- error it references, so complaints land in the same group as the error they are about.
-- `error_log_groups` below is the queue an operator works: one row per fingerprint.
--
-- ── RESOLVING ────────────────────────────────────────────────────────────────
--
-- `resolved_at` is set on every occurrence in a group when an admin marks it resolved.
-- New occurrences arrive unresolved, so a group that comes back after a "fix" reopens by
-- itself rather than hiding behind an earlier decision.
--
-- ── `expected` ───────────────────────────────────────────────────────────────
--
-- ACTION rows only. True when the failure is a guard doing its job — validation, not
-- signed in, a gate, stale terms, a rate limit — and false when something actually broke
-- (a write failed, the provider refused). Both are recorded because a guard that refuses
-- the same member ten times is a product problem too; the flag lets the console show real
-- failures first. An UNRECOGNISED code is treated as unexpected, so a new failure mode is
-- surfaced rather than filtered away.
--
-- ── WHY THIS TABLE HOLDS FREE TEXT WHEN `ux_events` (0121) REFUSES TO ───────────
--
-- A message and a stack are the point of an error record. But a message can quote data
-- (a failed insert names the value it rejected), so the table is sensitive:
--
--   * NO member or anon grant of any kind. Every write goes through the service-role
--     client in `lib/errors/errorLog.ts`, which bounds every field first. Guests hit
--     errors too, so the server routes in front of it rate-limit instead, which a grant
--     cannot do.
--   * ADMIN READ ONLY. Not even a reporter reads their own report back.
--   * `context` holds identifiers only (a cash sale id, a trade id, a region), never
--     arguments wholesale: the writer extracts uuid-valued `…Id` fields and nothing else.
--   * `path` is a path, not a URL: the query string is dropped and a `/t/<token>` invite
--     token is redacted, because that token is a capability.
--
-- ── RETENTION ────────────────────────────────────────────────────────────────
--
-- Grows with failures rather than with contracts. `error_logs_created_idx` supports a
-- delete-by-age sweep; no pg_cron job is installed, for 0121's reason: a job that deletes
-- evidence should be chosen, not inherited.

create type cardtrade.error_log_source as enum (
  'SERVER',
  'CLIENT',
  'ACTION',
  'BACKGROUND',
  'REPORT'
);

comment on type cardtrade.error_log_source is
  'Where an error_logs row came from: thrown on the server, thrown in the browser, a '
  'Server Action that returned a failure, a background job or money movement, or a '
  'report a member filed from the error screen.';

create table cardtrade.error_logs (
  id uuid primary key default gen_random_uuid(),

  source cardtrade.error_log_source not null,

  -- What groups this row with its repeats. Computed by the writer; see the header.
  fingerprint text not null,

  -- ACTION rows only: the failure was a guard doing its job. See the header.
  expected boolean not null default false,

  -- The handle a member quotes to support and a report files against. A Next.js digest
  -- (SERVER) or a browser-minted id (CLIENT). Null when there is none.
  reference text,

  -- WHICH THING FAILED. The action (`cashSale.acceptCashSaleTerms`) for ACTION rows, the
  -- job or money operation (`job.cash-sale-payouts`, `payout.seller`) for BACKGROUND rows.
  name text,

  -- The machine code: the ActionResult `error` for ACTION rows, a job's own code for
  -- BACKGROUND rows.
  error_code text,

  -- What went wrong. Null on a REPORT, which describes an error rather than being one.
  message text,
  stack text,

  -- Where it happened, as a path. Query string dropped, invite tokens redacted.
  path text,

  -- SERVER only. The route FILE (`/app/listings/[id]/page`), which groups without a
  -- LIKE; `route_type` is render | route | action | proxy.
  route_path text,
  route_type text,
  method text,

  -- Identifiers only, e.g. {"cashSaleId": "…", "region": "AU"}. Bounded below.
  context jsonb,

  -- REPORT only: what the member wrote, if anything.
  note text,

  -- `on delete set null`, as in `ux_events`: the row is about the product, not the
  -- person, so a deleted account detaches rather than erasing the failure record.
  profile_id uuid references cardtrade.profiles(id) on delete set null,

  -- Triage. Set together by `resolveErrorGroup`; `resolved_by` may later go null if the
  -- admin's account is deleted, which is why there is no both-or-neither constraint.
  resolved_at timestamptz,
  resolved_by uuid references cardtrade.profiles(id) on delete set null,

  created_at timestamptz not null default now(),

  -- ── Shape constraints. Mirrored by the writer, which truncates rather than letting
  --    an oversized field reject the whole row. ──────────────────────────────
  constraint error_logs_fingerprint_shape
    check (fingerprint ~ '^[0-9a-z]{1,32}$'),
  constraint error_logs_reference_shape
    check (reference is null or reference ~ '^[A-Za-z0-9_-]{1,64}$'),
  constraint error_logs_name_shape
    check (name is null or name ~ '^[A-Za-z0-9_.:/-]{1,128}$'),
  constraint error_logs_error_code_shape
    check (error_code is null or error_code ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  constraint error_logs_message_length
    check (message is null or char_length(message) <= 2000),
  constraint error_logs_stack_length
    check (stack is null or char_length(stack) <= 8000),
  constraint error_logs_path_shape
    check (path is null or (path like '/%' and char_length(path) <= 512)),
  constraint error_logs_route_path_length
    check (route_path is null or char_length(route_path) <= 512),
  constraint error_logs_route_type_shape
    check (route_type is null or route_type ~ '^[a-z-]{1,32}$'),
  constraint error_logs_method_shape
    check (method is null or method ~ '^[A-Z]{1,10}$'),
  constraint error_logs_context_shape
    check (
      context is null
      or (jsonb_typeof(context) = 'object' and pg_column_size(context) <= 2048)
    ),
  constraint error_logs_note_length
    check (note is null or char_length(note) <= 2000),

  -- ── What each source must carry to be actionable. ──────────────────────────
  -- A captured failure has to say what it was; a report has to point at one.
  constraint error_logs_error_has_message
    check (source = 'REPORT' or message is not null),
  constraint error_logs_report_has_reference
    check (source <> 'REPORT' or reference is not null),
  -- An action failure is only useful grouped by WHICH action and WHICH code.
  constraint error_logs_action_is_attributed
    check (source <> 'ACTION' or (name is not null and error_code is not null)),
  constraint error_logs_background_is_named
    check (source <> 'BACKGROUND' or name is not null),
  -- Only a returned action failure can be a guard doing its job. A thrown error, a
  -- refused payout or a member's report is never "expected".
  constraint error_logs_only_actions_are_expected
    check (expected = false or source = 'ACTION')
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- The delete-by-age sweep, and "what happened lately".
create index error_logs_created_idx
  on cardtrade.error_logs (created_at desc);

-- One group's occurrences, newest first: the console's drill-down, and the view below.
create index error_logs_fingerprint_idx
  on cardtrade.error_logs (fingerprint, created_at desc);

-- Resolving a group touches only its open rows.
create index error_logs_open_idx
  on cardtrade.error_logs (fingerprint)
  where resolved_at is null;

-- Joining a report to the error it is about.
create index error_logs_reference_idx
  on cardtrade.error_logs (reference)
  where reference is not null;

-- Foreign keys, so `on delete set null` on a profile does not scan this table.
create index error_logs_profile_idx
  on cardtrade.error_logs (profile_id);
create index error_logs_resolved_by_idx
  on cardtrade.error_logs (resolved_by);

-- ---------------------------------------------------------------------------
-- The queue: one row per fingerprint
--
-- `security_invoker`, so the view is read with the CALLER's privileges and RLS on the
-- table applies. Without it a view runs as its owner and bypasses RLS entirely. The
-- only reader today is the service-role console, but the view must not become the way
-- around the table's admin-only policy if a grant is ever added.
--
-- Group attributes come from the newest NON-REPORT row, because a report carries no
-- message or code of its own. A group made only of reports (the error itself was not
-- captured, e.g. logging was off) reads as source REPORT.
-- ---------------------------------------------------------------------------

create view cardtrade.error_log_groups
with (security_invoker = true) as
select
  e.fingerprint,
  coalesce(
    (array_agg(e.source order by e.created_at desc) filter (where e.source <> 'REPORT'))[1],
    'REPORT'::cardtrade.error_log_source
  ) as source,
  (array_agg(e.name order by e.created_at desc) filter (where e.source <> 'REPORT'))[1] as name,
  (array_agg(e.error_code order by e.created_at desc) filter (where e.source <> 'REPORT'))[1] as error_code,
  (array_agg(e.message order by e.created_at desc) filter (where e.source <> 'REPORT'))[1] as message,
  (array_agg(e.route_path order by e.created_at desc) filter (where e.route_path is not null))[1] as route_path,
  (array_agg(e.path order by e.created_at desc) filter (where e.path is not null))[1] as path,
  coalesce(bool_and(e.expected) filter (where e.source <> 'REPORT'), false) as expected,
  count(*) filter (where e.source <> 'REPORT') as occurrences,
  count(*) filter (where e.source = 'REPORT') as reports,
  count(*) filter (where e.resolved_at is null) as open_count,
  count(distinct e.profile_id) as members_affected,
  min(e.created_at) as first_seen,
  max(e.created_at) as last_seen,
  max(e.resolved_at) as last_resolved_at
from cardtrade.error_logs e
group by e.fingerprint;

comment on view cardtrade.error_log_groups is
  'One row per error fingerprint: what failed, how often, how many members it hit, how '
  'many reported it, and how many occurrences are still unresolved. The operations '
  'console Errors tab. security_invoker, so the table''s admin-only RLS applies.';

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table cardtrade.error_logs enable row level security;

-- `(select cardtrade.is_admin())` wrapped for 0078's reason: evaluated once per
-- statement, not once per row. No UPDATE policy: triage runs through the service role
-- behind `requireAdmin`, the same arrangement as feedback and reports.
create policy error_logs_admin_select
  on cardtrade.error_logs for select to authenticated
  using ((select cardtrade.is_admin()));

comment on table cardtrade.error_logs is
  'Everything that went wrong: SERVER and CLIENT errors, ACTION failures a Server Action '
  'returned, BACKGROUND job and money failures, and member REPORTs, grouped by '
  'fingerprint. Service-role writes only (lib/errors/errorLog.ts), admin read only: '
  'messages and stacks can quote data, and report notes are member prose.';

-- ---------------------------------------------------------------------------
-- Grants
--
-- At the foot of the file, per the ordering note in the tech steering doc. Members get
-- SELECT on the table only so the admin policy can apply to an admin's cookie-bound
-- client; the policy returns nothing to anyone else. No member or anon write of any
-- kind, and no member grant on the view at all: its one reader is the service role.
-- ---------------------------------------------------------------------------

revoke all on cardtrade.error_logs from anon, authenticated;
grant select on cardtrade.error_logs to authenticated;
grant all on cardtrade.error_logs to service_role;

revoke all on cardtrade.error_log_groups from anon, authenticated;
grant select on cardtrade.error_log_groups to service_role;
