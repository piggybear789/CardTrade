# UX review D: catalog, listing page, editor, watchlist, sellers, offers, private deals

**Summary**

1. Money is the weakest area. The catalog and listing headline round the buyer total down to whole dollars ("$46 AUD" for a $46.35 charge), the seller's Sales list shows the buyer's total as if it were the sale price, and the fee copy never states the exact rate. The fee copy also says "about 1%", which disagrees with the product rule of about 2%.
2. On a Multiple items listing, desktop offers "Buy now" while phone offers "Request". The desktop label promises an instant purchase that the listing cannot give, and at 1280x720 the "Nothing in this listing is held for you" line falls below the fold.
3. On the listing page, Buy now, Propose trade and Make an offer are three equal-weight icon tiles, so there is no clear primary action. Phone has the opposite problem: the offer and trade buttons are unlabelled icons.
4. At 1280x720 the private-deal preview phone is about 190 px wide and cannot be read. On phone, the link card and a red "Cancel link" sit above the form, and the sticky footer covers the fee summary.
5. Member lists (My listings, Trades, Messages, Notifications) render hundreds of rows with no paging. The seller page hides listings under the References graph. Smaller inconsistencies (heart state, rail highlight, "live" vs "ready") add friction.

Caveat on the inputs: phone screenshots are full-page captures. The sticky action bar and bottom nav are painted mid-page, and some tiles are blank because their images had not loaded when the capture ran. I have not counted these as bugs. Where a finding depends on what a real 844 pt viewport shows, the finding says so.

---

## P1: misleads or blocks

