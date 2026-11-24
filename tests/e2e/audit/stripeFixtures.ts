// tests/e2e/audit/stripeFixtures.ts
//
// Ids and test cards of the LONG-LIVED Stripe TEST fixture objects the audit binds the
// seed members to (design, "Stripe bindings"). Data only: no SDK, no environment, no
// network, so a unit test can check it without a key. None of these values is a
// secret: a connected-account id and a published Stripe test card number grant
// nothing without the platform's secret key.
//
// Requirements: 2.7 (fixture objects are tagged and kept by cleanup), 4.3 (real Stripe
// test mode for money Pathways), 13.5, 13.6, 13.19, 24.2.
//
// ONE CONNECTED ACCOUNT PER SEED SELLER, not one per platform (owner decision
// during task 7.16). The design first named one account per platform, but:
//   * `profiles_merchant_ref_key` (0005, cloned into `cardtrade_dev`) is a UNIQUE index,
//     so two profiles cannot hold the same `merchant_ref`;
//   * sellers sharing an account would share its payout-bank fingerprint the moment
//     either refreshed payout status, which makes them RELATED_ACCOUNTS (ESC-03);
//   * the payee-name check (ESC-25) would force every seller onto one legal name.
// So each seed member has its own account on its platform, created once by
// `npm run audit:stripe-fixtures` (`scripts/e2e/provision-stripe-fixtures.ts`), with
// the member's seed name prefilled so `identity_check_name` already matches it.
//
// HOW THE ACCOUNTS WERE ONBOARDED (task 7.22). The two platforms differ.
//
// AU: platform-filled, `dashboard: 'none'`. Stripe's hosted onboarding puts an
// hCaptcha in front of an automated browser, and an account that has had an Account
// Link refuses API writes to its identity. So the seven AU accounts were created with
// `dashboard: 'none'` (the platform collects requirements) and filled through the API
// with Stripe's test values: DOB 1901-01-01, `address_full_match`, the
// `file_identity_document_success` document and a ToS attestation. Stripe validates
// the test ACCOUNT number but fingerprints routing + account, so each seller has
// account 000123456 or 888888883 (both "payout succeeds") under a different BSB, which
// keeps every payout fingerprint distinct.
//
// US: Express, hosted onboarding with API prefill. The US platform refuses
// `dashboard: 'none'` accounts (`account_creation_requirement_collection_unacknowledged`;
// its "Onboarding hosted by Stripe" setting is shared with live, so it stays). Uma's and
// Victor's are Express accounts tagged `cardtrade_e2e_onboarding: 'hosted'`: the script
// prefilled what the API accepts before any Account Link, and the owner finished each
// hosted flow by hand in test mode. Their payout banks share ABA 110000000 under
// different account numbers, so their fingerprints differ. The earlier Express accounts
// (acct_1UexjaDBOhMVPwMX, acct_1UexjiDqdR9I9B4m), left restricted, are closed.
//
// A DIFFERENT CARD NUMBER PER MEMBER. Stripe fingerprints a card by its number, the
// app records that fingerprint as a risk signal when a card is saved, and two members
// sharing one are refused as RELATED_ACCOUNTS. `BINDING_CARDS` therefore never repeats
// a number, and `ENTRY_CARDS` (typed into Payment Element by Pathways) avoids them too,
// with one stated exception below.
//
// AUSTRALIA HAS ONE TEST CARD. Stripe publishes a single Australian-issued test number
// (4000 0003 6000 0006, `pm_card_au`). It is BOB's, because Bob is the AU buyer the
// specs price at the domestic card rate (3% + A$0.60). Every other AU member's card is
// issued abroad, so when they BUY in AUD they are priced at the international card
// tier (`cardTierFor`). A Pathway that needs another AU domestic buyer creates a
// persona and types `ENTRY_CARDS.auDomestic` — which shares Bob's number, so that
// persona must not deal with Bob.

/** The two Stripe TEST platform accounts (mirrors `TestPlatform` in `backend/stripe.ts`). */
export type FixturePlatform = 'AU' | 'US';

