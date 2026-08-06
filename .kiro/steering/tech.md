# Tech Stack

## Core

- **Next.js 15** (App Router, React Server Components) with **React 19**
- **TypeScript 5.7**, `strict: true`, `noEmit` (Next/Vitest handle transpilation)
- **Supabase** — PostgreSQL, Auth, Storage, Realtime (`@supabase/supabase-js`, `@supabase/ssr`)
- **Tailwind CSS 3** + **shadcn/ui** (Radix primitives, `class-variance-authority`, `tailwind-merge`, CSS variables, slate base color)
- **lucide-react** icons, **sonner** toasts, **next-themes**
- **zod 4** for schema validation, **react-hook-form** + `@hookform/resolvers` for forms
- **Vitest 3** + **fast-check** (property-based testing), **@testing-library/react** + jsdom for components

## Commands

```cmd
npm run dev         :: next dev
npm run build       :: next build (production build)
npm run start       :: next start
npm run typecheck   :: tsc --noEmit
npm run lint        :: eslint . (flat config, not `next lint`)
npm run test        :: vitest --run (single pass, no watch)
```

Never start `npm run dev` from an agent turn; it blocks.

ESLint is a flat config (`eslint.config.mjs`) wired to `@next/eslint-plugin-next`,
`eslint-plugin-react-hooks` and `@typescript-eslint` **directly**. Do not reintroduce
`eslint-config-next`: its root entry is still eslintrc-style and loads
`@rushstack/eslint-patch`, which throws under ESLint 9. `next build` swallowed that throw
and silently skipped linting, so the build passed while nothing checked unused imports or
hook rules. `next lint` itself is deprecated and removed in Next 16.

Do **not** run `npm run build` or `npm run typecheck` as a routine verification step — they are slow and the user runs them on their own cadence. Validate changes with `npm run test` (or a targeted Vitest project/file) and rely on editor diagnostics for type errors. Only run a build or typecheck when the user explicitly asks for one.

Run a single Vitest project or file:

```cmd
npx vitest --run --project domain
npx vitest --run tests/unit/tradeProposal.test.ts
```

## Test layout

`vitest.config.ts` defines two projects:

- `domain` — Node environment, covers `tests/unit/**` and `tests/property/**` (pure state machine, validators, orchestrators, fast-check properties). No DOM, no Supabase.
- `component` — jsdom environment with globals and `tests/setup.ts` (jest-dom matchers), covers `tests/component/**`.

Property tests use `fast-check` to assert correctness properties of the domain logic. Domain logic must stay pure so it can be tested without a database.

## Path aliases

Defined in both `tsconfig.json` and `vitest.config.ts` — keep them in sync:

`@/domain/*`, `@/lib/*`, `@/components/*`, `@/*`

## Supabase clients

Pick the right client; all of them target the `cardtrade` Postgres schema (`db: { schema: 'cardtrade' }`).

- `lib/supabase/server.ts` → `createClient()` — cookie-bound, acts as the signed-in user, RLS enforced. Use in Server Components, Server Actions, Route Handlers.
- `lib/supabase/browser.ts` — client components / Realtime subscriptions.
- `lib/supabase/admin.ts` → `createAdminClient()` — service-role key, **bypasses RLS**. Marked `import 'server-only'`; use only for trusted server tasks (webhook handler, guarded orchestrator writes, Storage uploads). Never import from client code.

Generated DB types live in `lib/supabase/database.types.ts` (`Tables<'items'>`, etc.). Regenerate after schema changes rather than hand-editing.

## Environment

