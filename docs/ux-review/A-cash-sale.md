# UX review: cash sale (Buy now → Pay → fulfil → inspect → payout)

Source: e2e screenshots listed in `docs/ux-review/inputs/A-cash-sale.txt` (run `2026-11-26T01-42-49Z-g4ea9pj`). Desktop is 1280×720, phone is iPhone 14 (390 pt wide, captured at 3x). About 60 screenshots were reviewed across all 24 test-ids on both viewports. Paths below are shortened to `audit-artifacts/<test-id>/<viewport>/…/step-NN.<member>.png`.

**Summary**
1. Money figures disagree on the same screen. The room header shows a domestic-card total while the Pay dialog charges a higher one, the seller sees the buyer's total, and the seller's own listing shows "$46 AUD" for a $45.00 card.
2. Refusals and failures live only in toasts. A failed 3-D Secure check, an unpayable seller, the exposure limit, repricing and related accounts all leave the room looking payable, with nothing persistent saying what happened or that nothing was charged.
3. Every state says the same thing three to five times (header badge, chip, status card, timeline card, action bar), while the one thing the member must do sits in a chat footer away from the status card that describes it.
4. The Pay dialog does not fit a 720 px desktop or the phone: the primary button is cut off or below the fold, and its copy says the money is held "until the item is handed over", which is wrong.
5. The phone header and action bar cannot hold their content. Badges clip off the right edge, key reassurance lines end in "…", the inspection banner sits above the header, and three stacked bars take about 30% of the screen.

---

## P1: blocks, confuses or misleads about money

### [P1] Room header total disagrees with the amount charged
- **Where:** `payments.card-3ds` step 4, desktop (`audit-artifacts/cash-sale.payments.card-3ds/desktop/…/step-04.buyer.png`). `payments.card-repriced` step 7, both viewports (`…/card-repriced/desktop/…/step-07.buyer.png`, `…/phone/…/step-07.buyer.png`).
- **What's wrong:** The header behind the dialog reads **"$154.50 AUD total"**, which is the 3% domestic price. The Pay dialog on the same screen reads **"Charged now, in AUD $157.50 AUD"** at "Buyer protection fee (Card) 5%". After the repricing refusal, the header still shows $154.50 AUD, although the buyer's card will be charged more.
- **Suggested fix:** Derive the header total (`ContractHeader` / the `CashSaleView` header) from the same `totalForMethod(savedCardTier)` the dialog uses. If the tier is unknown, show "$150.00 AUD + fee" instead of a total. After `CARD_REPRICED`, update the header in the same render as the refusal.

### [P1] The seller is shown the buyer's total, and their own listing shows a rounded "$46 AUD"
- **Where:** `delivery.lifecycle` steps 8, 17 and 21, seller, desktop and phone (`…/delivery.lifecycle/desktop/…/step-08.seller.png`, `…/phone/…/step-17.seller.png`). `cancel.in-agreement` step 5, seller. `buy-now.reserves-single` step 7, seller, desktop (`…/buy-now.reserves-single/desktop/…/step-07.seller.png`).
- **What's wrong:** In the seller's room the header reads "$46.35 AUD total", while the chat header and "You receive" both read $45.00 AUD. On the seller's own listing the price reads **"$46 AUD"**: the price plus the buyer's fee, rounded, with no decimals. That figure is neither their price nor the buyer's total. A seller can reasonably think the platform changed their price.
- **Suggested fix:** Make the header role-aware. The seller sees "You receive $45.00 AUD" and the buyer sees "$46.35 AUD total". On the listing page, always format the price with `formatMoney` (two decimals). Show the owner the price they set, with the fee line underneath ("Buyers pay $46.35 AUD incl. 3% buyer protection fee").

