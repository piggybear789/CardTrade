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
.kiro/steering/     These guidance docs
```

## app/

Route folders mirror features: `(auth)/sign-in`, `(auth)/sign-up`, `(auth)/forgot-password`, `auth/update-password`, `onboarding`, `admin` (+ `arbitration`), `listings` (+ `new`, `[id]`, `[id]/edit`, `mine`), `messages` (+ `[id]`), `notifications`, `offers`, `profile` (+ `payouts`), `purchases`, `sales` (+ `[id]`), `saved`, `sellers/[id]`, `trades` (+ `new`, `[id]`), `deals/new`, `t/[token]`, `account-suspended`, `(marketing)/help|terms|privacy`, `api/webhooks/stripe`, `api/webhooks/ship24`, `api/jobs/cash-sale-payouts`, `api/jobs/trade-inspections`, and `api/mobile/**`.

Pages are Server Components by default: fetch data with the cookie-bound Supabase client and pass plain data down. Add `'use client'` only on components that need state, effects, or Realtime.

Protected prefixes are listed in `middleware.ts` in both `PROTECTED_PREFIXES` and `config.matcher` — update both when adding a protected route.

## components/

One folder per feature (`account`, `admin`, `arbitration`, `auth`, `brand`, `contract`, `deals`, `fulfilment`, `identity`, `layout`, `listings`, `location`, `messages`, `notifications`, `offers`, `onboarding`, `payments`, `payouts`, `profile`, `reports`, `reviews`, `sales`, `trade`) plus `ui/` for shadcn primitives (button, card, dialog, form, input, label, select, textarea, badge, sonner, sheet, slider, popover, tooltip, skeleton, choice-tile, confirm-dialog, empty-state, dialog-row).

Two folders are cross-flow and should be reached for before writing anything new in `sales/` or `trade/`:

- `contract/` — the contract room shell both flows render: header, progress rail, action card, detail rows, timeline, conversation panel, exchange panel, hold list, money table, image lightbox.

`sales/ContractLineItems.tsx` holds BOTH the editor and the read-only list of what a Cash_Sale covers (0064), deliberately in one module: the buyer composes a request in the editor and then reviews the same lines in the contract room, and drift between the two would read as the terms having changed on them. `sales/EditContractItemsDialog.tsx` is the renegotiation surface; `listings/CloseShopfrontDialog.tsx` retires a binder listing without touching its open contracts.
- `fulfilment/` — the fulfilment controls both flows render: `FulfilmentMethodChoice`, `FulfilmentTermsFields`, `RecordShipmentDialog`, `DeliveryAddressPanel`, `InspectionCountdown`, `HandoverFailedDialog`. None of them own a server action; each room injects its own, because the two flows freeze and settle differently even where they look identical. These exist because the rooms had drifted apart in ways that mattered — the trade room accepted a free-text meeting point and an optional meeting time where the sale demanded a resolved place and a future instant.

Components are `PascalCase.tsx`. Add new shadcn primitives to `ui/` via the shadcn conventions in `components.json`; don't hand-roll styling that a primitive already covers. Compose classes with `cn()` from `@/lib/utils`.

## domain/

- `state-machine/` — `machine.ts` holds the `TRANSITIONS` table, the single source of truth for `Trade_State` changes. `guards.ts`, `actions.ts`, `types.ts` build on it. No Supabase, React, or service imports.
- `validation/` — zod schemas per entity (`item.ts`, `profile.ts`, `registration.ts`, `cashSaleLineItems.ts`), re-exported from `index.ts`. Use `runSchema()` from `result.ts` so failures come back as `{ ok: false, field, message }`. `cashSaleLineItems.ts` mirrors the CHECK constraints in migration 0064 and owns `lineItemsTotalCents`, the one definition of a shopfront contract's price — `replace_cash_sale_items` re-derives the same sum in SQL and aborts when the two disagree, so they are pinned to each other rather than merely intended to match.
- `orchestrator/` — use-case logic paired with a repository interface. Each `xOrchestrator.ts` is pure and takes a repository; each `supabaseXRepository.ts` supplies the Supabase-backed implementation plus a `createDefaultXOrchestrator()` factory. Tests inject fakes instead of hitting a database. Key orchestrators: `cashSaleOrchestrator`, `tradeOrchestrator`, `tradeProposal`, `disputeResolution`, `merchantOnboarding`, `itemOrchestrator`.
- `services/` — the payment seam. Callers depend only on `PaymentKycService` (`PaymentService & PayerService`) obtained from `getPaymentService()` in `index.ts`; the binding is chosen there and nowhere else. Never import the Stripe SDK outside `services/stripe/**`. Sub-folders: `stripe/` (real binding), `mock/` (deterministic simulation), `testing/` (InMemoryService for unit tests), `tracking/` (manual shipment tracking).
- `fulfilment/` — the shared "how do the goods change hands" model: `FulfilmentMethod`, one validator (`validateFulfilmentTerms`), one normalizer, and the trade inspection clock (`deriveTradeInspectionDeadline`, `TRADE_INSPECTION_HOURS`). Cash_Sales and Trades both go through it. The two tables still spell the columns differently (`cash_sales.fulfillment_method / shipping_cost_cents` vs `trades.handover_method / delivery_cost_cents`) because renaming either would touch the terms RPCs, the Realtime publication, the seeds and the hand-maintained types; each flow adapts its row and everything above the adapter speaks one language. Display strings that need `formatAud` stay in `lib/handover/terms.ts`, because `domain/` may not import `lib/`.
- `trade/tradeFee.ts` — platform fee calculation for trades (5% of FMV, symmetric).
- `trade/tradeSideValues.ts` — what each side of a Trade is WORTH, and the ONE place the binder rule lives (0081): a SHOPFRONT side is valued at whatever is offered against it, never at its own `fmv_cents`, which is a whole inventory's "from" price. Three call sites read it — the collateral sizing in `placeBondsForAgreedTrade`, the charged fee in `acceptTradeTerms`, and the fee the trade room DISCLOSES. Do not re-derive a side value by summing `fmv_cents`: disclosure has to agree with the charge, and two derivations of one money figure is the bug shape this codebase has already paid for twice.
- `bond/bondPolicy.ts` — collateral sizing: who needs a bond, how much, ceiling logic.
- `contract/` — step definitions for the contract progress rail. `cashSaleSteps.ts`, `tradeSteps.ts`, `steps.ts` (shared utilities).
- `webhook/mapEventToAction.ts` — maps a `Webhook_Event` to a state machine event.
- `identity/identityGate.ts` — the ONE place the Identity_Gate is evaluated. Never re-derive it inline.
- `region/regions.ts` — the trading-region registry and the ONE place two parties' regions are compared (`checkRegionCompatibility`). Pure, so the orchestrator guard and the browse UI share it. The request-scoped half — IP header, cookie, profile — is `lib/location/resolveRegion.ts`, which is `server-only` and is the only place `x-vercel-ip-country` is read.
- `arbitration/arbitrationCase.ts` — the triage model over disputed sales, trades and chargebacks. Priority is derived from deadlines, fraud allegations and SLA, deliberately **not** from amount, because weighting by money parks small disputes forever.
- `payouts/payoutReadModel.ts` — what a seller is owed and what has landed. `custodyReconciliation.ts` — platform balance health check.

## lib/

- `actions/` — one module per feature, each starting with `'use server'`. Server Actions are thin: authenticate, gate on the Identity_Gate where money can be received, validate, delegate to an orchestrator, revalidate. A `'use server'` module may only export async functions, so shared constants live in `lib/marketplace-constants.ts` and shared types in `lib/actions/result.ts` (`ActionResult`, `ok()`, `fail()`). Every action returns a discriminated `{ ok: true, data }` / `{ ok: false, error, message, field? }` result — never throw for expected failures. Key modules: `trades.ts`, `tradeNegotiation.ts`, `tradeFees.ts`, `tradeLifecycleStore.ts`, `cashSale.ts`, `listings.ts`, `offers.ts`, `payments.ts`, `payouts.ts`, `merchant.ts`, `identity.ts`, `arbitration.ts`, `admin.ts`, `messages.ts`, `reviews.ts`, `auth.ts`, `demo.ts`.
- `supabase/` — the three clients plus hand-maintained `database.types.ts` (the MCP generator only emits the `public` schema, so regenerating would destroy the `cardtrade` types — edit by hand).
- `staffGate.ts` — `requireStaff()` (`is_support` OR `is_admin`, may arbitrate). Distinct from `requireAdmin()` in `lib/actions/admin.ts` (may moderate). Two capabilities, not a hierarchy: nothing derives one from the other. The three dispute-resolution actions are staff-gated; everything else in `admin.ts` is admin-only.
- `realtime/` — `useXRealtime` client hooks for Supabase Realtime subscriptions: `useCashSaleRealtime`, `useTradeRealtime`, `useConversationRealtime`, `useNotifications`.
- `trades/` — `server-only` trade work that must NOT be a Server Action, because every export of a `'use server'` module is an endpoint addressable by anyone who learns its id. `completion.ts` holds `finalizeCompletedTrade` (release both collateral holds, then settle cash) so the mutual-acceptance path and the inspection timeout do the same thing; `inspectionSweep.ts` is the timeout itself, called only by `app/api/jobs/trade-inspections`.
- `webhook/webhookPipeline.ts` — the full verify → translate → dedupe → map → dispatch → log pipeline.
- `notifications/createNotification.ts`, `format.ts`, `utils.ts`, `marketplace-constants.ts` — shared helpers and tuned limits.
- `location/geoapify.ts` — address autocomplete and map embed integration (Google Maps).
- `location/resolveRegion.ts` — `server-only`. The one place a request becomes a browse region, and the one place `x-vercel-ip-country` is read. The precedence chain is `?region=` → the member's own `profiles.region_code` → their remembered cookie → the IP guess → `DEFAULT_REGION`, and it reports which of those it used so the UI can disclose a guess. Nothing on the read path writes; only `setBrowseRegion` does.
- `handover/terms.ts` — display-layer formatting for fulfilment terms.
- `storage/` — Supabase Storage helpers for item image uploads.

## Conventions

- Files: `camelCase.ts` in `domain/` and `lib/`, `PascalCase.tsx` for components, `kebab-case` route folders.
- Single quotes and semicolons in `domain/` and `lib/`; 2-space indent throughout.
- Lead each non-trivial module with a header comment stating what it does and which requirements it satisfies, and document exported types/functions with JSDoc — this matches existing files.
- Errors are values, not exceptions: `ValidationResult` in the domain, `ActionResult` at the action boundary.
- Authorization is enforced twice: RLS on the cookie-bound client *and* an explicit owner/participant guard in the orchestrator. Keep both when adding write paths.
