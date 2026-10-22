-- 0160_instagram_bot_token.sql
--
-- The Instagram DM claim bot's access token, kept current by the `:17` job.
--
-- WHY A TABLE. The bot's token (Instagram API with Instagram Login) lasts 60 days
-- and is extended by calling `refresh_access_token`, which may hand back a NEW
-- token string. An environment variable cannot be rewritten from a running function,
-- so the refreshed token has to live somewhere the job can write. Before this, the
-- token sat in `INSTAGRAM_PAGE_ACCESS_TOKEN` until it lapsed and every claim DM
-- failed with GRAPH_400.
--
-- ROTATION STAYS IN VERCEL. `env_token_sha256` is the SHA-256 of the env token the
-- row was seeded from. When the env value changes (an operator generated a new token
-- in the Meta dashboard), the hashes differ, the env token wins and the row is
-- re-seeded from it, so a manual rotation is never shadowed by a stale stored token.
--
-- ACCESS. Service role only, one row (`id = 1`). RLS is on with no policies and every
-- member and anon grant is revoked: this is a credential that reads NoDitto's inbox.

create table if not exists cardtrade.instagram_bot_tokens (
  id smallint primary key default 1
    check (id = 1),
  access_token text not null
    check (char_length(access_token) between 20 and 2000),
  env_token_sha256 text not null
    check (env_token_sha256 ~ '^[0-9a-f]{64}$'),
  -- From `expires_in` on the last refresh. Null until the first refresh.
  expires_at timestamptz,
  -- When the token was last refreshed, or seeded from the environment. Meta refuses
  -- to refresh a token younger than 24 hours, so a seed counts as fresh.
  refreshed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table cardtrade.instagram_bot_tokens is
  'The Instagram DM claim bot token (0160). One row. Service role only; refreshed daily by the :17 job.';

alter table cardtrade.instagram_bot_tokens enable row level security;

revoke all on cardtrade.instagram_bot_tokens from public, anon, authenticated;
grant select, insert, update on cardtrade.instagram_bot_tokens to service_role;
