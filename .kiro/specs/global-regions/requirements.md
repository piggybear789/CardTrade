# Requirements Document — Global Regions via a Bloc Platform

**Status: NOT STARTED. Blocked on an external answer (see Requirement 0).** This spec
plans opening NoDitto beyond Australia. It is written so it can be paused after
Requirement 0 if Stripe says no, without any code having been written on a false premise.

Product rules for regions today live in `.kiro/steering/product.md` (the regional note
under Transaction models) and `.kiro/steering/tech.md` (the per-region env-var scheme).
This spec EXTENDS that model; it does not replace it. Where the two disagree, the
steering is the current state and this document is the proposed change.

---

## Introduction

NoDitto is live in Australia on one Stripe platform account. The goal is to let members
in other countries buy, sell and trade — ideally without standing up a separate Stripe
platform account, a separate legal entity, and a separate deployment binding for every
country on earth.

Stripe's **cross-border payouts** make that partly achievable: a platform based in the
US, UK, EEA, Canada or Switzerland can pay connected accounts in **any** of those
regions. So one US platform account (the newly incorporated Stripe Atlas C-Corp) could,
in principle, serve sellers across the whole **US/UK/EEA/CA/CH bloc** off a single
account and a single Connect onboarding flow.

This spec captures that design, the one external assumption it rests on, and the code
changes it implies. It deliberately does not schedule any Dashboard or entity work —
that is the founder's, not the codebase's.

### The fact that shapes every decision below

**Cross-border payouts change who the platform can PAY, not who can TRADE with whom.**

It is tempting to read "one US platform serves the bloc" as "a UK member can trade with
a US member". It cannot, and must not. `checkRegionCompatibility`
(`domain/region/regions.ts`) keeps every deal inside ONE region — a UK member trades
with UK members in GBP, a German with Germans in EUR. That rule is unchanged and is not
up for negotiation here: postage, currency and consumer law all stay local.

What cross-border payouts change is purely settlement plumbing: **one platform account
can pay the sellers across several regions**, instead of needing one account per region.
So the unit that collapses is the PLATFORM ACCOUNT, not the trading region. The
onboarding modal still lists each region as its own line, because a member's region is
still their settlement jurisdiction and currency.

Read this paragraph before touching the binding layer. The entire design is "decouple
platform-account from region", and the failure mode is quietly re-merging them.

---

## Established facts

Verified against the live account (via Stripe MCP, 2026-09-24) and the code, not assumed:

- **Live platform:** `acct_1U0H0FKEPlyX260L`, country `AU`, test mode ("NoDitto
  sandbox").
- **Connected accounts today:** `capabilities: { transfers: "active" }` only,
  `controller.stripe_dashboard.type: "express"`, losses and fees on `application`,
  `default_currency: aud`, `country: AU`. Opened by `createManagedMerchant` with
  `configuration.recipient`.

### THE TERMINOLOGY COLLISION THAT INVALIDATED THE FIRST READING OF THIS SPEC

**Accounts v2 `configuration.recipient` is NOT the `recipient` service agreement.** One
is a ROLE (this account may receive transfers). The other is a LEGAL ToS TYPE. They share
a word and nothing else, and conflating them produces exactly the wrong conclusion.

Evidence that our accounts are on the **`full`** service agreement, not `recipient`:

1. **Documented:** the Accounts v2 limitations section states you must use Accounts v1 for
   "Signing connected accounts to a recipient service agreement". `createManagedMerchant`
   uses `v2.core.accounts.create`, so it **cannot** be signing the recipient agreement.
2. **Empirical** (MCP, live sandbox account `acct_1U6mKPKEPlpC29N3`): `tos_acceptance`
   returns `{ date: 1787321204 }` with **no `service_agreement: "recipient"`**.

**Consequence: the cross-border limitation "no cross-border payouts to accounts under a
recipient service agreement" DOES NOT APPLY TO US.** Do not plan a `recipient` → `full`
migration on that basis. There is nothing to migrate; we are already `full`.

### The blocker that DOES apply: Accounts v2 vs cross-border payouts

The Accounts v2 limitations section carries this callout, repeated verbatim on three pages
(`connect/accounts-v2`, `connect/accounts-v2/migrate-integration`,
`connect/accounts-v2/saas-platform-payments-billing`):

> **Cross-border payouts** — Use Global payouts to send cross-border payouts.

Read plainly, that says Connect cross-border payouts are **not available on Accounts v2**,
and Global Payouts is the substitute. It is terse and gives no reasoning, which is why
Requirement 0 exists rather than a conclusion.

**Why the substitute is materially worse for us, not merely different:**

| | Connect cross-border payouts | Global Payouts |
| --- | --- | --- |
| Who carries the licensing | **Stripe**, under Stripe's Money Transmitter licence | **Us** — "might require a Money Transmitter license if you manage your customers' funds" |
| Platform countries | US, UK, EEA, CA, CH | US, UK (AU only in private preview) |
| Prerequisite | none beyond approval | **requires Stripe Treasury** |
| Positioning | marketplaces using Stripe as their processor | "best for businesses that **already hold** the MTL" |

We manage our customers' funds by design — escrow is the product. So Global Payouts points
the MTL obligation directly at us, which is the single thing Connect cross-border payouts
would have absorbed. That is not a tradeoff to weigh; it is the opposite of the goal.

- Cross-border payouts are also **not self-serve**: "Stripe determines if your platform
  meets the criteria."
- Corroborating detail: the legacy account-types page notes some connected-account
  countries "are available only when using cross-border payouts" — so it genuinely is the
  mechanism that widens country coverage.
- Sources, verified 2026-09-24 — re-check before acting:
  https://docs.stripe.com/connect/cross-border-payouts ·
  https://docs.stripe.com/connect/accounts-v2 ·
  https://docs.stripe.com/connect/service-agreement-types ·
  https://docs.stripe.com/global-payouts
- **Cross-border payouts bloc:** platform in US / UK / EEA / CA / CH can pay connected
  accounts in any of those regions. Australia is NOT in the bloc — it can neither be a
  cross-border platform nor a cross-border destination. This is why AU stays its own
  account permanently.
- **The code already assumes one account per region.** `allConfiguredRegionCodes()`
  scans `STRIPE_SECRET_KEY_XX`; `operationalRegions()` intersects that with
  `tradingEnabled`; `regionBinding.ts` selects a platform by the contract's frozen
  currency; `DEFAULT_CONFIG_REGION = 'AU'` maps the unsuffixed key to AU. There is
  nowhere today that expresses "one account, many regions".
- **`REGIONS`** in `domain/region/regions.ts` already lists all 40 bloc + AU countries
  with correct currency / stripeCountry / locale, all `tradingEnabled: false` except AU.
  Migration `0068` mirrors this in `cardtrade.regions`, pinned by
  `tests/unit/regionCurrencyAgreement.test.ts`.
- **The stale note:** `product.md` still says the blocker on a second region is the
  single global `STRIPE_CURRENCY`. That is no longer true (currency is per-region from
  the table, trigger-derived per 0068). It must be corrected as part of this work.

---

## Requirement 0 — Confirm cross-border payouts on Accounts v2 (BLOCKING, external)

**User story:** As the platform owner, I need Stripe to tell me whether Connect
cross-border payouts are available to an Accounts v2 platform, because the documented
answer is "use Global Payouts" and Global Payouts puts the money-transmitter obligation on
us.

This is the ONE question that decides the architecture. Everything in Requirements 1–2
is contingent on it. Do not write that code first.

The question for Stripe sales / support, stated exactly:

> We are a marketplace and merchant of record, built on the Accounts v2 API
> (`v2.core.accounts.create` with `configuration.recipient` +
> `stripe_balance.stripe_transfers`), using separate charges and transfers with platform
> loss liability (`fees_collector` and `losses_collector` = `application`). We collect the
> full purchase into our platform balance, hold it pending buyer inspection, then transfer
> the net to the seller.
>
> We want ONE US platform account to onboard and pay sellers across the US/UK/EEA/CA/CH
> bloc using Connect cross-border payouts, so that Stripe's Money Transmitter licence
> covers the funds flow.
>
> 1. Your Accounts v2 limitations section says "Use Global payouts to send cross-border
>    payouts." Does that mean Connect cross-border payouts are unavailable to Accounts v2
>    platforms entirely, or can they be enabled on our account?
> 2. If unavailable on v2: is there a supported path to Connect cross-border payouts for a
>    new platform, given Accounts v1 is not recommended for new integrations?
> 3. Our connected accounts are on the `full` service agreement (v2 cannot sign the
>    recipient agreement). Please confirm that satisfies the cross-border service-agreement
>    limitation.
> 4. For our escrow / merchant-of-record model specifically, does Connect cross-border
>    payouts keep the money-transmitter obligation with Stripe, or does holding buyer funds
>    pending inspection move it to us regardless of which product we use?

#### Acceptance criteria

1. WHEN Stripe confirms cross-border payouts are available to us THEN Requirements 1–2
   proceed as written (one US platform serves the bloc).
2. WHEN Stripe says cross-border is v1-only or unavailable THEN this spec is REPLACED by
   "AU + US as two independent single-region platforms", Requirement 1 is reduced to
   nothing, and each further region needs its own entity and account. No
   platform-decoupling code is written.
3. WHEN Stripe's answer is "Global Payouts only" THEN the MTL question in (4) above is
   answered IN WRITING and reviewed by a lawyer before any non-AU region is enabled.
   Global Payouts additionally requires Treasury, which is its own approval.
4. The answer is recorded in this file, dated, before `sk_live_` is used for any region.

---

## Requirement 1 — Decouple platform account from trading region

**User story:** As a developer, I need one Stripe platform account to serve many trading
regions, so the bloc does not require one account per country.

#### Acceptance criteria

1. WHEN the system resolves the platform account for a contract THEN it maps the
   contract's region to a PLATFORM-ACCOUNT KEY (e.g. `US` serves `US, GB, DE, FR, …`),
   not 1:1 to the region code.
2. WHEN a bloc region is operational THEN `operationalRegions()` includes it only if its
   serving platform account is configured, not only if its own suffixed key exists.
3. WHEN `regionBinding.ts` selects a client THEN it selects the SERVING account, not an
   account named after the region.
4. AU continues to resolve to the AU account with no behavioural change.
5. The platform-account→regions mapping is expressed in ONE place, tested, and is the
   only thing that must change to add a bloc region.

---

## Requirement 2 — Out-of-country seller onboarding

**User story:** As an out-of-US seller in the bloc, I can onboard and be paid by the US
platform.

**REVISED after research.** An earlier draft of this requirement called for migrating
connected accounts from the `recipient` service agreement to `full`. **That work does not
exist** — see the terminology collision above; `v2.core.accounts.create` already produces
`full`-agreement accounts. Do not reintroduce it.

What may still be needed is unknown until Requirement 0 is answered, so this requirement
is deliberately thin.

#### Acceptance criteria

1. WHEN a seller's region differs from the serving platform's country THEN
   `createManagedMerchant` passes that seller's own country (it already prefers
   `profiles.region_code` over the config default) and requests whatever capability set
   Stripe's answer to Requirement 0 specifies.