### [P1] The headline price rounds the buyer total down to whole dollars
- **Where:** catalog.filters-sort-and-redirect step 2, desktop, `C:\dev\Marketplace\audit-artifacts\catalog.filters-sort-and-redirect\desktop\2026-11-26T01-42-49Z-g4ea9pj\step-02.visitor.png`. Also listings.create-single-and-shopfront step 1, desktop, `...\listings.create-single-and-shopfront\desktop\2026-11-26T01-42-49Z-g4ea9pj\step-01.seller.png`, and watchlist-sellers.watch-toggle-and-seller-page step 3, desktop, `...\watchlist-sellers.watch-toggle-and-seller-page\desktop\2026-11-26T01-42-49Z-g4ea9pj\step-03.member.png`.
- **What's wrong:** The listing page shows "$46 AUD" in the headline, and the box below it says "Buyers pay $46.35 AUD · You receive $45.00 AUD". The catalog tile shows the same "$46 AUD". The figure is neither the price the seller set ($45.00) nor what the buyer is charged ($46.35). Truncating a money figure downwards under-states the charge. A buyer who compares this tile with the Offers page ("You'd pay $46.35 AUD") sees two different numbers.
- **Suggested fix:** Show cents on every money figure (`$46.35 AUD`), or show the listing price on the tile and label it with "+ 3% buyer protection fee". Never truncate. Make the catalog, listing headline, Buy dialog and Offers page use one formatter.
- **Mobbin reference:** [GetYourGuide](https://mobbin.com/screens/01742268-63ec-446d-ad5e-1fd21f4e0a09?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) uses "From £84" with one consistent price form on every tile.

### [P1] The seller's Sales list shows the buyer's total as the row amount
- **Where:** surfaces.public-and-member-routes-ux step 5, desktop, `...\surfaces.public-and-member-routes-ux\desktop\2026-11-26T01-42-49Z-g4ea9pj\step-05.member.png`. Also phone, `...\surfaces.public-and-member-routes-ux\phone\2026-11-26T01-42-49Z-g4ea9pj\step-05.member.png`.
- **What's wrong:** One private deal appears twice on the same screen with two amounts. Under "Waiting to join" it reads "Private Deal Charizard $80.00 AUD". Its contract row reads "Private Deal Charizard $82.40 AUD". Other rows follow the same pattern: "$46.35 AUD" for a $45 card and "$6,180.00 AUD" for a $6,000 card. The seller receives the price, not the buyer's total, so the list overstates their income.
- **Suggested fix:** On Sales, show what the seller receives ("You get $80.00 AUD"). On Purchases, show what the buyer pays ("You pay $82.40 AUD"). Label the figure every time.

### [P1] Desktop shows "Buy now" on a Multiple items listing, while phone shows "Request"
- **Where:** offers.shopfront-and-no-card-refused step 2, desktop `...\offers.shopfront-and-no-card-refused\desktop\2026-11-26T01-42-49Z-g4ea9pj\step-02.buyer.png` and phone `...\phone\...\step-02.buyer.png`.
- **What's wrong:** Desktop labels the primary action "Buy now" on a "from $20 AUD" listing. Nothing is for sale at $20 until the buyer asks for specific cards. Phone calls the same action "Request". On desktop the only reassurance, "Nothing in this listing is held for you. Buyer protection: your payment is held until you accept the cards.", sits at y≈660–680 and is cut off at the 720 px fold.
- **Suggested fix:** Use "Request cards" on both viewports for Multiple items listings. Move "Nothing in this listing is held for you" directly under the "from $20 AUD" price line, which is above the fold. Keep the buyer protection line where it is.

### [P1] Fee copy gives no exact rate and its NoDitto share disagrees with the product rule
- **Where:** listings.create-single-and-shopfront step 1, desktop and phone, `...\listings.create-single-and-shopfront\desktop\...\step-01.seller.png`. Also private-deals.create-and-claim-cash-sale step 1, desktop, `...\private-deals.create-and-claim-cash-sale\desktop\...\step-01.host.png` (the editor capture).
- **What's wrong:** The copy reads "The difference is the buyer protection fee the buyer pays: mostly Stripe's costs, with NoDitto keeping about 1% on larger sales, less on small ones." The rate itself (3% here: $1.35 on $45, $2.40 on $80) appears nowhere. The product rule is to state the exact rate ("4%" style) and to say NoDitto keeps **about 2%**. The deal composer has a "Buyer protection fee $2.40 AUD" row with no rate either.
- **Suggested fix:** Change the row label to "Buyer protection fee (3%)" in the listing money box, the deal Terms summary and the Offers card. Cut the sentence to: "Buyers pay a 3% buyer protection fee on top. Most of it goes to Stripe; NoDitto keeps about 2% on larger sales, less on small ones." Before shipping, check the "1%" and "2%" figures against `processingFee.ts`.

---

## P2: clutter or responsive breakage

### [P2] The listing page's three actions have equal weight and no primary
- **Where:** watchlist-sellers.watch-toggle-and-seller-page step 2, desktop, `...\watchlist-sellers.watch-toggle-and-seller-page\desktop\2026-11-26T01-42-49Z-g4ea9pj\step-02.member.png`.
- **What's wrong:** "Buy now", "Propose trade" and "Make an offer" are three 48 px icon squares with captions, spread across the column. Only the filled square marks Buy now as primary. The price ($31 AUD) and the buy action are 250 px apart, separated by the seller card and description.
- **Suggested fix:** Use one full-width primary button that carries the total ("Buy now · $31.93 AUD"). Below it, put a row with two secondary outline buttons, "Make an offer" and "Propose trade". Place this block directly under the price and keep the seller card below it.
- **Mobbin reference:** [Contra product page](https://mobbin.com/screens/32e564e1-b739-4d2c-b9b4-4e97120c5aa0?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) puts the price over one full-width primary and a full-width secondary. [Upwork](https://mobbin.com/screens/7f0c60ca-ca6d-4b77-a0b6-1e271f16c28a?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) puts the amount in the button ("Continue ($30)") with the payment-protection line under it.

### [P2] Phone action bar: unlabelled offer and trade icons, and labels that differ from desktop
- **Where:** watchlist-sellers.watch-toggle-and-seller-page step 2, phone, `...\watchlist-sellers.watch-toggle-and-seller-page\phone\2026-11-26T01-42-49Z-g4ea9pj\step-02.member.png`. Also offers.shopfront-and-no-card-refused step 2, phone.
- **What's wrong:** The bar holds message, heart, offer and trade icons plus "Buy". The offer icon (hand and coin) and the trade icon (two arrows) have no labels. The primary button says "Buy" here but "Buy now" on desktop. The bar shows no price, so a buyer who has scrolled cannot see the price next to the action.
- **Suggested fix:** Put the price on the left of the bar ("$31.93 AUD incl. fee") and one primary on the right ("Buy now", or "Request cards" on Multiple items). Move offer and trade into a "More options" sheet with text labels, or show them as labelled buttons under the price in the page body.
- **Mobbin reference:** [On](https://mobbin.com/screens/660dc94a-9357-42d3-8b61-d3ecd36d49c2?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) and [Klook](https://mobbin.com/screens/81816c9b-b8ea-4d27-ad9d-b4c9a21bce85?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) use a sticky bar with the price on the left and one primary on the right.

### [P2] The contract room shows two unlabelled amounts for the same deal
- **Where:** offers.counter-and-accept-opens-sale step 4, desktop, `...\offers.counter-and-accept-opens-sale\desktop\2026-11-26T01-42-49Z-g4ea9pj\step-04.buyer.png`. Also private-deals.create-and-claim-cash-sale step 2, desktop.
- **What's wrong:** The header reads "$53.56 AUD total" while the chat header in the same viewport reads "$52.00 AUD". In the private deal, the header says "$82.40 AUD total" and the chat says "$80.00 AUD". On phone only the lower figure is shown ("$52.00 AUD").
- **Suggested fix:** Label both figures: "Price $52.00 AUD" and "You pay $53.56 AUD". On phone, show the buyer the figure they will pay.

### [P2] The rail highlights "Sales" while the buyer is in a Purchase
- **Where:** offers.counter-and-accept-opens-sale step 4, desktop, and private-deals.create-and-claim-cash-sale step 2, desktop (joiner room).
- **What's wrong:** The rail title reads "Purchase", but the highlighted item is "Sales". The buyer is told they are in the selling area.
- **Suggested fix:** Highlight the item for the member's role in the contract: Purchases for the buyer, Sales for the seller.

### [P2] The private-deal preview is unreadable at 1280x720
- **Where:** surfaces.public-and-member-routes-ux step 8, desktop, `...\desktop\...\step-08.member.png`. Also private-deals.self-join-and-expired-refused steps 1–2, desktop.
- **What's wrong:** The preview canvas is about 670 px wide, but the phone inside it is about 190 px wide. Its text ("Nothing is paid or held when you join.", "$40.00 AUD") renders at roughly 5–6 px. The phone keeps its height, so the canvas also wastes about 240 px of vertical space under the link bar.
- **Suggested fix:** At heights of 760 px or less, scale the device to fill the canvas height minus the link bar (about 430 px tall). Alternatively, default to the browser preview at 1280 wide, where a 600 px card is legible. Fix the left column at about 520 px and give the rest to the preview.
- **Mobbin reference:** [Stripe payment link](https://mobbin.com/screens/73e48ea7-589a-483c-b118-bdaf2215a376?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) and [Contra create service](https://mobbin.com/screens/814d8155-36ae-4f1c-9802-10371cf87607?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) render the preview at a readable size and let it take half the screen.

### [P2] Phone deal editor: the link card and "Cancel link" push the form down, and the footer covers the fee summary
- **Where:** private-deals.self-join-and-expired-refused step 2, phone, `...\phone\...\step-02.host.png`. Also private-deals.create-and-claim-cash-sale step 1, phone.
- **What's wrong:** The first screen holds the back button, "Send the link, or change the deal here. The link stays the same.", the link card, a red "Cancel link", and only then the steps. The destructive action sits about 40 px below "Copy link". On the Terms step, the sticky footer ("Before they pay, they see the name on your ID." plus Back and Save changes) covers the "They pay $41.20 AUD" row the host came to check. The same deal is shown twice: as the "What they'll see" preview and in the form itself.
- **Suggested fix:** Move "Cancel link" into the overflow menu, as desktop does ("…"), and add a confirmation. Collapse the link card to one line ("Link live · Copy"). Give the scroll area bottom padding equal to the footer height so the summary can scroll clear of it. Collapse "What they'll see" behind a "Preview" button.

### [P2] Edge-case copy in the main path of the deal editor
- **Where:** private-deals.self-join-and-expired-refused step 1, desktop, `...\desktop\...\step-01.host.png`.
- **What's wrong:** The disabled "Trade cards" tile carries the sentence "To switch between selling and trading, cancel this link and start a new one." It appears on every edit, for an action few hosts will try. The footer also carries "Before they pay, they see the name on your ID." on every step.
- **Suggested fix:** When the deal is live, hide the tile that was not chosen and show the chosen kind as a static label. Put the switching note in a tooltip on that label. Keep the ID-name note on the Terms step only.

### [P2] Inconsistent heart state between the listing page and the tiles
- **Where:** watchlist-sellers.watch-toggle-and-seller-page steps 2–3, desktop and phone, and surfaces step 1, desktop (member catalog).
- **What's wrong:** The listing page shows a filled red heart with "1". The Saved page shows the same item with an outline heart and "1". On the member catalog, hearts appear on only some tiles, and where they do they cover the card art next to the "New" and "Multiple items" badges.
- **Suggested fix:** Make the heart filled whenever the member has saved the item, on every surface. Show it on every tile in a fixed top-right slot. Stack the badges in the top-left slot only.
- **Mobbin reference:** [Fresha](https://mobbin.com/screens/72df0ddc-8197-4c7b-9325-6389cb16685b?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) puts a heart in the same corner of every tile and badges in the opposite corner.

### [P2] Catalog tiles show the game, not the condition
- **Where:** catalog.filters-sort-and-redirect step 2, desktop and phone.
- **What's wrong:** Every tile carries "Pokémon", which repeats the active tab and the image. It never shows the condition ("Near Mint", "Graded"), the attribute collectors filter on most. Location is also absent, although the listing page shows "Sydney NSW".
- **Suggested fix:** Replace the game line with "Near Mint · Sydney NSW", or with condition alone on phone. Show the game only on the "All" tab, as a small icon.

### [P2] The trust banner takes the top of every catalog and search page
- **Where:** catalog.filters-sort-and-redirect steps 2–4, phone, `...\phone\...\step-03.visitor.png`. Also catalog.hidden-private-item-excluded step 2, phone.
- **What's wrong:** On phone, "Buy, sell and trade cards with verified collectors" plus three bullet lines take about 140 pt, roughly a sixth of the viewport. The banner repeats on search results and on the empty state, pushing the first listing below the fold. Its bullets also repeat word for word on the sign-in panel.
- **Suggested fix:** Show the banner only on the unfiltered first page for guests. Collapse it to one line on phone ("ID-checked sellers · Payment held until you accept"). Drop it on search, filtered and empty-state views.

### [P2] The guest redirect to sign-in gives no reason
- **Where:** surfaces.guest-restricted-surface-redirects step 1 and watchlist-sellers.guest-save-routed-to-signin step 1, desktop and phone, `...\watchlist-sellers.guest-save-routed-to-signin\desktop\...\step-01.visitor.png`.
- **What's wrong:** A guest who tapped Save, or opened /listings/mine, lands on a generic page: "Sign in. Welcome back. Sign in to buy, sell and trade." Nothing says why, and a new visitor is greeted with "Welcome back".
- **Suggested fix:** Read `redirectTo` and set the subtitle from it, for example "Sign in to save this card" or "Sign in to see your listings". For a first-time visitor, put "Create an account" at the same weight as Sign in.

### [P2] The expired invite page is a dead end
- **Where:** private-deals.self-join-and-expired-refused step 4, desktop `...\desktop\...\step-04.joiner.png` and phone.
- **What's wrong:** A small card in the top third reads "This invite expired. Ask them to send a new deal link." "Them" is not named, the page has no action, and the rest of the screen is empty apart from the full rail.
- **Suggested fix:** Name the host ("Ask Diaz Collectibles to send a new link"). Add "Message them" when the joiner is signed in, plus "Browse the marketplace". Centre the card the way the 404 page does.

### [P2] Offer cards repeat the same figure three times
- **Where:** offers.counter-and-accept-opens-sale step 3, desktop `...\desktop\...\step-03.seller.png` and phone.
- **What's wrong:** The seller's card shows "$52.00 AUD ~~$60.00 AUD~~", then "You'd get $52.00 AUD", then "You are selling · with [E2E] offer-buyer · your offer", then "them ~~$45.00 AUD~~ → you $52.00 AUD". The amount appears three times in four lines.
- **Suggested fix:** Use two lines: "Your counter $52.00 AUD (they offered $45.00 · listed $60.00)" and "You'd get $52.00 AUD · with offer-buyer". The buyer's card already does this well: "You'd pay $46.35 AUD incl. buyer protection fee".

### [P2] The seller page hides listings under the References graph
- **Where:** watchlist-sellers.watch-toggle-and-seller-page step 4, desktop, `...\desktop\...\step-04.member.png`.
- **What's wrong:** A buyer who arrives from a listing must scroll past the profile, the References graph (about 200 px), and six reference cards with pagination before reaching "Listings 37". That is about 700 px down at 1280.
- **Suggested fix:** Put Listings and References in tabs under the profile header, with Listings first when the visitor arrived from a listing. Keep a one-line references summary in the header ("7 positive references") that links to the tab.

### [P2] Member lists have no paging
- **Where:** surfaces.public-and-member-routes-ux steps 3, 4, 6 and 7, desktop. The full-page captures are 11,646 px, 7,795 px, 8,821 px and 4,245 px tall.
- **What's wrong:** My listings, Trades, Inbox and Activity render every row. The catalog pages its results ("Page 1 of 4") and phone uses "Load more listings", but these lists do neither. Notification rows repeat "The buyer has paid. The funds are held in escrow - arrange handover or postage." many times over.
- **Suggested fix:** Page at about 25 rows, or use "Load more" as the catalog does. Group Activity by contract, with one row per contract showing its latest event.

### [P2] Phone truncation: Sales tabs and saved card
- **Where:** surfaces.public-and-member-routes-ux steps 5 and 2, phone, `...\phone\...\step-05.member.png` and `...\phone\...\step-02.member.png`.
- **What's wrong:** The Sales tabs show "Open 27 · Your move 14 · Their move 12", and "Finished" is pushed off-screen with no scroll affordance. The Account page shows "Mastercard •••• ...", which cuts off the last 4 digits (the only useful part), and "Used to pay and to back...".
- **Suggested fix:** Make the tabs a horizontally scrollable row with an edge fade, or use a segmented control with shorter labels ("Open", "You", "Them", "Done"). For the card, drop the brand word on phone and keep "•••• 4444"; let the description wrap.

---

## P3: polish

### [P3] Mixed copy for one state: "Your link is live" and "Your link is ready"
- **Where:** private-deals.self-join-and-expired-refused step 1 ("live") vs step 2 ("ready"), desktop. Phone also uses both.
- **What's wrong:** One state has two names, and the "Live" badge in the editor bar is a third. "Save changes" is grey when nothing has changed, which looks like a broken button.
- **Suggested fix:** Use "Your link is live" everywhere. Keep Save changes outlined until there is something to save, rather than grey.

### [P3] Catalog search title is the raw query
- **Where:** catalog.filters-sort-and-redirect step 3, desktop and phone; catalog.hidden-private-item-excluded step 2.
- **What's wrong:** The H1 becomes "mwwww8su80e4248" at 28 px with no result count, so a typo is shouted back as a heading.
- **Suggested fix:** Use "Results for “…”" with a count ("1 listing"), and keep "All listings" as the H1 style for browse only.

### [P3] Category tabs fade into a chevron at 1280
- **Where:** catalog.filters-sort-and-redirect step 2, desktop; phone shows "Magic" fading out.
- **What's wrong:** After "Disney Lorcana" a faint icon fades into a chevron. The chevron is the only way to reach the other ten games, and it reads as a scroll hint rather than a menu.
- **Suggested fix:** Show about 6 games and add a "More games ▾" text button. On phone keep the scroller, but make the active tab scroll into view.

### [P3] Badge stacking on tiles
- **Where:** surfaces step 1, desktop; catalog step 2, desktop.
- **What's wrong:** "Multiple items" and "New" stack as two dark and light pills over the card art. "New" appears on almost every tile, so it no longer carries meaning.
- **Suggested fix:** Show one badge per tile, with "Multiple items" winning. Show "New" only for the first 24 hours, or drop it when sorting by Recently listed.

### [P3] Seller's own listing view: empty gap and unclear "Copy trade link"
- **Where:** listings.create-single-and-shopfront steps 1–2, desktop.
- **What's wrong:** The money box and buttons are pinned to the bottom of the image height, leaving about 100 px of blank space under a one-line description. "Copy trade link" does not say whether it shares the listing or opens a trade. The bin icon sits next to the edit actions without a label.
- **Suggested fix:** Let the column flow from the top. Rename the button to "Share listing" or "Copy link". Move Delete into an overflow menu.

### [P3] The 404 page for a non-owner keeps the "Edit listing" header on phone
- **Where:** listings.unverified-and-non-owner-refused step 3, phone, `...\phone\...\step-03.other.png`.
- **What's wrong:** The page title says "Edit listing" while the body says "We couldn't find that page".
- **Suggested fix:** Drop the editor header on the not-found state, or set it to "NoDitto".

### [P3] Sign-in button state differs by viewport
- **Where:** surfaces.guest-restricted-surface-redirects step 1, desktop (black, enabled) vs phone (grey, disabled), with both fields empty.
- **What's wrong:** The same empty form shows two button states.
- **Suggested fix:** Pick one behaviour. Enabled with inline validation is the friendlier of the two.

### [P3] "Browse marketplace" is a full primary on Offers and Saved headers
- **Where:** offers.counter-and-accept-opens-sale steps 2–4, phone; watchlist step 3, phone.
- **What's wrong:** On phone the header's largest, darkest button sends the member away from the page they opened, and it competes with the page's real action ("Withdraw").
- **Suggested fix:** Make it a text link, or show it only in the empty state.

---

## Responsive notes

### 1280x720 desktop
- **Catalog grid:** With the 240 px rail, five columns of about 170 px work for images, but titles wrap to two lines and the seller row drops to 11 px. Use 4 columns between 1024 and 1360 px, which gives about 215 px tiles. Keep 5 columns from 1360 px. Set the tile title to 14 px / 2 lines with a fixed `min-h-[2lh]`, so rows stay aligned (they already do).
- **Listing page:** The image column (about 470 px) and the detail column (about 470 px) are equal, so everything below the description is pushed under the fold. Use a 55/45 split, and cap the image height at `calc(100vh - 140px)` so it never sets the column height. Order the right column as title, price with the "incl. fee" total, the Multiple items "nothing is held" line, the primary action, secondary actions, the seller card, then the description.
- **Editors:** For the deal composer, see the preview finding. Scale the device to the canvas height when the viewport is 760 px tall or less, or default to the browser frame at 1280. Give the form column `max-w-[520px]` and the sticky footer 64 px. For the listing editor, the listing page view under `/listings/[id]` shows the money box sitting tight to the fold, so the scaled `ListingPreview` should use the same 55/45 split to stay legible.
- **Rails:** The 240 px rail is shown on transient pages (expired invite, verify identity). Collapse it to a 64 px icon rail below 1360 px, or hide it on single-message pages.

### Phone (390 pt)
- **Catalog:** Two columns are right. Cut the trust banner to one line and remove it on search. The tile price is 22 pt bold; drop it to 18 pt and swap the game line for condition.
- **Listing page:** In a real viewport, the image (about 330 pt), the sticky action bar (about 56 pt) and the bottom nav (about 56 pt) leave the title and price barely visible on first load. Cap the hero at 60vh. Merge the sticky action bar with the price and hide the bottom nav on detail pages, as most marketplaces do.
- **Type:** Page H1s ("Offers", "Saved", "Sales") are about 30 pt, and "Browse marketplace" buttons are 48 pt tall. Use 24 pt H1s and 40 pt secondary buttons so the content starts higher.
- **Sticky footers:** In the deal editor and the listing editor, pad the scroll container by the footer height (`pb-[calc(footer+env(safe-area-inset-bottom))]`) so the fee summary and the last fields can scroll clear of the footer.
- **Tabs:** Every tab row (Sales, Offers, category) should scroll horizontally with an edge fade, never clip.
