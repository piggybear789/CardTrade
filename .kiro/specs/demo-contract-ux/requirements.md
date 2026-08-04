# Requirements Document

## Glossary

- **Contract Workspace:** The shared active-contract surface containing the stage, next action, exchange ledger, and conversation access.
- **Exchange Ledger:** A consistent two-sided summary of all goods, optional cash, declared value, and settlement state.
- **Available-height boundary:** A viewport-derived component height that gives an inner message list a defined scrollable area without fixing the page itself.
- **Full Conversation:** The dedicated thread view for a participant-only contract conversation, with a route back to the related contract.

## Introduction

This spec turns CardTrade’s sales, private deals, trades, and related conversations into a coherent demo-ready contract experience. It resolves the current chat overflow by giving the conversation a real, bounded workspace on desktop and an intentionally different, task-first mobile layout.

It supplements the authoritative CardTrade requirements. It does not weaken authorization, RLS, state-machine guards, private-item rules, or the rule that money is integer AUD cents. Where the older document describes provider behavior that the current implementation cannot prove, this specification requires clear demo-safe language and a visible simulated state instead of a false claim.

## Scope and product decisions

- **Contract room family:** Cash sales, private deals, and accepted trades are all contracts. They share status, the agreed exchange, next action, history, and participant conversation patterns while preserving their specific state machines.
- **Exchange language:** A side may contain several items and optional cash. Counterpart acceptance—not an algorithmic FMV comparison—agrees the deal. A declared trade value is informative only and must never size collateral.
- **Collateral language:** The UI says a payment method may be charged if a trade goes wrong. It must not say money is held, deposited, refunded, or escrowed unless the configured payment service actually performs that operation.
- **Provider setup:** KYC is optional. Payout approval is required only to receive cash; it does not block listing or goods-only trades. A payment method is needed where a user must back a card-backed trade obligation.
- **Private items:** An item created for a trade remains excluded from catalog search and facets forever. Its disclosure is limited to participants in that offer and resulting contract.
- **Desktop and mobile:** Desktop uses a bounded, multi-panel contract workspace. Mobile keeps the document scrollable and opens chat as a deliberate, viewport-contained task surface; it does not squeeze three desktop columns into a narrow stack.

## Requirements

### Requirement 1: Bounded contract conversations

**User Story:** As a contract participant, I want to read and send messages without the conversation making the contract page endlessly tall, so that I can coordinate a handover while keeping the next required action visible.

#### Acceptance Criteria

1. On desktop contract routes, the ContractChat message list SHALL occupy a container with a definite available block size; messages SHALL scroll within that container and SHALL NOT enlarge the contract page after the workspace has reached its designed available height.
2. The chat header and composer SHALL remain visible while its message list scrolls. A composer error SHALL remain adjacent to the composer without obscuring the newest visible message.
3. Contract rooms SHALL use a shared workspace primitive that supplies the complete flex/grid `min-h-0`, definite-height, and overflow chain required by the embedded chat; `h-full` alone SHALL NOT be used as the chat sizing strategy.
4. The desktop workspace SHALL derive its usable height from the viewport, header, and shell gutters, with a sensible lower bound for an empty thread. It SHALL remain usable on short-height laptops without clipping actions or creating nested page-level horizontal overflow.
5. When a participant intentionally scrolls away from the newest message, a realtime update SHALL NOT pull the entire document or their message list back to the bottom. New-message behavior SHALL provide a clear return-to-latest affordance instead.
6. Chat connection state SHALL distinguish live, connecting, reconnecting, and offline states consistently in embedded and full-thread views.
7. A contract participant SHALL be able to open the full conversation from the compact workspace and return to the same contract. The full thread SHALL identify the related sale, deal, or trade.

### Requirement 2: Contract-room information hierarchy

**User Story:** As a buyer, seller, or trader, I want to understand the exchange and my next required step at a glance, so that I can act confidently without reading a long stack of cards.

#### Acceptance Criteria

1. Every active Cash_Sale, Deal, and Trade SHALL begin with the same conceptual hierarchy: current stage, next action, agreed exchange, participant context, and conversation access.
2. The first visible action area SHALL name the participant’s immediate task in plain language, explain why it is available or blocked, and render only actions permitted by the underlying state/authorization rules.
3. The agreed exchange SHALL show each side separately, list every included Item, show item counts instead of hiding a bundle behind a single title, label private items as “Not listed,” and state cash direction unambiguously.
4. Cash, declared trade value, collateral/charge exposure, and payout setup SHALL be presented as distinct concepts. Declared value SHALL be labeled as a participant’s stated value, not an appraised or protected value.
5. Contract history, terms, fulfillment details, disputes, and completion/review actions SHALL remain available below the workspace in a readable normal document flow. Active and ended contracts SHALL use distinct plain-language headings and end states.
6. The implementation SHALL not expose raw participant UUIDs, internal provider references, database state names without explanatory labels, or evidence-pack download affordances in participant-facing screens.

### Requirement 3: Responsive contract behavior

**User Story:** As a participant on a phone, tablet, or short laptop screen, I want the contract to remain usable without clipped controls or a squeezed desktop layout.

#### Acceptance Criteria