2. WHEN the seller is in the platform's own country THEN behaviour is unchanged.
3. Any additional onboarding requirements for out-of-country sellers are surfaced in the
   onboarding UI, not discovered at payout time.
4. Existing AU connected accounts are untouched. No migration of live accounts.
5. `merchant_status` / `merchant_settlements_enabled` continue to be derived from the
   provider in both directions, never latched (`stripe-payments.md`).

---

## Requirement 3 — Per-region currency and money correctness

**User story:** As a member, my contract is denominated and displayed in my region's
currency, correctly, including non-2-decimal currencies.

#### Acceptance criteria

1. WHEN a bloc region is enabled THEN its currency comes from the region table (already
   true) and `assertMinorUnitSupported` gates it (already wired in `readStripeConfig`).
2. WHEN the Friction_Tax applies in a non-AUD region THEN `FRICTION_TAX_CENTS` is a
   per-currency lookup, not the AU-only `2000` constant (`domain/dispute/frictionTax.ts`
   records this exact TODO).
3. No zero-decimal or three-decimal currency is enabled without explicit handling.

---

## Requirement 4 — Onboarding, waitlist and disclosure

**User story:** As a member anywhere, the region picker offers me every operational
region and waitlists me otherwise.

#### Acceptance criteria

1. WHEN operational regions change THEN `listSelectableRegions()` reflects them with no
   code change (already true).
2. WHEN a member is outside every operational region THEN they land on the waitlist
   (`joinRegionWaitlist`), unchanged.
3. The picker never shows a "rest of world" bucket: each region is its own line with its
   own currency.

---

## Requirement 5 — Cross-account fraud fingerprint (do first, small)

**User story:** As the platform, a person fraud-banned on one account stays banned on all
of them.

#### Acceptance criteria

1. WHEN more than one platform account exists THEN `IDENTITY_FINGERPRINT_SECRET` is set
   to a single shared value across all deployments, so one person hashes identically
   everywhere (`config.ts` falls back to the per-account `secretKey` otherwise —
   different key, different hash, ban evaded).
2. The secret is set BEFORE the second account runs its first Identity check (rotating it
   later orphans existing hashes).
3. `IDENTITY_FINGERPRINT_SECRET` is added to `.env.local.example` (absent today).

---

## Requirement 6 — Documentation truth

#### Acceptance criteria

1. The stale `STRIPE_CURRENCY` blocker note in `product.md` is corrected.
2. The region model in `product.md` / `tech.md` is updated to describe
   platform-account-serves-many-regions once Requirement 1 lands.
3. `regions.ts` header comments are updated where they assert 1:1 region↔account.

---

## Out of scope

- Countries outside the US/UK/EEA/CA/CH bloc (Global Payouts is a different product with
  self-held licensing — a separate spec if ever pursued).
- Moving AU onto the US entity (rejected: AU is outside the bloc, worse economics, kills
  the PayTo roadmap; see the conversation that produced this spec).
- Any Dashboard, entity, or licensing action — those are the founder's, not code.

## The division of labour (recorded so it is not re-litigated)

- **Founder only:** all Stripe Dashboard setup on the US account (Connect onboarding,
  Accounts v2 registration, loss-liability acceptance, automatic-payouts OFF, Identity
  flow, webhook endpoints, API keys), pasting secrets into `.env.local`, incorporation,
  and the Requirement 0 conversation with Stripe.
- **Codebase:** everything in Requirements 1–6.
- The agent cannot drive the US account via MCP (it is bound to the AU sandbox) and does
  not write secret values.
