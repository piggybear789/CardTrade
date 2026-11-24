// scripts/e2e/provision-stripe-fixtures.ts
//
// ONE-OFF, run by the owner: create the audit's fixture connected accounts in Stripe
// TEST mode, one per seed member on that member's platform (AU or US), fill them with
// Stripe's test values through the API, and print their ids for
// `tests/e2e/audit/stripeFixtures.ts`.
//
//   npm run audit:stripe-fixtures                    (both platforms)
//   npx tsx scripts/e2e/provision-stripe-fixtures.ts --platform US   (one platform)
//   npx tsx scripts/e2e/provision-stripe-fixtures.ts --hosted        (US sellers: Express
//       accounts prefilled by API, then hosted onboarding links for the owner; see below)
//
// Requirements: 2.7 (every object is tagged as an audit fixture), 4.3 (real test-mode
// sellers for the money Pathways), 13.19 (one account per seller, so no two sellers
// share a payout account and look related).
//
// TEST KEYS ONLY. Every client comes from `testStripe()` (`tests/e2e/audit/backend/
// stripe.ts`), which throws before constructing a client unless the platform's key is
// an `sk_test_` secret key. The error names the variable, never the value.
//
// PLATFORM-FILLED, NOT HOSTED (task 7.22). Stripe's hosted onboarding puts an hCaptcha
// in front of an automated browser, and an account that has had an Account Link
// refuses API writes to its identity. So every account is created with
// `dashboard: 'none'` (the platform collects requirements; each platform's Connect
// platform profile must accept that responsibility first) and filled here with
// Stripe's documented test values: DOB 1901-01-01, the `address_full_match` address,
// the `file_identity_document_success` document, a ToS attestation, the US SSN last 4
// `0000`, and a test bank account. No Account Link is ever created.
//
// DISTINCT PAYOUT BANKS. The app records the payout-bank fingerprint as a risk signal,
// and two sellers sharing one are RELATED_ACCOUNTS (ESC-03). Stripe validates the test
// ACCOUNT number but fingerprints routing + account, so `PAYOUT_BANKS` gives every
// seller a different pair, all of them "payout succeeds" test numbers.
//
// IDEMPOTENT. An account is found before one is created: first the id already in
// `stripeFixtures.ts`, then any open, platform-collected account on the platform tagged
// `cardtrade_e2e_fixture=<seed profile id>`. A found account is re-filled only while
// its transfers are not active. Express accounts from the earlier hosted approach are
// ignored by the lookup and replaced when named in `stripeFixtures.ts` (close the old
// one by hand afterwards).
//
// The accounts are tagged `cardtrade_sandbox=true` and `cardtrade_e2e_fixture`, which
// `scripts/e2e/cleanup-test-data.ts` keeps. They carry no run stamp, because they
// outlive every run.

import type Stripe from 'stripe';

import { testStripe } from '../../tests/e2e/audit/backend/stripe';
import { FIXTURE_METADATA_KEY } from '../../tests/e2e/audit/core/sharedCleanup';
import {
  CROSS_BORDER_FIXTURE_ACCOUNTS,
  MEMBER_FIXTURES,
  type FixturePlatform,
  type MemberFixture,
} from '../../tests/e2e/audit/stripeFixtures';
import { SEED_USERS, type SeedUser } from '../../tests/e2e/support/users';
import { SANDBOX_METADATA_KEY } from '../../domain/services/stripe/metadata';

const CURRENCY: Record<FixturePlatform, string> = { AU: 'aud', US: 'usd' };

/** Stripe's test address that passes verification, per account country. */
const TEST_ADDRESS: Record<FixturePlatform, NonNullable<Stripe.V2.Core.AccountUpdateParams.Identity.Individual['address']>> = {
  AU: { line1: 'address_full_match', city: 'Sydney', state: 'NSW', postal_code: '2000', country: 'au' },
  US: { line1: 'address_full_match', city: 'San Francisco', state: 'CA', postal_code: '94111', country: 'us' },
};

/** Stripe's test identity document that verifies. */
const TEST_IDENTITY_DOCUMENT = 'file_identity_document_success';

/**
 * Each seller's test payout bank: routing (BSB or ABA) + account. Every pair differs,
 * so no two sellers share a payout fingerprint. The AU values are the ones the seven
 * AU accounts were filled with; the US ones are Stripe's US "payout succeeds" numbers.
 */
