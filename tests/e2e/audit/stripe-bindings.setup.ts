// tests/e2e/audit/stripe-bindings.setup.ts
//
// Binds every seed member to REAL Stripe TEST objects, so Pathways on the main server
// (Stripe test mode) can pay, hold and transfer as them (design, "Stripe bindings").
// Runs in the `setup` project.
//
// Requirements: 2.7 (every object created is stamped), 4.3 (Stripe test mode for money
// Pathways), 13.5 / 13.6 (a buyer with a real saved card), 13.19 (no two seed members
// share a card or payout account, so RELATED_ACCOUNTS never fires by accident), 24.2.
//
// Per member, idempotently:
//   1. find or create the member's test Customer on its platform, tagged
//      `cardtrade_e2e_fixture=<profile id>` (the profile's own `payer_id` first, then
//      Stripe Search, then create);
//   2. attach the member's OWN test card (`BINDING_CARDS`), unless it is already on the
//      Customer, and make it the default. Brand, last 4 and issuing country are read
//      back from Stripe and asserted, so a wrong token mapping fails here;
//   3. reset the member's risk signals to exactly that card's fingerprint (what
//      `completeCardSetup` records), dropping any shared payout-account signal;
//   4. point `merchant_ref` at the member's own fixture connected account, after
//      checking it is tagged as theirs and its transfers are active;
//   5. align `identity_check_name` with the account's individual name (ESC-25) and
//      clear a stale payee mismatch;
//   6. set a staff exposure override (`EXPOSURE_OVERRIDE_MINOR`).
//
// SANDBOX ONLY. Every row write goes through `support/db.ts`, whose helpers refuse any
// schema but `cardtrade_dev`; `e2eSchema()` is also asserted up front so a refusal
// happens before anything is created in Stripe. Stripe clients come from
// `testStripe()`, which refuses a key that is not an `sk_test_` secret.
//
// No card data passes through NoDitto: cards are attached with Stripe's published test
// PaymentMethod tokens (`pm_card_*`), server to Stripe.
//
// `npm run dev:db:reset` returns the seed to mock refs; the next run rebinds.

import { test as setup, expect } from '@playwright/test';
import type Stripe from 'stripe';

import { stampedMetadata, testStripe } from './backend/stripe';
import { FIXTURE_METADATA_KEY } from './core/sharedCleanup';
import {
  EXPOSURE_OVERRIDE_MINOR,
  PROVISION_COMMAND,
  memberFixture,
  paymentMethodLabel,
  type BindingCard,
  type MemberFixture,
} from './stripeFixtures';
import { deleteRows, e2eSchema, envValue, insertRow, selectRows, updateRows } from '../support/db';
import { SEED_USERS, type SeedUser } from '../support/users';
import { platformRegion } from '../../../domain/region/regions';
import { riskSignalHash } from '../../../domain/risk/relatedAccounts';

interface ProfileRow {
  id: string;
  region_code: string | null;
  payer_id: string | null;
  merchant_ref: string | null;
  merchant_status: string | null;
  merchant_settlements_enabled: boolean | null;
  identity_check_name: string | null;
}

interface AccountView {
  id: string;
  metadata?: Record<string, string> | null;
  identity?: { individual?: { given_name?: string | null; surname?: string | null } | null } | null;
  configuration?: {
    recipient?: {
      capabilities?: { stripe_balance?: { stripe_transfers?: { status?: string } | null } | null } | null;
    } | null;
  } | null;
}

/** The secret `lib/risk/signals.ts` keys risk-signal HMACs with. Empty: no signal. */
function riskSignalSecret(): string {
  return envValue('IDENTITY_FINGERPRINT_SECRET')?.trim() || envValue('STRIPE_SECRET_KEY')?.trim() || '';
}

function missingFixture(label: string, what: string): Error {
  return new Error(
    `Stripe fixture missing for ${label}: ${what}. Run \`${PROVISION_COMMAND}\`, finish onboarding, and paste the printed ids into tests/e2e/audit/stripeFixtures.ts`,
  );
}

async function loadProfile(user: SeedUser): Promise<ProfileRow> {
  const [row] = await selectRows<ProfileRow>(
    'profiles',
    `select=id,region_code,payer_id,merchant_ref,merchant_status,merchant_settlements_enabled,identity_check_name&id=eq.${user.id}`,
  );
  if (!row) throw new Error(`seed profile ${user.email} is missing; run \`npm run dev:db:reset\``);
  return row;
}

/** The member's tagged Customer: the profile's own payer first, then Search, then a new one. */
async function bindCustomer(stripe: Stripe, user: SeedUser, payerId: string | null): Promise<Stripe.Customer> {
  if (payerId?.startsWith('cus_')) {
    try {
      const existing = await stripe.customers.retrieve(payerId);
      if (!existing.deleted && existing.metadata?.[FIXTURE_METADATA_KEY] === user.id) return existing;
    } catch {
      // A Customer from another platform or a deleted one: fall through to Search.
    }
  }
  const found = await stripe.customers.search({
    query: `metadata['${FIXTURE_METADATA_KEY}']:'${user.id}'`,
    limit: 1,
  });
  if (found.data[0]) return found.data[0];
  return stripe.customers.create({
    description: `NoDitto e2e fixture: ${user.displayName}`,
    metadata: stampedMetadata({ [FIXTURE_METADATA_KEY]: user.id, cardtrade_profile_id: user.id }),
  });
}

