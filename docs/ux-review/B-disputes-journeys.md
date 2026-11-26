# UX review B: cash-sale disputes, returns and the two journeys

Source: `docs/ux-review/inputs/B-cash-sale-disputes-journeys.txt`. 70 screenshots opened, covering all 9 test-ids on both viewports (desktop 1280x720, phone 390 wide at 3x). Paths below are relative to `C:\dev\Marketplace\audit-artifacts\` and every run folder is `2026-11-26T01-42-49Z-g4ea9pj`, shortened to `…`. Some screenshots have black redaction boxes. Findings only cover what is visible around them.

**Summary of themes**
1. Money outcomes are never stated. Refunded and chargeback-held contracts show no amount, no destination and nothing about the buyer protection fee, and the seller never sees that a payout is on hold.
2. Contract-room copy drifts from the product rules: "Trades have no fee", "about seven days" authorisations, a fixed "Up to $20.00 AUD" condition outcome, "about 1%", "Payment held by Stripe".
3. The return flow shows the wrong content in some places: a raw ISO timestamp, an outbound tracking card inside "Post the item back", an "Inspection window" card on the seller's return tab, and a misleading duplicate-tracking error.
4. The stepper and the action bar are not consistent. Step counts change between 3, 4, 5, 6 and 8 for one contract, steps 7 and 8 have no labels, labels truncate ("Meet and…", "Waiting on accepta…"), and buttons clip at the right edge.
5. Stale or repeated text fills the timeline and chat: "Auto-completes after 7 days" stays up after a dispute or refund, the composer still says "Message about the handover…" on finished contracts, and a face-to-face trade is told to "coordinate shipping".

---

## Findings

### [P1] Raw ISO timestamp in the return deadline event
- **Where:** cash-sale-disputes.return-and-refund step 9/10/15, lapsed-return step 11, seller-contest step 10/11/13, both viewports. For example `cash-sale-disputes.return-and-refund\phone\…\step-09.seller.png`, `cash-sale-disputes.return-and-refund\desktop\…\step-09.seller.png`.
- **What's wrong:** "Refund approved. Buyer must dispatch the return by 2026-12-03T01:55:13.595Z." This is the most important date in the return flow, and it is shown as a UTC machine string. Every other date on the page uses "Thu, 3 Dec, 12:55 pm AEDT".
- **Suggested fix:** Format the date the same way as the rest of the room: "Refund approved once the card is back. Post it by Thu, 3 Dec, 12:55 pm AEDT." The event copy is built in the cash-sale event text (`domain/orchestrator/cashSaleEvents.ts` or its display mapper). Pass the date through the shared date formatter instead of interpolating the ISO value.

### [P1] Refunded contracts never say how much was refunded or where it went
- **Where:** return-and-refund step 15 (`…return-and-refund\desktop\…\step-15.buyer.png`, `…\phone\…\step-15.buyer.png`), early-fraud-warning step 6 (`…early-fraud-warning\desktop\…\step-06.seller.png`, `…\phone\…\step-06.seller.png`).
- **What's wrong:** The action bar reads "Refunded here" next to an (i), and the Status card reads "This contract is finished". Neither shows an amount. The buyer paid "$56.65 AUD total", which includes the buyer protection fee, and nothing says whether the A$56.65 or the A$55.00 came back, or to which card. On the phone, early-fraud step 6 has an empty body under the header ("Step 3 of 5 · Refunded") with nothing in it except "Refunded here". "Refunded here" also doesn't make sense as a phrase.
- **Suggested fix:** Put a refund summary card at the top of Status: "Refunded A$56.65 AUD to Visa •••• 4242 · Thu, 26 Nov. Banks usually show it within 5–10 business days." Add a line for the seller: "The buyer was refunded. Your card is back in your listings." Rename the action-bar label to "Refunded". For an early fraud warning, add one neutral line: "This payment was cancelled and refunded before shipping."
- **Mobbin:** [Trainline refund overview](https://mobbin.com/screens/1650f9a6-33ae-482f-8f8e-378c7dea3ac8?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) lists the ticket price, refundable amount, admin charge and total refund, then says where the money goes. [talabat order cancelled](https://mobbin.com/screens/a02eeba5-8d85-4d80-866f-0050e2fb63c3?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) gives refund amount, status and "Refund to" as three rows.

### [P1] The seller can't see the chargeback payout hold
- **Where:** cash-sale-disputes.chargeback-won step 7 and step 9, seller (`…chargeback-won\desktop\…\step-07.seller.png`, `…\step-09.seller.png`, `…\phone\…\step-07.seller.png`).
- **What's wrong:** The test asserts the hold reason is CHARGE_DISPUTE, but the seller's room is the same before and after: "In transit", "Payment held by Stripe", "Waiting for … to confirm it arrived". The seller can't tell that their payout is frozen by a card dispute, or when it cleared. The phone capture for step 9 is the same file as step 7, so the "cleared" state was never captured on phone.
- **Suggested fix:** Add a payout status row to the Payment tab and a timeline event: "Payout on hold: the buyer's bank opened a card dispute. We're responding with the contract record. Nothing for you to do." When the dispute is won: "Card dispute closed in your favour. Payout released." Re-capture phone step 9.

### [P1] "Trades have no fee" contradicts the 2% Trade_Fee
- **Where:** journeys.trade-lifecycle step 7 (`…trade-lifecycle\desktop\…\step-07.counterpart.png`, `…\phone\…\step-07.counterpart.png`).
- **What's wrong:** The dialog says it three times: "Trades have no fee." in the lead paragraph, "NoDitto fee $0.00 AUD" as a row, and "Trades have no NoDitto fee. The collateral is a card hold, which costs nothing." under it. The product decision of 2026-11-27 sets the fee at 2% of the value received (A$2.40 AUD here). If this build has that rule, the dialog is wrong about money. If the fee is waived, the dialog should name the rule, not "no fee". The test step title ("no fee") is out of date in the same way.
- **Suggested fix:** Show one row: "Trade fee (2% of what you receive) A$2.40 AUD · charged when both holds are in place, refunded if the swap doesn't happen." Delete the other two mentions. Update the e2e step name to match.

### [P1] Collateral copy contradicts the authorisation budget and the dispute rules
- **Where:** trade-lifecycle step 11/12/19, Collateral tab, desktop (`…trade-lifecycle\desktop\…\step-11.counterpart.png`, `…\step-19.counterpart.png`).
- **What's wrong:** "Authorisations expire about seven days after they are placed". The authorisation budget is 114 hours (about 4¾ days), so "about seven" tells a trader they have more time than they do. The "How it ends" table says "A condition dispute: Up to $20.00 AUD. Covers the other trader's return postage." Since ESC-01, staff choose compensation for a condition dispute, up to what the collateral covers. A fixed A$20.00 figure for return postage tells members both how much is at risk and who pays postage, and both are wrong. The footnote is also cut off at 720 px ("so the trade has to finish before then" falls off the bottom).
- **Suggested fix:** "Card holds last about 4 days, so the trade has to finish before then." Condition row: "A condition dispute: Staff decide, up to your full collateral." Or keep a number only if it is the real cap. Move the expiry note above the table so it stays visible at 720 px.

### [P1] The Pay dialog's lead sentence names the card even when PayTo is selected, and the button looks disabled
- **Where:** journeys.cash-sale-lifecycle step 7 (`…cash-sale-lifecycle\desktop\…\step-07.buyer.png`, `…\phone\…\step-07.buyer.png`), chargeback-won step 4.
- **What's wrong:** "This charges $154.50 AUD to your card through Stripe and …" stays as it is when the PayTo option (A$153.75) is chosen, so the total in the lead and the total on the button can disagree. On desktop the primary button "Accept terms and pay $154.50 AUD" is mid-grey and reads as disabled. On the phone the dialog is about 1.6 screens tall: the "How holds and disputes work" link is cut off at the fold and the Pay button is not visible without scrolling. "Buyer protection fee (Card)" puts "3%" on its own line under the label.
- **Suggested fix:** Generate the lead from the selected rail: "You pay A$153.75 AUD by PayTo. NoDitto holds it until you accept the card." Use the solid primary colour for the pay button as soon as a rail is selected. On the phone, make the sheet footer (total and Pay button) sticky and shorten each option's description to one line ("Saved card", "Approve in your banking app"). Put the rate inline in the label: "Buyer protection fee (card, 3%)".

### [P1] "Post the item back" shows the outbound parcel as delivered
- **Where:** lapsed-return step 7, buyer, desktop (`…lapsed-return\desktop\…\step-07.buyer.png`).
- **What's wrong:** The return instruction card says "Add the return carrier and tracking number once you have posted it.", then shows the seller's outbound "Australia Post · ND1795…AU · Track parcel · Delivered Thu, 26 Nov, … confirmed by the carrier." A buyer can easily take that as the return already being delivered. The card has no "Add return tracking" button, and the action bar only offers "View return".
- **Suggested fix:** In return states, remove the outbound tracking block from the card. Show the return address, the deadline, and a primary "Add return tracking" button inside the card. Put the outbound parcel under the Delivery tab.

### [P1] A lapsed return looks like a fresh dispute and the stepper drops from 8 steps to 3
- **Where:** lapsed-return step 11, buyer (`…lapsed-return\desktop\…\step-11.buyer.png`, `…\phone\…\step-11.buyer.png`).
- **What's wrong:** On desktop, after the return deadline passed, the buyer sees "Dispute under review. You raised a dispute on Thu, 26 Nov … Funds are held." with "Step 3 of 3 · Review". The phone at the same step still shows "Return required · Step 6 of 8 · Return" and "Post it back". The two viewports tell the buyer different things, and neither says the return deadline passed or what that means for the refund.
- **Suggested fix:** Add a specific lapsed state: "You didn't post the card back by Thu, 3 Dec. Our team is reviewing the case. Your refund isn't cancelled, but it will take longer." Keep the 8-step rail with "Return" marked as overdue (amber) instead of collapsing it.

### [P1] The seller's Return tab shows the buyer's "Inspection window" card
- **Where:** return-and-refund step 9, seller (`…return-and-refund\desktop\…\step-09.seller.png`, `…\phone\…\step-10.seller.png`).
- **What's wrong:** Under "Return needed before the refund" the seller sees "Inspection window · 7 days left. Nothing is needed from you until Thu, 3 Dec … If they miss it, our team reviews the case. Nothing is paid out to either side on a timer." This is the inspection component reused for the buyer's posting deadline. The heading is wrong for a seller, and "Nothing is needed from you" sits right under a request to "Give them a return address". The address is already shown on the line below it, so the request is already done.
- **Suggested fix:** Use a return-specific card: "Buyer posts by Thu, 3 Dec, 12:55 pm AEDT · 7 days left. Once the carrier delivers it, you have 3 days to check it before the refund is released." Hide "Give them a return address" once an address exists.

### [P1] Duplicate-tracking error is misleading and the toast covers the field
- **Where:** cash-sale-disputes.return-tracking-refused-outbound step 10 (`…return-tracking-refused-outbound\desktop\…\step-10.buyer.png`, `…\phone\…\step-10.buyer.png`).
- **What's wrong:** "That tracking number is already on another contract. Check it and try again." The number is this contract's own outbound parcel, so "another contract" is false and the buyer won't understand what went wrong. On the phone the toast sits on top of the tracking input inside the sheet. On desktop it appears bottom-right, away from the field. The helper text "If it already shows delivered, support confirms the delivery before the buyer's inspection starts" belongs to the seller's shipment dialog. It doesn't make sense to a buyer posting a return.
- **Suggested fix:** Show the error inline under the field: "That's the number the seller sent the card with. Enter the number from your return parcel." Use a return-specific helper: "Use a tracked service. The refund starts when the carrier confirms delivery to the seller." (`RecordShipmentDialog` needs a return variant of its copy.)

### [P1] "Payment held by Stripe" mislabels who holds the money
- **Where:** Every contract-room header from payment onward, for example `…cash-sale-lifecycle\desktop\…\step-09.seller.png`, `…raise-and-withdraw\desktop\…\step-06.buyer.png`. Trades show "Holds placed with Stripe".
- **What's wrong:** NoDitto collects the payment into its platform balance and releases it by transfer. Stripe states that it doesn't provide escrow. "Held by Stripe" suggests Stripe is the custodian and the guarantor. The header also shows "Payment held" (pill) and "Funds confirmed" (status badge) next to each other, so the same fact appears twice.
- **Suggested fix:** Use one pill: "Payment held by NoDitto" (payments processed by Stripe can go behind the (i)). For trades: "Card holds placed" with no provider name. Remove "Funds confirmed" as a status label. "Paid · waiting to ship" covers it.

### [P2] The listing headline rounds the price and the fee note says "about 1%"
- **Where:** journeys.cash-sale-lifecycle step 1, seller (`…cash-sale-lifecycle\desktop\…\step-01.seller.png`, `…\phone\…\step-01.seller.png`).
- **What's wrong:** The headline reads "$155 AUD", but the box beneath says "Buyers pay $154.50 AUD". The rounded headline and the exact figure disagree by 50 cents. The note reads "mostly Stripe's costs, with NoDitto keeping about 1% on larger sales, less on small ones." The fee rules say NoDitto keeps about 2%, so one of the two is wrong. The note also takes three lines under the totals and pushes the actions down.
- **Suggested fix:** Show the exact figure in the headline ("$154.50 AUD", or "$150.00 AUD + 3% buyer protection fee"). Shorten the note to one line with an (i): "Includes the 3% buyer protection fee (i)". Put the Stripe/NoDitto split in the tooltip and correct the share.

### [P2] Step counts and step labels change on the same contract
- **Where:** cash-sale-lifecycle step 3 ("Step 1 of 4") vs step 6 ("Step 2 of 5"). trade-lifecycle step 3 ("Step 1 of 4 · Holds") vs step 4 ("Step 1 of 5 · Holds"). raise-and-withdraw step 6 ("Step 3 of 3 · Review", where the delivery steps disappear). return flows ("Step 6 of 8", "Step 7 of 8", then "Step 4 of 5 · Refunded" or "Step 6 of 6"). Example `…return-and-refund\desktop\…\step-15.buyer.png`.
- **What's wrong:** The total changes as states change, so "where am I" resets. On the refunded desktop screen, step 4 is "Refunded" with a red ✕ while step 5 "Inspect" still shows as pending after the contract ended. Steps 7 and 8 on desktop return rails are numbered circles with no labels (`…seller-contest\desktop\…\step-11.seller.png`).
- **Suggested fix:** Fix the rail when the contract opens (Discuss terms → Payment → Delivery → Received → Inspect). Add Return and Refund only when a return is ordered, and label every step. Show a dispute as a red marker on the current step, not as a new 3-step rail. Grey out steps after a terminal state, or remove them.

### [P2] Action-bar labels truncate and buttons clip at 1280 and on the phone
- **Where:** trade-lifecycle step 13 desktop: "Report fra" cut off at the right edge, "Meet and…" (`…trade-lifecycle\desktop\…\step-13.proposer.png`, `…\step-11.counterpart.png`). Phone step 11: "Meet and…", step 16: "Waiting on accepta…" (`…trade-lifecycle\phone\…\step-16.proposer.png`). cash-sale step 6 desktop: "Pay to lock it in" wraps over two lines.
- **What's wrong:** The action bar puts a label and up to three buttons into a column about 390 px wide on desktop. The status label gets squeezed, and the third button overflows the panel.
- **Suggested fix:** Put the label on its own line above the buttons when there are two or more buttons. Limit the bar to one primary and one secondary button, and move "Report fraud" into the ⋮ menu or into the dispute sheet as a reason. Short labels: "Meet and swap", "Waiting for them".

### [P2] Stale "Auto-completes after 7 days" stays after a dispute, return or completion
- **Where:** Timeline "Delivered" card on lapsed-return step 7, return-and-refund step 9/15, seller-contest step 13, cash-sale-lifecycle step 14/18, both viewports.
- **What's wrong:** "Carrier confirmed delivery. Auto-completes after 7 days unless the buyer acts." It still shows on disputed, returned and completed contracts. Timeline entries should record what happened, and a note about the future goes out of date and conflicts with the current status.
- **Suggested fix:** Use past tense: "Carrier confirmed delivery. Buyer's 7-day check started." Keep the countdown in the inspection banner only.

### [P2] One inspection fact is stated in three places, and the phone banner sits above the header
- **Where:** cash-sale-lifecycle step 13 (`…\desktop\…\step-13.buyer.png`, `…\phone\…\step-13.buyer.png`). trade-lifecycle step 15/16.
- **What's wrong:** The banner ("Check what you received, then accept it or raise a dispute by Thu, 3 Dec … If you do nothing, the sale completes on its own and the seller is paid."), the timeline ("Auto-completes after 7 days…") and the action bar ("Accept or report") all say the same thing. On the phone the banner renders above the contract header and pushes the title and back button about 470 px down the screen. On desktop, "Complete purchase" is a muted grey button, so the key decision doesn't stand out.
- **Suggested fix:** Keep the banner to one line on the phone ("7 days to check it · until Thu, 3 Dec") and place it under the header. Use solid primary for "Complete purchase", with "Report a problem" as the secondary button.

### [P2] Seller and buyer see different labels for one return state
- **Where:** seller-contest step 10/11/13 (`…seller-contest\desktop\…\step-11.seller.png`, `…\step-13.seller.png`, `…\phone\…\step-11.seller.png`).
- **What's wrong:** The buyer's bar reads "Return being checked". The seller's reads "Check the return", and after contesting it still shows "Check the return" with a primary "View return", while the tab says "Return under review … no money moves until they decide." The header pill stays "Return in transit" after the parcel has been delivered and contested.
- **Suggested fix:** Use one state name: "Return under review". Add "Delivered back, under review" as a header pill. After a contest, the seller's bar reads "Our team is reviewing" with no primary button.

### [P2] The staff "Case closed" screen blames another arbitrator right after their own action
- **Where:** lapsed-return step 8 and return-and-refund step 8, staff (`…return-and-refund\desktop\…\step-08.staff.png`, `…\phone\…\step-08.staff.png`).
- **What's wrong:** "This case is no longer open. It may have been resolved by another arbitrator." It appears straight after this staff member ordered the return, so they can't confirm their decision was recorded. On the phone the page has no header, no back control and no case summary.
- **Suggested fix:** After a staff member resolves a case, show "Return ordered. Buyer has until Thu, 3 Dec to post it." with a link to the contract. Keep the "another arbitrator" text only for when someone else closed it.
- **Mobbin:** [Square Disputes](https://mobbin.com/screens/7572c6dc-158d-4c88-befa-48bf17c14595?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) splits cases into Needs response / In review / Resolved tabs, so a case that just closed stays findable under Resolved instead of disappearing.

### [P2] "Collateral pending" has a label but no next action
- **Where:** trade-lifecycle step 8/9 (`…trade-lifecycle\desktop\…\step-08.counterpart.png`, `…\step-09.proposer.png`).
- **What's wrong:** The action bar shows "Post collateral" (i) above a card row with "Replace", and no button. A member reads "Post collateral" as something they have to do, but the hold is placed automatically about 24 hours before the meeting.
- **Suggested fix:** "Card hold of A$120.00 AUD goes on Wed, 25 Nov, 2:30 pm (24 hours before you meet)." Make "Replace card" the only control.

### [P2] Desktop trade exchange cards wrap the currency and squeeze the names
- **Where:** trade-lifecycle step 4/5/8/13 desktop (`…trade-lifecycle\desktop\…\step-04.proposer.png`).
- **What's wrong:** The "You receive" card wraps "$120.00 / AUD" onto two lines while "You send" stays on one, because the right card is narrower once the arrow button sits between them. Item titles truncate to "[E2E] J…". The trader line starts with a stray separator: "· New to NoDitto".
- **Suggested fix:** Use `whitespace-nowrap` on the amount and set the value at `text-xl` instead of `text-2xl` below 1440. Stack the two cards vertically under 900 px of content width. Drop the leading "·" when it's the first item on the line.

### [P2] Chat placeholders don't match the contract state
- **Where:** All contract rooms, for example `…return-and-refund\phone\…\step-15.buyer.png`, `…trade-lifecycle\desktop\…\step-03.proposer.png`.
- **What's wrong:** "Message about the handover…" appears on refunded, returned and finished contracts. A face-to-face trade with an empty chat says "Use chat to coordinate shipping and receipt."
- **Suggested fix:** Make the placeholder depend on state: "Message [name]…" by default, "Ask about the return…" in return states. Trade empty state: "Agree on a meeting spot and time here."

### [P2] Phone header pills overflow off the screen
- **Where:** Phone contract headers, for example `…lapsed-return\phone\…\step-11.buyer.png` ("Payment he"), `…trade-lifecycle\phone\…\step-11.counterpart.png` ("Holds pla"), `…early-fraud-warning\phone\…\step-06.seller.png` ("[E2E] ef…").
- **What's wrong:** Price, status pill, "Payment held" pill and the (i) all sit on one row. The second pill clips at the screen edge and runs under the (i) and ⋮ icons.
- **Suggested fix:** On the phone, show only the status pill in the header and move "Payment held" into the (i) sheet. Or let the pill row wrap (`flex-wrap gap-1`), with the icons in their own column.

### [P2] The phone listing page puts the bottom nav in the middle of the content
- **Where:** journeys.cash-sale-lifecycle step 1, phone full-page (`…cash-sale-lifecycle\phone\…\step-01.seller.png`).
- **What's wrong:** In the full-page capture, the fixed nav bar appears between the price row and the seller card. In real use, that means the price sits right at the nav's top edge, and the image placeholder takes about 60% of the first screen.
- **Suggested fix:** Add bottom padding equal to the nav height plus the safe-area inset under page content. Cap the image to about 50vh on the phone so the price and buy actions show on the first screen.

### [P3] Timeline money and spelling don't follow house style
- **Where:** raise-and-withdraw step 6 phone, chargeback-won step 4/7 phone (`…chargeback-won\phone\…\step-04.buyer.png`).
- **What's wrong:** "updated the fulfillment terms — shipping for 0.00 AUD." The amount has no "$" (elsewhere it's "$0.00 AUD"), "fulfillment" is the US spelling where the house style is "fulfilment", and "shipping for 0.00" is the wrong way to say free postage.
- **Suggested fix:** "[name] chose postage: free." or "…postage A$8.00 AUD", always through `formatMoney`.

### [P3] The Delivery tab's "$0.00 AUD" has no label
- **Where:** cash-sale-lifecycle step 5/6/14 desktop (`…cash-sale-lifecycle\desktop\…\step-05.buyer.png`).
- **What's wrong:** "Delivery address" on the left and "$0.00 AUD" right-aligned on the same row. It looks like the address costs nothing.
- **Suggested fix:** Use two rows: "Postage · Free" and "Deliver to · 12 Test Street…". Fill the empty lower half of the panel with the parcel status.

### [P3] Withdraw dialog leaves a white band below the page on desktop
- **Where:** raise-and-withdraw step 8 desktop (`…raise-and-withdraw\desktop\…\step-08.buyer.png`, 1280x822).
- **What's wrong:** The capture is 822 px tall, and the bottom 100 px is unstyled white below the overlay. The page grew while the dialog was open, which breaks the rule that layout must not jump. The cancel button says "Keep as is", the same text the Pay dialog uses. Here it would be clearer as "Keep my dispute".
- **Suggested fix:** Find out what the Dispute tab mounts that adds height while the dialog is open (probably evidence panel content) and reserve its space. Button labels: "Keep dispute" / "Withdraw dispute".

### [P3] The trade map is an empty grey block
- **Where:** trade-lifecycle step 3/9 desktop (`…trade-lifecycle\desktop\…\step-03.proposer.png`).
- **What's wrong:** A 220 px grey rectangle sits above "12 Test Street… Open". The map embed didn't render, and nothing fills its space.
- **Suggested fix:** Show a static map image, or fall back to a compact address row with an "Open in Maps" link, at the same reserved height so the layout doesn't move.

### [P3] The "Funds confirmed" status sits next to "Payment held"
- **Where:** cash-sale-lifecycle step 8 desktop and phone, chargeback-won step 4 phone.
- **What's wrong:** Two pills for one state ("Funds confirmed" and "Payment held"), and the phone action bar repeats it as "Waiting on posting · The seller posts by 1 Dec 2026". That date format is different from the "Thu, 3 Dec" style used elsewhere.
- **Suggested fix:** Status "Paid · waiting to ship". Date "Seller posts by Tue, 1 Dec".

### [P3] "The bundle and cash were fixed…" on a card-for-card swap
- **Where:** trade-lifecycle step 8/13/15 desktop.
- **What's wrong:** It mentions a "bundle" and "cash" on a trade that has neither.
- **Suggested fix:** "Terms are locked. Neither of you can change them now." Mention cash only when there is a cash leg.

---

## Responsive notes

**1280x720 desktop.** The three-column layout (240 px rail, about 590 px detail, about 390 px chat) is tight at this width.
- **Chat column:** this is the main bottleneck. The action bar can't fit a label plus two or three buttons ("Report fra", "Meet and…", "Pay to lock it in" on two lines). Below 1440 px wide, either collapse the left rail to icons (64 px), which gives the chat about 560 px, or let the action bar wrap to two rows (label on top).
- **Vertical space:** at 720 px, the header card (about 100 px), the inspection banner (about 100 px) and the tab bar use about 45% of the height before any content shows. Footnotes like the collateral expiry line fall off the bottom. Make the banner one line at `text-sm`, and make the header a single 56 px row when the viewport is under 800 px tall.
- **Dialogs:** the Pay dialog (630 px) just fits. Cap all contract dialogs at `max-h-[calc(100dvh-4rem)]` with a scrolling body and a sticky footer, so the primary button is always visible.
- **Type:** amounts in the exchange cards (`text-2xl`) wrap. Use `text-xl` and `nowrap`. Timeline body text at 12 px is close to the minimum, so keep it at 13 px or larger.

**Phone (390 wide).**
- **Bottom sheets:** the Pay and trade-accept sheets are 1.5–2 screens tall, and their primary buttons are below the fold. Use a sticky footer with the total and the primary button, collapse explanatory paragraphs behind "How this works", and limit option descriptions to one line.
- **Header:** the title, price and two pills don't fit on one row. Show only the status pill and let the rest wrap or move into the (i) sheet. The truncated title "[E2E] Dispute mwwwi8j92509…" shows the title needs two lines (`line-clamp-2`) at `text-base`.
- **Space:** the composer, action bar and nav take about 560 of 1992 device px (about 190 CSS px). When the contract is terminal, hide the composer behind a "Message" button, or hide the action bar when it has no action ("Refunded here", "This contract is finished").
- **Toasts** show on top of sheets and cover inputs. Show field errors inline, and place toasts above the sheet footer.
- **Inspection banner:** it renders above the header and pushes the back button off the first screen. Keep the header pinned first and the banner second.
- **Tap targets:** the (i) icons next to action-bar labels are about 20 CSS px. Make the hit area at least 44 px.
