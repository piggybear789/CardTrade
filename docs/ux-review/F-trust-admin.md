# UX review F: trust pages, admin console, marketing pages and route guards

**Summary**
1. The public trust surfaces (References, Report a scam, Trusted Seller apply) are calm and readable, but a few lines overclaim. The worst is /safety telling buyers there is "always a real, verified person on the other side". A buyer is never ID-checked.
2. References break the product rule against a score: the graph node says "100% good", and the landing list shows only "N positive" counts, which hides the bad and so-so counts.
3. The admin console is the weakest area. Payouts, Scams and Trusted sellers each render every record as a full card in one column, so pages run 5,000 to 13,000 px tall. The tab bar does not fit at 1280 px or on phone.
4. The same states are handled differently on different screens. An unverified member sees the full Trusted Seller form but no scam form. Phone sign-in disables its button, desktop does not. Refusals show "Not authorized" on one route and a 404 on another.
5. Polish issues repeat across several flows: the "Skip to Main Content" link becomes visible after every submit, toasts cover row actions, chips are truncated ("PayPal Friend…"), and avatar initials are built from a bracket ("[E").

---

## P1

### [P1] /safety says every counterparty is a verified person
- **Where:** marketing-errors.public-pages-and-not-found, step 4, desktop and phone. `audit-artifacts\marketing-errors.public-pages-and-not-found\desktop\2026-11-26T01-42-49Z-g4ea9pj\step-04.visitor.png`, `...\phone\...\step-04.visitor.png`
- **What's wrong:** "anyone who lists, sells or trades has had their photo ID and a selfie checked by Stripe first, so you always know there's a real, verified person on the other side." A seller looking at a cash buyer sees an unverified person. Buyers are exempt from the Identity_Gate unless they pay over the unverified-buyer limit, so this line is false for half the members who read it.
- **Suggested fix:** "Anyone who lists, sells or trades has had a photo ID and selfie checked by Stripe. Buyers paying by card don't need an ID check, but their money is held until the deal is done."