### [P1] A failed 3-D Secure payment leaves a dead end with no "nothing charged" message
- **Where:** `payments.card-3ds-failed` steps 5–8, desktop and phone (`…/card-3ds-failed/desktop/…/step-05.buyer.png`, `…/phone/…/step-05.buyer.png`).
- **What's wrong:** The room shows the chip **"Stripe failed"**, a red bar, "Step 2 of 5 · Failed", and an action bar reading **"Payment failed here (i)"** with no button. The only explanation is a toast, "The payment could not be collected.", which disappears. The timeline still ends at "started payment." Nothing persistent tells the buyer that nothing was charged or that the card is back on sale, and nothing offers a next step.
- **Suggested fix:** Use a FAILED status card: "Payment didn't go through. Your bank declined the security check, so nothing was charged. The card is back on sale." Add a primary "Buy it again" button (back to the listing) and a secondary "Use another card". Write a timeline event for the failure. Rename the chip "Payment failed" (see the provider-names finding).
- **Mobbin:** [talabat "Top up failed"](https://mobbin.com/screens/ce8b2238-1b89-4d12-9174-03d175a98b2c?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) uses one line of cause and two clear exits ("Try another card" / "Go back").

### [P1] The Pay dialog says the money is held "until the item is handed over"
- **Where:** `cancel.refused-after-payment` step 5 and `payments.card-3ds` step 4, desktop and phone (`…/cancel.refused-after-payment/desktop/…/step-05.buyer.png`, `…/phone/…/step-05.buyer.png`). `payments.bank-eps` step 5, desktop.
- **What's wrong:** The card intro reads "This charges $46.35 AUD to your card through Stripe and **holds it until the item is handed over**." The EPS intro reads "NoDitto holds your payment until the item is handed over." The money is actually held until the buyer accepts or the inspection window ends. The PayTo dialog gets this right ("NoDitto holds the payment until you accept the item"). The Card option's subline, "Paid straight away.", reads as if the seller is paid now.
- **Suggested fix:** Use one sentence for every rail: "You pay $46.35 AUD now. NoDitto holds it until you accept the card, then pays the seller." Change the Card subline to "Your saved card." Keep this copy in one constant shared by the card, bank-rail and PayTo dialogs (`BuyButton` / the Pay dialog in `CashSaleView`).
- **Mobbin:** [Citi Bike purchase sheet](https://mobbin.com/screens/f058b972-77d4-493c-b0c1-fe82453558fd?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) uses one authorisation sentence directly above a single primary button.

### [P1] The Pay dialog's primary button is below the fold on both viewports
- **Where:** `cancel.refused-after-payment` step 5, desktop and phone. `payments.card-3ds` step 4, desktop. `payments.card-no-auth` step 4.
- **What's wrong:** At 1280×720 the dialog runs from y≈25 to y≈695, so "Accept terms and pay $46.35 AUD" is cut in half and "Keep reviewing" is clipped. On the phone the sheet ends at the saved-card row ("Visa •••• 0006" is cut), and the pay button is not visible at all. Nothing on screen hints that the sheet scrolls.
- **Suggested fix:** Give the dialog a sticky footer holding the total and the primary button ("Pay $46.35 AUD"), with the body scrolling above it. Cut height by merging the intro and the "How holds and disputes work" link, putting "3%" on the same line as the fee label, and collapsing the price rows to one "Price + shipping" line when shipping is $0.00 AUD.
- **Mobbin:** [Klook price summary](https://mobbin.com/screens/5ba62796-f1d4-4632-b84e-94de05b2f3e9?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) pins the total and "Go to payment" to the bottom of the sheet. [Upwork "Fund contract & hire"](https://mobbin.com/screens/886d9dc6-b73a-4c91-935f-36a1e99fd76c?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) keeps the summary and button in a fixed column beside the method list.

### [P1] Region mismatch is known on the listing page, yet Buy now opens a full checkout before refusing
- **Where:** `payments.region-mismatch` steps 2–3, desktop and phone (`…/region-mismatch/desktop/…/step-03.buyer.png`, `…/phone/…/step-03.buyer.png`).
- **What's wrong:** The listing already shows "This listing is in United States and you are trading in Australia. Deals between those two regions are not possible yet, because payments for each are handled separately." Even so, Buy now opens the dialog with a USD price, an FX note and "Reserve item and agree terms". The refusal then repeats the same sentence as a toast, which on the phone covers the dialog.
- **Suggested fix:** When `checkRegionCompatibility` fails, disable Buy now and Make an offer on the listing (`BuyButton`), with the reason as one line under them: "Only members in the United States can buy this." Keep the server refusal as the backstop. Also fix "in United States" → "in the United States".

### [P1] Server refusals at Pay leave the room looking payable
- **Where:**
  - `payments.seller-exposure-limit` step 6, desktop (`…/seller-exposure-limit/desktop/…/step-06.buyer.png`)
  - `payments.seller-not-payable` step 6, phone (`…/seller-not-payable/phone/…/step-06.buyer.png`)
  - `payments.related-accounts` steps 5–6, both viewports
  - `payments.card-repriced` step 7, both viewports
- **What's wrong:** Each refusal is a toast, and each toast covers the very "Accept terms and pay" button that stays enabled. Examples:
  - "This seller has reached their limit for new sellers. Try again after their current sales complete."
  - "The seller hasn't finished setting up payouts yet, so this sale can't be paid. Try again once they have."
  - "The contract could not be opened. Please try again." This one invites pointless retries for a permanent refusal.

  Most of these toasts don't say "nothing was charged". The buyer has no way to learn when retrying would work.
- **Suggested fix:** Treat these as room states. Put a status card with the reason, "Nothing was charged.", and the next step ("We'll notify you when the seller can be paid", or "Cancel and release the card"). Disable Pay until the state changes. For related accounts, use "We can't open a sale between these accounts." and drop "try again". `buyer-identity-required` already does this well: a persistent "Verify ID to pay" bar with "Purchases over $5,000.00 AUD need a verified ID." Copy that pattern.

### [P1] When the seller changes the terms, the only signal is a toast over the Pay button
- **Where:** `multiple-items.line-items` steps 10–12, desktop (`…/multiple-items.line-items/desktop/…/step-12.buyer.png`).
- **What's wrong:** The buyer's Pay dialog closes, and a toast reads "The seller changed the terms. Review them before paying." It sits over "Accept terms and pay", which is still enabled. The header price drops from $56.65 to $51.50 AUD with no explanation. The timeline line "updated the items this contract covers." does not say what changed.
- **Suggested fix:** Show an inline "Terms changed" card on Status with a before/after: "Was: 2 lines, $55.00 AUD. Now: 1 line, $50.00 AUD." Add a "Review items" button. Make the timeline event name the new total.

### [P1] A flagged tracking number still tells the seller to wait for the buyer, and the warning is truncated
- **Where:** `delivery.flagged-delivered-before-shipment` step 11, seller, desktop (`…/flagged-delivered-before-shipment/desktop/…/step-11.seller.png`). Step 13, buyer, phone (`…/phone/…/step-13.buyer.png`).
- **What's wrong:** The seller's status card still reads "Waiting for [E2E] flagged-buyer to confirm it arrived" and "Delivered Tue, 24 Nov … confirmed by the carrier." The flag appears only as grey timeline text and an action-bar line cut to "Your tracking shows this parcel was already delivered, so…". The buyer's bar reads "Confirm arrival" over a "Confirm delivery" button, and the key line is truncated: "The seller's tracking shows delivered. Support is checking it,…".
- **Suggested fix:** Use a warning status card for both parties. Seller: "Support is checking this tracking number. It shows a delivery before you posted. The buyer's inspection won't start until we've checked." Buyer: "Support is checking the seller's tracking. You can still report a problem." Let the action-bar subline wrap to two lines instead of truncating.

---

## P2: clutter, too much text, responsive breakage

### [P2] The same fact appears three to five times per state
- **Where:**
  - ESCROW_HELD: `cancel.refused-after-payment` step 6, `payments.bank-eps` step 8, `payments.bank-payto` step 8. The header shows "Payment held by Stripe" + "Funds confirmed"; the chat header shows "Funds confirmed" + "Payment held"; the timeline card shows "Payment held / Payment confirmed. The seller can now ship the item."
  - INSPECTION: `delivery.lifecycle` step 12. A banner says "Check what you received, then accept it or raise a dispute by Thu, 3 Dec … If you do nothing, the sale completes on its own and the seller is paid." The status card says "Complete to release the funds, or dispute. Completes on its own at the deadline." The timeline says "Auto-completes after 7 days unless the buyer acts."
  - Tracking: `delivery.lifecycle` step 8. The number appears three times, alongside "Track parcel" (button), "Track parcel" (link) and "Track".
- **Suggested fix:** Give each fact one owner. The header holds one state chip ("Paid · held by NoDitto"). The status card holds the explanation and the action. The timeline holds dated events only, with no rules restated. Drop the duplicate chip from the chat-pane header (`ContractChat`), and keep the tracking number only on the status card.
- **Mobbin:** [DoorDash pickup](https://mobbin.com/screens/7f63b1c6-3693-403b-9762-9fb347ff7618?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) shows one status title, one tracker, one sentence and the action directly under it.

### [P2] The status card describes an action whose button is in the chat footer
- **Where:** `buy-now.reserves-single` step 4 ("Set handover terms / Choose shipping or a meet-up…"). `delivery.lifecycle` step 12 ("Accept the item, or report a problem", which offers only "Track parcel"). `multiple-items.line-items` step 7 ("Pay to lock in the deal"). All on desktop.
- **What's wrong:** On desktop the eye lands on the status card, which has no button. The real action ("Set delivery details", "Complete purchase", "Accept terms and pay") sits 400 px away in the chat pane's footer bar. "Report a problem" is only in the ⋮ menu.
- **Suggested fix:** Put the primary action (and, during inspection, a secondary "Report a problem") on the status card on desktop. Keep the chat-footer bar only on the phone, where the status card isn't visible.
- **Mobbin:** [X Card tracking](https://mobbin.com/screens/485ba275-39a1-4d3f-8e1c-b99c798ddd01?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) places "I Received My Card" directly under the stepper it completes.

### [P2] Action names change between the label, the button and the status copy
- **Where:**
  - "Handover terms" bar → "Set delivery details" button, even though the tab offers "Ship the item" or "Meet face to face" (`cancel.refused-after-payment` step 4)
  - "Accept or report" → "Complete purchase" → "release the funds" (`delivery.lifecycle` step 12)
  - "Confirm arrival" → "Confirm delivery" (`flagged` step 13)
  - "Confirm handover" label next to a "Confirm handover" button (`handover-too-early` step 9)
  - "Keep reviewing" (card) vs "Keep as is" (EPS)
- **Suggested fix:** Use one verb per step: "Set handover" / "Pay" / "Confirm handover" / "Accept item" / "Report a problem". Make the bar label a state ("Waiting for you"), never a copy of the button.

### [P2] Provider names and internal states appear as status chips
- **Where:** "Stripe pending" (`payments.bank-payto` step 5, `payment.unfinished-abandoned` step 7). "Stripe failed" (`card-3ds-failed` step 5). "Payment held by Stripe" vs "the funds are held by NoDitto" (`multiple-items.line-items` step 7). "Stripe method" under the saved card in the Pay dialog. "fulfillment terms" in every timeline.
- **Suggested fix:** Use "Waiting for your bank", "Payment failed", "Paid · held by NoDitto", "Saved card", and "handover terms" (Australian spelling, member vocabulary).

### [P2] An abandoned 3-D Secure check doesn't say what is pending or when it lapses
- **Where:** `payment.unfinished-abandoned` steps 6–7, desktop and phone (`…/unfinished-abandoned/desktop/…/step-07.buyer.png`).
- **What's wrong:** The status card still reads "Pay to lock in the deal / Pay now. Your payment method is charged and the funds are held by NoDitto." The only cue is the chip "Stripe pending" and a "Complete payment" button.
- **Suggested fix:** Use the status card "Finish your bank's security check / Nothing has been charged yet. If you don't finish by 1:18 pm, we'll cancel it and you can pay again." Keep the "Complete payment" button.

### [P2] Disabling too late: Confirm handover is enabled three days before the meeting
- **Where:** `in-person.handover-too-early` steps 8–9, desktop and phone (`…/handover-too-early/phone/…/step-09.seller.png`).
- **What's wrong:** Pressing "Confirm handover" gives the toast "You can confirm the handover from an hour before the meeting." The toast covers the composer on the phone. The status card doesn't show the meeting time.
- **Suggested fix:** Disable the button with the inline subline "Opens at 11:00 am, Sun 29 Nov (an hour before you meet)". Show the meeting place and time on the status card.

### [P2] The phone header overflows: badges clip and the info icon collides
- **Where:**
  - `cancel.refused-after-payment` step 6, phone: "Payment h" is cut off
  - `bank-eps` step 8, phone: "Payment" is clipped
  - `delivery.lifecycle` step 8, phone: (i) overlaps "Payment held"
  - `buy-now.reserves-single` step 4, phone: the counterparty chip runs off-screen
  - `seller-not-payable` step 6: "[E…"
- **What's wrong:** One 390 pt row has to hold the title, price, state chip, "Payment held" badge, counterparty and (i).
- **Suggested fix:** On phones, the contract header (`ContractHeader` in `components/contract/`) keeps title + price on row 1 and one chip on row 2. Drop the "Payment held" badge, which the chip already implies, and move the counterparty into the (i) sheet.

### [P2] The inspection banner sits above the phone header and pushes the room down
- **Where:** `in-person.handover-24h` step 12, buyer, phone (`…/handover-24h/phone/…/step-12.buyer.png`). `inspection.auto-complete` step 10, seller, phone. `delivery.lifecycle` step 12, desktop.
- **What's wrong:** On the phone the banner is about 430 px (four lines) above the back button and title. On desktop it appears only in INSPECTION and moves the whole room down by about 100 px compared with the previous state. This is the "layout jumps when data arrives" pattern the product rules forbid.
- **Suggested fix:** Fold the countdown into the status card ("Inspect by Fri 27 Nov, 1:01 pm · 1 day left") and into the phone action-bar subline. Drop the separate banner, or reserve its slot in every state.

### [P2] Truncated lines cut the money reassurance
- **Where:**
  - `buy-now.no-card` step 3, phone: "Stripe keeps it on file. Nothing is charged u…"
  - `payments.region-mismatch` step 3 and `related-accounts` step 4, desktop: "Buyer protection fee 6%, the rate for a card issued out…"
  - `delivery.lifecycle` step 8: "[E2…"
- **Suggested fix:** Let these sublines wrap (remove `truncate` / `line-clamp-1` in the Buy dialog's card row and the action-bar subline). Shorten them: "Nothing is charged until you pay." and "5% fee: card issued outside Australia."

### [P2] The fee rate is shown inconsistently and sometimes not at all
- **Where:**
  - Buy dialog (`buy-now.no-card` step 3): "$45.00 AUD + $1.35 AUD buyer protection fee", with no rate
  - Pay dialog: rate shown as an orphaned "3%" on its own line under "Buyer protection fee (Card)"
  - Payment tab after paying (`bank-payto` step 8, `delivery.lifecycle` step 17): "Buyer protection fee $3.75 AUD", with no rate
- **What's wrong:** The product rule is that the fee is shown as an exact rate wherever it appears.
- **Suggested fix:** Use one format everywhere: "Buyer protection fee (3%)  $1.35 AUD", from `processingFeeRateLabel` in `ContractDetailList` / the Buy dialog.

### [P2] "Lowest fee" tags both options when they cost the same
- **Where:** `payments.bank-eps` step 5, desktop (`…/bank-eps/desktop/…/step-05.buyer.png`). Both Card and EPS show "Lowest fee" at €154.50 EUR.
- **Suggested fix:** Show the tag only when one option is strictly cheaper. If you keep a tag, show the saving ("Save $2.22 AUD", from `cancel.refused-after-payment`).

### [P2] Cancelled and completed contracts read the same
- **Where:** `cancel.in-agreement` step 5, seller, desktop (`…/cancel.in-agreement/desktop/…/step-05.seller.png`).
- **What's wrong:** A cancelled sale shows "This contract is finished", the same card as a completed sale. The footer reads "Cancelled here (i)". Nothing says that no money moved or that the card is back on sale.
- **Suggested fix:** Use "Cancelled before payment / No money moved. Your card is back on sale." and add "View listing".

### [P2] Seller payout state gives no date or reason during the holdback
- **Where:** `delivery.lifecycle` step 17, seller, desktop and phone (`…/delivery.lifecycle/desktop/…/step-17.seller.png`).
- **What's wrong:** The tab reads "Queued for release to your payout account. View payouts" while the payout is held by the new-seller holdback. The seller can't tell whether something is wrong.
- **Suggested fix:** Use "Releases on Thu 3 Dec. New sellers' first payouts wait 7 days after payment." The paid state ("Sent to your payout account. It can take up to four business days to appear.") is good; keep it.

### [P2] On a listing with multiple items, the Items tab buries the lines under a full-size photo
- **Where:** `multiple-items.line-items` step 8, phone (`…/phone/…/step-08.buyer.png`), and step 12, desktop.
- **What's wrong:** The Items tab opens with a 1,000 px listing photo and a huge "$55.00 AUD". The contract lines (what the buyer is actually buying) are below the fold on both viewports. On the phone, "Prot" is clipped in the tab strip next to "Edit". The Status tab in AGREEMENT (step 4) shows only "Set handover terms", not the lines the buyer just wrote.
- **Suggested fix:** On a multiple-items contract, render `ContractLineItems` first, with a 64 px thumbnail. On Status, summarise "2 lines · $55.00 AUD · Edit". Make the tab strip scroll horizontally with a fade on the edge.

### [P2] Phone: three stacked bars and an empty chat take most of the screen
- **Where:** All phone room screens, e.g. `buy-now.reserves-single` step 4 and `inspection.auto-complete` step 10 ("Awaiting acceptance (i)", a bar with no subline and no button).
- **What's wrong:** The action bar, the composer and the bottom nav together take about 560 of 1992 px. The area above them is mostly white.
- **Suggested fix:** Hide the bottom nav inside a contract room (it is a full-screen task with its own back button). Collapse the action bar to one 56 pt row when it has no button.

---

## P3: polish

### [P3] The rail highlights "Sales" for a buyer
- **Where:** Every buyer room screen on desktop (e.g. `delivery.lifecycle` step 12, `bank-payto` step 8). The rail heading reads "Purchase", but "Sales" is the active item.
- **Suggested fix:** Highlight "Purchases" when the viewer is the buyer.

### [P3] The step count and step names shift between states and methods
- **Where:** "Step 1 of 4 · Discuss terms" becomes "Step 2 of 5 · Payment" once shipping is chosen (`cancel.refused-after-payment` steps 4–5). An in-person sale is labelled "Step 3 of 4 · Delivery" while the chip says "Handover" (`handover-24h` step 9). "Step 4 of 5 · Received" appears while the chip says "In transit" (`delivery.lifecycle` step 8).
- **Suggested fix:** Show the method-agnostic 4-step rail from the start (Agree · Pay · Hand over · Inspect). Name each step for the current activity, and drop the duplicate "Step N of M" text where the stepper is visible.

### [P3] The timeline addresses the viewer in the third person
- **Where:** To the buyer: "The buyer has 24 hours to check the item…" (`handover-24h` step 12) and "The buyer can report a problem at any time." (`flagged` step 13). To the seller: "The seller can now complete the agreed in-person handover." (`handover-24h` step 9).
- **Suggested fix:** Render role-aware event copy ("You have 24 hours…", "You can now meet the buyer.") in the timeline.

### [P3] Timeline cards keep future-tense rules after the fact
- **Where:** `delivery.lifecycle` step 21 and `inspection.auto-complete` step 14. The Delivered card still says "Auto-completes after 7 days unless the buyer acts." after completion. The completion line reads "Inspection window of 7 days expired after carrier-confirmed delivery." (capital "I" mid-sentence, system phrasing).
- **Suggested fix:** Keep timeline copy to past-tense facts: "Delivered (carrier confirmed)" and "Completed automatically after 7 days". Also write "free shipping" instead of "shipping for 0.00 AUD", and when an amount is shown, use `formatMoney` ("$0.00 AUD").

### [P3] The disabled "Handover confirmed" looks like a success button, and the bar label wraps
- **Where:** `in-person.handover-24h` step 9, seller, desktop. The muted green "Handover confirmed" button sits next to "Confirm handover (i)", with (i) wrapped onto its own line. "Pay to lock it in (i)" wraps the same way at 1280 (`handover-24h` step 4, `multiple-items` step 7).
- **Suggested fix:** Replace the disabled button with a check and the text "You confirmed · waiting for the buyer". Give the bar label `whitespace-nowrap` and a shorter text ("Pay to lock in").

### [P3] The empty map embed on an in-person sale
- **Where:** `in-person.handover-24h` step 4, desktop (`…/handover-24h/desktop/…/step-04.buyer.png`). A 260 px grey box sits above "12 Test Street… Open". The address is shown three times.
- **Suggested fix:** Use a fixed-height Static Maps image (or none), and show the address once, with "Open in Maps". This may be a test-environment key issue, but the reserved space is large even when the map loads.

### [P3] "Nothing in this listing is held" is in the smallest text, below the fold
- **Where:** `multiple-items.line-items` step 3, desktop (`…/multiple-items.line-items/desktop/…/step-03.buyer.png`). The 12 px grey footnote at y≈660 is cut by the 720 fold. The price "from $20 AUD" has no decimals.
- **Suggested fix:** Put "Nothing is held. Each buyer agrees their own cards with the seller." directly under the "Multiple items" label beside the price. Render the price as "from $20.00 AUD".

### [P3] The Complete purchase sheet repeats the photo advice and omits the consequence
- **Where:** `delivery.lifecycle` step 13, phone (`…/phone/…/step-13.buyer.png`). "We recommend photographing or filming what you received. This becomes your baseline evidence…" is followed by "Recommended — it is your evidence if there is a dispute later."
- **Suggested fix:** Use one line, "Add a photo first. It's your evidence if something's wrong.", and add the consequence above the button: "This pays $45.00 AUD to the seller and ends buyer protection for this sale."

### [P3] The Buy dialog repeats the listing and reuses "holds"
- **Where:** `buy-now.no-card` step 3, desktop and phone. "Reserving holds it for you and opens a contract with the seller. You do not pay yet." The phrase "How holds and disputes work" appears in the Pay dialog. Collateral elsewhere is a "temporary card hold", so "hold" now means three things.
- **Suggested fix:** Use "Reserve this card. You'll agree delivery with the seller, then pay." and rename the link "How buyer protection works".

---

## Responsive notes

**Desktop at 1280×720**
- The room is a 3-column layout: a 256 px rail, a ~590 px status pane and a ~390 px chat pane. Content sits at 13–14 px in the panes and 11–12 px in the timeline. The status pane is mostly empty below a 100 px card, while the chat pane is crowded and its header truncates the counterparty ("[E2…").
- Suggestions:
  - Below 1366 px wide, collapse the rail to icons (64 px). That gives the status pane about 190 px.
  - Move the primary action onto the status card.
  - Raise timeline text from 12 px to 13 px with 1.45 line height.
- Dialogs are 576 px wide and grow with content. At 720 px tall, the Pay dialog's primary button lands at y≈690 and is clipped. Suggestions:
  - Cap dialogs at `max-h-[calc(100dvh-48px)]`, with a scrolling body and a sticky footer.
  - Below 760 px tall, drop the intro paragraph to one line and use 40 px option rows instead of 76 px.
- Toasts appear bottom-right at about 360 px wide and repeatedly cover the chat pane's action button. Anchor error toasts top-centre in contract rooms, or better, replace them with inline states (see the P1 refusal findings).

**Phone at 390 pt**
- Body type renders at about 17 pt (51 px at 3x) and headers at about 22 pt. That is readable, but too big for the header row, which holds a 22 pt title, a 17 pt price and two 17 pt badges. Suggestions:
  - Set the header title to 17 pt semibold with one-line truncation.
  - Put price and chip on row 2 at 15 pt.
  - Drop the second badge.
- Action-bar sublines are clamped to one line. Allow two lines at 15 pt, because these lines carry the money and deadline information.
- The tab strip in the details sheet (Status · Items · Delivery · Payment · Protection · History) overflows at 390 pt and clips "Histor" and "Prot" with no scroll cue. Add `overflow-x-auto` with an edge fade, or shorten the labels ("Pay", "Cover").
- Bottom sheets use about 70–85% of the height but never pin their primary button. Every sheet with a money action should pin "Pay $X AUD" in a 72 pt footer with safe-area padding.
- Inside a contract room, hide the 5-tab bottom nav. Together with the action bar and composer it takes about 190 pt of an 844 pt screen.
- Floating elements (the Stripe test-mode badge in `bank-payto` step 5, and the "99+" badge covering the Account icon) collide with full-width buttons. Keep a 16 pt clear zone above the safe area for floating UI, and cap nav badges at "9+".
