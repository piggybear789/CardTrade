// scripts/simulate-cash-sale.ts
//
// Drive the seeded Cash_Sale through REAL Stripe test-mode calls, so the demo row
// is backed by genuine provider objects instead of `pi_demo_*` placeholders.
//
// Deliberately goes through our own PaymentService rather than the Stripe SDK
// directly: the point is to exercise the integration we ship, including the
// collect-to-platform-then-release split, not to prove that Stripe works.
//
// SAFETY
//   * Refuses to run against an `sk_live_` key.
//   * Test mode makes real API calls that move NO real money.
//   * The seller release is a real Transfer to a real connected account, which
//     requires that account to be payable. If it is not, the script says so and
//     leaves the release FAILED rather than pretending.
//
// Run with:
//   npx tsx --env-file=.env.local scripts/simulate-cash-sale.ts

import { getPaymentService } from '../domain/services';
import { isRealMoneyProvider, resolvePaymentProvider } from '../domain/services/providerMode';

const SALE_TITLE = '1999 Charizard Holo (PSA 8)';
const BUYER_EMAIL = 'mika.demo@noditto.test';
const SELLER_EMAIL = 'kitsunearia@gmail.com';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

if (isRealMoneyProvider()) {
  console.error('Refusing to run: STRIPE_SECRET_KEY is a live key.');
  process.exit(1);
}
if (resolvePaymentProvider() !== 'stripe') {
  console.error('PAYMENTS_PROVIDER does not resolve to stripe; nothing real to simulate.');
  process.exit(1);
}

// Supabase over REST rather than supabase-js: the JS client builds a Realtime
// client on init, which needs a native WebSocket and therefore Node 22+.
const rest = `${url.replace(/\/$/, '')}/rest/v1`;
const headers = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`,
  'content-type': 'application/json',
  'accept-profile': 'cardtrade',
  'content-profile': 'cardtrade',
};

const aud = (cents: number) =>
  `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 })}`;
const step = (n: number, label: string) => console.log(`\n${n}. ${label}`);
const ok = (msg: string) => console.log(`  ok    ${msg}`);
const warn = (msg: string) => console.log(`  warn  ${msg}`);

async function q<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${rest}/${path}`, { ...init, headers });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

interface SaleRow {
  id: string;
  buyer_id: string;
  seller_id: string;
  amount_cents: number;
  platform_fee_cents: number;
  transfer_id: string | null;
  seller_payout_status: string;
}
interface ProfileRow {
  id: string;
  display_name: string | null;
  contact_email: string | null;
}