### [P1] References show a percentage score, and the landing list hides negative counts
- **Where:** references.leave-and-graph-api, step 1, desktop and phone; step 2, desktop. `audit-artifacts\references.leave-and-graph-api\desktop\2026-11-26T01-42-49Z-g4ea9pj\step-01.member.png`, `...\phone\...\step-01.member.png`, `...\desktop\...\step-02.member.png`
- **What's wrong:** The centre node of the Trust Network reads "@noditto.demo.alice 100% good". That is a reference score in all but name, which the product rules ban, and it rounds badly at low counts (1 of 1 also gives "100% good"). The "Most referenced" rows and the profile header show only "8 positive" / "7 positive", so a handle with 8 good and 5 bad looks identical to one with 8 good and none bad. The landing promise "Good and bad experiences shown" is not true of the list directly under it.
- **Suggested fix:** Remove the percentage from the node and show the people tally instead ("8 good · 0 so-so · 1 bad"). Show all three counts on every list row and in the profile header, even when a count is 0, so the row width stays fixed. Colour the bad count, not the whole row.
- **Mobbin reference:** [Dollar Shave Club reviews](https://mobbin.com/screens/f6cee98d-c71a-4eeb-b584-cb1fea01f786?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) always shows the full breakdown with zero rows included, so a missing bad count can't be read as "none". Use its breakdown idea, not its average.

### [P1] The Admin Payouts tab renders dozens of identical custody cards (10,808 px)
- **Where:** admin.staff-console-and-two-person-proposal, step 1, desktop. `audit-artifacts\admin.staff-console-and-two-person-proposal\desktop\2026-11-26T01-42-49Z-g4ea9pj\step-01.admin1.png`
- **What's wrong:** "Money held for members — United States platform, USD balance" appears 30 or more times, each card with a "Fresh reading" chip, three columns of USD figures and the same explanatory paragraph. Only one card (Australia platform, AUD) is different. The control this panel exists for, a shortfall, would be lost in that repetition. The real work items ("Seller open-sales limit", "Seller release holds") sit at the very bottom of a 10,000 px page.
- **Suggested fix:** Show one row per platform and currency, with a status column (Balanced / Short by X USD) and the reading time. Move the explanation behind one "How this is calculated" disclosure. Put the action queues (stuck payouts, holds, limits) above the reconciliation.
- **Mobbin reference:** [Stripe Radar reviews](https://mobbin.com/screens/2c5ac1d2-c3e5-42ae-9394-88445d4e7dd7?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) puts the count tiles first and the filters on one line, with no per-record prose.

### [P1] The Admin Scams and Trusted sellers queues are endless card stacks with no triage
- **Where:** scam-reports.submit-and-staff-cluster, step 2, desktop (13,394 px). trusted-sellers.apply-and-approve, step 2, desktop (5,174 px) and phone (20,160 px). `audit-artifacts\scam-reports.submit-and-staff-cluster\desktop\2026-11-26T01-42-49Z-g4ea9pj\step-02.staff.png`, `audit-artifacts\trusted-sellers.apply-and-approve\desktop\2026-11-26T01-42-49Z-g4ea9pj\step-02.staff.png`, `...\phone\...\step-02.staff.png`
- **What's wrong:** Every scam report is a full card with a large salmon evidence block, a private-notes textarea and four buttons, and they run one after another. Approved Trusted Seller rows ("APPROVED", "Revoke") render with full applications and notes boxes, mixed in with the one that needs a decision. The header counter "0 ready" sits beside a list that is almost all already-decided rows. On phone every card is repeated at full width, so the one pending applicant sits among 20,000 px of approved ones.
- **Suggested fix:** Default each queue to "Needs a decision" and move decided rows to an "Approved / Declined" filter. Use a compact list (name, status, age, cluster strength) and open a detail pane on the right at ≥1024 px. Collapse private notes until clicked. Lazy-load evidence thumbnails at a fixed size.
- **Mobbin reference:** [Google Classroom "To review"](https://mobbin.com/screens/1af1974a-ea2a-4a50-b94f-16da45a502ad?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) groups work by state with counts and keeps each row to one line. [Braintrust human review](https://mobbin.com/screens/10082e65-e881-4f06-89a5-5556ae465265?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) uses a list-detail layout with "Next row" for working through a queue.

---

## P2

### [P2] The sign-in trust panel credits Stripe with holding the money
- **Where:** guards.protected-routes-redirect-with-return-path, steps 1–5, desktop. `audit-artifacts\guards.protected-routes-redirect-with-return-path\desktop\2026-11-26T01-42-49Z-g4ea9pj\step-01.visitor.png`
- **What's wrong:** "Stripe holds a purchase until you have the card and say it is right." NoDitto holds the funds in its platform balance and Stripe processes the payment, and Stripe says it does not provide escrow. The headline "Trade cards without trusting strangers" also promises more than the system gives.
- **Suggested fix:** "We hold your payment until you have the card and say it's right." Headline: "Buy, sell and trade cards with your payment held until you accept."

### [P2] The Admin tab bar overflows at 1280 px and on phone
- **Where:** admin.staff-console-and-two-person-proposal, step 1, desktop. scam-reports.submit-and-staff-cluster, step 2, desktop. trusted-sellers.apply-and-approve, step 2, phone.
- **What's wrong:** There are ten tabs ("Payouts 0, Reports 2, Feedback, Errors 36, Reconciliation 7, Trusted sellers, References, Scams 20…"). The last tab touches the right edge at 1280 px. On phone only four tabs show, with no sign the row scrolls, so Scams and References can't be found.
- **Suggested fix:** Group the tabs into Money (Payouts, Reconciliation), Trust & safety (Reports, Scams, Trusted sellers, References) and System (Errors, Feedback), with a second row or a left rail. On phone, use a select ("Queue: Scams (20)") instead of a tab strip.

### [P2] Unverified members are gated differently on the scam and Trusted Seller pages
- **Where:** scam-reports.unverified-member-refused, step 1, desktop and phone. trusted-sellers.unverified-refused, step 1, desktop and phone. `audit-artifacts\scam-reports.unverified-member-refused\desktop\...\step-01.unverified.png`, `audit-artifacts\trusted-sellers.unverified-refused\desktop\...\step-01.unverified.png`
- **What's wrong:** /report-scam hides the form and shows "Verify your ID first". /trusted-sellers/apply shows the whole form, including "Send application" as the primary black button, with "Verify ID" as a secondary outline button above it. The more important action (verify) has the weaker style, and a member can send an application that "We can't approve … until that's done".
- **Suggested fix:** Use one pattern on both pages. Make "Verify ID" the primary button. Keep the form visible below it but greyed out with "Unlocks after your ID check", or let members fill it in but label the submit "Save and verify ID".

### [P2] The Trusted Seller apply page never says what the badge is not
- **Where:** trusted-sellers.apply-and-approve, step 1, desktop and phone. trusted-sellers.unverified-refused, step 1. `audit-artifacts\trusted-sellers.unverified-refused\phone\...\step-01.unverified.png`
- **What's wrong:** The page explains how to apply but not what approval means. The Terms carry the caveat ("our own judgement … not a guarantee"), but applicants and the profile badge ("Trusted Seller" next to "ID verified") show nothing like it. On the profile the two badges look like one combined claim.
- **Suggested fix:** Add one line under the apply heading: "It's our judgement after checking your selling history. It isn't a guarantee, and buyers keep the same protection either way." Give the profile badge a tooltip or popover with the same sentence.

### [P2] The References landing promise overclaims
- **Where:** references.leave-and-graph-api, step 1, desktop and phone.
- **What's wrong:** "…to check references and see if they're real." References are not pre-checked, so NoDitto can't tell anyone whether a person is "real". "ID-verified references only" is accurate about the authors but reads as if the subject was verified too.
- **Suggested fix:** "Look up any handle, eBay seller or Facebook Marketplace name to see what people who've dealt with them say." Chip: "Every reference is from an ID-checked member."

### [P2] The empty references page repeats "0" and the handle, and its footprint check can imply clearance
- **Where:** references.missing-sentiment-refused, step 1, desktop and phone. `audit-artifacts\references.missing-sentiment-refused\desktop\2026-11-26T01-42-49Z-g4ea9pj\step-01.member.png`
- **What's wrong:** One screen says "0 References", "References ✓ 0 positive" (a green check beside zero), "NE @new" and "No references yet for @new". "Checking digital footprint 0 of 6" lists "Scam database Checking…". If that resolves to "No matches", members will read it as "safe". Also, this test asserts a refusal for a missing sentiment, but the screenshot shows the handle page and not the composer's inline error, so the refusal UI isn't evidenced.
- **Suggested fix:** Drop the big "0 References" stat when it's zero, and drop the green check on a zero count. Show the handle once. Word the scam row result as "No reports found. That doesn't mean they're safe." Capture the composer with its sentiment error in the test.

### [P2] The profile header says "No ratings yet" beside references and a Trusted Seller badge
- **Where:** references.leave-and-graph-api, step 2, desktop. trusted-sellers.apply-and-approve, step 3, desktop and phone. `audit-artifacts\trusted-sellers.apply-and-approve\desktop\...\step-03.applicant.png`
- **What's wrong:** Alice's header reads "Trusted Seller · No ratings yet" with "7 positive" references just below. A first-time visitor sees two reputation systems that disagree. The applicant header reads "ID verified · E2e", where the given-name slot shows a seed artefact, and the empty-state avatar shows "[E" because initials were taken from "[E2E]".
- **Suggested fix:** In the header, show NoDitto sales reviews as "No sales reviews yet", next to the reference tally, with each source labelled. Build initials from letters only, ignoring brackets and punctuation.

### [P2] The scam form truncates payment chips and shows a raw month input
- **Where:** scam-reports.submit-and-staff-cluster, step 1, desktop and phone. `audit-artifacts\scam-reports.submit-and-staff-cluster\desktop\...\step-01.reporter.png`, `...\phone\...\step-01.reporter.png`
- **What's wrong:** The chips read "PayPal Friend…" and "PayPal Goods…" at both sizes, and that difference is exactly what the reporter needs to tell apart. "Roughly when" shows Chromium's "--------- ----" placeholder on desktop and an empty box on phone.
- **Suggested fix:** Label the chips "PayPal (friends)" and "PayPal (goods)", or let them wrap to two lines. Replace the native month input with two selects (Month, Year) or chips ("This month", "Last month", "Earlier…").
- **Mobbin reference:** [Revolut "What's the issue?"](https://mobbin.com/screens/0537c3f7-04a4-4a57-86ef-6d47b9224302?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) starts with a short list of full-width, untruncated choices before asking for detail.

### [P2] Toasts cover row actions and sit on the phone tab bar
- **Where:** scam-reports.submit-and-staff-cluster, step 1, desktop and phone. trusted-sellers.apply-and-approve, steps 1–2.
- **What's wrong:** On desktop the "Report sent…" toast covers the "Withdraw" button of the new row in "Your reports", leaving "Withd". On phone it covers the report row and touches the bottom nav. In admin, "Approved. Their badge is live." covers the next card's fields.
- **Suggested fix:** Offset toasts above the phone tab bar (bottom inset plus the bar's height). On desktop, place them top-right in console pages, or keep them clear of the content column.

### [P2] The skip link becomes visible after every form submit
- **Where:** scam-reports.submit-and-staff-cluster, step 1, desktop and phone. trusted-sellers.apply-and-approve, steps 1–2, desktop and phone.
- **What's wrong:** A purple "Skip to Main Content" button floats over the page heading after submitting. Focus is being sent to the top of the document, so a keyboard user also loses their place. Its Title Case also differs from the sentence case used everywhere else.
- **Suggested fix:** After a successful submit, move focus to the new status heading ("Thanks, we've got your application") or the new row, and not to the document. Rename it "Skip to main content".

### [P2] Refusals look different on different routes
- **Where:** admin.non-staff-refused, step 1, desktop and phone. admin.staff-console-and-two-person-proposal, step 2, desktop. guards.non-party-and-mobile-api-refused, steps 3–4, desktop and phone.
- **What's wrong:** A member on /admin sees "Not authorized / You don't have permission to view the operations console" with an outline "Return home" button. An outsider on /sales/[id] gets the 404 (that is right, because it doesn't leak that the contract exists). Admin2, a staff account in the test, is shown "Not authorized" on ?tab=arbitration with no hint about which role is missing. "Not authorized" is also a weak heading with a weak button.
- **Suggested fix:** Keep the 404 for contracts. For admin, use the heading "This page is for NoDitto staff" and a filled "Back to marketplace" button. For a staff member missing a capability, say which one: "Arbitration needs support access. Ask an admin to add it."

---

## P3

### [P3] Terms and Privacy are a single wall with no contents or summary
- **Where:** marketing-errors.public-pages-and-not-found, steps 2–3, desktop (7,019 px and 5,066 px) and phone (29,967 px and 22,080 px).
- **What's wrong:** There are 20 sections in Terms, and the phone page is about 75 screens long. There is no table of contents, no "jump to" and no back-to-top. The opening already tells readers to "read in particular sections 6 to 9 on payments and section 15 on our liability", which is a contents list written as a sentence.
- **Suggested fix:** Add a "Key points" box (5 bullets: held payments, inspection windows, trade collateral, fees, liability) and a numbered contents list. Make the contents sticky in a left column at ≥1024 px. Add anchor links on headings and a floating "Contents" button on phone.
- **Mobbin reference:** [Spellbook agreement summary](https://mobbin.com/screens/9e7c9bc1-b8a5-4491-a414-64121ca16323?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) leads with bolded topic bullets before the full text.

### [P3] The /safety intro and callout repeat each other and run long
- **Where:** marketing-errors.public-pages-and-not-found, step 4, desktop and phone.
- **What's wrong:** "Most deals on NoDitto go off without a hitch, and the system is built so that when one doesn't, you've still got a way back. This page explains how that works…" comes before the actual rule. The callout then says the same thing at length ("Everything we can do to help depends on the deal having happened on the platform…"). "When to walk away" is two dense paragraphs of red flags that would scan better as a list.
- **Suggested fix:** Open with the callout as one line: "Keep the whole deal on NoDitto: pay, chat and post here." Turn the red flags into a bulleted list of 6 items. Link "Report a scam" from this page, since that is where scammed members land.

### [P3] The Help page has no direct path to "Report a scam"
- **Where:** marketing-errors.public-pages-and-not-found, step 1, desktop and phone.
- **What's wrong:** "I was scammed outside NoDitto" is the first question, but it is an accordion row like the rest. "Still stuck?" offers "Sign in to contact us" only, so a guest has no way to reach anyone.
- **Suggested fix:** Pin two action rows above the FAQ: "Report a scam" and "Problem with a deal" (which goes to the contract room). For guests, offer a contact email next to sign-in.
- **Mobbin reference:** [Aave Help & Support](https://mobbin.com/screens/08ce8125-f2b2-4ae2-88e3-33f1c0b77715?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) separates "Get support" actions from "Common questions".

### [P3] The 404 copy has a filler line and the page loses the phone nav for guests
- **Where:** marketing-errors.public-pages-and-not-found, step 5, desktop and phone. guards.non-party-and-mobile-api-refused, step 3, phone.
- **What's wrong:** "Everything on NoDitto stays one click from the marketplace." adds nothing. On phone, a signed-in member's 404 keeps the bottom tab bar but a guest's 404 has none, while the guest Help page does show one.
- **Suggested fix:** Cut the second sentence. Add a secondary link ("Search references" or "Help"). Render the guest tab bar on 404 the same way as on Help.

### [P3] Sign-in button state differs between phone and desktop
- **Where:** guards.protected-routes-redirect-with-return-path, steps 1–5, desktop and phone.
- **What's wrong:** The phone shows a grey disabled "Sign in" before any input, while desktop shows it black and enabled. The phone also drops the "why NoDitto" panel entirely, which is fine, but nothing tells the visitor they were redirected from /admin or /trades.
- **Suggested fix:** Keep the button enabled and validate on submit, on both sizes. When a `redirectTo` is present, add a one-line note: "Sign in to see your trades."

### [P3] API refusals render as blank white pages in a browser
- **Where:** jobs-webhooks.unauthorized-job-and-invalid-signature-refused, steps 1–2. marketing-errors.api-errors-anonymous-no-origin-refused, step 1, desktop. guards.non-party-and-mobile-api-refused, step 4.
- **What's wrong:** These are correct refusals, but the screenshots are blank, so the capture proves nothing visually and a curious member who opens the URL sees an empty page.
- **Suggested fix:** Leave the endpoints unchanged. In the e2e harness, screenshot the response status and body (for example, a small rendered page of the JSON) so these steps have evidence.

### [P3] The Trusted Seller application status hides its heading at 1280×720 and has a weak next step
- **Where:** trusted-sellers.apply-and-approve, step 1, desktop and phone. `audit-artifacts\trusted-sellers.apply-and-approve\desktop\...\step-01.applicant.png`
- **What's wrong:** After submit the page is scrolled so "Thanks, we've got your application" sits under the header, and the first visible line is the subhead. "Review: In progress. This can take a while." gives no timeframe. The two equal outline buttons ("Edit application", "See References") don't say what to do while waiting.
- **Suggested fix:** Scroll to the top or focus the heading after submit. Give a range ("Usually within 3 working days"). Make the second button about the member's own page: "Ask for references".
- **Mobbin reference:** [Contra "Your job is in review"](https://mobbin.com/screens/b088ce32-c691-4b2d-b890-6d14f08cc0af?utm_source=other&utm_medium=ai-assistant&utm_source_platform=mcp) pairs the in-review state with one clear next action.

### [P3] The admin Trusted sellers intro is a paragraph of policy
- **Where:** trusted-sellers.apply-and-approve, step 2, desktop and phone.
- **What's wrong:** "Members who applied from the Trusted Seller page. Read what they told us, check it yourself, keep notes here, then decide. Approving adds the badge and raises their open-sales limit; it never skips the ID check, and approval stays locked until that has passed. Nothing here moves money." Staff need this once, not on every visit.
- **Suggested fix:** Use one line, "Approving adds the badge and raises the open-sales limit. It never moves money.", with an info popover for the rest.

---

## Responsive notes

**1280×720 desktop**
- Console pages use a single 700 px content column inside the rail, so the payout, scam and trusted-seller cards waste roughly 300 px on the right. At ≥1200 px, use a list-detail split (list about 420 px, detail filling the rest).
- The admin tab strip needs grouping or a second row at this width (see P2).
- The seller/references profile (references.leave-and-graph-api step 2) puts the graph, the reference list and then 30 listing tiles, five across, into one 4,600 px page. Paginate listings at 10 and give "Listings" and "References" tabs at the top so the page doesn't run on for screens.
- Long pages (Terms 7,019 px, Privacy 5,066 px) need a sticky contents column. The 680 px text column is good for reading and should stay.
- Full-page captures show the sticky site header floating mid-page (scam report, Trusted Seller admin). That is a capture artefact, but it confirms the header is `position: sticky`. Make sure toasts and the skip link don't stack with it.

**Phone (390 px)**
- Bottom tab bar: on several pages (Help, Safety, Report a scam, Trusted Seller apply) the last block of content scrolls under the bar, for example "Verify ID" cut in half on report-scam unverified. Add `padding-bottom: calc(tab-bar height + safe-area)` to the page shell.
- Toasts need the same bottom offset so they clear the tab bar.
- Reference list rows wrap the platform icons onto a second line ("ebay · W · Other · Discord · NoDitto"), and the count column then centres against the taller row. Cap the icons at 3 plus "+2" and keep the counts top-aligned.
- Admin on phone: replace the tab strip with a select, show queue rows as one-line items, and open details full-screen. A 20,000 px Trusted Seller page isn't workable.
- The empty-state on the references page is about 500 px of whitespace around "NE @new". Reduce it to a compact 160 px block so "Leave a reference" stays above the fold.
- The phone 404 heading ("We couldn't find that page") is about 32 px on two short lines, which is fine. Keep it, and add the guest tab bar for consistency.
- The phone sign-in and Help type sizes are good. The scam form's 2-column payment chips should drop to full-width chips under 360 px so the labels never truncate.
