-- 0130_fuzzy_suggest.sql
--
-- Typo-tolerant search suggestions.
--
-- Suggestions matched titles with ILIKE only, so "charzard" found nothing and the
-- dropdown dead-ended on "No matching titles" for a card that was listed. This adds a
-- trigram fallback the suggest action calls when the exact attempts find nothing:
-- word similarity between the query and each title, best first.
--
-- SECURITY INVOKER, so the caller's RLS and column grants apply exactly as they do to
-- the ILIKE query it backs up — a guest sees what a guest's catalog query would. The
-- predicate is the catalog's own (available, visible, open, in the given games and
-- region). `pg_trgm.word_similarity_threshold` is set on the function so `<%` can use
-- the GIN index at a looser threshold than the 0.6 default, which rejects most typos.

create extension if not exists pg_trgm with schema extensions;

create index if not exists items_title_trgm_idx
  on cardtrade.items using gin (lower(title) extensions.gin_trgm_ops)
  where hidden = false and closed_at is null and status = 'AVAILABLE';

create or replace function cardtrade.suggest_items_fuzzy(
  p_q text,
  p_games text[],
  p_region text default null,
  p_limit integer default 6
)
returns table (
  id uuid,
  title text,
  category text,
  image_paths text[],
  fmv_cents bigint,
  currency text,
  listing_kind cardtrade.listing_kind
)
language sql
stable
security invoker
set search_path = cardtrade, extensions, pg_catalog
set pg_trgm.word_similarity_threshold = '0.35'
as $$
  select i.id, i.title, i.category, i.image_paths, i.fmv_cents, i.currency, i.listing_kind
  from cardtrade.items i
  where i.hidden = false
    and i.closed_at is null
    and i.status = 'AVAILABLE'
    and i.category = any (p_games)
    and (p_region is null or i.location_country_code = p_region)
    and lower(p_q) <% lower(i.title)
  order by extensions.word_similarity(lower(p_q), lower(i.title)) desc, i.created_at desc
  limit least(greatest(coalesce(p_limit, 6), 1), 10);
$$;

comment on function cardtrade.suggest_items_fuzzy(text, text[], text, integer) is
  'Typo-tolerant title suggestions (0130): trigram word similarity, best first. The fallback when exact matching finds nothing.';

revoke all on function cardtrade.suggest_items_fuzzy(text, text[], text, integer) from public;
grant execute on function cardtrade.suggest_items_fuzzy(text, text[], text, integer) to anon, authenticated;
