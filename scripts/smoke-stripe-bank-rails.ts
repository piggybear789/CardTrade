// END-TO-END payment run for every cash-sale rail, Stripe TEST mode only (refuses a live key).
//
// For each rail, through the app's real code: the cash-sale orchestrator (in-memory
// repository) + the real StripeService for the platform. Per sale:
//   agree terms -> Pay with the rail (acceptCashSaleTerms) -> the buyer approves in a
//   real browser via Payment Element + Stripe's test bank page -> read-back settles
//   (confirmCashSalePayment) -> ship -> receive -> accept -> seller payout transfer
//   (payoutCashSaleSeller) -> verify on Stripe: amount, rail, on_behalf_of, transfer,
//   and Stripe's ACTUAL fee against our cost table.
// A second sale per rail is paid and then refunded (refundOnFraudWarning) to prove a
// refund goes back over that rail.
//
//   npx tsx --env-file=.env.local scripts/smoke-stripe-bank-rails.ts            (every rail)
//   npx tsx --env-file=.env.local scripts/smoke-stripe-bank-rails.ts IDEAL PAYTO
//   npx tsx --env-file=.env.local scripts/smoke-stripe-bank-rails.ts CARD CARD_INTL CARD_UK_EEA
//
// The card runs (0159) pay with a saved test card whose issuing country picks the card
// tier: CARD an Australian card, CARD_INTL a US card on the AU platform, CARD_UK_EEA a
// UK card paying a German seller. Each checks the tier it was priced at and Stripe's
// real fee against our cost table for that tier.
//
// The sellers are fixed TEST connected accounts (a German account on the US platform,
// with the EU rail capabilities, and an Australian one); swap them if those go away.
import { chromium, type Browser, type Page } from '@playwright/test';
import Stripe from 'stripe';

import {
  acceptCashSaleInspection,
  acceptCashSaleTerms,
  confirmCashSalePayment,
  initiateCashSale,
  payoutCashSaleSeller,
  recordCashSaleReceipt,
  recordCashSaleShipment,
  refundOnFraudWarning,
  updateCashSaleTerms,
  type CashSaleOrchestratorDeps,
} from '../domain/orchestrator/cashSaleOrchestrator';
import { createStripeService } from '../domain/services/stripe';
import { readStripeConfig } from '../domain/services/stripe/config';
import { stripeCostMinor } from '../domain/fees/processingFee';
import { totalForMethod, type PaymentMethodKind } from '../domain/payments/paymentMethods';
import { APPROVED_SELLER, BUYER, ITEM, fakeTracking, makeCashSaleRepository } from '../tests/unit/fakes/cashSaleRepository';
import { startPayPage, type PayPage } from './lib/payPage';

type Rail = {
  region: 'US' | 'AU';
  currency: string;
  buyerRegion: string;
  sellerRegion: string;
  payee: string;
  pk: string;
  /** A card run's Stripe test card (`pm_card_*`), whose issuing country picks the tier. */
  card?: string;
};

