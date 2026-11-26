# C — Trades: UX review from e2e screenshots (1280x720 desktop, iPhone 14)

**Summary**
1. The trade room's biggest problems involve money. The Multiple items side shows "VALUE $500.00 AUD" when the trade is actually valued at A$250.00. Accept-terms copy says "Trades have no fee", which contradicts the 2% Trade_Fee in the current product rules. A cancelled trade says neither why it was cancelled nor that nothing was charged.
2. On phone, the room shows only chat and the action dock. The terms (what you give, what you get, the meeting) are never on screen when the member taps "Accept terms".
3. The accept-terms dialog repeats itself. It states the hold twice and "no fee" twice, has a $0.00 row, and includes an expiry edge case. On phone it is taller than the viewport, and error toasts land on top of it.
4. The action dock overflows horizontally in several states: the declined-hold retry panel on both viewports, and the inspection buttons on phone. Buttons and copy are cut off.
5. Wording is inconsistent between screens. Delivery and shipping copy appears on in-person-only trades, notifications say "escrow", and the step label reads "Holds" during negotiation. There are three different explanations of when the trade cash moves.

Coverage note: about 85 screenshots were requested and about 50 came back viewable. The rest were dropped by the tool's per-request image limit. Five test-ids were never seen on either viewport: `trades.collateral.locks-live-and-job-completes`, `trades.lifecycle.cash-leg-accepted`, `trade-disputes.custody-capture-after-rewind`, `trade-disputes.raise-condition-no-capture` and `trades.abandon.meeting-passed-unlocked`. The inspection, dispute and completion findings below come from the `trade-disputes.staff-unfounded` and `no-exchange` screens, which show the same room states. All paths are under `C:\dev\Marketplace\audit-artifacts\<test-id>\<viewport>\2026-11-26T01-42-49Z-g4ea9pj\`.

---

## P1

### [P1] Multiple items side shows the A$500.00 "from" price as its trade value
- **Where:** `trades.shopfront.side-valued-at-offer`, steps 8, 12 and 13, desktop (`step-08.bob.png`, `step-12.bob.png`).
- **What's wrong:** The test asserts "Bob's side is valued at Alice's A$250.00 card, not the A$500.00 'from' price". The Exchange card still shows **"You send · VALUE $500.00 AUD"** with the listing line "$500.00 AUD", next to "You receive $250.00 AUD". The page header says $250.00 AUD. A member reads this as an unequal swap, or as a A$500 hold.
- **Suggested fix:** On a Multiple items side, show the trade side value (from `resolveTradeSideValues`), not `fmv_cents`. Use "VALUE $250.00 AUD", and under it: "Valued at what you get in return. Listing price from $500.00 AUD." The Exchange card in `components/trade/…` should read the same frozen side value that sizes the collateral.

### [P1] "Trades have no fee" contradicts the 2% Trade_Fee
- **Where:** The accept-terms dialog in every test that opens it, for example `trades.agree.refused-short-reservation` step 16 on desktop and phone (`step-16.bob.png`) and `trades.cash-leg.fx-disclosure` step 6 desktop (`step-06.payer.png`). Also the Propose trade dialog, `trades.agree.refused-short-reservation` step 5 desktop (`step-05.alice.png`).
- **What's wrong:** "Trades have no fee." "NoDitto fee $0.00 AUD — Trades have no NoDitto fee." The Propose dialog says "trades have no fee". The product rules (2026-11-27) set a Trade_Fee of 2% of the value each trader receives. If that fee is live, this copy understates what is charged. If it is not live yet, the $0.00 row is noise.
- **Suggested fix:** Take the row from `tradeFee.ts`. Show it when it is above zero: "NoDitto fee (2% of what you receive) $5.00 AUD, charged when the holds are placed, refunded if the swap doesn't go ahead". When it is zero, drop the row and the sentence.