/** A Stripe test card attached to a seed member's Customer by the bindings. */
export interface BindingCard {
  /** Stripe's test PaymentMethod token, attached through the API (no raw card data). */
  token: string;
  /** The published test card number behind the token. Documentation and uniqueness only. */
  number: string;
  /** Stripe's `card.brand`, read back and asserted after attaching. */
  brand: string;
  last4: string;
  /** Stripe's `card.country` (where the card was issued): it picks the card fee tier. */
  country: string;
}

/** One seed member's fixtures. */
export interface MemberFixture {
  /** Seed profile id (`tests/e2e/support/users.ts`). */
  memberId: string;
  /** Lowercase seed name, for messages. */
  label: string;
  /** The Stripe platform the member's region settles on (`platformRegion`). */
  platform: FixturePlatform;
  /** Country of the member's connected account (Stripe fixes it at creation). */
  accountCountry: 'au' | 'us';
  /**
   * The member's own TEST connected account, or null until
   * `npm run audit:stripe-fixtures` has created it and its id is pasted here.
   */
  connectedAccount: string | null;
  card: BindingCard;
}

/** The German test seller on the US platform, with the EU bank-rail capabilities. */
export const DE_FIXTURE_ACCOUNT = 'acct_1UQ1EbDBt8PZ9Rx1';

/**
 * Cross-border connected accounts a Pathway may point a seller at for the run (a
 * seller moved to DE to sell in EUR). Not bound to anyone by default.
 */
export const CROSS_BORDER_FIXTURE_ACCOUNTS: Readonly<Record<'DE', string>> = {
  DE: DE_FIXTURE_ACCOUNT,
};

/**
 * Every seed member's fixtures, keyed by profile id. The ids match `SEED_USERS`; a
 * unit test pins that every seed member has an entry and no card number repeats.
 */
export const MEMBER_FIXTURES: Readonly<Record<string, MemberFixture>> = {
  '11111111-1111-1111-1111-111111111111': {
    memberId: '11111111-1111-1111-1111-111111111111',
    label: 'alice',
    platform: 'AU',
    accountCountry: 'au',
    connectedAccount: 'acct_1UexnaKEPl6itasJ',
    card: { token: 'pm_card_mastercard', number: '5555555555554444', brand: 'mastercard', last4: '4444', country: 'US' },
  },
  '22222222-2222-2222-2222-222222222222': {
    memberId: '22222222-2222-2222-2222-222222222222',
    label: 'bob',
    platform: 'AU',
    accountCountry: 'au',
    connectedAccount: 'acct_1UexoUKEPlni0mEC',
    card: { token: 'pm_card_au', number: '4000000360000006', brand: 'visa', last4: '0006', country: 'AU' },
  },
  '33333333-3333-3333-3333-333333333333': {
    memberId: '33333333-3333-3333-3333-333333333333',
    label: 'carol',
    platform: 'AU',
    accountCountry: 'au',
    connectedAccount: 'acct_1UexqLKEPldvW2ak',
    card: { token: 'pm_card_visa_debit', number: '4000056655665556', brand: 'visa', last4: '5556', country: 'US' },
  },
  '44444444-4444-4444-4444-444444444444': {
    memberId: '44444444-4444-4444-4444-444444444444',
    label: 'dave',
    platform: 'AU',
    accountCountry: 'au',
    connectedAccount: 'acct_1UexqbKEPlOu82J9',
    card: { token: 'pm_card_mastercard_debit', number: '5200828282828210', brand: 'mastercard', last4: '8210', country: 'US' },
  },
  '55555555-5555-5555-5555-555555555555': {
    memberId: '55555555-5555-5555-5555-555555555555',
    label: 'erin',
    platform: 'AU',
    accountCountry: 'au',
    connectedAccount: 'acct_1UexqrKEPlrrpJiZ',
    card: { token: 'pm_card_nz', number: '4000005540000008', brand: 'visa', last4: '0008', country: 'NZ' },
  },
  '66666666-6666-6666-6666-666666666666': {
    memberId: '66666666-6666-6666-6666-666666666666',
    label: 'frank',
    platform: 'AU',
    accountCountry: 'au',
    connectedAccount: 'acct_1UexrIKEPl0izfmI',
    card: { token: 'pm_card_mastercard_prepaid', number: '5105105105105100', brand: 'mastercard', last4: '5100', country: 'US' },
  },
  '77777777-7777-7777-7777-777777777777': {
    memberId: '77777777-7777-7777-7777-777777777777',
    label: 'grace',
    platform: 'AU',
    accountCountry: 'au',
    connectedAccount: 'acct_1UexrYKEPlsvk7sL',
    card: { token: 'pm_card_ca', number: '4000001240000000', brand: 'visa', last4: '0000', country: 'CA' },
  },
  'bbbbbbb1-0000-0000-0000-000000000001': {
    memberId: 'bbbbbbb1-0000-0000-0000-000000000001',
    label: 'uma',
    platform: 'US',
    accountCountry: 'us',
    connectedAccount: 'acct_1Uf6ArRhjVRwQl8q',
    card: { token: 'pm_card_amex', number: '371449635398431', brand: 'amex', last4: '8431', country: 'US' },
  },
  'bbbbbbb2-0000-0000-0000-000000000002': {
    memberId: 'bbbbbbb2-0000-0000-0000-000000000002',
    label: 'victor',
    platform: 'US',
    accountCountry: 'us',
    connectedAccount: 'acct_1Uf6BRDnHKduZyZA',
    card: { token: 'pm_card_discover', number: '6011000990139424', brand: 'discover', last4: '9424', country: 'US' },
  },
};