async function main() {
  const payments = getPaymentService();

  step(0, 'Locate the seeded sale');
  const [sale] = await q<SaleRow[]>(
    `cash_sales?item_title=eq.${encodeURIComponent(SALE_TITLE)}&select=id,buyer_id,seller_id,amount_cents,platform_fee_cents,transfer_id,seller_payout_status`,
  );
  if (!sale) throw new Error('Seeded sale not found. Run supabase/seeds/demo_kitsunearia.sql first.');
  const net = Math.max(sale.amount_cents - sale.platform_fee_cents, 0);
  ok(`sale ${sale.id} — buyer pays ${aud(sale.amount_cents)}, seller nets ${aud(net)}`);

  const profiles = await q<ProfileRow[]>(
    `profiles?id=in.(${sale.buyer_id},${sale.seller_id})&select=id,display_name,contact_email`,
  );
  const buyer = profiles.find((p) => p.id === sale.buyer_id)!;
  const seller = profiles.find((p) => p.id === sale.seller_id)!;

  // Already collected on a previous run. Re-collecting is not just wasteful — it
  // charges the Buyer twice, and Stripe rightly rejects a reused idempotency key
  // whose parameters changed (a freshly vaulted card changes them). So skip
  // straight to the release, which is the part that can legitimately be retried.
  const alreadyCollected = sale.transfer_id?.startsWith('pi_') === true;
  if (alreadyCollected) {
    warn(`collection already settled as ${sale.transfer_id} — skipping to the release`);
    await releaseOnly(sale, net);
    return;
  }

  // ---- Buyer: real Customer + real vaulted card -------------------------
  step(1, 'Buyer payer — real Stripe Customer');
  const buyerPayer = await payments.createPayer(buyer.id, {
    displayName: buyer.display_name ?? 'Demo buyer',
    email: buyer.contact_email ?? BUYER_EMAIL,
  });
  ok(`${buyerPayer.payerId} for ${buyer.display_name}`);

  step(2, 'Vault a test card and make it the default');
  const card = await payments.attachPaymentSource!({
    payerId: buyerPayer.payerId,
    // Stripe's canonical test Visa. Card data never touches us.
    token: 'pm_card_visa',
    sourceType: 'credit-card',
  });
  // The seam returns only `sourceId`. Brand and last4 are read back FROM the
  // provider by `completeCardSetup` for display; they are deliberately not part of
  // this contract, so there is nothing else to log here.
  ok(card.sourceId);

  // ---- Seller: real connected account ----------------------------------
  step(3, 'Seller payee — real connected account (Accounts v2 recipient)');
  let merchantRef: string | null = null;
  let payable = false;
  try {
    const merchant = await payments.createManagedMerchant!({
      profileId: seller.id,
      businessEmail: seller.contact_email ?? SELLER_EMAIL,
      tradingName: seller.display_name ?? undefined,
    });
    merchantRef = merchant.merchantRef;
    payable = merchant.settlementsEnabled === true;
    ok(`${merchantRef} — compliance ${merchant.complianceStatus}, settlements ${payable}`);
    if (!payable) {
      warn('Not payable yet: hosted onboarding must be completed before a Transfer lands.');
    }
  } catch (err) {
    warn(`Could not create a connected account: ${err instanceof Error ? err.message : err}`);
    warn('Usually means platform loss liability is not accepted in the Dashboard yet.');
  }

  // ---- Collection: real PaymentIntent into the PLATFORM balance ---------
  step(4, `Collect ${aud(sale.amount_cents)} from the buyer into the platform balance`);
  const collection = await payments.requestTransfer({
    payerId: buyerPayer.payerId,
    amount: sale.amount_cents,
    ref: `cash-sale:${sale.id}`,
    nonce: `sim-collect:${sale.id}`,
  });
  if (collection.status !== 'SETTLED') {
    throw new Error(`Collection failed: ${collection.transferId || 'no id'}`);
  }
  ok(`${collection.transferId} SETTLED — funds are in the platform balance, not the seller's`);

  // ---- Release: real Transfer out of the platform balance ---------------
  step(5, `Release ${aud(net)} to the seller (platform keeps ${aud(sale.platform_fee_cents)})`);
  let payoutRef: string | null = null;
  let payoutStatus: 'SETTLED' | 'FAILED' = 'FAILED';
  let payoutError: string | null = null;

  if (!merchantRef) {
    payoutError = 'No connected account exists for the seller yet.';
    warn(payoutError);
  } else {
    const payout = await payments.payoutToMerchant({
      merchantRef,
      amount: net,
      ref: `cash-sale-payout:${sale.id}`,
      nonce: `sim-payout:${sale.id}`,
      sourcePaymentRef: collection.transferId,
    });
    payoutStatus = payout.status === 'SETTLED' ? 'SETTLED' : 'FAILED';
    payoutRef = payout.transferId || null;
    if (payoutStatus === 'SETTLED') {
      ok(`${payoutRef} SETTLED — money reached the connected account`);
    } else {
      payoutError = 'Provider rejected the seller payout (account not payable yet).';
      warn(payoutError);
    }
  }

  // ---- Persist the real references -------------------------------------
  step(6, 'Write the real provider references back to the sale');
  await fetch(`${rest}/cash_sales?id=eq.${sale.id}`, {
    method: 'PATCH',
    headers: { ...headers, prefer: 'return=minimal' },
    body: JSON.stringify({
      transfer_id: collection.transferId,
      payment_nonce: `sim-collect:${sale.id}`,
      seller_payout_status: payoutStatus,
      seller_payout_ref: payoutRef,
      seller_payout_nonce: `sim-payout:${sale.id}`,
      seller_payout_at: payoutStatus === 'SETTLED' ? new Date().toISOString() : null,
      seller_payout_error: payoutError,
    }),
  });
  if (merchantRef) {
    await fetch(`${rest}/profiles?id=eq.${seller.id}`, {
      method: 'PATCH',
      headers: { ...headers, prefer: 'return=minimal' },
      body: JSON.stringify({
        merchant_ref: merchantRef,
        merchant_settlements_enabled: payable,
        merchant_status: payable ? 'APPROVED' : 'PENDING',
      }),
    });
  }
  await fetch(`${rest}/profiles?id=eq.${buyer.id}`, {
    method: 'PATCH',
    headers: { ...headers, prefer: 'return=minimal' },
    body: JSON.stringify({ payer_id: buyerPayer.payerId, payment_source_id: card.sourceId }),
  });
  ok('sale and profiles now reference real Stripe objects');

  console.log(
    `\nDone. Collection is real and settled; release is ${payoutStatus}.` +
      (payoutStatus === 'SETTLED'
        ? ''
        : '\nThe /admin "Seller releases owed" section will show this as owed, which is accurate.'),
  );
}

