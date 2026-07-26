# Design Document: Demo Contract Rooms & UX

## Overview

CardTrade’s contract pages currently behave as long stacks of independent cards. Cash sales and private deals place two large party cards and an unconstrained chat in equal desktop thirds; the chat’s `h-full` has no definite parent height, so the document scrolls instead of the message list. Accepted trades are structurally different again: they have no participant conversation, despite being another active contract.

This design creates one **contract workspace** pattern. Its purpose is not decoration: it puts the current commitment, the participant’s next action, and conversation in one operational surface. Long-lived detail, history, and receipt/review actions remain below as normal document content.

## UX direction

The contract room should feel like a collector’s counter: the agreed swap is on the counter, the current handover step is prominent, and discussion is beside it—not scattered through a generic dashboard. The visual signature is an **exchange ledger**: compact “You give / You receive” rows with actual item counts, cash direction, and a current-stage marker. It is structural information, not a decorative timeline.

The application’s existing ink, parchment, gold, and trust tones remain the base. The contract workspace adds no new typography or ornamental treatment. Its distinction comes from a disciplined 4:8 desktop split, dense ledger rows, and a single highlighted “Next step” panel.

## Audit findings

1. `MarketplaceShell` and `PageShell` correctly provide flexible width and `min-h-0`, but neither gives the content workspace a definite vertical height.
2. CashSaleView and DealRoom place party cards, chat, and content in an auto-height `lg:flex-row` where every child receives equal width. `ContractChat` therefore cannot resolve `h-full` to a bounded height.
3. `scrollIntoView` can scroll the document because the chat log is not the reliable scrolling ancestor.
4. `ChatThread` has richer connection and delivery cues than `ContractChat`; the two views have drifted.
5. TradeContract is a serial card dashboard with no chat, participant summary, or shared contract-room hierarchy.
6. Cash-inclusive trade proposals persist cash but do not yet charge, transfer, settle, or show a cash lifecycle. Proposal acceptance performs several writes without one transaction.

## Architecture

```text
MarketplaceShell
└── ContractPage
    ├── ContractWorkspace (desktop available-height boundary)
    │   ├── ContractSummaryPane (4 columns)
    │   │   ├── stage + next action
    │   │   ├── exchange ledger
    │   │   └── compact parties / trust context
    │   └── ContractConversationPane (8 columns)
    │       ├── persistent chat header
    │       ├── independently scrolling message log
    │       └── persistent composer
    └── ContractDetails (normal document flow)
        ├── terms / delivery / collateral explanation
        ├── state history and disputes
        └── completion, review, or history actions
```

## Layout decisions

### Desktop: one bounded operational surface

At `lg` and above, the route starts with a fluid two-column grid rather than three equal cards:

```text
┌────────────────────── summary / action ──────────────────────┬──────────────── conversation ────────────────┐
│ Stage chip + clear next step                                  │ Contract title, counterparty, realtime state   │
│ Exchange ledger: you give / you receive / cash status         ├───────────────────────────────────────────────┤
│ Compact participant and charge-exposure context               │ independently scrolling messages                │
│ Primary action + secondary route to terms/details             ├───────────────────────────────────────────────┤
│                                                                │ pinned composer + send/error                    │
└──────────────────────────────────────────────────────────────┴───────────────────────────────────────────────┘
                                      ↓ normal document flow: terms, fulfilment, history, disputes, review
```

The grid uses a fluid `minmax(17rem, 0.9fr) minmax(0, 1.7fr)` relationship, so the conversation has the space it needs without relying on a hard content width. The workspace gets a named available-height CSS token derived from the viewport after header and shell gutters. It has a lower usable bound for the empty state and an upper viewport-relative cap for compactness; it is not a page-wide fixed-height layout. Both grid children and every nested flex child use `min-w-0`/`min-h-0` where they must allow text truncation or internal scroll.

Only the message log owns `overflow-y-auto`. The workspace itself contains overflow on the intended axis; the document still scrolls normally for details below it. The loading and error chat states reserve the same workspace geometry as a live chat to prevent reflow.

### Mobile and tablet: staged instead of compressed

Below `lg`, the contract is a one-column document in this order:

