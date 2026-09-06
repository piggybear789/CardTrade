-- 0111_account_closure.sql
--
-- Account closure, schema half only (Req 7.4, 7.5).
--
-- Closure is ANONYMISE-AND-DETACH, not a row delete: `profiles.id` is referenced by
-- cash sales, trades, payouts, reviews and arbitration records, all of which
-- accounting and dispute resolution read, and Req 7.4 protects them. Deleting the
-- row would either cascade evidence away or fail on a constraint. So a closed
-- account keeps its row, keeps its contract history, and stops being publicly
-- identifiable.
--
-- This migration adds ONLY the column and the read paths. The closure itself —
-- replacing the display name, avatar, bio and social links, revoking sessions and
-- detaching the auth identity — is the orchestrator's job and runs on the
-- service-role path. Nothing here lets a member write the flag; see section 4.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT TOUCH. The Identity_Gate expressions:
-- the boolean on the public view below is reproduced BYTE-FOR-BYTE from 0087, and
-- the two `seller_identity_verified` trigger functions and their trigger column list
-- are left alone. The denormalisation-agreement property in
-- `tests/property/identityGate.test.ts` reads the newest migration defining each and
-- evaluates it against `satisfiesIdentityGate`; it fails loudly on a shape it cannot
-- interpret and throws outright if a Connect column (`merchant_status`,
-- `merchant_settlements_enabled`) appears in a gate expression. Recreating the view
-- here makes THIS file the newest definition, so the plain
-- `identity_check_status = 'VERIFIED'::cardtrade.identity_check_status` form is
-- load-bearing rather than stylistic.
--
-- The fraud identity blocklist (`identity_person_keys`, 0105) is untouched on
-- purpose: Req 7.6 exists to stop closure being a way to launder a ban.

-- =============================================================================
-- 1. The column
-- =============================================================================
--
-- Nullable and set once, at closure. Not a boolean, because "when" is what
-- arbitration and accounting need when they read a contract whose counterparty has
-- left; a flag would answer half the question.

alter table cardtrade.profiles
  add column if not exists closed_at timestamptz;

comment on column cardtrade.profiles.closed_at is
  'When this account was closed (Req 7.4). Null for an open account. Written only '
  'by the account-closure orchestrator on the service-role path: members hold no '
  'UPDATE grant on this column, because a member-writable closure flag is a way to '
  'fake a closed account. Closure anonymises the profile and retains the contract, '
  'payout, review and arbitration records.';

-- =============================================================================
-- 2. public_profiles: a closed profile still returns a ROW
-- =============================================================================
--
-- THIS VIEW SERVES TWO DIFFERENT READS, and that is why closure cannot simply be
-- filtered out here. It backs contract rooms, message threads, review lists and the
-- arbitration case view — where a counterparty and an arbitrator still need to see
-- *someone* on the other side of a completed contract — AND it backs discovery, the
-- catalog seller strip and the seller page, where a closed member should not appear
-- at all. Filtering here would satisfy the second read by breaking the first: a live
-- contract would render a blank counterparty, and the fix for a missing name is
-- never to hide the contract.
--
-- So the row survives with its member-identifying fields REPLACED (Req 7.5): the
-- display name becomes a fixed anonymous label, and the avatar, bio and social links
-- are dropped from every public read path. Discovery gets its own view, section 3.
--
-- The anonymous label is applied HERE as well as by the orchestrator's own write to
-- `profiles.display_name`, on purpose: the projection must be safe on its own terms,
-- so a closure that half-completed cannot leak a name through the read path every
-- surface in the product goes through.
--
-- `identity_first_name` is NOT nulled. It is the provider-verified GIVEN name, it is
-- part of the identity disclosure that Req 7.4 retains for arbitration, and Req 7.5
-- enumerates the fields closure removes — this is not one of them.
--
-- Every column from 0087 is preserved and in the same order; `closed_at` is appended
-- so nothing selecting positionally moves. Recreated rather than replaced-in-place
-- would be needed only for a type change, so `create or replace` is enough here.

