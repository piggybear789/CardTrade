'use server';

// lib/actions/payments.ts
//
// Payment-instrument Server Actions. These exist because collateral holds and
// cash-sale collections happen off-session, long after the cardholder has left,
// so the Payer needs a vaulted instrument to draw on: a charge against a payer
// with no saved method is rejected by the provider.
//
// PCI SCOPE. Card fields are rendered by the PROVIDER inside its own iframe
// (Stripe Payment Element), so no card number, CVC, expiry, BSB or account number
// is ever accepted, validated, logged, or stored — not by this module, and not by
// any component. This is a narrower surface than the previous CaptureJS
// arrangement, which rendered our own card inputs and validated them before
// tokenising.
//
// The publishable key is returned by an action rather than read from a
// `NEXT_PUBLIC_` env var in the client, so the server stays the single place that
// resolves provider configuration.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getPaymentService } from '@/domain/services';
import { type ActionResult, fail, ok } from './result';

/** Typed failure codes for {@link beginCardSetup} and {@link completeCardSetup}. */
export type CardSetupError =
  | 'NOT_AUTHENTICATED'
  | 'PROFILE_NOT_FOUND'
  | 'NOT_SUPPORTED' // the active provider has no hosted capture flow
  | 'PAYER_UNAVAILABLE'
  | 'PROVIDER_ERROR';

/** What the browser needs to mount the provider's own card fields. */
export interface CardSetupSession {
  setupId: string;
  /** Scoped to this one setup attempt; cannot move money. */
  clientSecret: string;
  publishableKey: string;
}

/**
 * Open a provider-hosted card capture session for the signed-in User, creating
 * their Payer on demand (Req 2.1).
 *
 * The returned secret lets the browser talk to the provider's card fields
 * directly. Nothing here accepts card data, and the provider — not the client —
 * is the source of truth for what gets vaulted.
 */
export async function beginCardSetup(): Promise<ActionResult<CardSetupSession, CardSetupError>> {
  const authed = await requirePayer();
  if (!authed.ok) return authed;

  const { payments, payerId } = authed.data;
  if (!payments.beginInstrumentSetup) {
    return fail('NOT_SUPPORTED', 'The active payment provider cannot store payment methods.');
  }

  try {
    const setup = await payments.beginInstrumentSetup({ payerId });
    return ok({
      setupId: setup.setupId,
      clientSecret: setup.clientSecret,
      publishableKey: setup.publishableKey,
    });
  } catch (err) {
    return fail(
      'PROVIDER_ERROR',
      err instanceof Error ? err.message : 'Could not start card entry.',
    );
  }
}

/**
 * Confirm a completed card setup and persist the saved-method reference.
 *
 * The brand/last4 label is read back from the provider rather than accepted from
 * the client, so it cannot be spoofed, and ownership of the setup is verified
 * against this User's Payer inside the service.
 */
export async function completeCardSetup(
  setupId: string,
): Promise<ActionResult<{ sourceId: string; label: string }, CardSetupError>> {
  const authed = await requirePayer();
  if (!authed.ok) return authed;

  const { payments, payerId, userId } = authed.data;
  if (!payments.completeInstrumentSetup) {
    return fail('NOT_SUPPORTED', 'The active payment provider cannot store payment methods.');
  }
  if (!setupId?.trim()) {
    return fail('PROVIDER_ERROR', 'No card setup reference was supplied.');
  }

  try {
    const instrument = await payments.completeInstrumentSetup({
      payerId,
      setupId: setupId.trim(),
    });

    const label = buildPaymentMethodLabel('credit-card', {
      brand: instrument.brand ? titleCase(instrument.brand) : undefined,
      last4: instrument.last4,
    });

    const admin = createAdminClient();
    await admin
      .from('profiles')
      .update({
        payment_source_id: instrument.sourceId,
        payment_token_type: 'credit-card',
        payment_method_label: label,
      })
      .eq('id', userId);

    return ok({ sourceId: instrument.sourceId, label });
  } catch (err) {
    return fail(
      'PROVIDER_ERROR',
      err instanceof Error ? err.message : 'The payment method could not be saved.',
    );
  }
}

/**
 * Resolve the signed-in User's provider Payer, creating it on first use.
 *
 * The Payer id is read/written with the service-role client because `profiles`
 * RLS is owner-only for writes of provider references; only `payer_id` is
 * touched.
 */
