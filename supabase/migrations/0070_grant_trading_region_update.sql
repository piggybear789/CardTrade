-- 0070_grant_trading_region_update.sql
--
-- Lets a member set their own trading region, and enforces the rules about it in
-- the database rather than only in the Server Action.
--
-- THE BUG THIS FIXES. 0065 added `profiles.region_code` and the onboarding step
-- that writes it, but never granted UPDATE on the column. Every other
-- member-writable column on `profiles` got its own explicit grant — 0005 and 0006
-- (`display_name`, `contact_email`), 0058 (`onboarding_completed_at`), 0066
-- (`avatar_path`) — and this one was missed.
--
-- The consequence was not subtle. `setTradingRegion` runs through the cookie-bound
-- client, so its UPDATE was refused by column privilege, the action fell into its
-- `persistence-error` branch, and onboarding showed "Your region could not be
-- saved. Please retry." Retrying could never help. And because 0065 made an ABSENT
-- region a refusal rather than a pass, a member who could not get past that step
-- could not buy, sell or trade at all — so the gap closed the entire product to
-- every new signup, while looking like a transient save failure.
--
-- WHY A TRIGGER AND NOT JUST THE GRANT. Granting the column means the row can be
-- written by anything holding the member's JWT, not only by `setTradingRegion`. The
-- action's own `region-locked` check would then be advisory: a member could PATCH
-- the column directly and move their region after Connect onboarding, leaving
-- `profiles.region_code` disagreeing with the country on their connected account.
-- A transfer to an account registered elsewhere fails, so that is discovered at
-- payout time, after goods have shipped. This is the project's enforce-twice
-- convention applied to the one column where the second enforcement has to be the
-- database, because the first one is bypassable by construction.
--
-- The trigger mirrors the action exactly, and both rules are refusals a member can
-- cause:
--   * a region that is not `trading_enabled` is refused, because badging someone
--     ready to trade and then refusing every contract they open is the 0060 shape
--     of mistake;
--   * a CHANGE of region is refused once a `merchant_ref` exists. NULL -> region is
--     always allowed, and region -> the same region is a no-op, so onboarding stays
--     idempotent for a member who already has a connected account.
--
-- Operator writes are deliberately exempt: support has to be able to correct a
-- region, and that is the documented remedy the action points at.

-- ---------------------------------------------------------------------------
-- The guard
-- ---------------------------------------------------------------------------

create or replace function cardtrade.enforce_trading_region_rules()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_enabled boolean;
begin
  -- Untouched: nothing to check. Covers every profile update that is not about
  -- the region, which is almost all of them.
  if new.region_code is not distinct from old.region_code then
    return new;
  end if;

  -- Operator/system writes bypass. `service_role` is how support and the webhook
  -- pipeline write, and blocking them would remove the only remedy the action
  -- tells members to ask for.
  if coalesce(current_setting('request.jwt.claim.role', true), current_user) = 'service_role' then
    return new;
  end if;

  -- Clearing the region is never a member action: an absent region is refused by
  -- every contract guard (0065), so allowing it would be a way to silently opt out
  -- of being able to transact.
  if new.region_code is null then
    raise exception 'A trading region cannot be removed once set.'
      using errcode = 'check_violation';
  end if;

  select r.trading_enabled into v_enabled
  from cardtrade.regions r
  where r.code = new.region_code;

  if v_enabled is null then
    raise exception 'Unknown region: %', new.region_code
      using errcode = 'check_violation';
  end if;

  if not v_enabled then
    raise exception 'Region % is browsable but not open for deals.', new.region_code
      using errcode = 'check_violation';
  end if;

  -- WRITE-ONCE ONCE CONNECTED. Both conditions are required: a member with a
  -- connected account but no region yet is mid-onboarding and must be allowed to
  -- finish, which is precisely the case the missing grant was breaking.
  if old.merchant_ref is not null and old.region_code is not null then
    raise exception
      'Trading region is tied to the payout account and cannot be changed.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function cardtrade.enforce_trading_region_rules() is
  'Mirrors setTradingRegion in the database: refuses a non-trading region, refuses '
  'clearing, and refuses a CHANGE once a merchant_ref exists. Needed because '
  'granting update on region_code makes the action''s own guard bypassable by any '
  'direct PATCH carrying the member''s JWT.';

drop trigger if exists profiles_enforce_trading_region on cardtrade.profiles;

create trigger profiles_enforce_trading_region
  before update of region_code on cardtrade.profiles
  for each row
  execute function cardtrade.enforce_trading_region_rules();

-- ---------------------------------------------------------------------------
-- The grant.
--
-- LAST IN THE FILE, deliberately. `tests/property/identityGate.test.ts` parses
-- migration TEXT with regexes, and `grant select (col)` contains the literal
-- `select (`, which its trigger-function pattern matches across newlines. Column
-- grants therefore go after the functions — see the note in tech.md.
--
-- RLS still confines this to the caller's own row via `profiles_owner_update`
-- (`auth.uid() = id`), exactly as it does for display_name.
-- ---------------------------------------------------------------------------

grant update (region_code) on cardtrade.profiles to authenticated;
