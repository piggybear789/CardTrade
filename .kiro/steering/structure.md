# Project Structure

## Layered architecture

Dependencies flow in one direction only:

```
app/ (routes, RSC)  →  components/  →  lib/  →  domain/
                                        ↓
                              Supabase / Mock_Service
```

`domain/` never imports from `app/`, `components/`, or `lib/`. Keep it pure so it runs in the Node-only Vitest project.

## Top level

```
app/                Next.js App Router routes (pages, layouts, API route handlers)
components/         React components, grouped by feature + shared ui/ primitives
domain/             Pure business logic: state machine, validation, orchestrators, services
lib/                Framework glue: server actions, Supabase clients, realtime hooks, helpers
supabase/           Sequential SQL migrations + seed.sql
tests/              unit/ (Node), property/ (fast-check), component/ (jsdom)
middleware.ts       Auth guard; redirects unauthenticated users off protected prefixes
.kiro/specs/        Authoritative spec (requirements.md, design.md, tasks.md)
.kiro/steering/     These guidance docs
```

## app/

Route folders mirror features: `(auth)/sign-in`, `(auth)/sign-up`, `account`, `admin`, `deals` (+ `new`, `[id]`, `join/[token]`), `kyc`, `listings` (+ `new`, `[id]`, `[id]/edit`), `messages`, `notifications`, `profile`, `sales/[id]`, `sellers/[id]`, `trades` (+ `new`, `[id]`), and `api/webhooks/stripe/route.ts`.

Pages are Server Components by default: fetch data with the cookie-bound Supabase client and pass plain data down. Add `'use client'` only on components that need state, effects, or Realtime.

Protected prefixes are listed in `middleware.ts` in both `PROTECTED_PREFIXES` and `config.matcher` — update both when adding a protected route.

## components/

One folder per feature (`account`, `admin`, `auth`, `deals`, `kyc`, `layout`, `listings`, `messages`, `notifications`, `offers`, `profile`, `reports`, `reviews`, `sales`, `trade`) plus `ui/` for shadcn primitives (button, card, dialog, form, input, label, select, textarea, badge, sonner).

Components are `PascalCase.tsx`. Add new shadcn primitives to `ui/` via the shadcn conventions in `components.json`; don't hand-roll styling that a primitive already covers. Compose classes with `cn()` from `@/lib/utils`.

## domain/

- `state-machine/` — `machine.ts` holds the `TRANSITIONS` table, the single source of truth for `Trade_State` changes. `guards.ts`, `actions.ts`, `types.ts` build on it. No Supabase, React, or service imports.
- `validation/` — zod schemas per entity (`item.ts`, `profile.ts`, `registration.ts`), re-exported from `index.ts`. Use `runSchema()` from `result.ts` so failures come back as `{ ok: false, field, message }`.
- `orchestrator/` — use-case logic paired with a repository interface. Each `xOrchestrator.ts` is pure and takes a repository; each `supabaseXRepository.ts` supplies the Supabase-backed implementation plus a `createDefaultXOrchestrator()` factory. Tests inject fakes instead of hitting a database.
- `services/` — the payment seam. Callers depend only on `PaymentKycService` (`PaymentService & PayerService`) obtained from `getPaymentService()` in `index.ts`; the binding is chosen there and nowhere else. Never import the Stripe SDK outside `services/stripe/**`.
- `webhook/` — `mapEventToAction.ts` maps a `Webhook_Event` to a state machine event.
- `identity/identityGate.ts` — the ONE place the Identity_Gate is evaluated. Never re-derive it inline.
- `deal/` — private-deal policy: `dealCash.ts` (who pays whom), `dealCollateral.ts` (stake sizing), `dealDispute.ts` (dispute outcome arithmetic and terminal state).
- `arbitration/arbitrationCase.ts` — the triage model over disputed sales, trades, deals and chargebacks. Priority is derived from deadlines, fraud allegations and SLA, deliberately **not** from amount, because weighting by money parks small disputes forever.
- `payouts/payoutReadModel.ts` — what a seller is owed and what has landed.

## lib/

- `actions/` — one module per feature, each starting with `'use server'`. Server Actions are thin: authenticate, gate on the Identity_Gate where money can be received, validate, delegate to an orchestrator, revalidate. A `'use server'` module may only export async functions, so shared constants live in `lib/marketplace-constants.ts` and shared types in `lib/actions/result.ts` (`ActionResult`, `ok()`, `fail()`). Every action returns a discriminated `{ ok: true, data }` / `{ ok: false, error, message, field? }` result — never throw for expected failures.
- `supabase/` — the three clients plus hand-maintained `database.types.ts` (the MCP generator only emits the `public` schema, so regenerating would destroy the `cardtrade` types — edit by hand).
- `staffGate.ts` — `requireStaff()` (`is_support` OR `is_admin`, may arbitrate). Distinct from `requireAdmin()` in `lib/actions/admin.ts` (may moderate). Two capabilities, not a hierarchy: nothing derives one from the other. The three dispute-resolution actions are staff-gated; everything else in `admin.ts` is admin-only.
- `realtime/` — `useXRealtime` client hooks for Supabase Realtime subscriptions.
- `notifications/createNotification.ts`, `format.ts`, `utils.ts`, `marketplace-constants.ts` — shared helpers and tuned limits.

## Conventions

- Files: `camelCase.ts` in `domain/` and `lib/`, `PascalCase.tsx` for components, `kebab-case` route folders.
- Single quotes and semicolons in `domain/` and `lib/`; 2-space indent throughout.
- Lead each non-trivial module with a header comment stating what it does and which requirements it satisfies, and document exported types/functions with JSDoc — this matches existing files.
- Errors are values, not exceptions: `ValidationResult` in the domain, `ActionResult` at the action boundary.
- Authorization is enforced twice: RLS on the cookie-bound client *and* an explicit owner/participant guard in the orchestrator. Keep both when adding write paths.
