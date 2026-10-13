-- 0147_default_privileges_hardening.sql
--
-- ESC-39: a new function in `cardtrade` is no longer executable by members by default.
--
-- Postgres grants EXECUTE on every new function to PUBLIC. Every money function in
-- this schema has had to remember a `revoke ... from public` at the end of its
-- migration, and 0117 exists because several did not. Revoking the default for the
-- role that creates them means a forgotten revoke now fails closed: the function is
-- unreachable until a migration grants it deliberately.
--
-- `for role postgres` IS MANDATORY. Without it the statement changes the defaults of
-- whichever role runs it, which is not the role migrations create functions as, and
-- it would silently do nothing.
--
-- `cardtrade.is_admin()` is deliberately NOT touched here. Its live body must be
-- captured with pg_get_functiondef('cardtrade.is_admin'::regproc) into a follow-up
-- migration before anything redefines it.

alter default privileges for role postgres in schema cardtrade
  revoke execute on functions from public, anon, authenticated;