const PAYOUT_BANKS: Record<string, { routing: string; account: string }> = {
  alice: { routing: '110000', account: '000123456' },
  bob: { routing: '000000', account: '000123456' },
  carol: { routing: '110000', account: '888888883' },
  dave: { routing: '000000', account: '888888883' },
  erin: { routing: '062000', account: '000123456' },
  frank: { routing: '062001', account: '000123456' },
  grace: { routing: '062002', account: '000123456' },
  uma: { routing: '110000000', account: '000123456789' },
  victor: { routing: '110000000', account: '000111111116' },
};

interface AccountView {
  id: string;
  dashboard?: string | null;
  closed?: boolean | null;
  metadata?: Record<string, string> | null;
  configuration?: {
    recipient?: {
      capabilities?: {
        stripe_balance?: {
          stripe_transfers?: { status?: string; status_details?: Array<{ code?: string }> } | null;
        } | null;
      } | null;
    } | null;
  } | null;
  requirements?: { entries?: Array<{ description?: string; minimum_deadline?: { status?: string } }> } | null;
}

const INCLUDE: Stripe.V2.Core.AccountRetrieveParams.Include[] = ['identity', 'configuration.recipient', 'requirements'];

function transfersStatus(account: AccountView): string {
  return account.configuration?.recipient?.capabilities?.stripe_balance?.stripe_transfers?.status ?? 'unknown';
}

function outstanding(account: AccountView): string[] {
  return (account.requirements?.entries ?? []).map((e) => `${e.description} (${e.minimum_deadline?.status ?? '?'})`);
}

/** Given name and surname from a seed display name ("Alice Nguyen"). */
function nameParts(user: SeedUser): { given_name: string; surname: string } {
  const words = user.displayName.trim().split(/\s+/);
  if (words.length < 2) throw new Error(`seed member ${user.email} needs a two-part display name`);
  return { given_name: words.slice(0, -1).join(' '), surname: words[words.length - 1] };
}

async function retrieve(stripe: Stripe, id: string): Promise<AccountView | null> {
  try {
    return (await stripe.v2.core.accounts.retrieve(id, { include: INCLUDE })) as unknown as AccountView;
  } catch (err) {
    console.log(`  could not read ${id}: ${(err as Error).message}`);
    return null;
  }
}

/** An open, platform-collected account tagged as this member's fixture, if one exists. */
async function findTagged(stripe: Stripe, memberId: string): Promise<AccountView | null> {
  for await (const account of stripe.v2.core.accounts.list({ limit: 20 })) {
    const view = account as unknown as AccountView;
    if (view.metadata?.[FIXTURE_METADATA_KEY] !== memberId) continue;
    if (view.closed || view.dashboard !== 'none') {
      console.log(`  ignoring legacy ${view.id} (dashboard ${view.dashboard ?? '?'}${view.closed ? ', closed' : ''})`);
      continue;
    }
    return retrieve(stripe, view.id);
  }
  return null;
}

async function create(stripe: Stripe, fixture: MemberFixture, user: SeedUser): Promise<AccountView> {
  const body: Stripe.V2.Core.AccountCreateParams = {
    contact_email: `e2e-fixture-${fixture.label}@example.com`,
    display_name: `${user.displayName} (NoDitto e2e fixture)`,
    dashboard: 'none',
    configuration: {
      recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
    },
    defaults: {
      currency: CURRENCY[fixture.platform],
      responsibilities: { fees_collector: 'application', losses_collector: 'application' },
    },
    identity: {
      country: fixture.accountCountry,
      entity_type: 'individual',
      individual: nameParts(user) as Stripe.V2.Core.AccountCreateParams.Identity.Individual,
    },
    include: INCLUDE,
    metadata: {
      [SANDBOX_METADATA_KEY]: 'true',
      [FIXTURE_METADATA_KEY]: fixture.memberId,
      cardtrade_profile_id: fixture.memberId,
    },
  };
  // `none:` keeps this key apart from the earlier Express creations' keys.
  const account = await stripe.v2.core.accounts.create(body, {
    idempotencyKey: `e2e-fixture-account:none:${fixture.platform}:${fixture.memberId}`,
  });
  return account as unknown as AccountView;
}