1. At desktop widths, the workspace SHALL allocate more horizontal space to conversation than to summary/party context. It SHALL NOT retain the current equal three-column split.
2. At tablet widths, the workspace SHALL preserve a readable exchange summary and make conversation access clear without horizontal scrolling or clipped action labels.
3. At mobile widths, contract content SHALL become a deliberate order: stage and next action, exchange summary, participant context, then a chat entry point and details. The full message experience SHALL open in a bounded viewport-aware sheet or dedicated thread rather than appear as an unbounded middle card between party panels.
4. A mobile composer SHALL remain above the safe-area inset and keyboard. The message list SHALL be the only scrolling region in the active chat experience.
5. The mobile shell SHALL expose KYC/trust status and section navigation without relying on an invisible scrollbar as the only sign that more content exists.
6. All workspace controls, messages, item names, cash amounts, timestamps, and error states SHALL remain keyboard reachable, screen-reader labeled, and visible at 200% zoom without requiring horizontal page scroll.

### Requirement 4: Complex offers and contract continuity

**User Story:** As a trader, I want an offer containing several items and optional cash to remain understandable from proposal through completion, so that I can decide, ship, receive, dispute, or review the exact agreed exchange.

#### Acceptance Criteria

1. The proposal inbox, offer form, counter flow, accepted Trade, shipment/receipt guidance, dispute view, and history SHALL use the same exchange-ledger language for a bundle and optional cash.
2. A counteroffer SHALL make clear which offer it replaces and which goods each participant is proposing. It SHALL support the intended X:Y exchange model rather than silently reducing the original side to one target Item.
3. Editing an open offer SHALL either permit the caller to revise the entire offered side—including its primary Item—or state a clear replacement flow that retains the counterparty’s context and does not strand private items.
4. A private offered Item SHALL remain private in every proposal, counteroffer, active contract, history row, notification, and full-thread context.
5. Fulfillment SHALL state that shipment and receipt are recorded per participant side, not per Item. If a side is incomplete, the participant SHALL be directed to the appropriate dispute path rather than offered a misleading partial-receipt completion action.
6. A cash component SHALL display its payment/settlement status separately from the goods and SHALL not appear completed merely because the proposal or item handover was accepted.

### Requirement 5: Demo integrity and money-state correctness

**User Story:** As a demo viewer, I want every visible payment, settlement, and collateral state to match what the hackathon implementation actually simulates, so that the demo earns trust rather than making unsupported promises.

#### Acceptance Criteria

1. Before a cash-inclusive Trade can show a completed lifecycle, the system SHALL either perform and record a deterministic simulated cash settlement or visibly block the affected completion state with an actionable explanation. Persisting a number alone is insufficient.
2. Proposal acceptance SHALL be an all-or-nothing operation: Trade creation, every Item reservation, bundle rows, cash terms, proposal status, and initial collateral records SHALL succeed together or leave the proposal and Items unchanged.
3. The Mock_Service and StripeService implementations SHALL agree with the UI’s chosen collateral model. If the model is a later-charge authorization, the demo SHALL show an authorization/charge exposure, not a captured charge, refund, or claimed provider pre-auth.
4. A failed later capture, failed simulated settlement, missing payout approval, and unavailable Item SHALL result in a visible recoverable/administrative resolution state; no participant-facing screen may imply a successful contract when the money action failed.
5. A destructive listing action SHALL be available only from the owner’s listing controls, require clear confirmation, call the existing server action, and return the user to an accurate list state. It SHALL NOT visually link “Delete” to edit.
6. Demo-only controls SHALL be clearly separated from real participant actions, unavailable in production configuration, and never replace required lifecycle UI.

### Requirement 6: Contract and list state clarity

**User Story:** As a member returning to CardTrade, I want to find work that still needs me and distinguish it from history, so that I do not lose an offer, sale, deal, or trade.

#### Acceptance Criteria

1. Purchases, Sales, Deals, Trades, and Offers SHALL make active work and history visibly distinct. Pending proposals count as active only.
2. An empty state SHALL name the exact thing that is absent, explain the next useful action in one sentence, and never appear beside a pending proposal or active contract that already needs attention.
3. Contract-list rows SHALL summarize counterparty, current stage, bundle count/title, cash direction and status where relevant, and an understandable date; they SHALL link directly to the associated contract or offer.
4. Notifications and full-thread links SHALL return participants to the exact active contract or offer that generated them.

### Requirement 7: Evidence-based visual and accessibility validation

**User Story:** As the CardTrade team, we want to validate the contract experience against real page geometry and realistic records, so that a polished desktop view does not hide mobile, overflow, or state regressions.

#### Acceptance Criteria

1. Before a contract workspace change is accepted, the implementer SHALL inspect it with a long message thread and an exchange containing multiple items plus cash at desktop, short-height laptop, tablet, and mobile viewport sizes.
2. Browser captures or an equivalent visual record SHALL verify: bounded chat scroll, pinned composer, no horizontal overflow, readable ledger rows, visible next action, and correct active/history copy.
3. Validation SHALL exercise at least one private Item, an unverified participant with a card-backed obligation, a payout-pending cash recipient, an incoming proposal, an outgoing proposal, and a terminal contract.
4. The implementation SHALL use editor diagnostics for changed TypeScript/TSX files. Automated tests SHALL not be run unless the user explicitly rescinds the instruction to stop Vitest.
