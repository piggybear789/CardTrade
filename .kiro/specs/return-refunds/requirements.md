# Requirements Document — Return-Conditional Refunds

## Introduction

Today a `REFUND_BUYER` dispute outcome refunds the Buyer in full, marks the sale
`REFUNDED`, and returns the Item to the catalog. **Nothing asks the Buyer to send the
goods back, and no return is tracked.** For the commonest reason a full refund is
awarded — "it arrived and it is not what was agreed" — that means the Buyer keeps both
the item and the money, and the Seller is handed a live listing for goods they no
longer hold.

The copy now says so plainly (`CashSaleDisputeResolution`, `payoutNotifier`), which
turns a surprise into a decision. This spec is the actual fix: make a full refund
conditional on the goods coming back, when the goods are in the Buyer's hands.

### The fact that shapes every decision below

**NoDitto already holds the money.** Cash_Sale proceeds sit in the platform balance
from the Commitment_Point until the sale resolves (`product.md`, "Cash Sale"). Every
other marketplace designing this flow — eBay, PayPal — is solving a harder problem,
because there the Seller may already have been paid and a refund is a clawback.

Here it is not. That means the *safe* ordering — goods move first, money moves second —
costs the Buyer nothing they have not already accepted, because their money is frozen
either way. On eBay that ordering would leave a Buyer out of pocket and empty-handed;
here it does not. **Do not import the eBay sequencing without noticing this.**

---

## Established facts

Verified against the live schema (`information_schema`) and the migrations, not
assumed:

- `cardtrade.cash_sale_status` has **11 values**: `AGREEMENT`, `PAYMENT_PENDING`,
  `ESCROW_HELD`, `IN_TRANSIT`, `HANDOVER`, `INSPECTION`, `COMPLETED`, `DISPUTED`,
  `CANCELLED`, `FAILED`, `REFUNDED`. **There is no state for "awaiting a return".**
- `cash_sale_delivery_details` columns: `cash_sale_id`, `buyer_id`, `address_label`,
  `place_id`, `country_code`, `latitude`, `longitude`, timestamps. **One row per sale,
  and it holds the BUYER's address only. There is no Seller address anywhere in the
  schema — a return currently has nowhere to go.**
  - Contrast `trade_delivery_details`, which has a row per trader *because a swap posts
    in both directions*. That is the shape a return needs, and the precedent for it.
- `cash_sales` tracking columns are a **single set**: `tracking_carrier`,
  `tracking_number`, `tracking_status`, `tracking_url`, `carrier_delivered_at`. A
  return is a SECOND shipment leg and would collide with the outbound one.
- Refund machinery already exists and is nonce-protected: `refund_cents`,
  `refund_nonce`, `refund_ref`, `refund_status`, `refund_attempts`, `refund_error`,
  plus `mark_cash_sale_refund_due` and the refund drain in
  `processDueRefunds`. **No new money-movement primitive is required.**
- Carrier confirmation is already wired: `apply_cash_sale_tracking` sets
  `carrier_delivered_at` only on a `DELIVERED` status, Ship24 pushes it via
  `/api/webhooks/ship24` (now authenticated), and `ManualTrackingService` is the
  no-carrier fallback.
- Reusable UI already exists: `RecordShipmentDialog`, `DeliveryAddressPanel`,
  `InspectionCountdown`, `HandoverFailedDialog`, `DisputeEvidencePanel`.

---

## The three decisions

These are product calls, not implementation details. Recommendations given, but each
is yours.

### D1 — Ordering: goods first, then money

**Recommended: the Buyer ships, carrier confirms delivery to the Seller, THEN the
refund is released.**

Because the platform holds the funds, the Buyer is not disadvantaged relative to today
— their money is already frozen. The alternative (refund immediately, trust the return)
puts the entire loss on the Seller with no recourse, which is the same asymmetry this
spec exists to remove.

The Buyer's protection is that the refund is **automatic on carrier-confirmed
delivery**, not discretionary — the Seller cannot sit on it. That mirrors how the
outbound leg already works: a carrier confirmation, never a party's word, starts a
clock that can end in a payout.

### D2 — Who pays return postage

**Recommended for v1: the Buyer pays it and is not reimbursed. Stated up front,
before they commit to the return.**

This is the uncomfortable one, and the reason is structural rather than a
preference. On a full refund the Seller receives **nothing**, so there is no payout to
deduct return postage from. Unlike a Trade, a Cash_Sale Seller posts **no collateral** —
that is exactly why the Friction_Tax exists on the trade side and has no cash-sale
equivalent. So there is no held Seller money to charge.