/** Fill identity, profile and ToS with Stripe's test values. Safe to repeat. */
async function fillIdentity(stripe: Stripe, fixture: MemberFixture, user: SeedUser, accountId: string): Promise<void> {
  const individual: Stripe.V2.Core.AccountUpdateParams.Identity.Individual = {
    ...nameParts(user),
    email: `e2e-fixture-${fixture.label}@example.com`,
    date_of_birth: { day: 1, month: 1, year: 1901 },
    address: TEST_ADDRESS[fixture.platform],
    documents: {
      primary_verification: { type: 'front_back', front_back: { front: TEST_IDENTITY_DOCUMENT } },
    },
    ...(fixture.platform === 'US' ? { id_numbers: [{ type: 'us_ssn_last_4', value: '0000' }] } : {}),
  };
  await stripe.v2.core.accounts.update(accountId, {
    defaults: {
      profile: {
        business_url: `https://noditto.app/sellers/${fixture.memberId}`,
        product_description: 'Trading cards sold on NoDitto (e2e test fixture)',
      },
    },
    identity: {
      individual,
      attestations: {
        terms_of_service: {
          account: { date: new Date().toISOString(), ip: '127.0.0.1', user_agent: 'NoDitto e2e fixture provisioning' },
        },
      },
    },
  });
}

/** Attach the seller's test payout bank unless one is already on the account. */
async function ensureBank(stripe: Stripe, fixture: MemberFixture, user: SeedUser, accountId: string): Promise<void> {
  const existing = await stripe.accounts.listExternalAccounts(accountId, { object: 'bank_account', limit: 1 });
  if (existing.data.length > 0) return;
  const bank = PAYOUT_BANKS[fixture.label];
  if (!bank) throw new Error(`no PAYOUT_BANKS entry for ${fixture.label}`);
  await stripe.accounts.createExternalAccount(
    accountId,
    {
      external_account: {
        object: 'bank_account',
        country: fixture.accountCountry.toUpperCase(),
        currency: CURRENCY[fixture.platform],
        routing_number: bank.routing,
        account_number: bank.account,
        account_holder_name: user.displayName,
        account_holder_type: 'individual',
      },
    } as Stripe.AccountCreateExternalAccountParams,
    { idempotencyKey: `e2e-fixture-bank:${fixture.platform}:${accountId}` },
  );
}

