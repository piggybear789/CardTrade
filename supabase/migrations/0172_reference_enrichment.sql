-- 0169_reference_enrichment.sql
--
-- Reference enrichment: eBay reputation, async Sherlock OSINT footprint, off-platform
-- web/scam-callout mentions, an entity graph connecting handles/profiles/signals, and
-- pgvector + trigram hybrid embeddings for semantic & fuzzy name/alias matching.
--
-- SEPARATION GUARANTEE. Nothing written here ever enters `cardtrade.member_references`
-- or counts toward `tallyPeople()` verified vouch counts. OSINT signals are public
-- external indicators ("Is this person real?") with explicit confidence/risk levels,
-- never verified deal attestations.
--
-- ACCESS. All tables and the vector-match RPC are `service_role` only, with RLS enabled
-- and zero `anon` / `authenticated` privileges. Public reads go through server-side
-- loaders/routes that strip internal identifiers and never leak `scam_reports` PII.

create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- ---------------------------------------------------------------------------
-- 1. Background check execution runs (cache + async worker progress)
-- ---------------------------------------------------------------------------
create table if not exists cardtrade.identity_check_runs (
  id uuid primary key default gen_random_uuid(),
  target_kind text not null
    check (target_kind in ('PROFILE', 'CLAIM', 'HANDLE', 'PERSON_NAME')),
  target_key text not null
    check (char_length(target_key) between 1 and 240),
  platform text
    check (platform is null or char_length(platform) <= 40),
  handle_norm text
    check (handle_norm is null or char_length(handle_norm) <= 100),
  query_name text
    check (query_name is null or char_length(query_name) <= 120),
  query_location text
    check (query_location is null or char_length(query_location) <= 120),
  target_profile_id uuid references cardtrade.profiles(id) on delete cascade,
  target_claim_id uuid references cardtrade.social_claims(id) on delete cascade,
  status text not null default 'QUEUED'
    check (status in ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED')),
  sources_status jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  requested_by uuid references cardtrade.profiles(id) on delete set null,
  error_message text
    check (error_message is null or char_length(error_message) <= 500),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table cardtrade.identity_check_runs is
  'Cached and in-flight OSINT/eBay background check runs for handles and Marketplace names (0169). Service-role only.';

create index if not exists identity_check_runs_target_idx
  on cardtrade.identity_check_runs (target_key, created_at desc);

create index if not exists identity_check_runs_status_idx
  on cardtrade.identity_check_runs (status, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. External OSINT / API signals (strictly separate from member_references)
-- ---------------------------------------------------------------------------
create table if not exists cardtrade.osint_signals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references cardtrade.identity_check_runs(id) on delete cascade,
  target_key text not null
    check (char_length(target_key) between 1 and 240),
  subject_profile_id uuid references cardtrade.profiles(id) on delete cascade,
  subject_claim_id uuid references cardtrade.social_claims(id) on delete cascade,
  source text not null
    check (source in ('EBAY_API', 'SHERLOCK', 'WEB_SEARCH', 'INTERNAL_RISK')),
  signal_kind text not null
    check (signal_kind in (
      'EBAY_SELLER_PROFILE',
      'SHERLOCK_MATCH',
      'WEB_MENTION',
      'SCAM_ALERT_MENTION',
      'SCAM_HASH_MATCH',
      'CROSS_PLATFORM_LINK'
    )),
  external_platform text
    check (external_platform is null or char_length(external_platform) <= 60),
  external_handle text
    check (external_handle is null or char_length(external_handle) <= 120),
  external_url text
    check (external_url is null or char_length(external_url) <= 1000),
  confidence text not null default 'LOW'
    check (confidence in ('HIGH', 'MEDIUM', 'LOW')),
  risk_flag text not null default 'NONE'
    check (risk_flag in ('NONE', 'CAUTION', 'WARNING')),
  title text
    check (title is null or char_length(title) <= 240),
  snippet text
    check (snippet is null or char_length(snippet) <= 1000),
  payload jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  expires_at timestamptz not null
);

comment on table cardtrade.osint_signals is
  'External API and OSINT signals (eBay seller stats, Sherlock footprint, web mentions, aggregate risk flags) (0169). Service-role only.';

create index if not exists osint_signals_target_idx
  on cardtrade.osint_signals (target_key, observed_at desc);

create index if not exists osint_signals_run_idx
  on cardtrade.osint_signals (run_id);

create index if not exists osint_signals_claim_idx
  on cardtrade.osint_signals (subject_claim_id)
  where subject_claim_id is not null;

create index if not exists osint_signals_profile_idx
  on cardtrade.osint_signals (subject_profile_id)
  where subject_profile_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Entity Graph Edges (typed, verified-vs-probabilistic edges)
-- ---------------------------------------------------------------------------
create table if not exists cardtrade.entity_graph_edges (
  id uuid primary key default gen_random_uuid(),
  from_kind text not null
    check (from_kind in ('PROFILE', 'CLAIM', 'HANDLE', 'OSINT_SIGNAL', 'SCAM_CLUSTER')),
  from_key text not null
    check (char_length(from_key) between 1 and 240),
  to_kind text not null
    check (to_kind in ('PROFILE', 'CLAIM', 'HANDLE', 'OSINT_SIGNAL', 'SCAM_CLUSTER')),
  to_key text not null
    check (char_length(to_key) between 1 and 240),
  edge_type text not null
    check (edge_type in (
      'CLAIMED_BY',
      'SAME_HANDLE_CANDIDATE',
      'WEB_MENTION_OF',
      'ALIAS_HINT',
      'SIMILAR_VECTOR',
      'RISK_CORRELATION'
    )),
  verified boolean not null default false,
  weight double precision not null default 0.5
    check (weight >= 0 and weight <= 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table cardtrade.entity_graph_edges is
  'Entity relationship graph separating verified ownership/deals from probabilistic OSINT links (0169). Service-role only.';

create unique index if not exists entity_graph_edges_unique_idx
  on cardtrade.entity_graph_edges (from_kind, from_key, to_kind, to_key, edge_type);

create index if not exists entity_graph_edges_from_idx
  on cardtrade.entity_graph_edges (from_kind, from_key);

create index if not exists entity_graph_edges_to_idx
  on cardtrade.entity_graph_edges (to_kind, to_key);

-- ---------------------------------------------------------------------------
-- 4. Vector + Trigram Dossier Embeddings (512-dim hybrid semantic search)
-- ---------------------------------------------------------------------------
create table if not exists cardtrade.reference_dossier_embeddings (
  id uuid primary key default gen_random_uuid(),
  subject_key text not null
    check (char_length(subject_key) between 1 and 240),
  subject_kind text not null
    check (subject_kind in ('PROFILE', 'CLAIM', 'HANDLE', 'WEB_MENTION', 'SCAM_PATTERN')),
  platform text
    check (platform is null or char_length(platform) <= 60),
  handle_or_name text not null
    check (char_length(handle_or_name) between 1 and 160),
  location_hint text
    check (location_hint is null or char_length(location_hint) <= 120),
  source_url text
    check (source_url is null or char_length(source_url) <= 1000),
  content_text text not null
    check (char_length(content_text) between 1 and 4000),
  content_hash text generated always as (md5(content_text)) stored,
  metadata jsonb not null default '{}'::jsonb,
  embedding extensions.vector(512) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table cardtrade.reference_dossier_embeddings is
  'Vector + trigram index of trader dossiers, warning mentions, eBay profiles, and aliases (0169). Service-role only.';

create unique index if not exists reference_dossier_embeddings_dedupe_idx
  on cardtrade.reference_dossier_embeddings (subject_key, subject_kind, content_hash);

create index if not exists reference_dossier_embeddings_hnsw_idx
  on cardtrade.reference_dossier_embeddings
  using hnsw (embedding extensions.vector_cosine_ops);

create index if not exists reference_dossier_embeddings_name_trgm_idx
  on cardtrade.reference_dossier_embeddings
  using gin (handle_or_name extensions.gin_trgm_ops);

create index if not exists reference_dossier_embeddings_content_trgm_idx
  on cardtrade.reference_dossier_embeddings
  using gin (content_text extensions.gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 5. Hybrid Vector + Trigram Match RPC (service_role only)
-- ---------------------------------------------------------------------------
create or replace function cardtrade.match_reference_dossiers(
  p_query_text text,
  p_query_embedding extensions.vector(512),
  p_limit integer default 8
)
returns table (
  id uuid,
  subject_key text,
  subject_kind text,
  platform text,
  handle_or_name text,
  location_hint text,
  source_url text,
  content_text text,
  metadata jsonb,
  vector_score double precision,
  trigram_score double precision,
  combined_score double precision
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    d.id,
    d.subject_key,
    d.subject_kind,
    d.platform,
    d.handle_or_name,
    d.location_hint,
    d.source_url,
    d.content_text,
    d.metadata,
    greatest(0.0, 1.0 - (d.embedding operator(extensions.<=>) p_query_embedding))::double precision as vector_score,
    greatest(
      extensions.similarity(lower(d.handle_or_name), lower(p_query_text)),
      extensions.similarity(lower(d.content_text), lower(p_query_text))
    )::double precision as trigram_score,
    (
      0.60 * greatest(0.0, 1.0 - (d.embedding operator(extensions.<=>) p_query_embedding))
      + 0.40 * greatest(
        extensions.similarity(lower(d.handle_or_name), lower(p_query_text)),
        extensions.similarity(lower(d.content_text), lower(p_query_text))
      )
    )::double precision as combined_score
  from cardtrade.reference_dossier_embeddings d
  where
    (1.0 - (d.embedding operator(extensions.<=>) p_query_embedding)) > 0.18
    or extensions.similarity(lower(d.handle_or_name), lower(p_query_text)) > 0.15
    or lower(d.content_text) like '%' || lower(btrim(p_query_text)) || '%'
  order by combined_score desc
  limit greatest(1, least(coalesce(p_limit, 8), 25));
$function$;

-- ---------------------------------------------------------------------------
-- 6. RLS + Grants (strictly service_role only)
-- ---------------------------------------------------------------------------
alter table cardtrade.identity_check_runs enable row level security;
alter table cardtrade.osint_signals enable row level security;
alter table cardtrade.entity_graph_edges enable row level security;
alter table cardtrade.reference_dossier_embeddings enable row level security;

revoke all on function cardtrade.match_reference_dossiers(text, extensions.vector, integer) from public, anon, authenticated;
grant execute on function cardtrade.match_reference_dossiers(text, extensions.vector, integer) to service_role;

revoke all on cardtrade.identity_check_runs from public, anon, authenticated;
revoke all on cardtrade.osint_signals from public, anon, authenticated;
revoke all on cardtrade.entity_graph_edges from public, anon, authenticated;
revoke all on cardtrade.reference_dossier_embeddings from public, anon, authenticated;

grant select, insert, update, delete on cardtrade.identity_check_runs to service_role;
grant select, insert, update, delete on cardtrade.osint_signals to service_role;
grant select, insert, update, delete on cardtrade.entity_graph_edges to service_role;
grant select, insert, update, delete on cardtrade.reference_dossier_embeddings to service_role;