The options, honestly:

| Option | Cost lands on | Viable now? |
|---|---|---|
| Buyer pays, no reimbursement | Buyer | ✅ Yes — no new money movement |
| Buyer pays, reimbursed in refund | **Platform** (money it never collected) | ⚠️ Only as funded goodwill |
| Deducted from Seller proceeds | Seller | ❌ On a full refund there are no proceeds |
| Capture from Seller collateral | Seller | ❌ Cash_Sale Sellers post none |
| Platform absorbs, capped | Platform | ⚠️ Policy + budget decision |

If you want the Seller to bear it, that needs a Seller-side hold at the Commitment
Point — a real change to the Cash_Sale model, and out of scope here.

### D3 — When a return is required at all

**Recommended: only when the goods reached the Buyer.** Derive it, do not ask.

- Sale reached `INSPECTION` or `HANDOVER`, or `carrier_delivered_at` is set → the Buyer
  has the goods → **return required**
- Sale is still `ESCROW_HELD` or `IN_TRANSIT` with no carrier delivery → the Buyer never
  received them → **refund immediately, no return** (this is the lost-parcel and
  never-shipped case; there is nothing to send back)

An arbitrator may override in either direction, because "delivered" and "the Buyer
actually has something worth returning" are not the same claim — an empty box is
recorded as delivered.

---

## State machine

Two new statuses, inserted between `DISPUTED` and `REFUNDED`:

```
DISPUTED
   │
   ├── outcome REFUND_BUYER, goods with Buyer
   │        ↓
   │   RETURN_PENDING ──── Buyer records return shipment ───► RETURN_IN_TRANSIT
   │        │                                                      │
   │        │ return deadline lapses,                              │ carrier confirms
   │        │ nothing shipped                                      │ delivery to Seller
   │        ↓                                                      ↓
   │   (arbitration: release to Seller,                        REFUNDED
   │    or partial, or extend)                                 + Item relisted
   │
   ├── outcome REFUND_BUYER, goods never reached Buyer
   │        ↓
   │   REFUNDED  (Item relisted only if the Seller still holds it — D3)
   │
   ├── outcome PARTIAL_REFUND  → COMPLETED   (unchanged; the Buyer KEEPS the item,
   │                                          which is the whole point of this outcome)
   └── outcome RELEASE_SELLER  → COMPLETED   (unchanged)
```

**`PARTIAL_REFUND` must never enter the return flow.** It exists precisely so the Buyer
keeps the item at a reduced price. Routing it through a return would contradict its
own definition.

### Terminality

`RETURN_PENDING` and `RETURN_IN_TRANSIT` are **not** terminal, and the Item must stay
`RESERVED` throughout. Relisting on entry to the return flow would advertise goods that
are in transit — the unfulfillable-listing problem migration 0064 exists to avoid.

---

## Schema changes

### R1 — Seller return address

The return has nowhere to go today. Follow the `trade_delivery_details` precedent
rather than inventing a shape.

**Acceptance criteria**

1. `cash_sale_delivery_details` gains a `party` discriminator (`BUYER` | `SELLER`), or
   a sibling table holds the Seller row. The existing single-row-per-sale assumption
   and its unique constraint must be revisited either way.
2. A Seller address is readable by the Buyer **only** from `RETURN_PENDING` onward —
   the same disclosure timing the outbound address already uses (0057). A Seller's home
   address must not be readable at any earlier point in a sale.
3. It must be a resolved, provider-autocompleted place, matching
   `isResolvedPlace()`. Free text is refused, as on the outbound leg.
4. The address is NOT on `cash_sales`, which is Realtime-published — same reasoning as
   `trade_delivery_details`.

### R2 — Return shipment leg

`cash_sales` has one set of tracking columns and the return is a second leg.

**Acceptance criteria**

1. Return tracking is stored separately from outbound: `return_tracking_carrier`,
   `return_tracking_number`, `return_tracking_status`, `return_tracking_url`,
   `return_carrier_delivered_at`. The outbound values must remain intact and readable
   after a return completes — arbitration needs both legs.
2. `apply_cash_sale_tracking` either gains a leg argument or a sibling
   `apply_cash_sale_return_tracking` exists. Whichever: **`return_carrier_delivered_at`
   is set only on a `DELIVERED` status**, never from a party's assertion.