/** Re-read until transfers are active or a few seconds pass (verification is async). */
async function settle(stripe: Stripe, accountId: string): Promise<AccountView | null> {
  let account: AccountView | null = null;
  for (let i = 0; i < 10; i += 1) {
    account = await retrieve(stripe, accountId);
    if (!account || transfersStatus(account) === 'active') return account;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return account;
}

// ---------------------------------------------------------------------------------
// --hosted: the US path (task 7.22).
//
// The US TEST platform has "Ongoing seller compliance: Stripe" and "Account creation:
// Onboarding hosted by Stripe", so a `dashboard: 'none'` account is refused there
// (`account_creation_requirement_collection_unacknowledged`), and that setting is
// shared with live, so it stays. Uma's and Victor's accounts are therefore created
// exactly the way `createManagedMerchant` creates a same-country seller's (Express,
// recipient + stripe_transfers, platform fees and losses), prefilled field by field
// through the API BEFORE any Account Link exists (Stripe refuses identity writes to an
// Express account once a link has been made), and then handed to the owner as hosted
// onboarding links to finish by hand. Nothing here solves or bypasses the hCaptcha.
//
// Each prefill field is a separate update, so one refusal cannot sink the rest, and
// the outcome is printed as `accepted` or the Stripe error code (never a message body
// that could echo submitted values).
//
// Re-running finds the account by `cardtrade_e2e_onboarding=hosted` + the fixture tag
// and skips the old restricted accounts still named in `stripeFixtures.ts`. A re-run
// after a link exists will see identity writes refused; that is expected.
// ---------------------------------------------------------------------------------

const ONBOARDING_METADATA_KEY = 'cardtrade_e2e_onboarding';
const HOSTED_RETURN_URL = 'http://localhost:3100/profile?tab=verification';

/** One prefill attempt's outcome: `accepted`, or the Stripe error code. */
interface PrefillOutcome {
  field: string;
  result: string;
}

function errorCode(err: unknown): string {
  const e = err as { code?: string; type?: string; raw?: { code?: string } };
  return e.code ?? e.raw?.code ?? e.type ?? 'unknown_error';
}

async function attempt(field: string, run: () => Promise<unknown>): Promise<PrefillOutcome> {
  try {
    await run();
    return { field, result: 'accepted' };
  } catch (err) {
    return { field, result: `refused [${errorCode(err)}]` };
  }
}

/** A fresh hosted-path account for this member, if one was made on an earlier run. */
async function findHosted(stripe: Stripe, fixture: MemberFixture): Promise<AccountView | null> {
  for await (const account of stripe.v2.core.accounts.list({ limit: 20 })) {
    const view = account as unknown as AccountView;
    if (view.metadata?.[FIXTURE_METADATA_KEY] !== fixture.memberId) continue;
    if (view.metadata?.[ONBOARDING_METADATA_KEY] !== 'hosted') continue;
    if (view.closed || view.id === fixture.connectedAccount) continue;
    return retrieve(stripe, view.id);
  }
  return null;
}

/** Create the account the way `createManagedMerchant` does for a same-country seller. */
async function createHosted(stripe: Stripe, fixture: MemberFixture, user: SeedUser): Promise<AccountView> {
  const body: Stripe.V2.Core.AccountCreateParams = {
    contact_email: `e2e-fixture-${fixture.label}@example.com`,
    display_name: user.displayName,
    dashboard: 'express',
    configuration: {
      recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
    },
    defaults: {
      currency: CURRENCY[fixture.platform],
      responsibilities: { fees_collector: 'application', losses_collector: 'application' },
    },
    identity: { country: fixture.accountCountry, entity_type: 'individual' },
    include: INCLUDE,
    metadata: {
      [SANDBOX_METADATA_KEY]: 'true',
      [FIXTURE_METADATA_KEY]: fixture.memberId,
      [ONBOARDING_METADATA_KEY]: 'hosted',
      cardtrade_profile_id: fixture.memberId,
    },
  };
  const account = await stripe.v2.core.accounts.create(body, {
    idempotencyKey: `e2e-fixture-account:hosted:${fixture.platform}:${fixture.memberId}`,
  });
  return account as unknown as AccountView;
}

/** Try every prefill the owner asked for, one update each. */
async function prefillHosted(
  stripe: Stripe,
  fixture: MemberFixture,
  user: SeedUser,
  accountId: string,
): Promise<PrefillOutcome[]> {
  type Individual = Stripe.V2.Core.AccountUpdateParams.Identity.Individual;
  const individual = (fields: Individual) => () =>
    stripe.v2.core.accounts.update(accountId, { identity: { individual: fields } });

  const outcomes: PrefillOutcome[] = [];
  outcomes.push(await attempt('individual.name', individual(nameParts(user) as Individual)));
  outcomes.push(await attempt('individual.date_of_birth', individual({ date_of_birth: { day: 1, month: 1, year: 1901 } })));
  outcomes.push(await attempt('individual.address', individual({ address: TEST_ADDRESS[fixture.platform] })));

  const phone = await attempt('individual.phone (0000000000)', individual({ phone: '0000000000' }));
  outcomes.push(phone);
  if (phone.result !== 'accepted') {
    outcomes.push(await attempt('individual.phone (+10000000000)', individual({ phone: '+10000000000' })));
  }

  outcomes.push(
    await attempt('individual.id_numbers us_ssn_last_4', individual({ id_numbers: [{ type: 'us_ssn_last_4', value: '0000' }] })),
  );
  outcomes.push(
    await attempt('individual.id_numbers us_ssn', individual({ id_numbers: [{ type: 'us_ssn', value: '000000000' }] })),
  );

  outcomes.push(
    await attempt('defaults.profile (business_url + product_description)', () =>
      stripe.v2.core.accounts.update(accountId, {
        defaults: {
          profile: {
            business_url: 'https://noditto.app',
            product_description: 'Trading cards sold on NoDitto (e2e test fixture)',
          },
        },
      }),
    ),
  );

  outcomes.push(await attempt('external_account (bank)', () => ensureBank(stripe, fixture, user, accountId)));
  return outcomes;
}

async function provisionHosted(): Promise<void> {
  const results: Array<{ label: string; id: string; transfers: string; url: string | null; outstanding: string[] }> = [];

  for (const user of SEED_USERS) {
    const fixture = MEMBER_FIXTURES[user.id];
    if (!fixture || fixture.platform !== 'US') continue;
    const stripe = testStripe('US');
    console.log(`\n${fixture.label} (US platform, hosted onboarding)`);

    let account = await findHosted(stripe, fixture);
    if (account) {
      console.log(`  found ${account.id} from an earlier run`);
    } else {
      account = await createHosted(stripe, fixture, user);
      console.log(`  created ${account.id}`);
    }

    for (const { field, result } of await prefillHosted(stripe, fixture, user, account.id)) {
      console.log(`  prefill ${field}: ${result}`);
    }

    const before = (await retrieve(stripe, account.id)) ?? account;
    console.log(`  outstanding before link (${outstanding(before).length}):`);
    for (const entry of outstanding(before)) console.log(`    - ${entry}`);

    let url: string | null = null;
    try {
      const link = await stripe.v2.core.accountLinks.create({
        account: account.id,
        use_case: {
          type: 'account_onboarding',
          account_onboarding: {
            configurations: ['recipient'],
            return_url: HOSTED_RETURN_URL,
            refresh_url: HOSTED_RETURN_URL,
            collection_options: { fields: 'eventually_due' },
          },
        },
      });
      url = link.url;
    } catch (err) {
      console.log(`  account link refused [${errorCode(err)}]`);
    }

    const after = (await retrieve(stripe, account.id)) ?? before;
    results.push({
      label: fixture.label,
      id: account.id,
      transfers: transfersStatus(after),
      url,
      outstanding: outstanding(after),
    });
  }

  console.log('\nSummary (hosted onboarding links are single-use and short-lived):');
  for (const r of results) {
    console.log(`\n  ${r.label}: ${r.id}  stripe_transfers: ${r.transfers}`);
    for (const entry of r.outstanding) console.log(`    outstanding: ${entry}`);
    console.log(`    onboarding link: ${r.url ?? '(none)'}`);
  }
}

function platformFilter(argv: string[]): FixturePlatform | null {
  const i = argv.indexOf('--platform');
  if (i < 0) return null;
  const value = argv[i + 1]?.toUpperCase();
  if (value !== 'AU' && value !== 'US') throw new Error('--platform must be AU or US');
  return value;
}

async function main(): Promise<void> {
  if (process.argv.includes('--hosted')) {
    await provisionHosted();
    return;
  }
  const only = platformFilter(process.argv.slice(2));
  const ids: Array<{ fixture: MemberFixture; id: string; status: string }> = [];
  let pending = 0;

  for (const user of SEED_USERS) {
    const fixture = MEMBER_FIXTURES[user.id];
    if (!fixture) throw new Error(`no fixture entry for seed member ${user.email} in stripeFixtures.ts`);
    if (only && fixture.platform !== only) continue;
    const stripe = testStripe(fixture.platform);
    console.log(`\n${fixture.label} (${fixture.platform} platform)`);

    let account: AccountView | null = null;
    if (fixture.connectedAccount) {
      account = await retrieve(stripe, fixture.connectedAccount);
      if (account && account.metadata?.[FIXTURE_METADATA_KEY] !== fixture.memberId) {
        throw new Error(
          `${fixture.connectedAccount} in stripeFixtures.ts is not tagged as ${fixture.label}'s fixture; fix the id rather than re-tagging`,
        );
      }
      if (account && (account.closed || account.dashboard !== 'none')) {
        // A hosted-era Express account cannot be filled by API: replace it, then close
        // it by hand and paste the new id into stripeFixtures.ts.
        console.log(`  ${account.id} in stripeFixtures.ts is a legacy ${account.dashboard} account; replacing it`);
        account = null;
      }
    }
    account ??= await findTagged(stripe, fixture.memberId);
    if (account) {
      console.log(`  found ${account.id}`);
    } else {
      account = await create(stripe, fixture, user);
      console.log(`  created ${account.id}`);
    }

    if (transfersStatus(account) !== 'active') {
      await fillIdentity(stripe, fixture, user, account.id);
      await ensureBank(stripe, fixture, user, account.id);
      account = (await settle(stripe, account.id)) ?? account;
    }

    const status = transfersStatus(account);
    console.log(`  stripe_transfers: ${status}`);
    if (status !== 'active') {
      pending += 1;
      for (const entry of outstanding(account)) console.log(`  outstanding: ${entry}`);
    }
    ids.push({ fixture, id: account.id, status });
  }

  // The cross-border account is not created here; report whether it is still usable.
  if (!only || only === 'US') {
    const de = await retrieve(testStripe('US'), CROSS_BORDER_FIXTURE_ACCOUNTS.DE);
    console.log(`\nDE cross-border account ${CROSS_BORDER_FIXTURE_ACCOUNTS.DE}: ${de ? transfersStatus(de) : 'NOT FOUND'}`);
  }

  console.log('\nconnectedAccount values for tests/e2e/audit/stripeFixtures.ts:');
  for (const { fixture, id, status } of ids) {
    console.log(`  ${fixture.label.padEnd(7)} ${fixture.memberId}  connectedAccount: '${id}',${status === 'active' ? '' : '  // transfers not active yet'}`);
  }
  if (pending > 0) {
    console.log(`\n${pending} account(s) are not active yet. Re-run in a minute; if it persists, read the outstanding requirements above.`);
  }
}

main().catch((err: unknown) => {
  const e = err as { message?: string; code?: string; type?: string };
  console.error(`provision-stripe-fixtures failed: ${e.code ? `[${e.code}] ` : ''}${e.message}`);
  process.exit(1);
});