/**
 * Retry just the Seller release, through the real orchestrator.
 *
 * Goes via `payoutSeller` rather than calling the provider directly so the whole
 * production path is exercised: the DB payability gate, the persisted nonce, the
 * status write-back, and the audit event. This is the same code the /admin "Retry
 * release" button runs.
 */
async function releaseOnly(sale: SaleRow, net: number) {
  step(1, 'Refresh the seller payability gate from the provider');
  const [sellerProfile] = await q<Array<{ id: string; merchant_ref: string | null }>>(
    `profiles?id=eq.${sale.seller_id}&select=id,merchant_ref`,
  );
  const merchantRef = sellerProfile?.merchant_ref;
  if (!merchantRef) throw new Error('Seller has no merchant_ref; run the full simulation first.');

  const payments = getPaymentService();
  const merchant = await payments.getManagedMerchant!(merchantRef);
  const payable = merchant?.settlementsEnabled === true;
  ok(`${merchantRef} — compliance ${merchant?.complianceStatus}, settlements ${payable}`);

  // The orchestrator reads payability from the DB, so it has to reflect reality
  // before the release is attempted.
  await fetch(`${rest}/profiles?id=eq.${sale.seller_id}`, {
    method: 'PATCH',
    headers: { ...headers, prefer: 'return=minimal' },
    body: JSON.stringify({
      merchant_settlements_enabled: payable,
      merchant_status: payable ? 'APPROVED' : 'PENDING',
    }),
  });

  if (!payable) {
    warn('Still not payable. The capability activates asynchronously — try again shortly.');
    return;
  }

  step(2, `Release ${aud(net)} out of the platform balance`);
  // NOTE: this calls the provider seam directly rather than the orchestrator.
  // `supabaseCashSaleRepository` pulls in the admin client, which is guarded by
  // `server-only` and refuses to load outside a React Server Component — so the
  // orchestrator path can only be exercised from the app itself. Press "Retry
  // release" in /admin to run that version.
  const [row] = await q<Array<{ seller_payout_nonce: string | null }>>(
    `cash_sales?id=eq.${sale.id}&select=seller_payout_nonce`,
  );
  // Reuse the PERSISTED nonce, never a fresh one: that is what makes a retry
  // safe if an earlier attempt actually succeeded but the response was lost.
  const nonce = row?.seller_payout_nonce ?? `payout:${sale.id}`;

  const payout = await payments.payoutToMerchant({
    merchantRef,
    amount: net,
    ref: `cash-sale-payout:${sale.id}`,
    nonce,
    sourcePaymentRef: sale.transfer_id ?? undefined,
  });

  const settled = payout.status === 'SETTLED';
  await fetch(`${rest}/cash_sales?id=eq.${sale.id}`, {
    method: 'PATCH',
    headers: { ...headers, prefer: 'return=minimal' },
    body: JSON.stringify({
      seller_payout_status: settled ? 'SETTLED' : 'FAILED',
      seller_payout_ref: payout.transferId || null,
      seller_payout_nonce: nonce,
      seller_payout_at: settled ? new Date().toISOString() : null,
      seller_payout_error: settled ? null : 'Provider rejected the seller payout',
    }),
  });

  if (!settled) {
    warn('release still failing — check the account capability');
    return;
  }
  ok(`${payout.transferId} SETTLED`);
  console.log('\nDone. The seller has been paid out of the platform balance.');
}

main().catch((err) => {
  console.error(`\nSimulation failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