/** The member's own test card on the Customer, attached once and made the default. */
async function bindCard(stripe: Stripe, user: SeedUser, customer: Stripe.Customer, card: BindingCard): Promise<Stripe.PaymentMethod> {
  const saved = await stripe.customers.listPaymentMethods(customer.id, { type: 'card', limit: 100 });
  let method = saved.data.find(
    (pm) => pm.card?.brand === card.brand && pm.card?.last4 === card.last4 && pm.card?.country === card.country,
  );
  if (!method) {
    method = await stripe.paymentMethods.attach(card.token, { customer: customer.id });
    method = await stripe.paymentMethods.update(method.id, {
      metadata: stampedMetadata({ [FIXTURE_METADATA_KEY]: user.id }),
    });
  }
  const defaultId =
    typeof customer.invoice_settings?.default_payment_method === 'string'
      ? customer.invoice_settings.default_payment_method
      : customer.invoice_settings?.default_payment_method?.id;
  if (defaultId !== method.id) {
    await stripe.customers.update(customer.id, { invoice_settings: { default_payment_method: method.id } });
  }
  return method;
}

/** The member's fixture connected account, checked as theirs and able to receive transfers. */
async function readAccount(stripe: Stripe, fixture: MemberFixture): Promise<AccountView> {
  if (!fixture.connectedAccount) throw missingFixture(fixture.label, 'no connected account id');
  let account: AccountView;
  try {
    account = (await stripe.v2.core.accounts.retrieve(fixture.connectedAccount, {
      include: ['identity', 'configuration.recipient'],
    })) as unknown as AccountView;
  } catch (err) {
    throw missingFixture(fixture.label, `${fixture.connectedAccount} could not be read (${(err as Error).message})`);
  }
  if (account.metadata?.[FIXTURE_METADATA_KEY] !== fixture.memberId) {
    throw missingFixture(fixture.label, `${account.id} is not tagged as this member's fixture`);
  }
  const status = account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status;
  if (status !== 'active') {
    throw missingFixture(fixture.label, `${account.id} transfers are "${status ?? 'unknown'}", so hosted onboarding is not finished`);
  }
  return account;
}

/** Replace the member's risk signals with exactly the bound card's fingerprint. */
async function resetRiskSignals(user: SeedUser, fingerprint: string | null | undefined): Promise<void> {
  await deleteRows('member_risk_signals', `profile_id=eq.${user.id}`);
  const hash = fingerprint ? riskSignalHash('CARD_FINGERPRINT', fingerprint, riskSignalSecret()) : null;
  if (hash) {
    await insertRow('member_risk_signals', { profile_id: user.id, kind: 'CARD_FINGERPRINT', value_hash: hash });
  }
}

setup.describe.configure({ mode: 'parallel' });

for (const user of SEED_USERS) {
  setup(`bind ${user.email} to Stripe test mode`, async () => {
    setup.setTimeout(90_000);
    e2eSchema();

    const fixture = memberFixture(user.id);
    if (!fixture) throw missingFixture(user.email, 'no entry in MEMBER_FIXTURES');
    const profile = await loadProfile(user);

    // The seed's own state must already be what the bindings assume.
    expect(platformRegion(profile.region_code), `${fixture.label}'s region settles on the fixture's platform`).toBe(fixture.platform);
    expect(profile.merchant_status, `${fixture.label} is a payout-approved seed seller (npm run dev:db:reset)`).toBe('APPROVED');
    expect(profile.merchant_settlements_enabled, `${fixture.label} has settlements enabled (npm run dev:db:reset)`).toBe(true);

    const stripe = testStripe(fixture.platform);
    const account = await readAccount(stripe, fixture);

    // The unique `merchant_ref` index: never take an account another profile holds.
    const holders = await selectRows<{ id: string }>(
      'profiles',
      `select=id&merchant_ref=eq.${encodeURIComponent(account.id)}&id=neq.${user.id}`,
    );
    expect(holders, `${account.id} is held by no other profile`).toEqual([]);

    const customer = await bindCustomer(stripe, user, profile.payer_id);
    const method = await bindCard(stripe, user, customer, fixture.card);
    expect(
      { brand: method.card?.brand, last4: method.card?.last4, country: method.card?.country },
      `${fixture.label}'s card reads back from Stripe as BINDING_CARDS says`,
    ).toEqual({ brand: fixture.card.brand, last4: fixture.card.last4, country: fixture.card.country });

    await resetRiskSignals(user, method.card?.fingerprint);

    const individual = account.identity?.individual;
    const payeeName = [individual?.given_name, individual?.surname].filter(Boolean).join(' ').trim();

    const [updated] = await updateRows<{ id: string }>('profiles', `id=eq.${user.id}`, {
      payer_id: customer.id,
      payment_source_id: method.id,
      payment_token_type: 'credit-card',
      payment_method_label: paymentMethodLabel(method.card?.brand ?? '', method.card?.last4 ?? ''),
      merchant_ref: account.id,
      // Unexposed payee name: leave the seed's name, which never flags (UNAVAILABLE).
      ...(payeeName ? { identity_check_name: payeeName } : {}),
      payee_identity_mismatch_at: null,
      exposure_limit_override_minor: EXPOSURE_OVERRIDE_MINOR,
    });
    expect(updated?.id, `${fixture.label}'s profile was updated`).toBe(user.id);
  });
}
