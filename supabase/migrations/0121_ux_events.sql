-- 0121_ux_events.sql
--
-- BEHAVIOURAL instrumentation: where a member went, and where they got stuck.
--
-- WHY THIS EXISTS. Until now the only way to learn that a member could not finish a
-- flow was for that member to type it into `cardtrade.feedback` (0120). That instrument
-- works — the first real report of the create-listing gate came through it — but it is
-- voluntary, self-reported, and it only catches the motivated. Everything else the
-- platform records is TRANSACTIONAL: `cash_sale_events` says a contract reached
-- PAYMENT_PENDING, `webhook_logs` says a provider event was handled. Neither can say
-- that someone opened the listing form five times, hit the same refusal each time, and
-- gave up — which is the class of failure that costs a marketplace its first sellers.
--
-- ── WHAT THIS TABLE IS NOT ────────────────────────────────────────────────────
--
-- It is NOT `cash_sale_events` for the UI. A contract event is a fact about a contract
-- and is part of the record that arbitration reads; one of these rows is a hint about a
-- person's session and is disposable. Never derive a contract state, a money figure, or
-- an arbitration finding from this table, and never make a member-facing surface depend
-- on a row being here. Instrumentation that a flow depends on is no longer
-- instrumentation — it is an undocumented write on the critical path.
--
-- ── THE NO-FREE-TEXT GUARANTEE IS STRUCTURAL ──────────────────────────────────
--
-- There is no `message` column, no `detail` column, no `metadata jsonb`, and there must
-- never be one. `name` and `error_code` are CHECK-constrained to a lower-case slug
-- shape, which is not cosmetic: it is the mechanism by which a caller is UNABLE to put
-- a member's description, a legal name, an address, a card detail or a session token in
-- here. Prose does not satisfy the pattern, so the constraint rejects it rather than
-- relying on a reviewer to notice.
--
-- This mirrors `flutter_app/lib/core/observability/error_reporter.dart`, which takes an
-- error and a stack and NOTHING else for the same reason and states it at length. Do
-- not add a jsonb bag "just for context": that removes the guarantee and replaces it
-- with a promise, and a scrubber over it would catch the patterns someone thought of
-- and miss the rest.
--
-- ── WHY NO `anon` INSERT ──────────────────────────────────────────────────────
--
-- A guest-writable analytics table is an unauthenticated write endpoint, i.e. a spam
-- sink that anyone can fill. Guest funnels are therefore deliberately NOT captured
-- here. That is a real gap — it means drop-off before sign-up is invisible — and the
-- honest fix is a rate limiter in front of the write, not a grant to `anon` bolted on
-- later. Recorded so the omission reads as a decision rather than an oversight.
--
-- ── RETENTION IS UNMANAGED, ON PURPOSE FOR NOW ────────────────────────────────
--
-- This table grows with traffic rather than with contracts, so it is the first one that
-- will need a retention policy. `ux_events_created_idx` supports a delete-by-age sweep.
-- No pg_cron job is installed here because the right window is a product decision and a
-- job that silently deletes evidence should be chosen, not inherited.

create type cardtrade.ux_event_kind as enum (
  -- A route was rendered. The funnel primitive: a sequence of these under one
  -- session_id is the path a member took.
  'PAGE_VIEW',
  -- A Server Action returned `{ ok: false }`. `error_code` carries the ActionResult
  -- code. This is the one that answers "what stopped them", and it is the reason the
  -- table exists at all.
  'ACTION_FAILURE',
  -- A gate refused before any work was attempted — an Identity_Gate refusal on a page,
  -- a region mismatch, a missing disclosure. Distinct from ACTION_FAILURE because the
  -- member never got as far as submitting anything, so the remedy is discoverability
  -- rather than validation.
  'GATE_BLOCKED',
  -- A form was left with unsaved input. The signal behind "I had to fill in the same
  -- fields five times".
  'FORM_ABANDONED'
);

comment on type cardtrade.ux_event_kind is
  'What shape of thing happened, NOT what it was about. The four values are the '
  'questions this table can answer: where did they go, what refused them after a '
  'submit, what refused them before one, and what did they give up on.';