async function requirePayer(): Promise<
  ActionResult<
    { payments: ReturnType<typeof getPaymentService>; payerId: string; userId: string },
    CardSetupError
  >
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return fail('NOT_AUTHENTICATED', 'You must be signed in to add a payment method.');
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from('profiles')
    .select('payer_id, display_name, contact_email, region_code')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) {
    return fail('PROFILE_NOT_FOUND', 'No profile was found for your account.');
  }

  // The payer (a Stripe Customer) and any vaulted card belong to ONE platform
  // account, so they must be created on the member's own region's platform (0068).
  // A card vaulted on the AU platform is invisible to the GB platform, and a hold
  // placed with the wrong one fails with no saved method rather than a clear error.
  const payments = getPaymentService(profile.region_code as string | null);
  let payerId = (profile.payer_id as string | null) ?? null;

  if (!payerId) {
    try {
      const payer = await payments.createPayer(user.id, {
        displayName: (profile.display_name as string | null) ?? undefined,
        email: (profile.contact_email as string | null) ?? undefined,
      });
      payerId = payer.payerId;
      await admin.from('profiles').update({ payer_id: payerId }).eq('id', user.id);
    } catch (err) {
      return fail(
        'PAYER_UNAVAILABLE',
        err instanceof Error ? err.message : 'Could not create a payment profile.',
      );
    }
  }

  return ok({ payments, payerId, userId: user.id });
}

/** `visa` -> `Visa`, for display in a saved-method label. */
function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Derive a human-readable label like "Visa •••• 4242" from display metadata. */
function buildPaymentMethodLabel(
  sourceType: 'credit-card' | 'bank-account',
  meta?: { last4?: string; brand?: string },
): string {
  if (sourceType === 'bank-account') {
    return meta?.last4 ? `Bank account •••• ${meta.last4}` : 'Bank account';
  }
  const brand = meta?.brand ?? 'Card';
  const last4 = meta?.last4 ?? '';
  return last4 ? `${brand} •••• ${last4}` : brand;
}

/** What the checkout UI shows for the buyer's saved payment method. */
export interface PaymentMethodStatus {
  hasPaymentMethod: boolean;
  /** Display label like "Visa •••• 4242". Null when no method exists. */
  label: string | null;
  /**
   * Expiry as `MM/YY`, read LIVE from the provider and never stored.
   *
   * Null whenever it could not be read — no card, a provider that does not
   * implement the read, or a failed call. Callers must treat it as optional
   * decoration: the label alone already identifies the card.
   */
  expiry: string | null;
}

/**
 * Read the current buyer's payment method status for checkout display.
 * Returns only the display-safe label, never any credential or token.
 */
export async function getPaymentMethodStatus(): Promise<
  ActionResult<PaymentMethodStatus, 'NOT_AUTHENTICATED'>
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return fail('NOT_AUTHENTICATED', 'You must be signed in.');
  }

  const admin = createAdminClient();
  const { data } = await admin
    .from('profiles')
    .select('payment_source_id, payment_method_label, payer_id')
    .eq('id', user.id)
    .maybeSingle();

  const hasPaymentMethod = Boolean(data?.payment_source_id);
  const label = (data?.payment_method_label as string | null) ?? null;

  // Expiry is read LIVE and never persisted — see `describeInstrument` on the seam
  // for why (the steering doc forbids instrument fields like expiry in a table).
  //
  // BEST-EFFORT BY DESIGN. This is decoration on a settings row, so a provider
  // outage must not fail the page or block the rest of the status. Anything that
  // goes wrong — no payer, no source, a provider without the method, a thrown
  // request — leaves `expiry` null and the label still renders.
  let expiry: string | null = null;
  const payerId = (data?.payer_id as string | null) ?? null;
  const sourceId = (data?.payment_source_id as string | null) ?? null;
  if (payerId && sourceId) {
    try {
      const payments = getPaymentService();
      const details = await payments.describeInstrument?.({ payerId, sourceId });
      if (details?.expMonth && details.expYear) {
        const month = String(details.expMonth).padStart(2, '0');
        const year = String(details.expYear).slice(-2);
        expiry = `${month}/${year}`;
      }
    } catch {
      // Deliberately silent: see above.
    }
  }

  return ok({ hasPaymentMethod, label, expiry });
}