const DE_SELLER = 'acct_1UQ1EbDBt8PZ9Rx1';
const AU_SELLER = 'acct_1UQ18nKEPlRNc2vb';
const RAILS: Record<string, Rail> = {
  IDEAL: { region: 'US', currency: 'eur', buyerRegion: 'NL', sellerRegion: 'DE', payee: DE_SELLER, pk: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_US' },
  BANCONTACT: { region: 'US', currency: 'eur', buyerRegion: 'BE', sellerRegion: 'DE', payee: DE_SELLER, pk: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_US' },
  EPS: { region: 'US', currency: 'eur', buyerRegion: 'AT', sellerRegion: 'DE', payee: DE_SELLER, pk: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_US' },
  P24: { region: 'US', currency: 'eur', buyerRegion: 'PL', sellerRegion: 'DE', payee: DE_SELLER, pk: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_US' },
  PAYTO: { region: 'AU', currency: 'aud', buyerRegion: 'AU', sellerRegion: 'AU', payee: AU_SELLER, pk: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY' },
  CARD: { region: 'AU', currency: 'aud', buyerRegion: 'AU', sellerRegion: 'AU', payee: AU_SELLER, pk: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', card: 'pm_card_au' },
  // 0159: a US-issued card on the AU platform, priced at the international card tier.
  CARD_INTL: { region: 'AU', currency: 'aud', buyerRegion: 'AU', sellerRegion: 'AU', payee: AU_SELLER, pk: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', card: 'pm_card_visa' },
  // A UK card paying a German seller: the UK–EEA tier.
  CARD_UK_EEA: { region: 'US', currency: 'eur', buyerRegion: 'DE', sellerRegion: 'DE', payee: DE_SELLER, pk: 'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_US', card: 'pm_card_gb' },
};

/** The smoke's run names that are card payments, and what each should be priced as. */
const CARD_RUNS: Record<string, PaymentMethodKind> = {
  CARD: 'CARD',
  CARD_INTL: 'CARD_INTERNATIONAL',
  CARD_UK_EEA: 'CARD_UK_EEA',
};

const PRICE = 10_000;
const POSTAGE = 1_500;
let failures = 0;

function check(cond: unknown, label: string, detail = ''): void {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures += 1;
}

function raw(region: 'US' | 'AU'): Stripe {
  const config = readStripeConfig(process.env, region);
  if (config.environment !== 'test') throw new Error(`refusing: ${region} key is not a test key`);
  return new Stripe(config.secretKey);
}

/**
 * A saved test card on a Stripe Customer, for a card run. `testCard` is the run's own
 * card (`pm_card_au` domestic on the AU platform, `pm_card_visa` US-issued, `pm_card_gb`
 * UK-issued); `E2E_CARD` overrides it. Returns the Customer and the attached card id,
 * which is the `payment_source_id` the app would have stored.
 */
async function testCardPayer(stripe: Stripe, testCard: string): Promise<{ payer: string; source: string }> {
  const customer = await stripe.customers.create({ description: 'NoDitto e2e buyer (test)' });
  const pm = await stripe.paymentMethods.attach(process.env.E2E_CARD ?? testCard, { customer: customer.id });
  await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: pm.id } });
  return { payer: customer.id, source: pm.id };
}

/**
 * Open an agreement as Buy Now does, with no card on file (none is needed to open
 * one). From Pay onwards the real buyer record is swapped in: no card for a bank rail,
 * a saved test card for a card run.
 */
async function buildSale(rail: Rail) {
  const payments = createStripeService({ region: rail.region });
  const stripe = raw(rail.region);
  const repo = makeCashSaleRepository({
    currency: rail.currency,
    item: { ...ITEM, fmvCents: PRICE, ownerRegionCode: rail.sellerRegion },
    buyer: { ...BUYER, regionCode: rail.buyerRegion, payerId: null, paymentSourceId: null },
    payee: { ...APPROVED_SELLER, merchantRef: rail.payee },
  });
  const deps: CashSaleOrchestratorDeps = { repository: repo.repository, payments, tracking: fakeTracking };
  const created = await initiateCashSale(deps, {
    buyerId: BUYER.profileId,
    itemId: ITEM.id,
    sellerIdentityVersion: 'seller-v1',
    buyerConfirmedSellerIdentity: true,
  });
  if (!created.ok) throw new Error(`initiate: ${created.error} ${created.detail ?? ''}`);
  // The fake names every sale `sale-1`, and every Stripe idempotency key is derived from
  // the sale id; a unique id per run keeps one run's keys from replaying another's.
  const id = `e2e-${rail.currency}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  repo.state.sale = { ...repo.state.sale!, id };
  return { deps, repo, stripe, created: { ...created, sale: repo.state.sale! } };
}

async function agree(deps: CashSaleOrchestratorDeps, saleId: string, version: number, country: string) {
  const terms = {
    fulfillmentMethod: 'DELIVERY' as const,
    shippingCostCents: POSTAGE,
    deliveryAddress: { label: 'Test street 1', placeId: 'geo:e2e-1', countryCode: country, lat: 52.37, lng: 4.9 },
  };
  const priced = await updateCashSaleTerms(deps, {
    cashSaleId: saleId,
    actorId: ITEM.ownerId,
    expectedTermsVersion: version,
    terms: { ...terms, deliveryAddress: undefined },
  });
  if (!priced.ok) throw new Error(`postage: ${priced.error}`);
  const addressed = await updateCashSaleTerms(deps, {
    cashSaleId: saleId,
    actorId: BUYER.profileId,
    expectedTermsVersion: priced.sale.termsVersion,
    terms,
  });
  if (!addressed.ok) throw new Error(`address: ${addressed.error}`);
  return addressed.sale;
}

/** The buyer's half: Payment Element, then the rail's test approval. */
async function approveInBrowser(browser: Browser, payPage: PayPage, method: PaymentMethodKind, pk: string, secret: string) {
  const tab: Page = await browser.newPage({ viewport: { width: 560, height: 900 } });
  try {
    await tab.goto(payPage.url({ pk, secret }));
    await tab.waitForFunction(() => (window as unknown as { __ready?: boolean }).__ready === true, null, { timeout: 45_000 });
    const field = tab.frameLocator('iframe[title="Secure payment input frame"]').first();
    await field.locator('#payment-nameInput').fill('Erika Mustermann');
    if (method === 'EPS' || method === 'P24') {
      const bank = field.locator('#payment-bankInput');
      const values = await bank.locator('option').evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value).filter(Boolean));
      await bank.selectOption(values[0]);
    }
    if (method === 'P24') await field.locator('#payment-emailInput').fill('e2e+p24@noditto.app');
    if (method === 'PAYTO') {
      await field.locator('#payment-bsbNumberInput').fill('000000');
      await field.locator('#payment-accountNumberInput').fill('000123456');
    }
    await tab.locator('#pay').click();

    if (method === 'PAYTO') {
      // Approved in the (simulated) banking app; confirmPayment resolves in place.
      await tab.waitForFunction(() => Boolean((window as unknown as { __result?: unknown }).__result), null, { timeout: 60_000 });
      return JSON.stringify(await tab.evaluate(() => (window as unknown as { __result?: unknown }).__result));
    }
    // Redirect rails: Stripe's test bank page, then back to the return URL.
    await tab.waitForURL((url) => !url.href.startsWith('http://localhost'), { timeout: 45_000 });
    const authorize = tab.getByRole('button', { name: /authori[sz]e/i }).or(tab.getByRole('link', { name: /authori[sz]e/i }));
    await authorize.first().click({ timeout: 30_000 });
    await tab.waitForURL((url) => url.href.startsWith(payPage.returnUrl), { timeout: 45_000 });
    const back = new URL(tab.url());
    return `returned redirect_status=${back.searchParams.get('redirect_status')}`;
  } catch (err) {
    await tab.screenshot({ path: `test-results/bank-rail-fail-${method}.png`, fullPage: true }).catch(() => undefined);
    throw err;
  } finally {
    await tab.close();
  }
}

/** The card issuer's 3-D Secure check, completed on Stripe's test challenge. */
async function completeCardCheck(browser: Browser, payPage: PayPage, pk: string, secret: string) {
  const tab: Page = await browser.newPage({ viewport: { width: 700, height: 900 } });
  try {
    await tab.goto(payPage.url({ pk, secret, mode: 'next-action' }));
    await tab.locator('#pay').click();
    // Either the issuer shows a challenge (click Complete) or the check is frictionless
    // and resolves by itself. Whichever comes first.
    const until = Date.now() + 45_000;
    let challenged = false;
    while (Date.now() < until) {
      const result = await tab.evaluate(() => (window as unknown as { __result?: unknown }).__result);
      if (result) return `${challenged ? 'challenge completed' : 'frictionless'} ${JSON.stringify(result)}`;
      for (const frame of tab.frames()) {
        const button = frame.getByRole('button', { name: /^complete/i });
        if (!challenged && (await button.count().catch(() => 0))) {
          await button.first().click();
          challenged = true;
          break;
        }
      }
      await tab.waitForTimeout(1000);
    }
    throw new Error('3-D Secure check did not finish');
  } catch (err) {
    await tab.screenshot({ path: 'test-results/bank-rail-fail-CARD.png', fullPage: true }).catch(() => undefined);
    throw err;
  } finally {
    await tab.close();
  }
}

async function payFor(run: string, browser: Browser, payPage: PayPage) {
  const rail = RAILS[run];
  // A card run is the buyer choosing "Card"; `priced` is the tier its card should land in.
  const priced: PaymentMethodKind = CARD_RUNS[run] ?? (run as PaymentMethodKind);
  const isCard = run in CARD_RUNS;
  const s = await buildSale(rail);
  const deps = s.deps;
  const agreed = await agree(deps, s.created.sale.id, s.created.sale.termsVersion, rail.buyerRegion);
  let source: string | null = null;
  if (isCard) {
    const card = await testCardPayer(s.stripe, rail.card ?? 'pm_card_au');
    source = card.source;
    s.repo.setBuyer({ ...BUYER, regionCode: rail.buyerRegion, payerId: card.payer, paymentSourceId: card.source });
  }
  const expected = totalForMethod(agreed, priced);
  const paid = await acceptCashSaleTerms(deps, {
    actorId: BUYER.profileId,
    cashSaleId: agreed.id,
    termsVersion: agreed.termsVersion,
    expectedAmountCents: expected,
    ...(isCard ? {} : { paymentMethod: priced }),
  });
  if (!paid.ok) throw new Error(`pay: ${paid.error} ${paid.detail ?? ''}`);
  check(paid.sale.paymentMethod === priced || (priced === 'CARD' && !paid.sale.paymentMethod), `priced as ${priced}`, String(paid.sale.paymentMethod));
  return { deps, stripe: s.stripe, rail, sale: paid.sale, nextAction: paid.nextAction, expected, priced, isCard, source };
}

async function settleAfterApproval(deps: CashSaleOrchestratorDeps, saleId: string, timeoutMs: number) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const confirmed = await confirmCashSalePayment(deps, { actorId: BUYER.profileId, cashSaleId: saleId });
    if (!confirmed.ok) return confirmed;
    if (confirmed.sale.status !== 'PAYMENT_PENDING' || Date.now() > until) return confirmed;
    await new Promise((r) => setTimeout(r, 3000));
  }
}

async function runRail(run: string, browser: Browser, payPage: PayPage) {
  const rail = RAILS[run];
  if (!rail) throw new Error(`unknown run ${run}`);
  console.log(`\n== ${run} (${rail.currency.toUpperCase()}, buyer ${rail.buyerRegion}, seller ${rail.sellerRegion}${rail.card ? `, ${rail.card}` : ''})`);

  // ---- Sale 1: pay, fulfil, pay the seller ----------------------------------
  const p = await payFor(run, browser, payPage);
  const method = p.priced;
  if (!p.isCard) {
    check(p.sale.status === 'PAYMENT_PENDING' && p.nextAction?.paymentMethod === method, 'Pay opens a bank approval for this rail');
    const outcome = await approveInBrowser(browser, payPage, method, process.env[rail.pk]!, p.nextAction!.clientSecret);
    console.log(`       buyer approval: ${outcome}`);
  }
  if (p.isCard && p.nextAction) {
    // A new buyer's card payment asks for 3-D Secure (ESC-03), as the room would.
    console.log(`       card 3-D Secure: ${await completeCardCheck(browser, payPage, process.env[rail.pk]!, p.nextAction.clientSecret)}`);
  }
  const settled = await settleAfterApproval(p.deps, p.sale.id, 90_000);
  check(settled.ok && settled.sale.status === 'ESCROW_HELD', 'read-back settles the sale into escrow', settled.ok ? settled.sale.status : settled.error);
  if (!settled.ok || settled.sale.status !== 'ESCROW_HELD') return;

  const intent = await p.stripe.paymentIntents.retrieve(settled.sale.transferId!, { expand: ['latest_charge'] });
  const charge = intent.latest_charge as Stripe.Charge;
  check(intent.status === 'succeeded', 'Stripe intent succeeded');
  check(intent.amount_received === p.expected, 'charged exactly the total shown for this rail', `${intent.amount_received} vs ${p.expected}`);
  check(charge.payment_method_details?.type === (p.isCard ? 'card' : RAILTYPE[method]), 'paid over the chosen rail', charge.payment_method_details?.type ?? '-');
  if (p.isCard) {
    console.log(`       card issued in ${charge.payment_method_details?.card?.country ?? '?'}`);
    check(charge.payment_method === p.source, 'charged the saved card the fee was priced for', String(charge.payment_method));
  }
  if (rail.currency !== 'usd' && rail.region === 'US') {
    check(intent.on_behalf_of === rail.payee, 'charged on behalf of the seller', String(intent.on_behalf_of));
  }
  // Stripe's own fee on the charge. A bank-rail charge's balance transaction can be
  // written a few seconds after the intent succeeds, so it is polled for briefly.
  let btx: Stripe.BalanceTransaction | null = null;
  for (let i = 0; i < 10 && !btx; i += 1) {
    const fresh = await p.stripe.charges.retrieve(charge.id, { expand: ['balance_transaction'] });
    btx = (fresh.balance_transaction as Stripe.BalanceTransaction | null) ?? null;
    if (!btx) await new Promise((r) => setTimeout(r, 2000));
  }
  const modelled = stripeCostMinor(PRICE + POSTAGE, settled.sale.platformFeeCents, rail.currency, method) - payoutPart(rail, method);
  console.log(
    btx
      ? `       service fee charged ${settled.sale.platformFeeCents}; Stripe's fee on the charge ${btx.fee} ${btx.currency} (net ${btx.net} ${btx.currency}); our cost table says ${modelled} ${rail.currency}`
      : `       service fee charged ${settled.sale.platformFeeCents}; Stripe has not written the charge's balance transaction yet`,
  );
  if (btx && btx.currency === rail.currency) {
    check(btx.fee <= modelled, "Stripe's real fee is within our cost table", `${btx.fee} <= ${modelled}`);
  }

  const shipped = await recordCashSaleShipment(p.deps, {
    cashSaleId: p.sale.id,
    actorId: ITEM.ownerId,
    shipment: { carrier: 'DHL', trackingNumber: `E2E${Date.now()}` },
  });
  check(shipped.ok, 'seller records shipment', shipped.ok ? shipped.sale.status : shipped.error);
  const received = await recordCashSaleReceipt(p.deps, { cashSaleId: p.sale.id, actorId: BUYER.profileId });
  check(received.ok, 'buyer confirms receipt', received.ok ? received.sale.status : received.error);
  const accepted = await acceptCashSaleInspection(p.deps, { cashSaleId: p.sale.id, actorId: BUYER.profileId });
  check(accepted.ok && accepted.sale.status === 'COMPLETED', 'buyer accepts, sale completes', accepted.ok ? accepted.sale.status : accepted.error);
  const paidOut = await payoutCashSaleSeller(p.deps, { cashSaleId: p.sale.id });
  check(paidOut.ok, 'seller payout transfer settles', paidOut.ok ? paidOut.sale.sellerPayoutStatus : `${paidOut.error} ${paidOut.detail ?? ''}`);
  if (paidOut.ok && paidOut.sale.sellerPayoutRef) {
    const transfer = await p.stripe.transfers.retrieve(paidOut.sale.sellerPayoutRef);
    check(transfer.destination === rail.payee, 'transfer went to the seller account', String(transfer.destination));
    check(transfer.amount === PRICE + POSTAGE && transfer.currency === rail.currency, 'seller receives price plus postage in the contract currency', `${transfer.amount} ${transfer.currency}`);
  }

  // ---- Sale 2: pay, then refund before shipment --------------------------------
  if (p.isCard) return;
  const r = await payFor(run, browser, payPage);
  await approveInBrowser(browser, payPage, method, process.env[rail.pk]!, r.nextAction!.clientSecret);
  const held = await settleAfterApproval(r.deps, r.sale.id, 90_000);
  if (!held.ok || held.sale.status !== 'ESCROW_HELD') {
    check(false, 'refund sale reached escrow', held.ok ? held.sale.status : held.error);
    return;
  }
  const outcome = await refundOnFraudWarning(r.deps, { cashSaleId: r.sale.id });
  check(outcome === 'REFUNDED', 'refund before shipment goes back over the rail', outcome);
  const refunds = await r.stripe.refunds.list({ payment_intent: held.sale.transferId!, limit: 5 });
  const refund = refunds.data[0];
  check(Boolean(refund) && refund.amount === r.expected, 'Stripe refund is the full amount paid', refund ? `${refund.amount} ${refund.status}` : 'none');
}

const RAILTYPE: Record<string, string> = {
  IDEAL: 'ideal',
  BANCONTACT: 'bancontact',
  EPS: 'eps',
  P24: 'p24',
  PAYTO: 'payto',
};

/** The payout share of `stripeCostMinor`, which Stripe bills separately from the charge fee. */
function payoutPart(rail: Rail, _method: PaymentMethodKind): number {
  const payoutBps = rail.region === 'US' && rail.currency !== 'usd' ? 50 : 25;
  return Math.ceil(((PRICE + POSTAGE) * payoutBps) / 10_000) + 25;
}

async function main() {
  const methods = process.argv.slice(2).length
    ? process.argv.slice(2)
    : ['IDEAL', 'BANCONTACT', 'EPS', 'P24', 'PAYTO', 'CARD', 'CARD_INTL', 'CARD_UK_EEA'];
  const payPage = await startPayPage();
  const browser = await chromium.launch();
  try {
    for (const method of methods) {
      try {
        await runRail(method, browser, payPage);
      } catch (err) {
        failures += 1;
        console.log(`  FAIL ${method} aborted — ${(err as Error).message.split('\n')[0]}`);
      }
    }
  } finally {
    await browser.close();
    await payPage.close();
  }
  console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILURE(S)`}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
