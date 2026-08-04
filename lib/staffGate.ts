import 'server-only';

// lib/staffGate.ts
//
// The two staff capability gates.
//
// TWO GATES, NOT A HIERARCHY WITH ONE SWITCH:
//
//   requireStaff — may arbitrate. `is_support` OR `is_admin`.
//   requireAdmin — may moderate. `is_admin` only. Lives in `lib/actions/admin.ts`.
//
// An admin satisfies both; a support worker satisfies only the first. Nothing derives
// one flag from the other, so they cannot drift out of agreement.
//
// WHY THE SPLIT MATTERS. Arbitration moves money — a fraud finding captures a full
// collateral authorisation — but it does not need the ability to hide listings, action
// community reports, clear reconciliation flags or drain payout queues. Handing every
// support worker those powers because they need one of them is how blast radius grows
// quietly.
//
// Read through the admin client because `is_support` and `is_admin` are
// provider-controlled: `0005_merchant_onboarding.sql` revoked column UPDATE on
// `profiles` from `authenticated`, and `0047` asserts the same for `is_support`, so a
// member cannot promote themselves.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/** Typed refusal reasons, matching the admin action vocabulary. */
export type StaffGateError = 'not-authenticated' | 'not-authorized';

/** What the caller may do, once past the gate. */
export interface StaffContext {
  userId: string;
  /** True when the caller may also moderate. */
  isAdmin: boolean;
}

/**
 * Require a caller who may arbitrate.
 *
 * Returns the caller's id and whether they are additionally an admin, so a single
 * read serves both the gate and any admin-only affordance on the same surface.
 */
export async function requireStaff(): Promise<
  { ok: true; ctx: StaffContext } | { ok: false; error: StaffGateError }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not-authenticated' };

  const { data } = await createAdminClient()
    .from('profiles')
    .select('is_admin, is_support')
    .eq('id', user.id)
    .maybeSingle();

  const isAdmin = Boolean(data?.is_admin);
  const isSupport = Boolean(data?.is_support);
  if (!isAdmin && !isSupport) return { ok: false, error: 'not-authorized' };

  return { ok: true, ctx: { userId: user.id, isAdmin } };
}

/**
 * Whether a profile may reach the arbitration workspace, for navigation.
 *
 * Cheap and read-only: used to decide whether to render a link, never to authorise an
 * action. Every action re-checks through {@link requireStaff}.
 */
export async function isStaff(profileId: string): Promise<boolean> {
  const { data } = await createAdminClient()
    .from('profiles')
    .select('is_admin, is_support')
    .eq('id', profileId)
    .maybeSingle();

  return Boolean(data?.is_admin) || Boolean(data?.is_support);
}
