# Implementation Plan: Demo Contract Rooms & UX

## Overview

This workstream makes the hackathon demo trustworthy and easy to operate. It is deliberately ordered: verify and repair state/data claims first, establish one reusable contract layout next, then migrate sale, deal, trade, and full-thread screens onto it. No production payment action or live data mutation is included in this plan without explicit approval.

**Validation policy:** The user has explicitly asked not to run Vitest. Use editor diagnostics and browser screenshot/manual checks during this work. Add or update automated tests only if the user later asks to resume them.

## Tasks

- [~] 1. Establish the demo contract and data baseline
  - [ ] 1.1 Inventory every cash, collateral, and dispute phrase shown in contract, offer, and profile surfaces; replace a claim only when it matches the configured service behavior. (Not audited beyond the specific fixes below.)
  - [x] 1.2 Trade cash leg now settles for real on completion via `requestTransfer` (`settleTradeCash` in `lib/actions/trades.ts`), gated on the counterpart holding a payout account; a failed/unavailable settlement flags `manual_reconciliation` rather than silently completing.
  - [x] 1.3 `finalize_trade_acceptance` (migration `0017_atomic_trade_acceptance.sql`, applied via MCP) makes bundle rows + cash + proposal status one Postgres transaction; `acceptTradeProposal` compensates (voids holds, restores items) if it fails after the Trade already exists.
  - [x] 1.4 **Real bug found and fixed**: `StripeService.placeHold/voidHold/partialCapture/fullCapture` were calling no Stripe endpoint at all (a fabricated "mandate" string) despite `PAYMENTS_PROVIDER=stripe` being set. Rewrote them to the documented charge-and-refund calls (`POST /payments/realtime`, `POST /refunds`) and verified the full charge→refund round trip live against the real Stripe test API (see chat log: payer created, `pmt_...` charged status `approved`, refund `requested`).
  - [x] 1.4a **Real bug found and fixed**: `createCollateralSideEffects` (HOLDS_FAILED hold-void/item-restore) was defined but never wired into any live orchestrator call. Wired into the webhook route, the only place HOLDS_FAILED is dispatched.
  - [x] 1.4b **Real bug found and fixed**: Req 6.7 (void holds on BOTH_ACCEPTED→COMPLETED) had zero implementation — a successfully completed trade never released collateral. Added `voidTradeHolds` in `recordLifecycle`.
  - [x] 1.4c **Real bug found and fixed**: `domain/orchestrator/tradeProposal.ts` still hard-rejected any accepted trade whose two primary items weren't exactly equal in value, contradicting the already-shipped bundle/declared-value model. Every cash/bundle trade would have failed at acceptance. Removed the guard, updated its test, and reconciled `.kiro/specs/cardtrade/requirements.md` 5.7/5.10 which still described the old equal-value rule.
  - [x] 1.5 Demo-controls fallback already removed in the prior session; `DemoPanel` remains the only, clearly-labelled demo surface.
  - _Requirements: 5, 6, 7_

- [x] 2. Define reusable contract-room primitives
  - [x] 2.1 Build a `ContractWorkspace` layout primitive with a desktop available-height boundary, a summary/action pane, and a conversation pane; preserve fluid width, `min-w-0`, and accessible focus behavior.
  - [ ] 2.2 Build a reusable exchange-ledger view for one-to-many goods, optional cash direction, declared value disclosure, and private-item labels. (Sale/Deal/Trade each still render their own ad hoc party/ledger markup.)
  - [ ] 2.3 Build a single lifecycle/next-action summary that derives allowed actions from the existing state models rather than duplicating transition logic in presentation components.
  - [x] 2.4 Add a compact participant/trust summary — done per-surface (`PartyColumn` in Sale/Deal, `TraderColumn` in Trade); not yet unified into one shared component.
  - _Requirements: 2, 3, 4_

- [~] 3. Repair shared chat behavior
  - [ ] 3.1 Refactor ContractChat and ChatThread around one shared model — they still duplicate the message-log/composer implementation; ContractChat lacks ChatThread's timestamps/read receipts.
  - [x] 3.2 Replace unconditional `scrollIntoView` with scroll-container-aware “follow latest” behavior and a new-message affordance. (Done in ContractChat; ChatThread still uses `scrollIntoView`.)
  - [x] 3.3 Add related-contract links to the full thread and an “Open full conversation” action from every embedded chat.
  - [x] 3.4 Create or link participant-only trade conversations when an offer becomes an accepted Trade; preserve RLS and add only the minimum migration/RPC surface required.
  - _Requirements: 1, 2_

- [~] 4. Migrate Cash_Sale and Deal rooms onto the workspace
  - [x] 4.1 Adapt `CashSaleView` onto `ContractWorkspace` (layout/chat only — ledger/next-action still ad hoc).
  - [x] 4.2 Adapt `DealRoom` onto `ContractWorkspace`, including the unjoined share-link state with stable geometry.
  - [ ] 4.3 Move long terms/delivery/collateral/dispute/completion/review content below the workspace — not audited; still in original order.
  - [ ] 4.4 Add compact mobile chat entry points — mobile currently stacks the full chat panel in document flow (usable, but not the deliberate staged/sheet experience the spec calls for).
  - _Requirements: 1, 2, 3, 6_