Copy `.env.local.example` to `.env.local`:

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — browser-safe
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` — browser-safe Google Maps key for Places Autocomplete, Maps Embed API (meeting points), and Maps Static API (suburb previews). Restrict by HTTP referrer in the Google Cloud Console. Enable Places API (New) + Maps Embed API + Maps Static API on the key.
- `SUPABASE_SERVICE_ROLE_KEY` — server-only, RLS-bypassing
- `PAYMENTS_PROVIDER` — `mock` (deterministic simulation) or `stripe` (real Stripe API)
- `WEBHOOK_SECRET`, `WEBHOOK_URL` — HMAC-SHA256 signing and delivery target for simulated webhooks
- `STRIPE_SECRET_KEY` — server-only. The prefix alone selects the mode (`sk_test_` vs `sk_live_`), so there is no separate environment variable to fall out of sync
- `STRIPE_WEBHOOK_SECRET` — `whsec_...`, verifies the `stripe-signature` header. Get one from `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — the only Stripe value that may reach the browser
- `STRIPE_IDENTITY_VERIFICATION_FLOW` — server-only `vf_...` id of the Dashboard Verification Flow used for the Identity_Gate. Read per region like the other Stripe values, because a flow belongs to one Stripe account. Optional: unset, the binding creates an equivalent inline document session instead, which works but moves the flow's options out of the Dashboard and into code
- `PAYOUT_MODE` — `platform` (default) or `direct` (settle Cash_Sales into the seller's sub-merchant)
- `DEFAULT_REGION` — ISO 3166-1 alpha-2 browse region used when nothing else resolves, i.e. local development and unrecognised IPs. Defaults to `AU`, and an unlisted code falls back rather than emptying the catalog. This is the BROWSE default only; it never becomes anyone's `profiles.region_code`
- **`STRIPE_SECRET_KEY_<REGION>`** — one Stripe platform account per region (0068), e.g. `STRIPE_SECRET_KEY_GB`. The unsuffixed `STRIPE_SECRET_KEY` is the binding for `AU` (`DEFAULT_CONFIG_REGION`) and **does not** serve any other region: a suffixed lookup never falls back, because resolving a GB seller onto the AU platform would look fine at onboarding and fail at the first transfer with the buyer already charged. `STRIPE_WEBHOOK_SECRET_<REGION>`, `STRIPE_CONNECT_WEBHOOK_SECRET_<REGION>` and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY_<REGION>` follow the same rule. Setting a region's key is what makes it operational — `allConfiguredRegionCodes()` discovers regions by scanning the environment, so there is no list to keep in step
- `STRIPE_CURRENCY` / `STRIPE_ACCOUNT_COUNTRY` — legacy fallbacks only. Currency and account country now come from the region table in `domain/region/regions.ts`, because a per-region env var for either would be a second place the mapping `GB → gbp` lives
- `JOBS_SECRET` — server-only bearer secret for the scheduled money-moving routes (`/api/jobs/cash-sale-payouts`, `/api/jobs/trade-inspections`). Both **fail closed** without it. Set `CRON_SECRET` to the same value, because Vercel Cron sends it as a bearer token on a GET.

Never expose non-`NEXT_PUBLIC_` values to the client, and never echo secret values back in output.

## Database migrations

SQL migrations are sequential files in `supabase/migrations/`, currently through `0069_identity_gate_on_stripe_identity.sql`. Add a new numbered file rather than editing an applied one. Every new table needs RLS policies. `supabase/seed.sql` holds demo data.

`lib/supabase/database.types.ts` is hand-maintained and its `Functions` block is part of that: `client.rpc('name', …)` is typed against it, so a new RPC or a new argument must be added there or the call fails `tsc` even though the SQL is correct. Adding a column to `cash_sales` also means adding it to `CASH_SALE_PUBLIC_SELECT` in `lib/supabase/cashSaleProjection.ts`, which is an explicit column list — the contract room reads through it and will simply not see the column otherwise.

`cardtrade.regions` (0068) mirrors `domain/region/regions.ts`, and the two are pinned by `tests/unit/regionCurrencyAgreement.test.ts`, which parses the migration's INSERT and compares every code, label, currency and minor-unit digit count. The SQL copy exists because the `set_row_currency_from_region` trigger derives `items.currency`, `cash_sales.currency` and `trades.currency` on insert, and a trigger cannot import TypeScript. Change one side and the test fails — do not "fix" it by loosening the test, because a drift here means a contract charged in one currency and displayed in another.

**Money is an integer in the currency's SMALLEST unit, and that is not always cents.** `minorUnitDigits()` is the one place the divisor lives: 2 normally, 0 for JPY. `assertMinorUnitSupported()` throws on a three-decimal currency rather than assuming 2, because that assumption is a silent tenfold error in a money path. Display goes through `formatMoney(minorUnits, currency)`; `formatAud` is a deprecated alias kept only so the remaining call sites compile.

When a migration changes the Identity_Gate expressions (`public_profiles.is_verified`, the two `seller_identity_verified` trigger functions, or that trigger's column list), the denormalisation-agreement property in `tests/property/identityGate.test.ts` reads the newest migration that defines each and evaluates it against `satisfiesIdentityGate`. It fails loudly on an expression it cannot interpret, so keep the SQL in the plain `identity_check_status = 'VERIFIED'::cardtrade.identity_check_status` form. The test additionally **throws** if a Connect column (`merchant_status`, `merchant_settlements_enabled`) reappears in a gate expression, because since 0069 those gate payouts and nothing else.

**That test parses migration TEXT with regexes, and two things in a migration file will break it.** `grant select (col)` contains the literal `select (`, which the trigger-function regex matches across newlines — so put column grants at the END of the file, after the functions. And do not write `select (` or `as is_verified` in a migration COMMENT either; prose matches the regex just as well as code does.
