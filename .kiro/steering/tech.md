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
npm run lint        :: next lint
npm run test        :: vitest --run (single pass, no watch)
```

Never start `npm run dev` from an agent turn; it blocks.

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
- `SUPABASE_SERVICE_ROLE_KEY` — server-only, RLS-bypassing
- `PAYMENTS_PROVIDER` — `mock` (deterministic simulation) or `pinch` (real Pinch Payments API)
- `WEBHOOK_SECRET`, `WEBHOOK_URL` — HMAC-SHA256 signing and delivery target for simulated webhooks
- `PINCH_ENV` (`test` | `live`), `PINCH_DEV_ID`/`PINCH_DEV_SECRET`, `PINCH_LIVE_ID`/`PINCH_LIVE_SECRET`, `PINCH_WEBHOOK_SECRET`, `PINCH_KYC_MODE`, `PINCH_MERCHANT_ID` — server-only Pinch config; only the `pk_*` publishable keys may reach the browser
- `PAYOUT_MODE` — `platform` (default) or `direct` (settle Cash_Sales into the seller's sub-merchant)

Never expose non-`NEXT_PUBLIC_` values to the client, and never echo secret values back in output.

## Database migrations

SQL migrations are sequential files in `supabase/migrations/` (`0001_schema.sql`, `0002_rls.sql`, `0003_realtime.sql`, `0004_dispute_fraud.sql`, `0005_merchant_onboarding.sql`). Add a new numbered file rather than editing an applied one. Every new table needs RLS policies. `supabase/seed.sql` holds demo data.