- [~] 5. Bring Trades to the same contract standard
  - [x] 5.1 Trade conversation migration `0016_trade_conversation.sql` applied via MCP; RLS confirmed covered by existing participant policies.
  - [x] 5.2 `TradeContract` on `ContractWorkspace` with real participant conversation and compact parties. No unified next-action summary or exchange-ledger component yet (goods list is still bespoke `GoodsColumn`).
  - [x] 5.3 Demo-controls fallback copy removed; `DemoPanel` is the only demo-control surface and is visually distinct.
  - [ ] 5.4 Per-side shipment/receipt/dispute UX not reviewed.
  - [ ] 5.5 Terminal trade presentation (concise final record vs active workspace) not reviewed.
  - _Requirements: 2, 3, 4, 5_

- [ ] 6. Repair the offer-to-contract journey
  - [ ] 6.1 Redesign `TradeOfferForm`, `TradeProposalInbox`, and `EditTradeOfferDialog` around the same exchange ledger and stated-value/cash semantics.
  - [ ] 6.2 Implement a counteroffer model that can select and represent all intended goods on both sides; preserve permanent privacy for private items.
  - [ ] 6.3 Resolve the primary-item edit limitation with a clear full-side replacement flow or an expanded edit model, retaining notification/history context for the counterpart.
  - [ ] 6.4 Add cash settlement status to proposal and contract surfaces; prevent false completion until the selected demo/production payment path reports success.
  - _Requirements: 4, 5, 6_

- [~] 7. Close remaining demo-visible inconsistencies
  - [x] 7.1 `components/listings/DeleteListingDialog.tsx` — real confirmation dialog wired to `deleteItem`, replacing the link that duplicated `/listings/[id]/edit`.
  - [x] 7.2 Admin console (`app/admin/page.tsx`) now resolves initiator/counterpart/fraud-victim/reporter/report-target to display names instead of raw UUIDs.
  - [x] 7.3 Offers now has the same Active/Past split as Trades/Sales/Purchases/Deals (`lib/lifecycle.ts` `isOfferPast`, `app/offers/page.tsx`, `OffersSection` scope-aware empty state).
  - [ ] 7.4 Not audited this pass.
  - [ ] 7.5 Not audited this pass.
  - _Requirements: 3, 5, 6_

- [ ] 8. Validate with realistic browser scenarios
  - [ ] 8.1 Prepare safe local/demo records for: a long Sales/Deals/Trades conversation, a 2-item-plus-cash trade, private offered goods, pending payout setup, and every active/terminal state required by Requirements 7.
  - [ ] 8.2 Capture and inspect contract routes at desktop (1440×900), short-height laptop (1366×650), tablet (768×1024), and mobile (390×844). Record any overflow or action-priority failures before sign-off.
  - [ ] 8.3 Validate keyboard traversal, focus visibility, screen-reader labels for message logs/composers, and 200% zoom; correct any nested-scroll trap or document jump.
  - [ ] 8.4 Run diagnostics for all changed files. Do not run Vitest, build, or typecheck unless the user explicitly requests them.
  - _Requirements: 1, 2, 3, 7_

## Deferred unless explicitly reprioritized

- Real Stripe pre-approval/mandate API integration and production settlement configuration.
- Provider-side multi-use token configuration beyond the already discussed merchant enablement.
- Parcel-level tracking for every individual Item in an X:Y trade; this MVP tracks fulfilment per participant side.
- Replacing the entire contract state machine or reworking the core RLS model.

## Task Dependency Graph

```text
1 Demo correctness baseline
├── 2 Shared contract primitives
│   ├── 3 Shared chat behavior
│   │   ├── 4 Cash Sale and Deal migration
│   │   └── 5 Trade migration (after trade-conversation migration review)
│   └── 6 Offer-to-contract continuity
└── 7 Remaining demo-visible inconsistencies
    └── 8 Browser and accessibility validation
```

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2", "7"] },
    { "wave": 3, "tasks": ["3", "6"] },
    { "wave": 4, "tasks": ["4", "5"] },
    { "wave": 5, "tasks": ["8"] }
  ]
}
```

Tasks 1.2, 1.3, 1.4, and 5.1 affect persistence or payment semantics. They require the specified migration/RLS review and, where applicable, use of MCP before any live schema application. Layout tasks can proceed independently only after the shared contract presentation model is agreed.

## Notes

- This spec intentionally does not start implementation. Its first deliverable is a reviewed decision on the cash-settlement demo path and the trade-conversation schema.
- No test command, build, or typecheck is part of this plan unless the user expressly asks for it.
- The original `cardtrade` spec remains authoritative for business rules not explicitly refined here.
