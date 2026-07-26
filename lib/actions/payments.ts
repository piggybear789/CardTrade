'use server';

// lib/actions/payments.ts
//
// Payment-instrument Server Actions. These exist because real Pinch charges
// (collateral holds, cash-sale transfers) need a vaulted payment source on the
// Payer: a realtime payment against a payer with no source is rejected by the
// provider.
//
// PCI SCOPE. Card details are tokenised in the browser by Pinch CaptureJS; only
// the resulting short-lived token reaches this module. No card number, CVC,
// expiry, BSB or account number is ever accepted, validated, logged, or stored
// here — see `.kiro/steering/pinch-payments.md`.
//
// The publishable key is the only Pinch value that may reach the client. It is
// returned by an action rather than inlined as a `NEXT_PUBLIC_` env var so the
// server stays the single place that resolves test-vs-live configuration.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getPaymentService } from '@/domain/services';
import { readPinchPublishableKey } from '@/domain/services/pinch';
import { type ActionResult, fail, ok } from './result';

/** Typed failure codes for {@link attachPaymentSource}. */
export type AttachSourceError =
  | 'NOT_AUTHENTICATED'
  | 'PROFILE_NOT_FOUND'
  | 'NOT_SUPPORTED' // the active provider does not vault instruments
  | 'PAYER_UNAVAILABLE' // the provider payer could not be created
  | 'PROVIDER_ERROR';

/** Typed failure codes for {@link getTokenisationConfig}. */
export type TokenisationConfigError = 'NOT_CONFIGURED';

/** What the browser needs to run CaptureJS. */
export interface TokenisationConfig {
  publishableKey: string;
  /** `test` or `live`, so the UI can badge non-production flows. */
  environment: string;
}

/**
 * Return the CaptureJS publishable key for the active environment. Safe to hand
 * to the browser: it can only create tokens, never move money.
 */
export async function getTokenisationConfig(): Promise<
  ActionResult<TokenisationConfig, TokenisationConfigError>
> {
  const publishableKey = readPinchPublishableKey();
  if (!publishableKey) {
    return fail(
      'NOT_CONFIGURED',
      'Card capture is not configured for this environment.',
    );
  }
  return ok({
    publishableKey,
    environment: process.env.PINCH_ENV?.toLowerCase() === 'live' ? 'live' : 'test',
  });
}

/**
 * Vault a CaptureJS token against the signed-in User's provider Payer, creating
 * the Payer on demand (Req 2.1).
 *
 * The Payer id is read/written with the service-role client because `profiles`
 * RLS is owner-only for writes of provider references; only `payer_id` is
 * touched. The returned source id is provider-side and carries no card data.
 *
 * `cardLast4` and `cardBrand` are display metadata derived by the caller from
 * the card entry UI — the server never sees the full card number. They are
 * persisted as a label so the buyer can identify their saved method later.
 */
export async function attachPaymentSource(
  token: string,
  sourceType: 'credit-card' | 'bank-account' = 'credit-card',
  displayMeta?: { last4?: string; brand?: string },
): Promise<ActionResult<{ sourceId: string }, AttachSourceError>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return fail('NOT_AUTHENTICATED', 'You must be signed in to add a payment method.');
  }
  if (!token?.trim()) {
    return fail('PROVIDER_ERROR', 'No payment token was supplied.');
  }

  const payments = getPaymentService();
  if (!payments.attachPaymentSource) {
    return fail(
      'NOT_SUPPORTED',
      'The active payment provider does not store payment methods.',
    );
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from('profiles')
    .select('payer_id, display_name, contact_email')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) {
    return fail('PROFILE_NOT_FOUND', 'No profile was found for your account.');
  }

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

  try {
    const result = await payments.attachPaymentSource({
      payerId,
      token: token.trim(),
      sourceType,
    });

    // Persist the provider-vaulted source reference as the authoritative proof
    // that this payer can be charged later. The label is display-only.
    // `payment_token` remains server-only for the separately ticketed
    // cross-merchant payer flow; it is never used as the saved-source signal.
    const label = buildPaymentMethodLabel(sourceType, displayMeta);
    await admin
      .from('profiles')
      .update({
        payment_source_id: result.sourceId,
        payment_token: token.trim(),
        payment_token_type: sourceType,
        payment_method_label: label,
      })
      .eq('id', user.id);

    return ok({ sourceId: result.sourceId });
  } catch (err) {
    return fail(
      'PROVIDER_ERROR',
      err instanceof Error ? err.message : 'The payment method could not be saved.',
    );
  }
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
    .select('payment_source_id, payment_method_label')
    .eq('id', user.id)
    .maybeSingle();

  const hasPaymentMethod = Boolean(data?.payment_source_id);
  const label = (data?.payment_method_label as string | null) ?? null;

  return ok({ hasPaymentMethod, label });
}