/** Each member's binding card, keyed by profile id (the design's `BINDING_CARDS`). */
export const BINDING_CARDS: Readonly<Record<string, BindingCard>> = Object.fromEntries(
  Object.values(MEMBER_FIXTURES).map((fixture) => [fixture.memberId, fixture.card]),
);

/**
 * The staff open-sales override the bindings give every seed member, in minor units
 * (1,000,000.00 in a two-decimal currency). A large parallel run would otherwise trip
 * `SELLER_EXPOSURE_LIMIT` in Pathways that are not about it; the Pathway that IS about
 * it uses a persona with no override.
 */
export const EXPOSURE_OVERRIDE_MINOR = 100_000_000;

/** A card a Pathway types into Stripe's Payment Element iframe. */
export interface EntryCard {
  number: string;
  /** What Stripe does with it, for messages and reports. */
  behaviour: string;
  /** True when Stripe demands a 3-D Secure challenge to save or pay with it. */
  challenges: boolean;
}

/**
 * Published Stripe test cards for REAL card entry. Typed only into Stripe's own
 * iframe, never into a NoDitto field. None repeats a `BINDING_CARDS` number except
 * `auDomestic` (see the file header).
 */
export const ENTRY_CARDS = {
  /** US Visa that needs no authentication. */
  success: { number: '4242424242424242', behaviour: 'succeeds, no authentication', challenges: false },
  /** The only Australian-issued test card. SAME NUMBER AS BOB'S binding. */
  auDomestic: { number: '4000000360000006', behaviour: 'AU-issued, succeeds', challenges: false },
  /** 3-D Secure 2 is required on every setup and payment. */
  threeDSecure: { number: '4000000000003220', behaviour: '3-D Secure 2 required on every use', challenges: true },
  /** Authenticate once at setup; later payments succeed without a challenge. */
  threeDSecureSetupOnly: { number: '4000002500003155', behaviour: '3-D Secure required to set up only', challenges: true },
  /** Declined when it is saved (generic decline). */
  declined: { number: '4000000000000002', behaviour: 'declined (generic)', challenges: false },
  /** Saves, then every charge is declined. For a decline at Pay. */
  declinesOnCharge: { number: '4000000000000341', behaviour: 'attaches; charges are declined', challenges: false },
  /** Declined for insufficient funds when charged. */
  insufficientFunds: { number: '4000000000009995', behaviour: 'declined: insufficient funds', challenges: false },
} as const satisfies Record<string, EntryCard>;

/**
 * "Visa •••• 4242": the saved-method label exactly as `completeCardSetup`
 * (`lib/actions/payments.ts`) writes it from Stripe's brand and last 4.
 */
export function paymentMethodLabel(brand: string, last4: string): string {
  const title = brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : 'Card';
  return last4 ? `${title} •••• ${last4}` : title;
}

/** The fixtures for a seed member, or undefined when it has none. */
export function memberFixture(memberId: string): MemberFixture | undefined {
  return MEMBER_FIXTURES[memberId];
}

/** The command that creates the fixture accounts, named in every "missing" failure. */
export const PROVISION_COMMAND = 'npm run audit:stripe-fixtures';