1. Stage, plain-language next action, and any required blocking explanation.
2. Compact exchange ledger, including item count, private disclosure, cash direction/status, and a link to all details.
3. Participant/trust context and the single most relevant secondary action.
4. A **Chat** button with unread/latest-message context.
5. Terms, delivery/handover, history, and dispute content.

Tapping Chat opens a viewport-contained conversation sheet or a dedicated `/messages/[id]` view with contract context. The sheet/thread gives the message log the only scrolling area and keeps the header/composer anchored above keyboard/safe-area space. Tablet may use the same staged flow or a two-column summary/chat layout only after the text and actions are proven to fit; it never forces the desktop three-panel composition.

### Exchange ledger

The ledger is one reusable presentation model, not separate card copy in each feature:

```text
YOU GIVE                              YOU RECEIVE
• Flygon                              • Articuno
• Clefairy                            $50 paid to you — awaiting settlement
Declared by you: $220                 Their stated value: not supplied
```

It shows one item per row until a compact threshold, then names the first items and includes an accessible “View all N items” expansion. FMV can appear as catalog context; a declared value remains explicitly participant-supplied. Collateral exposure is calculated and displayed separately under a “What could be charged if this goes wrong” label.

## Shared component plan

| Component | Responsibility |
|---|---|
| `ContractWorkspace` | Owns desktop grid, viewport-derived available height, mobile staging, and focus/overflow boundaries. |
| `ContractSummaryPane` | Renders stage, next action, compact parties, and exchange ledger. Accepts a presentation model, not raw database rows. |
| `ContractConversationPane` | Wraps the shared conversation view, full-thread link, latest-message behavior, and per-contract labels. |
| `ConversationView` | Shared message list, status, timestamp/read cues, composer, and scroll-follow policy used by `ContractChat` and `ChatThread`. |
| `ExchangeLedger` | Renders multiple goods, cash direction/status, declared value, private labels, and side-level fulfilment language. |
| `ContractDetails` | Hosts terms, tracking/handover, collateral, event history, disputes, and closing actions in normal document flow. |

The presentation adapters for Cash_Sale, Deal, and Trade resolve their own state-machine facts server-side where possible and pass a plain `ContractRoomModel` down. Existing action components retain their authorization checks; the summary only decides where they are placed and how their explanation is worded.

## Conversation behavior

The scroll policy is intentionally conservative:

- On initial load, the message log—not the document—opens at the latest message.
- While the reader is already near the bottom, inbound/outbound updates maintain that position.
- When the reader is reviewing history, a new message increments a “New messages” affordance; clicking it scrolls the **log** to latest.
- System events remain readable ledger-like notes, but do not dominate personal messages.
- Connection state uses the same `live`, `connecting`, `reconnecting`, and `offline` labels everywhere.
- Embedded chat has a clear “Open full conversation” link. Full conversation identifies and links back to its sale, deal, or trade.

Trades need a participant-only conversation associated at acceptance. The data model should use an explicit contract association rather than guessing from Item or participant IDs; its schema/RLS design belongs in the migration review before implementation.

## Lifecycle presentation

The top-level stage is the answer to “what happens now?”; history is the answer to “what happened?” They must not be conflated.

| State family | Top action language | Details/history language |
|---|---|---|
| Offer awaiting decision | `Review offer` / `Waiting for their answer` | `Offer terms` |
| Terms or confirmation | `Review and accept terms` | `Changes and agreement` |
| Card-backed obligation pending | `Add a payment method` / `Waiting for authorization` | `What could be charged` |
| Goods moving | `Add tracking`, `Confirm receipt`, or `Inspect your side` | `Handover progress` |
| Cash pending | `Complete simulated payment` or the actual enabled payment action | `Cash status` |
| Disputed | `View dispute` / `Provide requested information` | `Dispute history` |
| Completed or cancelled | `Trade completed`, `Sale cancelled`, etc. | `Final record` and review |

## Demo correctness boundaries

The current code proves only part of what the UI indicates:

- `PinchService.placeHold` currently returns a locally encoded mandate reference and does not call a provider pre-approval endpoint.
- `MockService.placeHold` emits `hold.active`/`hold.failed` events, but it must be reconciled with the later-charge language and capture outcomes.
- A cash trade leg is stored on proposal/trade rows but has no charge, settlement, or failure lifecycle.
- `acceptTradeProposal` creates the Trade, then writes bundle rows/cash and marks the proposal in separate operations. A mid-flow failure can leave inconsistent data.
- Trade conversations do not exist yet, and the TradeContract currently includes a participant-facing demo-controls fallback.

The spec treats these as release blockers for any demo claim of completed cash-inclusive trades or fully operational collateral. The solution may remain deterministic and mocked for the hackathon, but every visible state must be traceable to a persisted, recoverable state transition.

## Rollout and validation

Implement the reusable data/presentation model with a sale first, then private deals, then trades after their conversation and atomic acceptance design are approved. Keep existing routes live during migration; visual parity is accepted only after the required screenshot matrix in Requirements 7 is recorded. Schema changes use a new sequential migration and are applied to the Supabase project through MCP only after the migration and RLS implications are reviewed.

## Components and Interfaces

```ts
interface ContractRoomModel {
  kind: 'cash-sale' | 'deal' | 'trade';
  id: string;
  state: { label: string; detail: string; isTerminal: boolean };
  nextAction: { label: string; explanation: string; control: ReactNode | null };
  exchange: ExchangeLedgerModel;
  participants: ContractParticipant[];
  conversation: { id: string; href: string; latestPreview?: string } | null;
}

interface ExchangeLedgerModel {
  giving: LedgerSide;
  receiving: LedgerSide;
  cash: { direction: 'outgoing' | 'incoming'; amountCents: number; status: string } | null;
  declaredValueCents: number | null;
}
```

Route adapters produce this presentation model from server-authorized reads. They may not expose raw payment-provider identifiers or permit actions that bypass existing Server Actions/orchestrators. Client components receive only the fields needed to render and trigger already-authorized operations.

## Data Models

The implementation keeps existing Cash_Sale, Deal, Trade, proposal, Item, hold, and conversation records as their respective sources of truth. It adds only data required to join a Trade to a conversation and to persist the cash lifecycle selected in Requirement 5.

| Need | Data rule |
|---|---|
| Trade conversation | Store an explicit, nullable association between a Trade and a participant-only Conversation. Enforce RLS so only the two Trade participants can read/write it. |
| Trade cash lifecycle | Record an explicit status and audit timestamps/references for the simulated or real settlement; do not infer settlement from `cash_amount_cents`. |
| Exchange ledger | Derive from `trade_items`, primary legacy item columns, `cash_amount_cents`, and proposal terms. It is a view model, not a duplicate persistence table. |
| New-message affordance | Keep as client state based on scroll position and unread/realtime events; no schema change is needed. |

## Error Handling

Expected errors remain typed values at the Server Action boundary. The workspace makes the specific recovery path visible: reconnecting chat offers a status/retry state; a missing conversation offers a safe creation retry; a failed cash/collateral operation identifies that it did not complete and directs the participant to the supported next step. The UI never substitutes optimistic “completed” copy for a failed or unknown provider outcome.

## Correctness Properties

### Property 1: Contract conversation authorization

A contract conversation is visible only to the same participants authorized for its underlying Cash_Sale, Deal, or Trade.

**Validates: Requirements 1.7, 2.6**

### Property 2: Ledger fidelity and privacy

A bundle shown in the exchange ledger lists exactly the Item ids persisted for that side, including permanently hidden items only where the viewer is a participant.

**Validates: Requirements 2.3, 4.1, 4.4**

### Property 3: Lifecycle and settlement fidelity

A terminal contract does not expose an action the state machine disallows, and no cash leg reaches a completed presentation state without a persisted successful settlement outcome.

**Validates: Requirements 2.2, 4.6, 5.1, 5.4**

### Property 4: Scroll containment

Scrolling to a new chat message changes the message log’s scroll position, never the document scroll position.

**Validates: Requirements 1.1, 1.5, 3.4**

## Testing Strategy

The immediate validation is browser- and diagnostics-led because automated tests are paused by user instruction. Component and domain coverage can be added later for the exchange-ledger adapters, scroll-follow policy, cash-lifecycle guard, and atomic acceptance RPC once Vitest is explicitly resumed. Until then, the required screenshot/manual matrix in Requirements 7 is the release gate.
