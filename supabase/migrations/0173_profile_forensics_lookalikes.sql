-- 0170_profile_forensics_lookalikes.sql
--
-- Fast typosquatting / impersonation lookalike detection over `cardtrade.social_claims`
-- using pg_trgm + stripped-punctuation matching, ranked by similarity and live positive
-- reference count so real established accounts being mimicked surface first.
--
-- ACCESS: `service_role` only.

create index if not exists social_claims_handle_trgm_idx
  on cardtrade.social_claims
  using gin (handle_norm extensions.gin_trgm_ops);

create or replace function cardtrade.find_lookalike_claims(
  p_handle text,
  p_exclude_claim_id uuid default null,
  p_limit integer default 6
)
returns table (
  claim_id uuid,
  platform text,
  handle text,
  claimed_profile_id uuid,
  similarity_score double precision,
  exact_stripped_match boolean,
  positive_refs bigint
)
language sql
stable
security definer
set search_path = ''
as $function$
  with norm as (
    select
      lower(btrim(p_handle)) as q,
      regexp_replace(lower(btrim(p_handle)), '[^a-z0-9]', '', 'g') as q_stripped
  ),
  candidates as (
    select
      c.id as claim_id,
      c.platform,
      c.handle,
      c.claimed_profile_id,
      extensions.similarity(c.handle_norm, n.q)::double precision as similarity_score,
      (
        char_length(n.q_stripped) >= 4
        and regexp_replace(c.handle_norm, '[^a-z0-9]', '', 'g') = n.q_stripped
      ) as exact_stripped_match
    from cardtrade.social_claims c
    cross join norm n
    where c.handle_norm <> n.q
      and (p_exclude_claim_id is null or c.id <> p_exclude_claim_id)
      and (
        c.handle_norm operator(extensions.%) n.q
        or extensions.similarity(c.handle_norm, n.q) >= 0.45
        or (
          char_length(n.q_stripped) >= 4
          and regexp_replace(c.handle_norm, '[^a-z0-9]', '', 'g') = n.q_stripped
        )
      )
  )
  select
    cand.claim_id,
    cand.platform,
    cand.handle,
    cand.claimed_profile_id,
    cand.similarity_score,
    cand.exact_stripped_match,
    coalesce(refs.cnt, 0)::bigint as positive_refs
  from candidates cand
  left join lateral (
    select count(distinct coalesce(r.voucher_person_key, r.voucher_id::text, r.voucher_claim_id::text)) as cnt
    from cardtrade.member_references r
    where r.status = 'LIVE'
      and r.sentiment = 'POSITIVE'
      and (
        (cand.claimed_profile_id is not null and r.target_profile_id = cand.claimed_profile_id)
        or (cand.claimed_profile_id is null and r.target_claim_id = cand.claim_id)
      )
  ) refs on true
  where refs.cnt > 0 or cand.claimed_profile_id is not null or cand.exact_stripped_match
  order by
    cand.exact_stripped_match desc,
    (refs.cnt > 0 or cand.claimed_profile_id is not null) desc,
    cand.similarity_score desc,
    refs.cnt desc
  limit greatest(1, least(coalesce(p_limit, 6), 15));
$function$;

revoke all on function cardtrade.find_lookalike_claims(text, uuid, integer) from public, anon, authenticated;
grant execute on function cardtrade.find_lookalike_claims(text, uuid, integer) to service_role;