### [P1] Phone room hides the terms the member is accepting
- **Where:** Phone, every negotiating room, for example `trades.negotiate.counter-voids-acceptances` step 12 (`step-12.alice.png`), `trades.agree.refused-no-card` step 5 (`step-05.bob.png`) and `trades.shopfront.side-valued-at-offer` step 9 (`step-09.alice.png`).
- **What's wrong:** The viewport is the chat empty state ("Use chat to coordinate shipping and receipt."), a card row and "Accept terms". The counter changed the cash to A$10.00, and the only trace on phone is the header total changing from $250.00 to $260.00 AUD. The exchange, the cash line and the meeting place are behind a small (i) icon.
- **Suggested fix:** On phone, put a collapsed terms summary above the dock: "You give: Charizard · You get: Charizard + $10.00 AUD · Sun 29 Nov, 12:00 pm, 40 Example Rd". Make it a tap target that opens the full Exchange and Terms sheet. When a counter arrives, show what changed: "Bob changed the cash: $0.00 → $10.00 AUD".
- **Mobbin:** [Base review sheet](https://mobbin.com/screens/c9e67eac-42a5-4cee-ad48-9df38484d91f?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) shows "−0.00005 ETH / +0.00274 USDC" right where the member confirms.

### [P1] Accept-terms dialog: repeated facts, an edge case in the main flow, and the button below the fold
- **Where:** `trades.agree.refused-short-reservation` step 16 phone (`step-16.bob.png`) and desktop. The same dialog appears in `refused-unverified` step 6 and `fx-disclosure` step 6.
- **What's wrong:**
  - The opening sentence is circular: "Accepting agrees the terms."
  - "A$250.00" appears twice, and "Trades have no fee" twice.
  - The fee row shows $0.00 AUD.
  - The body includes "If a problem is still open when the hold is about to expire, it's charged and then refunded or paid out when staff decide."
  - The card row repeats the one already in the dock.
  - On phone, "Accept terms" is cut off at the bottom of a 1992px-tall capture.
- **Suggested fix:** Reduce the dialog to three rows and one sentence:
  - Title: "Accept and lock in this swap?"
  - "Temporary card hold · $250.00 AUD · Visa •••• 0006 (Change)"
  - "Placed about 24 hours before you meet. Released when the swap completes."
  - "NoDitto fee" (see the previous finding)
  - "How holds and disputes work" link, which holds the expiry and custody rule.
  - Footer: "Accept terms", pinned at the bottom of the sheet on phone.
- **Mobbin:** [Uniswap confirm swap](https://mobbin.com/screens/40a08547-e8ed-4255-86c0-d95cc40d1032?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) fits the two sides, the fee and one button in a short sheet, with the detail behind "Show more".

### [P1] Declined hold: the timeline says "cancelled" while the status and panel say "paused"
- **Where:** `trades.collateral.declined-hold-voids-other` step 13 on desktop and phone (`step-13.owner.png`).
- **What's wrong:** The timeline shows twice, in red, "Collateral could not be arranged. The trade was cancelled." The status pill says "Collateral pending". The dock says "A card declined the hold, so the trade is paused. Nothin…" with a retry button. The member cannot tell whether the trade is over, or whether their own hold is still live.
- **Suggested fix:**
  - Timeline line: "Visa •••• 0341 declined the A$250.00 AUD hold. The other hold was released."
  - Dock title: "Your card declined the hold"
  - Dock body: "Nothing was charged. Try another card by Sat 28 Nov, 12:00 pm, or the trade is cancelled."
  - Button: "Try again"
  - Do not use the word "cancelled" until the trade really is cancelled.

### [P1] Declined-hold retry panel overflows the dock on both viewports
- **Where:** As above. Desktop: the right column at x≈900–1264. Phone: the whole width.
- **What's wrong:** The panel is wider than its container. The text is cut at "Nothin", "Replace" is clipped at the right edge, and the retry button's label is off-screen. All that shows is a black bar.
- **Suggested fix:** Give the dock panel `min-w-0`, wrap the text, and make the button full width (`w-full`). Check that no dock child has a fixed width.

### [P1] Listing still offers Buy, Propose trade and Make an offer when region rules block all three
- **Where:** `trades.open.refused-region-mismatch` step 3, desktop and phone (`step-03.victor.png`).
- **What's wrong:** The copy says "This listing is in Australia and you are trading in United States. Deals between those two regions are not possible yet…" All three actions stay fully enabled, and "Buy now" stays black. On phone the notice is at the very bottom of a 3402px page, below the sticky action bar.
- **Suggested fix:** Disable the three actions and put a one-line notice directly above them: "Only members trading in Australia can buy or trade this card." On phone, replace the sticky bar's Buy button with that line and a "Message seller" button.

### [P1] Cancelled trade does not say why, or that nothing was charged
- **Where:** `trades.cash-leg.unpaid-pay-by-abandons` step 12 desktop (`step-12.alice.png`). The phone notifications are in step 14 (`step-14.alice.png`).
- **What's wrong:**
  - The header shows "Cancelled", but the progress bar is purple at "Step 2 of 4 · Delivery". The trade is in-person only.
  - The dock shows "Meet and swap (i)" and nothing else.
  - The Exchange still says "Stripe settles the cash once the trade completes".
  - Only the phone notification explains it ("anything you paid is being refunded"), and that sentence hedges when nothing was paid.
- **Suggested fix:**
  - Dock: "Cancelled: the $10.00 AUD cash wasn't paid by Sat 28 Nov, 12:00 pm. Nothing was held or charged, and both cards are back on the market."
  - Grey out the progress bar and label it "Cancelled".
  - Hide the settlement note.

### [P1] Accept stays enabled when it cannot succeed: missing card, unverified trader, card already in another trade
- **Where:**
  - `trades.agree.refused-no-card` step 6, desktop and phone (`step-06.trader.png`): "No card on file. Needed to lock this trade." next to an enabled "Accept terms".
  - `trades.agree.refused-unverified` step 6 desktop: the banner says "Stripe Identity required for both of you", yet the full dialog opens and the refusal arrives as a toast.
  - `refused-unverified` step 7 phone and `refused-short-reservation` step 17 phone: the toast covers the dialog's card row.
- **What's wrong:** The member reads a whole money dialog and only then finds out it can't proceed. On phone the error toast sits over the dialog content.
- **Suggested fix:** Check before the dialog opens, and match the cash-sale Buy dialog's pattern.
  - No card: the button becomes "Add a card to accept".
  - Unverified: the button becomes "Verify your ID to accept". When the other trader is the one unverified, disable it with "Waiting for Bob to verify their ID".
  - Short reservation: "This card is now in another trade". Show it inline in the dock, not as a toast over a dialog.

---

## P2

### [P2] Three different explanations of when the trade cash moves
- **Where:**
  - `trades.cash-leg.fx-disclosure` step 10 desktop and phone (`step-10.payer.png`): "NoDitto holds the cash until the trade completes, then releases it to the other trader."
  - Step 4 phone (`step-04.payer.png`): "Cash of €10.00 EUR settles after they finish payout setup. You can keep trading — collateral covers the goods. Stripe moves the cash once the receiver can take payouts."
  - Exchange note (`counter-voids-acceptances` step 11): "Stripe settles the cash once the trade completes, so whoever receives it needs payout details on file."
- **Suggested fix:** Use one sentence everywhere, built from the release policy: "You pay the cash now. NoDitto holds it and releases it to Bob when the swap completes." Show the payout-setup note only to the receiver: "Set up payouts to receive the €10.00 EUR."

### [P2] Pay-the-cash panel: wordy, and rendered above the room header on phone
- **Where:** `trades.cash-leg.fx-disclosure` step 10 phone (`step-10.payer.png`).
- **What's wrong:**
  - The panel sits above the room header, so the header ends up mid-page.
  - The panel is four sentences plus a conversion box: "It covers converting your payment so the other trader receives exactly the agreed cash, and it is not refunded."
  - The pay-by deadline is buried in the second sentence.
- **Suggested fix:** Put the panel inside the dock, under the header.
  - "Pay €10.20 EUR by Sat 28 Nov, 12:00 pm"
  - Rows: "Cash €10.00 · Conversion fee (2%, not refunded) €0.20"
  - Button: "Pay €10.20 EUR"
  - The card holds go on after you pay.
- **Mobbin:** [DoorDash "This table will be held for 4:54"](https://mobbin.com/screens/542ccb47-bba9-4565-bf87-e9adee3847a5?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) gives the deadline its own strip, not a clause in a paragraph.

### [P2] Inspection action row overflows on phone, and "Report fraud" is clipped
- **Where:** `trade-disputes.no-exchange-refused-after-inspection` step 6 phone (`step-06.counterpart.png`).
- **What's wrong:** "Accept item | Raise dispute | Report frau…" runs off the right edge. The header's green "Holds placed" text overlaps the (i) icon. The inspection banner sits above the room header.
- **Suggested fix:** Make "Accept item" full width. Put a row of two secondary buttons under it ("Raise a problem", "Report fraud"), or put "Report fraud" in the kebab menu. Move the banner under the header, inside the dock: "3 days left to check the card · until Sun 29 Nov, 3:04 pm".

### [P2] "Escrow", "ship your item" and "shipping" copy on in-person-only trades
- **Where:**
  - Notifications: `trades.negotiate.meeting-edit-clears-other` step 11 desktop (`step-11.alice.png`) and `cash-leg.unpaid-pay-by-abandons` step 14 phone.
  - Chat empty state on every phone room.
  - Stepper label in `unpaid-pay-by-abandons` step 12.
- **What's wrong:**
  - The notification says "Trade collateral locked — Both card holds are confirmed. The swap is on - ship your item or arrange the handover."
  - The chat empty state says "Use chat to coordinate shipping and receipt."
  - The stepper says "Step 2 of 4 · Delivery".
  - The cash-sale notification "Funds secured — The funds are held in escrow" breaks the vocabulary rule.
- **Suggested fix:**
  - Notification: "Both card holds are in place. Meet as agreed on Sun 29 Nov."
  - Chat empty state: "Use chat to agree where and when to meet."
  - Stepper: "Meet and swap".
  - Cash sale: "The buyer has paid. NoDitto holds the money until they accept the card."

### [P2] Progress label says "Step 1 of 4 · Holds" during negotiation, and the step count changes
- **Where:** Every negotiating room. `trades.negotiate.counter-voids-acceptances` step 5 desktop shows "Step 1 of 5 · Holds", and the same trade shows "Step 1 of 4" after the counter. `fx-disclosure` step 4 phone shows "Step 1 of 5".
- **What's wrong:** "Holds" during negotiation tells a member a hold is happening before they have accepted anything. The total number of steps changes for the same trade.
- **Suggested fix:** Name the steps for what the member does: "Agree → Holds → Meet → Check → Done". Keep the count fixed per trade type. A cash leg can be a sub-state of "Holds".
- **Mobbin:** [Blue Apron order tracker](https://mobbin.com/screens/27b81a1c-c5ff-4ec1-ac5b-b6770c87c3dc?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) labels every step under the bar.

### [P2] After a counter, the room has no waiting state
- **Where:** `trades.negotiate.counter-voids-acceptances` steps 9 and 11 desktop (`step-09.alice.png`, `step-11.bob.png`); `trades.agree.side-values-frozen` step 13 phone (`step-13.bob.png`).
- **What's wrong:** Once a member has accepted or countered, the dock shows only the card row. There is nothing like "Waiting for Bob". On phone, a "Collateral pending" room shows "Post collateral (i)" with no action and no explanation.
- **Suggested fix:** The dock always states the next action and who owns it:
  - "You accepted. Waiting for Bob to accept version 3."
  - "Holds go on about 24 hours before you meet (Sat 28 Nov, 12:00 pm). Nothing to do until then."
  - Rename "Post collateral", which reads as a button the member should press.

### [P2] Meeting change after the cutoff: the form is editable, then refuses on save
- **Where:** `trades.meeting.change-refused-after-cutoff` step 12, desktop and phone (`step-12.alice.png`).
- **What's wrong:** The full edit dialog opens with live fields and a "Save terms" button. The refusal then arrives as a toast over the dialog: "The meeting was locked at Wed, 25 Nov, 2:53 pm AEDT, when the trade collateral was placed." On desktop the toast covers part of "Save terms". "Save terms" is the wrong label for a meeting change, which is a proposal.
- **Suggested fix:** After the cutoff, do not offer "Edit terms". Show this on the Terms tab: "The meeting is locked because the card holds are in place. Message Bob if you need to change plans." Before the cutoff, label the button "Propose new meeting".

### [P2] Map preview is blank, and broken on phone
- **Where:** Terms tab, desktop: `trades.negotiate.meeting-edit-clears-other` step 9 (`step-09.bob.png`), `refused-no-card` step 5, `meeting.change-proposal-accepted` step 11. Phone: the edit dialog in `meeting.change-refused-after-cutoff` step 12.
- **What's wrong:** A grey box about 220px tall sits under the address. On phone it shows a broken-image "?" icon. It takes half the Terms tab and duplicates the address line.
- **Suggested fix:** When the Static/Embed map fails or has no key, collapse to the address with an "Open in Maps" link and a fixed small height. Do not leave an empty placeholder.

### [P2] Meeting-change proposal: cramped two columns on desktop, and the composer is pushed off on phone
- **Where:** `trades.meeting.change-proposal-accepted` steps 10 and 11, desktop and phone.
- **What's wrong:** In the 360px right column, "Agreed / Proposed" addresses wrap to four lines each. On phone, Alice's view clips the message composer at the bottom. The copy "Nothing changes unless X accepts. The proposal lapses Sat, 28 Nov…" is fine, but it is in grey and smaller than the addresses.
- **Suggested fix:** Stack the two as rows: "Now: Melbourne, Sun 29 Nov 12:00 pm" and "Proposed: Brisbane, Tue 1 Dec 12:00 pm". Show the full address on tap. Keep the dock height within the viewport by making the timeline scroll, not the dock.
- **Mobbin:** [OpenTable confirm](https://mobbin.com/screens/d2abf7cf-52d2-45f9-856b-f294b1af77c2?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) puts place and time on one compact line above "Yes, book this / Keep editing".

### [P2] Listing price A$258 vs trade value A$250.00, explained in a fee footnote
- **Where:** `trades.agree.refused-short-reservation` step 5 desktop (`step-05.alice.png`). The listing headline on `refused-unverified` step 3.
- **What's wrong:** The listing headline shows "$258 AUD", without cents and with a superscript "$". The trade dialog shows "$250.00 AUD", with "Valued at the seller's asking price. The listing's price includes the buyer protection fee a cash buyer pays; trades have no fee." Most members will not follow that sentence.
- **Suggested fix:** Under "You get": "$250.00 AUD (the seller's price. The $258 AUD on the listing includes the buyer protection fee for cash buyers.)" Better still, show "Trade value $250.00 AUD" on the listing near the "Propose trade" button.

### [P2] Exchange cards wrap the price and truncate item names
- **Where:** Desktop Exchange tab in every room, for example `trades.negotiate.counter-voids-acceptances` step 12 (`step-12.alice.png`).
- **What's wrong:** "You receive VALUE $250.00 / AUD" wraps onto two lines, while the left card fits on one, so the two cards are uneven. Item names show as "[E2E] T…", and the cash rows as "Cash you…" and "Cash the…", which hides who pays whom.
- **Suggested fix:** Use `whitespace-nowrap` on the amount and a smaller type size at `lg`. Let the item name take two lines. Label cash rows "Cash you pay" or "Cash you get" and do not truncate them.

### [P2] Phone listing: the sticky action bar overlaps content, and offer/trade buttons are icon-only
- **Where:** `trades.shopfront.refused-as-offering-side` step 3 phone and `refused-unverified` step 3 phone.
- **What's wrong:** The tab bar sits on top of "Buyer protection: your payment is held until you accept the card". The offer and trade buttons are bare icons next to a large "Buy", with no labels.
- **Suggested fix:** Add bottom padding equal to the bar's height. Add short labels ("Offer", "Trade") under the icons, or use a "More ways to deal" sheet.

### [P2] Staff case page tells the arbitrator who just resolved it that "another arbitrator" may have
- **Where:** `trade-disputes.staff-unfounded` step 8 phone (`step-08.staff.png`).
- **What's wrong:** "Case closed. This case is no longer open. It may have been resolved by another arbitrator." This appears right after the "Dispute resolved." toast, and the rest of the page is blank.
- **Suggested fix:** After a staff member's own resolution, show "Resolved as Unfounded. Both holds released." with links to "Back to the queue" and "Open the trade".

### [P2] Dispute resolution reads as an error in the member timeline
- **Where:** `trade-disputes.staff-unfounded` step 9 phone (`step-09.initiator.png`).
- **What's wrong:** "The dispute was resolved." is in red and does not give the outcome or the money result.
- **Suggested fix:** Use neutral text: "NoDitto staff found no problem. Both card holds were released and the trade is complete."

---

## P3

### [P3] Desktop chat header repeats the page header
- **Where:** All desktop rooms.
- **What's wrong:** The title, "$250.00 AUD" and the status pill appear twice, about 100px apart.
- **Suggested fix:** Keep the counterparty's name and avatar in the chat header. Drop the price and the pill.

### [P3] Stale "fixed" note on completed trades
- **Where:** `trade-disputes.staff-unfounded` step 9 desktop.
- **What's wrong:** A completed trade still says "The bundle and cash were fixed when both of you accepted the terms, so neither side can change them now."
- **Suggested fix:** Hide the note once the trade completes, or say "Completed on 26 Nov."

### [P3] Phone header crowding
- **Where:** `trades.meeting.change-proposal-accepted` step 10 phone.
- **What's wrong:** The status pill "Collateral pending" collides with the (i) icon, the kebab and the counterparty name, and the name is truncated to "[E2E] …".
- **Suggested fix:** Move the counterparty name to the second line, and put the pill on the same line as the price.

### [P3] Duplicate notifications
- **Where:** `meeting-edit-clears-other` step 11 desktop and `unpaid-pay-by-abandons` step 14 phone.
- **What's wrong:** "Meeting details changed" appears four times "just now". "Trade collateral could not be placed" appears about ten times, each time with the same three-sentence body.
- **Suggested fix:** Collapse repeated events for one trade within about 10 minutes into one row ("Meeting changed 4 times"). Shorten the body to one line.

### [P3] Staff queue and focus artefacts
- **Where:** `trade-disputes.no-exchange-refused-after-inspection` step 8 desktop (`step-08.staff.png`, 16,736px tall). `staff-unfounded` step 8 desktop.
- **What's wrong:** The queue is one unpaginated list. A purple "Skip to Main Content" chip shows over the sidebar.
- **Suggested fix:** Paginate the queue or add a "Needs response / In review / Resolved" filter. Keep the skip link hidden until it gets keyboard focus.
- **Mobbin:** [Square Disputes](https://mobbin.com/screens/7572c6dc-158d-4c88-befa-48bf17c14595?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) splits the queue into those three tabs with counts.

### [P3] The card row sits permanently in the dock
- **Where:** Every negotiating room.
- **What's wrong:** "Visa •••• 0006 / Expires 11/27 / Replace" takes up as much space as the primary action, before any hold exists.
- **Suggested fix:** Show the card only inside the accept dialog and the holds step. Before that, use a one-line "Card on file: Visa 0006".

---

## Responsive notes

**1280x720 desktop**
- The three-column layout (rail 256px, room about 590px, chat about 390px) leaves the dock about 360px wide. That is too narrow for the proposal comparison and for the declined-hold panel. Below 1360px, either collapse the left rail to icons or move the dock under the Exchange and Terms pane.
- Dialogs: the accept-terms dialog just fits in 720px. The Propose trade dialog does not: its submit button is below "Add cash", out of view. Pin the dialog footers (`sticky bottom-0`) and scroll only the body.
- Toasts appear bottom-right on top of the dialog's corner and its buttons. When a dialog is open, show errors inline in the dialog instead.
- Amounts in the Exchange cards wrap (see the Exchange cards finding). Use `nowrap` plus `text-xl` at this width.

**Phone (390px)**
- The room shows only chat. Add a sticky terms summary card above the dock (see the P1 finding).
- Bottom sheets taller than the viewport (accept terms, meeting edit) need a pinned footer so "Accept terms" and "Save" are always visible. Move the expiry/custody detail behind the "How holds and disputes work" link so the sheet fits on one screen.
- No dock row should be wider than the viewport. The inspection actions and the declined-hold panel overflow today. Stack the buttons full width and give one action the primary style.
- The Pay panel and the inspection banner render above the room header. Keep the header first, then the dock.
- The listing's sticky bar covers the content under it. Add matching bottom padding, and put the region refusal next to the actions, not at the end of the page.