3. Ship24 delivers return updates through the same authenticated webhook. The route
   must resolve which leg a tracking number belongs to and must not let a return event
   overwrite outbound delivery.
4. Both legs are added to `CASH_SALE_PUBLIC_SELECT` in `cashSaleProjection.ts`, or the
   contract room will not see them.

### R3 — Return deadline

Held money cannot wait indefinitely on a Buyer who never posts.

**Acceptance criteria**

1. `return_deadline_at` is set when the sale enters `RETURN_PENDING`.
2. The window is **7 days to hand the parcel to a carrier**, not 7 days to arrive —
   the Buyer controls the former and not the latter. Recommended, tune as you like.
3. A sweep (extending `cashSaleInspectionSweep`) flags lapsed returns for
   arbitration. It must **not** auto-release to the Seller: a Buyer who was awarded a
   refund and then missed a postage deadline has not been shown to be at fault, and the
   auto-complete-and-pay precedent does not transfer to a contested sale.
4. Both parties are warned 24h before the deadline, in-app and by email, reusing the
   existing warning machinery.

### R4 — Refund on confirmed return

**Acceptance criteria**

1. When `return_carrier_delivered_at` is set, the existing refund path is queued via
   `mark_cash_sale_refund_due` — **reusing `refund_nonce`**, so a duplicate carrier
   event cannot refund twice.
2. The Item returns to the catalog **only here**, never on entry to the return flow.
3. The status becomes `REFUNDED` exactly as it does today; nothing downstream of the
   refund needs to change.
4. If the refund itself fails, existing behaviour holds: `refund_status = 'FAILED'`,
   the drain retries, and the sale does not silently appear resolved.

### R5 — Seller disputes the return

The Seller may say the return arrived empty, damaged, or was never delivered despite
tracking.

**Acceptance criteria**

1. From `RETURN_IN_TRANSIT`, the Seller can raise a return dispute, reusing
   `DisputeEvidencePanel` and `dispute_evidence`.
2. Doing so **freezes the automatic refund** and returns the case to arbitration. It
   must not capture or release anything by itself — the `HANDOVER_FAILED` precedent on
   the trade side is the model.
3. The arbitration case view shows **both** shipment legs and all evidence from both
   parties.

### R6 — Disclosure before commitment

**Acceptance criteria**

1. Before a Buyer accepts a return-conditional refund, the UI states: that they must
   post the item within the window, who pays return postage (D2), that the refund
   releases automatically on carrier-confirmed delivery, and what happens if they do
   not post.
2. The Seller is told the same terms at the same time. Neither party learns the postage
   rule after committing.
3. Copy never implies NoDitto arranges, insures, or pays for the return unless D2 is
   resolved that way.

---

## Effort and risk

Roughly **3–5 days**, dominated by surfaces rather than logic:

| Area | Work |
|---|---|
| Migrations | Seller address, return tracking leg, 2 enum values, deadline column, RLS |
| Orchestrator | 2 new transitions, return-required derivation, refund-on-confirmation |
| Sweep | Return deadline warnings + lapse handling |
| Webhook | Leg resolution on the Ship24 route |
| UI | Return address capture, return shipment recording, countdown, Seller return dispute, arbitration two-leg view |
| Tests | State machine transitions, deadline properties, idempotency of refund-on-delivery |

**Main risks**

1. **The enum change touches a lot.** `cash_sale_status` is read by the projection, the
   contract steps (`cashSaleSteps.ts`), the payout read model, the arbitration model and
   the Dart port. Adding two values means auditing every exhaustive switch over it.
2. **Two shipment legs invite conflation.** A return event overwriting outbound delivery
   would corrupt the original inspection record. Keep the column sets fully separate and
   test a return arriving while outbound data is present.
3. **The seller address is new PII.** It is the first time a Seller's physical address
   enters the system; the disclosure timing in R1.2 is the whole protection.

---

## A cheaper option, if this is too much for now

**One input on the resolution: "are the goods coming back?"** — and relist only when the
answer is yes.

That is a few hours, no enum change, no new tracking leg, no new address table. It does
not enforce or track the return, but it fixes the concrete defect shipping today: an
Item relisted while the Buyer still holds it. Everything above remains available later
and nothing here blocks it.

Given return-conditional refunds mainly matter at volume — and the platform holding the
funds already means no party can walk off with both the goods and the money without a
staff decision — the cheap option is a defensible launch position. The full flow is what
you build when disputes are frequent enough that arbitrating each one by hand costs more
than the machinery.
