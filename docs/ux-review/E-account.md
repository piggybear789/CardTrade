# UX review E: account, auth, onboarding, profile, messages, notifications, reviews and reports

Source: e2e audit screenshots listed in `docs/ux-review/inputs/E-account.txt` (run `2026-11-26T01-42-49Z-g4ea9pj`). Desktop is 1280x720, phone is iPhone 14 (390pt, 3x). Paths below are relative to `C:\dev\Marketplace\audit-artifacts\`. Black bars in the screenshots are privacy redactions and are not counted as defects. `[E2E]` titles are test data.

## Summary

1. The auth screens are clean and consistent, but errors show twice (an inline banner plus a toast with the same words), and the phone sign-in button is disabled on some captures and enabled on others.
2. The identity check and payout setup stay visibly separate in onboarding and on the Verification tab, which follows the product rule. The completed identity step loses its status label, though, and "You're set up to sell" sits above a payout row.
3. Notification counts disagree on the same screen (bell 30, sidebar 99+, then 35 and 34 on other pages). The Activity page has no unread styling, prints "All caught up" next to unread items and shows broken thumbnails.
4. On phone, the conversation and contract headers clip their own controls ("No contra…", the "View listing" button cut in half), and the full-page captures show the bottom tab bar fixed over the middle of long pages. Payouts and Inbox render hundreds of rows with no paging.
5. A finished contract is a dead end: the action bar still shows a disabled green "Handover confirmed" button, the review prompt is a small secondary button, and once submitted the review appears nowhere in the room.

## Findings

### [P1] Notification counts disagree across the same screen
- **Where:** `profile-payouts.payouts-dashboard-and-redirect` step 2, desktop (`…\desktop\…\step-02.seller.png`): bell badge **30**, sidebar Notifications **99+**. `messaging.over-4000-chars-refused` step 2, desktop: bell 30, sidebar **35**. `messaging.send-and-live-delivery` step 2, desktop: bell 30, sidebar **34**. Phone `reviews-reports.review-and-report-flow` step 4 seller (`…\phone\…\step-04.seller.png`): Account tab **99+**, Inbox **4**.
- **What's wrong:** One concept has two counts on one screen. Members can't tell which is true, and "Mark all read" looks broken when the two badges don't clear together.
- **Suggested fix:** Back the bell and the sidebar row with one unread selector and one cap (99+). Phone has no bell, so put the badge on an Activity entry and leave the Account tab unbadged, or badge both from the same source.
- **Mobbin reference:** [Contra notifications](https://mobbin.com/screens/e57c2e04-2a91-48f6-b1ef-7335163016d9?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) shows one count in the sidebar, and its per-tab dots match the list.

### [P1] Activity list has no unread state, contradicts itself and shows broken thumbnails
- **Where:** `notifications.bell-and-mark-all-read` step 2 and 3, desktop and phone (`…\desktop\…\step-02.member.png`, `…\phone\…\step-02.member.png`).
- **What's wrong:** "All caught up" prints beside "Mark all read" while the bell says 30. Read and unread rows look the same. Almost every row repeats a "No longer available" chip. Many thumbnails are blank white squares or the browser's broken-image glyph. There are 50+ rows in one undivided "LAST 24 HOURS" group, and on phone the rows become a wall of grey copy.
- **Suggested fix:** Give unread rows a leading dot and a bolder title, and show "All caught up" only when the unread count is 0. Show "No longer available" once as muted row text, not as a chip. Use a category icon when the listing image is missing. Group rows by Today, Yesterday and Earlier, and load 20 at a time.
- **Mobbin reference:** [Meetup notifications](https://mobbin.com/screens/f73ef774-f449-42d0-a86b-519cfc981700?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) uses date groups, unread dots and one "Mark all as read" link.

### [P1] Phone thread header clips its own controls
- **Where:** `messaging.send-and-live-delivery` step 2, phone (`…\phone\…\step-02.buyer.png`). `messaging.over-4000-chars-refused` step 2, phone.
- **What's wrong:** The chip reads "No contra" (cut off), and the "View listing" button is cut through the middle of its text. Title, price, chip and button are all squeezed onto one 390pt row.
- **Suggested fix:** On phone, use two lines: title over price and status. Turn "View listing" into a chevron or make the whole header tappable, and drop the "No contract" chip, because the banner above the composer already says it.
- **Mobbin reference:** [Airbnb thread](https://mobbin.com/screens/b979a3d6-ce7f-4f70-9cd4-7b892d8650cc?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) keeps the header to names and dates and puts the listing in an inline card with "Show details".

### [P1] Finished contract still shows a stale primary action, and the review is hidden
- **Where:** `reviews-reports.review-and-report-flow` step 4 (buyer and seller), desktop and phone (`…\desktop\…\step-04.buyer.png`, `…\phone\…\step-04.buyer.png`). Step 6 (`…\step-06.buyer.png`).
- **What's wrong:** The action bar says "This contract is finished" next to a disabled green "Handover confirmed" button. The left pane says only "This contract is finished", with no amount, date or next step. The review entry point appears later as a small outline "Leave a review" in the chat footer. After submitting, the bar reads "Reviewed" and the review itself is never shown. On phone step 6 the thread area is empty white.
- **Suggested fix:** Once the contract is finished, replace the action with a primary "Leave a review" button for whichever party has not reviewed yet. Turn the status card into a receipt: what was bought, the total with its ISO code, the date the seller was paid, and the member's own review, which they can edit.
- **Mobbin reference:** [Airbnb thread](https://mobbin.com/screens/b979a3d6-ce7f-4f70-9cd4-7b892d8650cc?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) shows the booking state as a card with one action.

### [P1] Payouts tab renders every transaction with no paging
- **Where:** `profile-payouts.payouts-dashboard-and-redirect` step 1, desktop (`…\desktop\…\step-01.seller.png`, 6,743px tall) and phone (`…\phone\…\step-01.seller.png`, 29,499px tall).
- **What's wrong:** "Payment activity" lists 100+ rows, mostly identical "Collateral · $60.00 AUD hold · Held". The summary at the top gets lost, and on phone the table collapses into a narrow stack where amount and status wrap onto separate lines.
- **Suggested fix:** Show the 10 most recent rows with "View all", or paginate. Group collateral holds into one row ("12 active trade holds, $720.00 AUD") because they are not money owed. On phone, use a two-line row: description on top, amount and status chip below.
- **Mobbin reference:** [Stripe balances](https://mobbin.com/screens/896119a6-ad60-4fc5-bbb7-b60f25c7263a?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) has a short "Recent activity" list under the balance summary. [Fresha payments](https://mobbin.com/screens/2885e122-a849-4bc4-9e47-6dd613deaa6a?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) shows "Viewing 1–3 of 3".

### [P1] Inbox at 1280 is three cramped columns, and /messages has no limit
- **Where:** `messaging.send-and-live-delivery` step 2, desktop (`…\desktop\…\step-02.buyer.png`). Step 3, desktop (`…\desktop\…\step-03.seller.png`, 8,488px).
- **What's wrong:** At 1280 the 256px nav rail, a 368px inbox and a 656px thread share the width. Previews truncate after about 25 characters ("Hey Alice, is mwwwa5cy7843…"), and the thread header truncates too. The seller's /messages index renders 150+ conversations in one column with no search or filter.
- **Suggested fix:** On Messages below 1440, collapse the left rail to icons, which gives the inbox about 320px and the thread about 900px. Add search and an Unread filter above the list, and load the list in pages.
- **Mobbin reference:** [Contra messages](https://mobbin.com/screens/9df5f33f-570f-43c5-9fae-7eea0f9d82e8?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) puts search and General, Requests and Unread tabs above the list. [Expensify inbox](https://mobbin.com/screens/89215eec-ab49-40dd-b05b-75b0ab5ee69e?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) uses a slim icon rail so the two panes get the width.

### [P2] "You're set up to sell" groups payout with identity, and the completed identity step loses its label
- **Where:** `profile-payouts.payouts-dashboard-and-redirect` step 2, desktop and phone (`…\step-02.seller.png`). `profile-payouts.verified-not-payable-refusal` step 1, desktop and phone (`…\step-01.seller.png`).
- **What's wrong:** The heading "You're set up to sell. Two checks, and they unlock different things. Both are handled by Stripe, and there is nothing else to do here." names two checks but doesn't say what each unlocks. For the verified-but-not-payable member, step 1 "Verify your identity" turns grey with only the name under it. There is no "Verified" chip, so it reads as disabled rather than done.
- **Suggested fix:** Give each row its own one-line outcome. Identity: "Verified · lets you list, sell and trade". Payouts: "Active · lets you receive money" or "Not set up · needed before you can be paid". Keep a green "Verified" chip on the completed step 1. Drop the heading paragraph.
- **Mobbin reference:** [Contra account](https://mobbin.com/screens/e248fb0b-0634-49f6-ad78-7c36f53a4845?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) lists "Verify your identity" and "Complete your W-8 tax form" as separate steps, each saying what it unlocks.

### [P2] Seller-path onboarding: both steps say "Continue with Stripe" and the card jumps height
- **Where:** `onboarding.spoofed-return-markers-ignored` step 1 vs step 2, desktop (`…\desktop\…\step-01.visitor.png`, `step-02.visitor.png`) and phone.
- **What's wrong:** The dialog's top edge moves (y=188 to y=199) and its contents reflow, because the "Back" footer appears only after "Confirming your identity check with Stripe…" resolves. That is layout movement outside the region that changed. On desktop the spinner text sits in the right column and wraps the description into a narrow block. Step 1 and step 2 (Verification tab) both use the label "Continue with Stripe", so the two separate steps carry the same CTA.
- **Suggested fix:** Reserve the button slot (fixed height) and render the footer from the start. Label the buttons by outcome: "Verify my ID" for step 1 and "Set up payouts" for step 2, with "with Stripe" as helper text.

### [P2] Region step repeats the same warning twice
- **Where:** `onboarding.buyer-wizard` step 1, desktop and phone (`…\step-01.visitor.png`).
- **What's wrong:** The lede says "It is tied to your payout account". The helper text then says "This is tied to your payout account, so it is not something you can switch later on your own." A buyer who never sets up payouts reads about a payout account twice before choosing a country.
- **Suggested fix:** Lede: "Sets your currency and who you can trade with." Helper: "You can't change this yourself later. You can still browse every region."
- **Mobbin reference:** [Buy Me a Coffee payout setup](https://mobbin.com/screens/b14d0385-08c7-447a-896e-9be93e88c3d8?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) uses one country select with one short note.

### [P2] Welcome step leads with trust copy and no progress indicator
- **Where:** `auth.signup.provisions-profile` step 1/2, desktop and phone (`…\step-01.visitor.png`).
- **What's wrong:** "Two ways to transact, both designed to protect both sides" ("both… both") sits above three paragraphs that repeat the sign-in panel ("Every seller ID-checked", "Payment held until you accept"). The later steps have a progress bar and this one doesn't. On phone the text fills the screen with a large gap above the CTA.
- **Suggested fix:** Cut to three single-line bullets ("Sellers pass a photo ID check", "Your payment is held until you accept the card", "Trades are backed by a temporary card hold"). Show the step dots here too.

### [P2] Errors announced twice on auth screens
- **Where:** `auth.signin.invalid-credentials-refused` step 1, desktop and phone (`…\step-01.visitor.png`). `auth.signin.rate-limit-on-aux` step 1, desktop.
- **What's wrong:** "Invalid email or password." appears as a red banner and again as a toast. On phone the toast covers the "Create an account" link. The rate-limit capture stacks three toasts.
- **Suggested fix:** Keep the inline banner for form errors and drop the toast, or dedupe toasts by message.

### [P2] Sign-in primary button state is inconsistent on phone
- **Where:** `auth.signout.redirects-to-catalog` step 1 phone (grey disabled "Sign in", `…\phone\…\step-01.member.png`) vs step 2 phone (dark enabled, `step-02.member.png`). The desktop captures are always enabled.
- **What's wrong:** The same empty form shows two button states, and the grey one reads like a loading state.
- **Suggested fix:** Keep the button enabled and validate on submit, matching desktop and the reset form, which already shows "Enter the email address you signed up with."

### [P2] Redirect frames are blank white
- **Where:** `notifications.guest-redirected` step 1, desktop (`…\desktop\…\step-01.visitor.png`). `reviews-reports.report-does-not-notify-target` step 3, phone (`…\phone\…\step-03.seller.png`).
- **What's wrong:** The page is fully white with no header during the redirect or sign-in transition. On a slow network that looks like a crash.
- **Suggested fix:** Redirect in `proxy.ts` before render so the old page stays until the sign-in page is ready, which matches the no-skeleton rule. Make sure the root layout header always paints.

### [P2] Report submission gives no visible confirmation, and its entry point is a bare icon
- **Where:** `reviews-reports.report-does-not-notify-target` step 2, desktop and phone (`…\step-02.reporter.png`).
- **What's wrong:** The capture after "submits listing report" shows the listing unchanged. No toast, "Reported" state or disabled flag is visible. On desktop the report control is a 16px flag next to the heart with no label.
- **Suggested fix:** After submitting, turn the flag into a filled "Reported" state with a tooltip, and toast "Thanks. Our team will review this listing. The seller isn't told who reported it." Add a tooltip and aria-label "Report listing" to the icon.

### [P2] Duplicate sign-out actions and truncated rows on the phone Profile tab
- **Where:** `profile-payouts.tabs-and-live-edit` step 1, phone (`…\phone\…\step-01.member.png`) and desktop.
- **What's wrong:** Security has "Sign out everywhere → Sign out" and the page ends with a red "Sign out", so two buttons with the same label do different things. On phone the rows truncate: "Mastercard •••• …", "Used to pay and to back…", "every device, including th…".
- **Suggested fix:** Rename the security button "Sign out all devices". On phone, stack the value under the label for Payment method ("Mastercard •••• 8210" on its own line), and let descriptions wrap to two lines instead of truncating.

### [P2] Edit details sheet: labels in uppercase micro type and an ambiguous picture rule
- **Where:** `profile-payouts.tabs-and-live-edit` step 2, desktop and phone (`…\step-02.member.png`).
- **What's wrong:** "DISPLAY NAME" and "CONTACT EMAIL" are tracked caps, while every other form uses sentence case ("Email", "Password"). "Saves as soon as you pick it" next to a "Save changes" button leaves members unsure which one commits.
- **Suggested fix:** Use sentence-case labels. Move the avatar control out of the sheet and onto the profile header camera badge, which already exists, so the sheet has a single save model.

### [P2] Sidebar highlights "Sales" on a purchase
- **Where:** `reviews-reports.review-and-report-flow` steps 2, 4, 5 and 6, buyer, desktop (`…\desktop\…\step-02.buyer.png`).
- **What's wrong:** The page title is "Purchase", but the rail highlights Sales, so the member loses their place.
- **Suggested fix:** Pick the active rail item from the member's role on the contract (buyer → Purchases).

### [P2] Two prices with no explanation in the sale room
- **Where:** `reviews-reports.review-and-report-flow` step 2, desktop (`…\step-02.buyer.png`).
- **What's wrong:** The header says "$30.90 AUD total" and the chat header says "$30.00 AUD". Nothing says the difference is the buyer protection fee.
- **Suggested fix:** Label both: "Card $30.00 AUD · Total with protection fee $30.90 AUD". Or show the item price only in the chat header and leave the total to the contract header.

### [P2] Money formatting varies between screens
- **Where:** Listing `$21 AUD` (`messaging.over-4000-chars-refused` desktop step 2) vs thread `$20.00 AUD` (phone step 2). Contract `$30.90 AUD total`. Catalog `From $20 AUD`.
- **What's wrong:** Whole dollars on listings and cents in rooms. The ISO code is present everywhere, as the rule requires, but the decimals change between places that show the same amount.
- **Suggested fix:** Route every display through `formatMoney` with one rule: always show minor units, or drop them only when they are `.00`, applied everywhere.

### [P2] Message length limit is invisible until refused
- **Where:** `messaging.over-4000-chars-refused` step 2, desktop and phone (`…\step-02.buyer.png`).
- **What's wrong:** The listing "Send seller a message" box is one line and scrolls sideways. There is no counter, and the button just spins. The phone composer grows to five lines with no limit shown.
- **Suggested fix:** Show a counter from 3,500 characters ("3,812 / 4,000"), disable Send above 4,000 with the reason, and use a textarea that grows up to 4 lines on the listing page. The review dialog already has a "30/1000" counter, so reuse it.

### [P3] Same "no contract" disclaimer shown on every thread
- **Where:** `messaging.send-and-live-delivery` step 2, desktop and phone.
- **What's wrong:** "No contract yet — messages alone do not reserve goods or hold payment." is a permanent banner, and the header chip says "No contract" again.
- **Suggested fix:** Keep the banner, drop the chip, and add a single action: "Buy now" or "Propose trade".

### [P3] Reset confirmation buttons don't match
- **Where:** `auth.password-reset.enumeration-safe-and-admin-link` step 1, desktop (`…\desktop\…\step-01.visitor.png`).
- **What's wrong:** "Send another" and "Back to sign in" have different heights and font sizes side by side. The copy "It expires shortly, so use it soon" is vague.
- **Suggested fix:** Use the same button size for both and make "Back to sign in" the primary one. State the expiry: "The link works for 1 hour."

### [P3] Phone reset form shows an error before the visitor types
- **Where:** `auth.password-reset.enumeration-safe-and-admin-link` step 1, phone (`…\phone\…\step-01.visitor.png`).
- **What's wrong:** A red border and "Enter the email address you signed up with." appear on an empty field.
- **Suggested fix:** Validate on submit or on blur only.

### [P3] Phone listing detail: title and price fall below the action bar
- **Where:** `reviews-reports.report-does-not-notify-target` step 2, phone (`…\phone\…\step-02.reporter.png`).
- **What's wrong:** The image runs straight into the Message, Save, Offer, Trade and "Buy" bar. The title, price and "AUD" are not visible above it, so "Buy" appears before the member sees the price.
- **Suggested fix:** Put the title, price (with ISO code) and condition directly under the image, and keep the bar sticky at the bottom of the viewport.

### [P3] "Trusted Seller" copy overstates the review
- **Where:** `profile-payouts.payouts-dashboard-and-redirect` step 2, desktop and phone.
- **What's wrong:** "Our team reviewed your selling history" sits in the same card group as the Stripe checks and reads like a third verification.
- **Suggested fix:** Move it to its own section titled "Badges", with the copy "Approved by NoDitto staff. It isn't an ID check or a guarantee."

## Responsive notes

### 1280x720 desktop
- The fixed 256px "Account/Marketplace" rail costs 20% of the width everywhere. On Messages, sale rooms and Payouts, collapse it to a 64px icon rail below 1440. That gives the inbox and thread about 1,200px together and stops the "Pay to lock it in" label wrapping onto two lines next to "Accept terms and pay".
- The onboarding dialog (672px) splits the identity step into two columns, and the description wraps at about 220px. Stack the button under the text at this width, or make the dialog 560px and single-column.
- The Profile tab content column is 672px inside a 1,024px area, which leaves about 175px empty on the right. That is acceptable, but align the tab bar and the header to the same left edge (header avatar at 436px, cards at 432px).
- Long pages (Activity at 4,888px, Payouts at 6,743px, Inbox at 8,488px) need paging or "Load more". At 720px tall the summary scrolls away after one screen.
- The contract header right side (status chip, total, step text) packs into about 260px, and "Step 2 of 4 · Payment" sits under the total. Give the total its own line or move the step text into the progress rail.

### Phone (390pt)
- In every full-page capture the bottom tab bar is fixed over the middle of long pages, covering rows such as Payout destination and Browsing region. Check that the bar and the listing action bar are `position: fixed` to the viewport, and add bottom padding equal to the bar height plus the safe area so the last row clears it.
- Contract and thread headers: split into two lines (title, then price and status) and remove the inline "View listing" and "No contract" controls.
- In a thread, hide the 5-tab bar so the composer and banner get the space. The composer, the "No contract yet" banner and the tab bar currently take about 210pt of 844.
- The account hub's 8-icon grid (Activity, Saved, Offers, Listings, Purchases, Sales, Trades, Private Deal) pushes the Profile, Verification and Payouts tabs below the fold. Put the tabs first, or reduce the grid to one scrolling row.
- Settings rows with a value on the right (Payment method, Browsing region) truncate both sides. Stack the value under the label at 390pt.
- Auth screens use large type (the "Sign in" title is about 60px at 3x, roughly 20pt). That's fine, but the error toast lands over the bottom link. Anchor toasts to the top on phone.
