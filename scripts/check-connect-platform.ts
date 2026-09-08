/**
 * Report whether a Stripe platform account can create connected accounts.
 *
 * Two independent things block `v2.core.accounts.create` and the error text does
 * not distinguish them: the platform's own ACCOUNT ACTIVATION (business details
 * submitted) and its CONNECT PLATFORM PROFILE. The first is readable from the
 * account object; the second is only observable by attempting a create, which is
 * why `--probe` exists.
 *
 * Reads the key from STRIPE_SECRET_KEY. Nothing is written to disk and the key is
 * never printed beyond its mode prefix.
 *
 * Usage:
 *   $env:STRIPE_SECRET_KEY="sk_..."; npx tsx scripts/check-connect-platform.ts
 *   $env:STRIPE_SECRET_KEY="sk_..."; npx tsx scripts/check-connect-platform.ts --probe
 */
import Stripe from 'stripe';

const key = (process.env.STRIPE_SECRET_KEY ?? '').trim();
const probe = process.argv.includes('--probe');

if (!key) {
  console.error('STRIPE_SECRET_KEY is not set.');
  process.exit(1);
}

const mode = key.startsWith('sk_live_') ? 'LIVE' : key.startsWith('sk_test_') ? 'TEST' : 'UNKNOWN';
const stripe = new Stripe(key);

async function main() {
  console.log(`key mode:                 ${mode}`);

  // `GET /v1/account` — the key's OWN account — is a real endpoint the SDK supports at
  // runtime, but its types only declare overloads that begin with a connected-account
  // id. Narrowed through the object rather than by detaching the method, so the
  // receiver stays bound.
  const ownAccount = stripe.accounts as unknown as { retrieve(): Promise<Stripe.Account> };
  const acct = await ownAccount.retrieve();
  console.log(`platform account:         ${acct.id}`);
  console.log(`country:                  ${acct.country}`);
  console.log(`details_submitted:        ${acct.details_submitted}`);
  console.log(`charges_enabled:          ${acct.charges_enabled}`);
  console.log(`payouts_enabled:          ${acct.payouts_enabled}`);
  console.log(`transfers capability:     ${acct.capabilities?.transfers ?? 'absent'}`);
  console.log(`disabled_reason:          ${acct.requirements?.disabled_reason ?? 'none'}`);
  console.log(`currently_due:            ${JSON.stringify(acct.requirements?.currently_due ?? [])}`);

  // ACTIVATION verdict. Says nothing about the Connect platform profile.
  if (!acct.details_submitted || !acct.charges_enabled) {
    console.log('\nACTIVATION: incomplete. Submit business details before anything else.');
  } else {
    console.log('\nACTIVATION: complete.');
  }

  if (!probe) {
    console.log('\nCONNECT PLATFORM PROFILE: not checked. Re-run with --probe to test it.');
    console.log('(--probe creates one throwaway recipient account and then closes it.)');
    return;
  }

  console.log('\nCONNECT PLATFORM PROFILE: probing with a throwaway recipient account...');
  let createdId: string | undefined;
  try {
    // Mirrors the shape StripeService.createManagedMerchant sends, because the
    // failure is sensitive to `losses_collector: 'application'` — the platform
    // liability undertaking Stripe will not grant to an unreviewed platform.
    const created = await stripe.v2.core.accounts.create(
      {
        contact_email: 'connect-platform-probe@example.com',
        display_name: 'Connect platform probe',
        dashboard: 'express',
        configuration: {
          recipient: {
            capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
          },
        },
        defaults: {
          currency: acct.default_currency ?? 'aud',
          responsibilities: { fees_collector: 'application', losses_collector: 'application' },
        },
        identity: { country: acct.country?.toLowerCase() ?? 'au', entity_type: 'individual' },
        metadata: { cardtrade_probe: 'true' },
      },
      { idempotencyKey: `connect-platform-probe:${Date.now()}` },
    );
    createdId = created.id;
    console.log(`  RESULT: OK. Created ${created.id}.`);
    console.log('  The platform can create connected accounts. Retry Add payout details.');
  } catch (err) {
    const e = err as Stripe.errors.StripeError;
    console.log('  RESULT: FAILED.');
    console.log(`    type:    ${e.type}`);
    console.log(`    code:    ${e.code ?? 'none'}`);
    console.log(`    message: ${e.message}`);
  }

  if (createdId) {
    try {
      await stripe.accounts.del(createdId);
      console.log(`  cleaned up ${createdId}.`);
    } catch {
      console.log(`  could not auto-delete ${createdId} — remove it in the Dashboard.`);
    }
  }
}

main().catch((e) => {
  console.error('failed:', (e as Error).message);
  process.exit(1);
});
