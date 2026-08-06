--
-- Persist completion of the member onboarding sequence.
--
-- A nullable timestamp is intentional: NULL means this Profile still needs the
-- display-name + buyer/seller introduction. Existing members are deliberately
-- backfilled as NULL so they receive the one-time flow too; we must not infer a
-- completed onboarding from an email-derived display name.

alter table cardtrade.profiles
  add column if not exists onboarding_completed_at timestamptz;

comment on column cardtrade.profiles.onboarding_completed_at is
  'Set by the authenticated member after choosing a public display name and buyer/seller path. NULL means the member must be routed through onboarding.';

-- 0005 deliberately narrowed member updates to public profile fields. This new
-- UX-only field remains owner-writable under the existing profiles_owner_update
-- RLS policy; no provider or role fields are exposed.
grant update (onboarding_completed_at) on table cardtrade.profiles to authenticated;