create or replace view cardtrade.public_profiles as
  select
    id,
    case
      when closed_at is null then display_name
      else 'Closed account'::text
    end as display_name,
    rating,
    rating_count,
    (identity_check_status = 'VERIFIED'::cardtrade.identity_check_status) as is_verified,
    case
      when identity_check_status = 'VERIFIED'::cardtrade.identity_check_status
      then split_part(btrim(coalesce(identity_check_name, merchant_legal_entity_name)), ' '::text, 1)
      else null::text
    end as identity_first_name,
    region_code,
    case when closed_at is null then avatar_path else null::text end as avatar_path,
    case when closed_at is null then social_links else null::jsonb end as social_links,
    case when closed_at is null then bio else null::text end as bio,
    closed_at
  from cardtrade.profiles;

comment on view cardtrade.public_profiles is
  'Catalog-safe public projection of a Profile. Serves BOTH contract reads and '
  'discovery, so a closed account still returns a row here with its display name '
  'replaced and its avatar, bio and social links dropped (Req 7.5) — a counterparty '
  'or arbitrator on a completed contract must still see someone. Discovery reads '
  'cardtrade.discoverable_profiles instead, which omits closed accounts. Never '
  'exposes contact_email, merchant refs, legal name, or compliance notes.';

-- =============================================================================
-- 3. discoverable_profiles: closed accounts are excluded from DISCOVERY
-- =============================================================================
--
-- Excluding a closed member from discovery is a different question from excluding
-- them from a contract read, and it needs its own relation rather than a predicate
-- on the shared one. Seller browse, the seller directory and any future "find a
-- trader" surface read THIS view; contract rooms, message threads, review lists and
-- arbitration keep reading `public_profiles`.
--
-- Same shape as `public_profiles`, so a discovery caller can move onto it by
-- changing the relation name and nothing else. Also not a `security_invoker` view,
-- for the same reason `public_profiles` is not: invoker rights would evaluate
-- `profiles_owner_select` (`auth.uid() = id`) as the caller and every discovery
-- surface reads OTHER members, so it would return nothing.

create or replace view cardtrade.discoverable_profiles as
  select *
  from cardtrade.public_profiles
  where closed_at is null;

comment on view cardtrade.discoverable_profiles is
  'Discovery projection: cardtrade.public_profiles with closed accounts omitted '
  '(Req 7.4). Read by seller browse and directory surfaces. A contract room, '
  'message thread, review list or arbitration case must NOT read this view — it '
  'would hide a counterparty from a live contract.';

-- =============================================================================
-- 4. Access
-- =============================================================================
--
-- RLS on `profiles` is unchanged and needs no new policy: `profiles_owner_select`
-- (0002, re-created in 0078) is row-level, so the new column is readable exactly
-- where the rest of the row already is — by its owner and by the service role.
-- What the owner needs on top of the policy is the COLUMN privilege, because SELECT
-- on `profiles` is granted per column for `authenticated` (0066, 0069): without the
-- grant below a member cannot read their own closure state.
--
-- There is deliberately NO update grant. The member write allowlist (0072) is
-- explicit, so a new column is unwritable by default — the revokes below assert
-- that rather than change it, because a future blanket re-grant would otherwise
-- hand members a self-service closed flag, and a closed account a member can set
-- (and unset) is a way to fake having left while still holding a live contract.
-- Closure goes through the orchestrator on the service-role path.
--
-- The views stay SELECT-only for both roles, per the 0032/0072 fix: they are not
-- `security_invoker`, so a write grant on either would bypass the owner-only RLS on
-- the base table.
--
-- No `grant execute` to `authenticated` on any cardtrade function is added here.
--
-- COLUMN GRANTS LAST. A per-column read grant opens with a keyword-then-paren pair
-- that `tests/property/identityGate.test.ts` also uses to find a trigger function
-- body; it parses migration text with regexes and matches across newlines, in a
-- comment just as readily as in code, so those statements go at the end of the file
-- and the literal is not spelled out above them.

revoke update (closed_at) on cardtrade.profiles from authenticated;
revoke update (closed_at) on cardtrade.profiles from anon;

revoke insert, update, delete on cardtrade.public_profiles from authenticated;
revoke insert, update, delete on cardtrade.public_profiles from anon;
revoke insert, update, delete on cardtrade.discoverable_profiles from authenticated;
revoke insert, update, delete on cardtrade.discoverable_profiles from anon;

grant select on cardtrade.public_profiles to anon, authenticated;
grant select on cardtrade.discoverable_profiles to anon, authenticated;

grant select (closed_at) on cardtrade.profiles to authenticated;
