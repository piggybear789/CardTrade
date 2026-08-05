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

Property tests use `fast-check` to assert the correctness properties recorded in the spec design doc. Domain logic must stay pure so it can be tested without a database.

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
- `NEXT_PUBLIC_GEOAPIFY_KEY` — browser-safe Geoapify key for address autocomplete + static maps (restrict by HTTP referrer in the Geoapify dashboard)
- `SUPABASE_SERVICE_ROLE_KEY` — server-only, RLS-bypassing
- `PAYMENTS_PROVIDER` — `mock` (deterministic simulation) or `stripe` (real Stripe API)
- `WEBHOOK_SECRET`, `WEBHOOK_URL` — HMAC-SHA256 signing and delivery target for simulated webhooks
- `STRIPE_SECRET_KEY` — server-only. The prefix alone selects the mode (`sk_test_` vs `sk_live_`), so there is no separate environment variable to fall out of sync
- `STRIPE_WEBHOOK_SECRET` — `whsec_...`, verifies the `stripe-signature` header. Get one from `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — the only Stripe value that may reach the browser
- `PAYOUT_MODE` — `platform` (default) or `direct` (settle Cash_Sales into the seller's sub-merchant)
- `JOBS_SECRET` — server-only bearer secret for the scheduled money-moving routes (`/api/jobs/cash-sale-payouts`, `/api/jobs/trade-inspections`). Both **fail closed** without it. Set `CRON_SECRET` to the same value, because Vercel Cron sends it as a bearer token on a GET.

Never expose non-`NEXT_PUBLIC_` values to the client, and never echo secret values back in output.

## Database migrations

SQL migrations are sequential files in `supabase/migrations/`, currently through `0057_trade_fulfilment_parity.sql`. Add a new numbered file rather than editing an applied one. Every new table needs RLS policies. `supabase/seed.sql` holds demo data.

Note the base DDL for `deals` / `deal_holds` / `deal_events` is **not** in `supabase/migrations/` — those tables predate the numbered sequence. Alter them with `add column if not exists` rather than assuming a prior migration defines them.