create table cardtrade.ux_events (
  id uuid primary key default gen_random_uuid(),

  -- STITCHES A PATH WITHOUT NAMING A PERSON. Client-minted, opaque, and scoped to one
  -- browsing session, so a sequence of rows can be read as a journey even when
  -- profile_id is null. It is not a device id and must not be persisted beyond the
  -- session — see `lib/analytics/session.ts`, which holds it in sessionStorage
  -- precisely so it dies with the tab.
  session_id text not null,

  -- `on delete set null`, DELIBERATELY DIFFERENT FROM `feedback`, which cascades.
  -- Feedback cascades because a row there is something a named person WROTE, and
  -- retaining it after their account is gone is a trade that table is not important
  -- enough to make. A row here holds no words of theirs — only a kind, a path and a
  -- machine code — so detaching it keeps the aggregate honest (a funnel that shrinks
  -- retroactively on every account deletion is a funnel that lies) while dropping the
  -- link to the individual. Strictly less retained data than a cascade would leave
  -- behind elsewhere, and more useful.
  profile_id uuid references cardtrade.profiles(id) on delete set null,

  kind cardtrade.ux_event_kind not null,

  -- WHERE IT HAPPENED. A PATH, NOT A URL, on the same reasoning as `feedback.page_path`
  -- (0120): the query string is dropped by the caller because `?region=` and `?tab=`
  -- add nothing, and `/t/<token>` is already as much as belongs in here. Dynamic
  -- segments arrive already collapsed to their template — `/listings/[id]`, not a real
  -- id — so this column groups without a LIKE and cannot become a list of which
  -- listings a person looked at.
  path text not null,

  -- WHICH THING OF THAT KIND. A machine-generated discriminator, never member input:
  -- an action name for ACTION_FAILURE (`create-item`), a gate name for GATE_BLOCKED
  -- (`seller-disclosure`), a form id for FORM_ABANDONED (`item-form`). Null for
  -- PAGE_VIEW, where `path` already says it.
  name text,

  -- The ActionResult `error` code, verbatim. Already a machine code by construction —
  -- `lib/actions/result.ts` types it as a string union — so it needs no translation and
  -- must not be swapped for the human `message` beside it, which IS prose.
  error_code text,

  created_at timestamptz not null default now(),

  -- ── Shape constraints: the no-free-text guarantee, enforced ────────────────
  --
  -- Lower-case slugs only. A member's typed sentence contains spaces and capitals and
  -- therefore cannot satisfy this, which is the entire point: the column is closed to
  -- prose by the database rather than by convention. Bounded tightly as well, because
  -- an unbounded "slug" is just prose without spaces.
  constraint ux_events_name_shape
    check (
      name is null
      or (name ~ '^[a-z0-9][a-z0-9_.:-]*$' and char_length(name) <= 64)
    ),

  constraint ux_events_error_code_shape
    check (
      error_code is null
      or (error_code ~ '^[a-z0-9][a-z0-9_.:-]*$' and char_length(error_code) <= 64)
    ),

  -- Same rule as `feedback_page_path_shape`. Rejects `https://...`, which is how an
  -- absolute URL carrying a token or a referrer would otherwise arrive.
  constraint ux_events_path_shape
    check (path like '/%' and char_length(path) <= 512),

  -- An opaque handle, so it is bounded and slug-shaped too. Stops the column being
  -- repurposed as somewhere to smuggle a JWT or an email.
  constraint ux_events_session_shape
    check (session_id ~ '^[A-Za-z0-9_-]{8,64}$'),

  -- AN ACTION_FAILURE WITHOUT A CODE CANNOT BE ACTED ON, which makes it noise that
  -- still costs a row. The whole value of the kind is grouping by what failed.
  constraint ux_events_failure_has_code
    check (kind <> 'ACTION_FAILURE' or error_code is not null),

  -- Likewise a blocked gate has to say which gate, or the row means only "something
  -- refused someone somewhere".
  constraint ux_events_block_has_name
    check (kind <> 'GATE_BLOCKED' or name is not null)
);

-- ---------------------------------------------------------------------------
-- Indexes
--
-- Three reads are intended and each gets one. Nothing here supports "show me this
-- member's history", which is not a question this table exists to answer.
-- ---------------------------------------------------------------------------

-- "What is failing, and where" — the console's main query, and the one that would have
-- surfaced the create-listing refusal without waiting for a member to write in.
create index ux_events_failure_idx
  on cardtrade.ux_events (kind, name, error_code, created_at desc)
  where kind in ('ACTION_FAILURE', 'GATE_BLOCKED');

-- Reconstructing one journey in order, once a failure has pointed at a session.
create index ux_events_session_idx
  on cardtrade.ux_events (session_id, created_at);

-- Funnels by route, and the delete-by-age sweep this table will eventually need.
create index ux_events_created_idx
  on cardtrade.ux_events (created_at desc);

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table cardtrade.ux_events enable row level security;

-- ADMIN READ ONLY, AND NO MEMBER READ AT ALL — not even of their own rows. A member has
-- no use for their own click history, and a self-read policy would turn an internal
-- diagnostic into a disclosure surface that has to be reasoned about on every future
-- column. Insert-only for the member who generates them is the tighter arrangement.
--
-- `(select cardtrade.is_admin())` is wrapped for 0078's reason: it does not depend on
-- the row, so the planner evaluates it once per statement rather than once per row —
-- which matters more here than anywhere, because this is the largest table in the
-- schema by row count.
create policy ux_events_admin_select
  on cardtrade.ux_events for select to authenticated
  using ((select cardtrade.is_admin()));

-- A member may only ever record events against themselves. `profile_id` is nullable in
-- the column definition to survive account deletion, but an INSERT must name the
-- caller: a null here from a member client would be an untraceable row, and allowing it
-- would let any signed-in member write anonymous rows in bulk.
create policy ux_events_self_insert
  on cardtrade.ux_events for insert to authenticated
  with check (profile_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Grants
--
-- RLS decides WHICH row; these decide WHAT may be done to it. At the foot of the file,
-- after everything else, per the ordering note in the tech steering doc.
--
-- No member UPDATE and no member DELETE. An event is a statement about something that
-- already happened, so there is nothing to amend, and a member who could delete these
-- could erase the evidence of the very failure the table exists to catch.
-- ---------------------------------------------------------------------------

-- THE INSERT GRANT IS COLUMN-SCOPED, AND THE TWO OMISSIONS MATTER. `created_at` is
-- excluded so a member cannot backdate a row: a writable timestamp means any funnel or
-- time-to-completion figure derived from this table is only as trustworthy as the client
-- that sent it. `id` is excluded for the same reason 0120 omits its workflow columns — it
-- defaults, and nothing legitimate needs to choose it.
revoke all on cardtrade.ux_events from anon, authenticated;
grant insert (session_id, profile_id, kind, path, name, error_code)
  on cardtrade.ux_events to authenticated;
grant all on cardtrade.ux_events to service_role;

comment on table cardtrade.ux_events is
  'Behavioural instrumentation: navigation paths, action failures and gate refusals, '
  'for finding where members get stuck. Disposable and advisory — never derive a '
  'contract state, a money figure or an arbitration finding from it, and never let a '
  'member-facing flow depend on a row being present. Holds NO member free text by '
  'construction: name and error_code are CHECK-constrained to machine slugs.';
