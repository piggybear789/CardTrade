# Copy rewrites (draft)

A proposed rewrite for each line flagged in `ai-patterns.md`. Rules used: no em dashes, no "it's not X, it's Y" or "X, not Y", no "rather than / instead of", no filler ("actually", "just", "really", "genuinely"), "never" only where it is a plain fact. Facts and promises are unchanged; where a line is a product rule, the rewrite says the same rule.

**Keep** means leave it: prompts sent to AI models, developer-only errors, legal wording, or a "never" that is a plain fact. `…` is a value filled in at runtime. Nothing here is applied to the code yet.

## 1 · Contract rooms (trades and cash sales)

| Where | Current | Rewrite |
|---|---|---|
| `contract/AcceptWithPhotoDialog.tsx:122` | Video taken at acceptance — record of item condition when received. | Video taken when you accepted. It shows the item's condition on arrival. |
| `contract/AcceptWithPhotoDialog.tsx:123` | Photo taken at acceptance — record of item condition when received. | Photo taken when you accepted. It shows the item's condition on arrival. |
| `contract/AcceptWithPhotoDialog.tsx:201` | Recommended — it is your evidence if there is a dispute later. | Recommended. It's your evidence if there's a dispute later. |
| `contract/ContractHoldList.tsx:25` | Expired — no longer protected | Expired. No longer protected |
| `fulfilment/DeliveryAddressPanel.tsx:329` | Addresses are never shown in chat, and only to the sender. | Only the sender sees this address. It doesn't appear in chat. |
| `fulfilment/HandoverFailedDialog.tsx:98` | e.g. they did not show up, the item was not what was agreed, the parcel never arrived… | e.g. they didn't show up, the item wasn't what we agreed, the parcel didn't arrive… |
| `fulfilment/HandoverFailedDialog.tsx:255` | Attach up to … photos — damaged packaging, screenshots, the item you received. | Attach up to … photos: damaged packaging, screenshots, the item you received. |
| `fulfilment/InspectionCountdown.tsx:148` | The collateral authorisation on this trade expires before the inspection window closes. Raise a dispute now rather than later: after the authorisation lapses there is nothing left to capture. | The holds on this trade expire before the inspection window closes. If something is wrong, raise it now. Once the holds expire, there's nothing left to recover. |
| `payouts/PayoutReturnRefresh.tsx:56` | Payouts are set up — releases will be sent automatically. | Payouts are set up. We'll send your money automatically. |
| `payouts/PayoutSummary.tsx:106` | NoDitto is not a bank. What we hold for you sits with Stripe… It earns no interest and there is nothing here to withdraw. | Money we hold for you sits with Stripe, our payment provider, until a sale settles. Then it goes to your payout account automatically. It earns no interest, and you can't withdraw it from here. |
| `payouts/PayoutsDashboard.tsx:756` | Money under dispute is counted here only — not in "Owed to you" or "Held for open sales" — until the outcome is decided. | Money under dispute is counted here until the dispute is decided. It's left out of "Owed to you" and "Held for open sales". |
| `sales/CashSaleDisputeResolution.tsx:213` | they must post it back to you first — the … is refunded | they post it back to you first, and the … is refunded |
| `sales/CashSaleDisputeResolution.tsx:215` | If the item never reached them, they are refunded straight away. | If the item didn't reach them, they're refunded straight away. |
| `sales/CashSaleReturnPanel.tsx:185` | Return postage is at your cost and is not refunded. Use a tracked service — the refund depends on the carrier confirming delivery… | You pay return postage, and it isn't refunded. Use a tracked service: your refund is released when the carrier confirms delivery. |
| `sales/CashSaleReturnPanel.tsx:199` | If you miss it, our team reviews the case instead of closing it automatically — your refund is not cancelled, but it takes longer. | If you miss it, our team reviews the case. You still get your refund, but it takes longer. |
| `sales/CashSaleReturnPanel.tsx:284` | arrived if you can — an empty or wrong parcel is much easier to act on with them. | arrived if you can. Photos make an empty or wrong parcel much easier to sort out. |
| `sales/CashSaleView.tsx:2052` | … has already confirmed. Your confirmation starts a 24-hour window… Only confirm if you met and the item actually changed hands. | … has already confirmed. When you confirm, the buyer has 24 hours to raise a problem, and then the seller is paid. Only confirm once you've met and swapped. |
| `sales/CashSaleView.tsx:2053` | Only confirm if you met and the item actually changed hands. When you both confirm… — one confirmation is not enough. | Only confirm once you've met and swapped. After you both confirm, the buyer has 24 hours to raise a problem before the seller is paid. |
| `sales/HandoverFailedDialog.tsx:58` | Describe what went wrong. This raises a dispute and freezes the money — nothing is released… | Describe what went wrong. This raises a dispute and freezes the money until NoDitto support reviews it. Support can refund you in full, refund part, or let the sale stand. We'll tell you the outcome. |
| `trade/ActionBar.tsx:128` | Only confirm if you met and the goods actually changed hands. This does not release either deposit — you still get… | Only confirm once you've met and swapped. Both holds stay in place, and you still have … days to check what you got. |
| `trade/ActionBar.tsx:182` | The trade was just updated by someone else. Please try again. | The other trader updated this trade a moment ago. Please try again. |
| `trade/ActionBar.tsx:240` / `:487` | Item never arrived / Report an item that never arrived | Keep |
| `trade/ActionBar.tsx:490` | …The trade freezes for review and NOTHING is charged to either of you — NoDitto support decides what happens next. | Use this if the other trader didn't show up, refused to hand over, or the swap went wrong. The trade freezes and neither of you is charged. NoDitto support decides what happens next. |
| `trade/ActionBar.tsx:491` | …NOTHING is charged to either of you — a lost parcel is nobody's fault, so no deposit is taken while an operator looks at it. | Use this if the parcel hasn't arrived or arrived empty. The trade freezes and neither of you is charged while support looks into it. |
| `trade/DemoPanel.tsx:87` | Simulated payments — not live Stripe | Simulated payments (test only) |
| `trade/HoldStatus.tsx:43` | Expired — no longer protected | Expired. No longer protected |
| `trade/HoldStatus.tsx:66` | Your hold is placed before the meeting. It is a temporary hold on your card, not a payment. | Your hold is placed before the meeting. It's a temporary hold on your card, and nothing is charged. |
| `trade/HoldStatus.tsx:70` | A temporary hold, not a payment. It is released when the trade completes. | Nothing is charged. The hold is released when the trade completes. |
| `trade/ShippingDeadline.tsx:165` | Post now — the trade loses its collateral protection when the hold lapses. | Post now. The trade loses its protection when the holds expire. |
| `trade/TradeContract.tsx:405` | You can keep trading — collateral covers the goods. Stripe moves the cash once the receiver can take payouts. | You can keep trading. The holds cover the goods, and Stripe sends the cash once the receiver has set up payouts. |
| `trade/TradeNegotiationPanel.tsx:369` | A temporary hold, not a charge. Released when the trade completes. | A temporary hold on your card. Nothing is charged, and it's released when the trade completes. |
| `lib/handover/terms.ts:60` | , plus a … currency conversion fee (…, not refunded). | , plus a … currency conversion fee (…, non-refundable). |
| `lib/handover/terms.ts:132` | Delivered — free delivery. | Delivered, free postage. |
| `lib/handover/terms.ts:133` | Delivered — … delivery on top of the cash amount. | Delivered, with … postage on top of the cash. |
| `lib/handover/terms.ts:238` | Delivery — set postage | Delivery: set postage |
| `lib/fees/feeLabels.ts:125` | …The collateral itself is a card hold, not a charge. | …The collateral is a card hold, so nothing is charged for it. |

## 2 · Private deals

| Where | Current | Rewrite |
|---|---|---|
| `deals/DealComposeForm.tsx:1017` | Only people with the link can open it, and it never appears in the catalog. The first person to join gets the deal… | Only people with the link can open it. It stays out of the catalog. The first person to join gets the deal, and you can edit it until then; the link stays the same. |
| `deals/DealComposeForm.tsx:1090` | It never appears in the catalog. The first person to join gets the deal… | It stays out of the catalog. The first person to join gets the deal, and you can edit it until then; the link stays the same. |
| `deals/DealComposeForm.tsx:1331` | Only people with the link can open it, and it never appears in the catalog. It lasts 14 days, and you can cancel it any time. | Only people with the link can open it, and it stays out of the catalog. It lasts 14 days, and you can cancel it any time. |
| `deals/DealTermsBreakdown.tsx:95` | A temporary hold, not a charge. It's released when the trade completes. | A temporary hold on your card. Nothing is charged, and it's released when the trade completes. |

## 3 · Listings, catalog and offers

| Where | Current | Rewrite |
|---|---|---|
| `listings/[id]/(detail)/page.tsx:1086` | …Add anything else to that contract rather than starting a second one. | You already have an open contract with this seller for items from this listing. Add anything else to that contract. |
| `listings/[id]/error.tsx:25` | It's still there, we just couldn't fetch it. Try again in a moment. | The listing is still there, but we couldn't load it. Try again in a moment. |
| `sellers/[id]/page.tsx:93` | Trading card listings from … on NoDitto — identity-checked seller, payments held until you accept the card. | Trading card listings from … on NoDitto. ID-checked seller, and your payment is held until you accept the card. |
| `listings/ListingDesktopPane.tsx:270` | — Read seller reviews | Read seller reviews |

## 4 · Sign-up, onboarding, identity and profile

| Where | Current | Rewrite |
|---|---|---|
| `profile/(hub)/page.tsx:589` | Stripe collects your bank details directly. NoDitto never sees them. | Keep |
| `account/AccountSecuritySettings.tsx:117` | Always sent, so you never miss a window that protects you. | Always sent, so you don't miss a deadline that protects you. |
| `auth/RequestResetForm.tsx:157` | Never confirmed your email? | Didn't confirm your email? |
| `identity/IdentityCheckCard.tsx:154` | One step on Stripe's pages, with a photo ID and a selfie — NoDitto never sees the document. No bank details needed for this. | One step on Stripe's pages, with a photo ID and a selfie. Only Stripe sees the document, and no bank details are needed. |
| `identity/IdentityDemoControls.tsx:96` | Simulated identity check — not live Stripe | Simulated identity check (test only) |
| `identity/IdentityGatePrompt.tsx:130` | Still checking — we will update this automatically. | Still checking. This page updates by itself. |
| `identity/IdentityGatePrompt.tsx:156` | This step opens on Stripe's pages. NoDitto never sees the document. | Keep |
| `onboarding/OnboardingWizard.tsx:623` | No regions are open for deals right now. Please try again shortly — you can still browse listings in the meantime. | No regions are open for deals right now. Please try again soon. You can still browse listings meanwhile. |
| `onboarding/UnifiedOnboardingSurface.tsx:100` | …You can safely leave this page — we will update it when the result arrives. | Stripe is still reviewing your document. Most checks take a few minutes; a manual review can take longer. You can leave this page, and we'll update it when the result comes in. |
| `profile/AvatarUploadField.tsx:251` | …Shown next to your name on listings and in chats — it is not used to verify you. | Optional. PNG, JPEG or WebP, up to 2 MB. Shown next to your name on listings and in chats. |
| `profile/PayoutOnboarding.tsx:308` | …NoDitto never shows your address or bank details. | Your verified name may be shown to a buyer on an agreed sale. Your address and bank details stay private. |
| `profile/PayoutOnboarding.tsx:338` | …Continue with Stripe to complete it — you will pick up where you left off. | Stripe hasn't finished your setup, so you can't be paid yet. Continue with Stripe to finish; you'll pick up where you left off. |
| `profile/ProfileSettingRows.tsx:112` | Private to you. An address is shared with a seller only when you choose it for a purchase or trade — never before. | Private to you. A seller only sees an address once you choose it for a purchase or trade. |
| `profile/SocialLinksEditor.tsx:80` | Username only — not the full link. | Just the username, e.g. noditto |
| `domain/orchestrator/accountClosureOrchestrator.ts:261` | We could not check your open contracts just now. Please try again. | We couldn't check your open contracts. Please try again. |
| `domain/orchestrator/accountClosureOrchestrator.ts:284` | We could not close your account just now. Nothing has changed. Please try again. | We couldn't close your account, and nothing has changed. Please try again. |
| `domain/orchestrator/accountClosureOrchestrator.ts:295` | We could not close your account just now. Please try again. | We couldn't close your account. Please try again. |
| `domain/validation/profile.ts:32`, `registration.ts:88` | Enter a complete email address, including the domain — like you@example.com | Enter a full email address, like you@example.com |
| `domain/references/profileForensics.ts:135` | Facebook numeric IDs starting with 6158–6159 are very recently created accounts (~2025–2026) — a major red flag… | Facebook IDs starting 6158 or 6159 belong to accounts made in 2025 or 2026. With no references, that's a major red flag on Marketplace. |
| `domain/references/profileForensics.ts:222` | Handle "@…" ends in a digit — double-check it isn't a secondary or throwaway account. | "@…" ends in a number. Check it isn't a second or throwaway account. |
| `domain/references/profileForensics.ts:272` | The account category is "…" while the bio advertises trading-card buying/selling — a strong sign of a repurposed or bought/hijacked account. | The account is listed as "…" but the bio sells trading cards. That often means the account was bought, hijacked or repurposed. |
| `domain/references/profileForensics.ts:371` | Classic "left as collateral / just recouping my cost" backstory | Classic "left as collateral" or "only covering my cost" story |
| `domain/references/profileForensics.ts:391` | …High-liquidity grail cards never need a ~50% cold-DM discount. | They mention ~$… value but offer ~$…. A card that sells easily doesn't need a half-price cold DM. |

## 5 · References, Trusted Sellers, scam reports

| Where | Current | Rewrite |
|---|---|---|
| `report-scam/response/[id]/page.tsx:75` | We don't act on a single report, and we never take action without checking first. | We don't act on a single report, and we always check before doing anything. |
| `api/references/ai-check/route.ts:44` | Too many checks — please wait a moment and try again. | Too many checks. Please wait a moment and try again. |
| `references/BackgroundCheckPanel.tsx:75` | Matches … scam report… — do not send unprotected payment. | Matches … scam report…. Don't send an unprotected payment. |
| `references/BackgroundCheckPanel.tsx:102` | Public signals from other sites — separate from NoDitto references. | Public information from other sites. These are separate from NoDitto references. |
| `references/BackgroundCheckPanel.tsx:118`, `footprintJudge.ts:283` | Names can overlap — double-check payment details before sending money. | Many people share a name. Check the payment details before sending money. |
| `references/BackgroundCheckPanel.tsx:1577` | …Compare the link, not the name, with the one you have dealt with before. Many real people share a name. | Scammers copy a real person's name and photos onto a new account. Check the profile link matches the one you've dealt with before; many real people share a name. |
| `references/ProofChallengeClient.tsx:94` | Hey — before I send payment for …, could you take a quick 10-second live photo with code … here? … | Hey, before I pay for …, could you take a quick live photo with code … here? … |
| `references/ProofChallengeClient.tsx:204` | Expires … · If you are the buyer, keep this page open — it updates automatically when the seller submits. | Expires … · If you're the buyer, keep this page open. It updates when the seller sends the photo. |
| `references/ReferenceSearch.tsx:131` | We couldn't search references just now. Please try again. | We couldn't search references. Please try again. |
| `references/ReferenceSearch.tsx:365` | Couldn't search just now | Search failed. Try again |
| `scamReports/ScamReportForm.tsx:337` | …We turn these into a code that can only be matched, never read back… | The PayID, bank account, PayPal, phone number or handle they gave you. We store it as a one-way code we can match against other reports, so we can spot the same person again. |
| `scamReports/ScamReportForm.tsx:454` | Scammers often use fake names, so we never match on this. It just helps us read the report. | Scammers often use fake names, so we don't match on this. It helps us read the report. |
| `scamReports/ScamReportResponseForm.tsx:35` | • Anything that shows what really happened | • Anything that shows what happened |
| `domain/references/bio.ts:186/190/193` | (instructions to the AI model) | Keep |
| `domain/references/enrichment.ts:397` | High-risk warning signals detected — pause before paying | High-risk signs found. Hold off on paying |
| `domain/references/enrichment.ts:438` | …Confirm they actually control the linked Instagram or eBay account… | Public signals exist, but a common name can belong to several people. Ask them to prove they control the linked Instagram or eBay account (e.g. DM you or claim it here). |
| `domain/references/enrichment.ts:439` | …confirm the person messaging you actually controls this account. | This handle is active on several platforms. Before paying, check the person messaging you controls this account. |
| `domain/references/enrichment.ts:449` | Suspicious or limited footprint — verify before paying | Little or suspicious history. Check before paying |
| `domain/references/enrichment.ts:450` | Limited verifiable footprint — verify before paying | Little history we can check. Check before paying |
| `domain/references/externalSeller.ts:240` | Say why it is not them, in at least … characters. | Say why this account belongs to someone else, in at least … characters. |
| `domain/references/facebookIndex.ts:344` | …compare the profile link, not the name. Many real people share a name, so this is not proof on its own. | Scammers copy a real person's name and photos onto a new account. Check the profile you're dealing with is the one with years of history, by its link. Many people share a name, so this alone proves nothing. |
| `domain/references/paymentForensics.ts:194` | Hijacked Facebook and Instagram accounts almost never have a bank or PayID in the profile owner's name… | Hijacked Facebook and Instagram accounts almost always ask for payment to someone else's bank or PayID. Paying a "partner" or "brother" account is a classic money-mule scam. |
| `domain/references/paymentForensics.ts:212` | This email uses a temporary inbox provider — legitimate sellers do not receive payouts on disposable email addresses. | This is a disposable email address. Real sellers don't take payouts on one. |
| `domain/references/reference.ts:36` | Item never arrived | Keep |
| `domain/risk/scamReports.ts:432` | A handle-only match is never enough to ban. | A handle match alone can't justify a ban. (Staff only) |

## 6 · Messages and notifications

| Where | Current | Rewrite |
|---|---|---|
| `messages/ChatThread.tsx:529` | No contract yet — messages alone do not reserve goods or hold payment. | No contract yet. Messages don't reserve anything or hold payment. |
| `lib/notifications/payoutNotifier.ts:28`, `supabaseCollateralDisbursementRepository.ts:213` | Payout on hold — finish your payout setup | Payout on hold: finish your payout setup |
| `lib/notifications/payoutNotifier.ts:120` | Dispute resolved — buyer refunded | Dispute resolved: buyer refunded |
| `lib/notifications/payoutNotifier.ts:135` | Dispute resolved — partial refund | Dispute resolved: partial refund |
| `lib/notifications/payoutNotifier.ts:143` | Dispute resolved — no refund | Dispute resolved: no refund |
| `lib/trades/cashSaleInspectionSweep.ts:83` | Sale completed — payout queued | Sale complete: payout on its way |
| `lib/trades/cashSaleInspectionSweep.ts:126` | …Complete the purchase or raise a dispute before then — otherwise the sale completes and the seller is paid. | Your inspection window closes within 24 hours. Complete the purchase or raise a problem by then. If you do nothing, the sale completes and the seller is paid. |
| `lib/trades/cashSaleInspectionSweep.ts:183` | rather than closing it automatically — but it will take longer to resolve. | …our team reviews the case. It will take longer to resolve. |
| `lib/trades/cashSaleInspectionSweep.ts:257` | Return not posted — we are reviewing it | Return not posted: we're reviewing it |
| `lib/trades/cashSaleInspectionSweep.ts:269` | is reviewing the case. You can still post it — add the tracking number and | …is reviewing the case. You can still post it: add the tracking number and |
| `lib/trades/cashSaleInspectionSweep.ts:364` | now — our team has been asked to check in on this sale. | now. Our team will check in on this sale. |
| `lib/trades/inspectionSweep.ts:204` | the settlement is still being finalised and our team is on it — if a | the settlement is still being finalised and our team is on it. If a |
| `lib/trades/bondPlacementSweep.ts:227` | you never met, report it now. | Keep |
| `lib/email/templates.ts:39` | …If you don't respond, the … will auto-complete. Review it here: … — … | Hi …, Your inspection window closes in … hours. If you do nothing, the … completes on its own. Review it here: … (sign-off on its own line) |
| `lib/email/templates.ts:63/64` | …our team reviews the case rather than closing it automatically, but it will take longer to resolve… | Hi …, Your refund is waiting for the item to come back. Please post it and add the tracking number within … hours. If you miss that, our team reviews the case, which takes longer. |
| `lib/email/templates.ts:80/97/113/128/144` | … — … (sign-off joined by an em dash) | Put the link and the "NoDitto" sign-off on separate lines. |

## 7 · Help and policy pages

| Where | Current | Rewrite |
|---|---|---|
| `privacy/page.tsx:68/97/109/167/191/267` | (privacy policy) | Keep. Legal text, and every "never" is a factual commitment. |
| `terms/page.tsx:112/319/361` | (terms) | Keep |
| `safety/page.tsx:95` | …We'll also never ask for your password, your card number or a code, so anyone claiming to be NoDitto support who does isn't us. | Keep |
| `safety/page.tsx:137` | …it gets decided on what the contract says rather than on the listing. | …Describe each card exactly, because a dispute is decided on what the contract says. |
| `safety/page.tsx:144` | …Only send it once the contract itself shows the payment as collected, never because of a message or a screenshot… | Once the buyer has paid, you have 3 business days to post. Only send it when the contract shows the payment as collected. A message or screenshot doesn't count… |
| `safety/page.tsx:159` | A trade works a little differently, because instead of anyone paying, both of you put a temporary hold on your card… | A trade works a little differently. Nobody pays: each of you puts a temporary hold on your card for the value of your side… |
| `safety/page.tsx:176` | After the swap, you get … hours to inspect, and never less than … | After the swap, you get … hours to inspect, and at least … |
| `safety/page.tsx:191` | It helps to know what confirming the handover actually does… | It helps to know what confirming the handover does… |
| `safety/page.tsx:201` | …the one thing the inspection window can't really help with… | Sealed boxes and cases are the one thing the inspection window can't help with… |
| `safety/page.tsx:232` | We never handle the cards ourselves, so we can't authenticate them… | We don't handle the cards ourselves, so we can't authenticate them… |
| `help/HelpCentre.tsx:72` | …We never publish reports or tell anyone who sent them. | Keep |
| `help/HelpCentre.tsx:151` | …a separate Stripe step — you can sell before it is done, but the money waits until it is. | A Stripe identity check lets you list. To be paid you also set up payouts, a separate Stripe step. You can sell before then, but the money waits until it's done. |
| `help/HelpCentre.tsx:162` | A payout is queued when the sale completes — when the buyer accepts or their window ends — and Stripe sends it… | A payout is queued when the sale completes, which is when the buyer accepts or their window ends. Stripe then sends it to your bank on its schedule. |
| `help/HelpCentre.tsx:191` | …for what they receive — an uncaptured authorisation, so nothing is charged… | Trades are face to face. Each trader puts a temporary hold on their card for what they receive, and nothing is charged if the trade goes normally. You meet, swap, confirm, then have … days to check what you got. |
| `help/HelpCentre.tsx:225` | …A verified status says Stripe accepted that check — not a credit score or a guarantee of performance. | You send Stripe Identity a government ID and a selfie; Stripe checks them and we record the result. "Verified" means Stripe accepted the check. It says nothing about credit or how someone will trade. |
| `help/HelpCentre.tsx:251` | …Stripe collects your bank details directly; NoDitto never sees them. | Keep |

## 8 · Everything else

| Where | Current | Rewrite |
|---|---|---|
| `feedback/FeedbackDialog.tsx:55` | What were you doing, and what happened instead of what you expected? | What were you doing, what did you expect, and what happened? |
| `feedback/FeedbackDialog.tsx:152`, `lib/actions/feedback.ts:116` | Please add a little more detail — at least … characters. | Please add a bit more detail (at least … characters). |
| `feedback/FeedbackDialog.tsx:167` | Thanks — your idea is with the team. | Thanks, your idea is with the team. |
| `feedback/FeedbackDialog.tsx:168` | Thanks — we have got it. | Thanks, we've got it. |
| `lib/actions/trades.ts:274` | This trade is face to face. Confirm the handover instead of recording a shipment. | This trade is face to face, so confirm the handover when you meet. |
| `lib/actions/trades.ts:281` | This trade is posted. Record a shipment instead of confirming a handover. | This trade is posted, so record the shipment once you've sent it. |
| `lib/seo/site.ts:70` | NoDitto — buy, sell and swap trading cards with verified sellers | NoDitto: buy, sell and swap trading cards with verified sellers |
| `lib/enrichment/ebay.ts:661` | 0 active listings right now — open profile to view feedback | No active listings. Open their profile to see feedback |
| `lib/enrichment/footprintJudge.ts:436` | No verified history found, and @… (… positive …) has a similar handle — verify before paying. | No verified history, and @… (… positive …) has a similar handle. Check before paying. |
| `lib/enrichment/footprintJudge.ts:437` | Limited public history with … caution … — verify before paying. | Little public history and … caution …. Check before paying. |
| `lib/enrichment/psaCert.ts:261` | PSA cert #… was not found in PSA's registry — strong indicator of a fake or fabricated slab. | PSA cert #… isn't in PSA's registry. That strongly suggests a fake slab. |
| `lib/enrichment/aiTraderCheck.ts:322` | Hold off — I found red flags for …. | Hold off: I found red flags for …. |
| `lib/enrichment/aiTraderCheck.ts:551` | …to `.env.local` — or type their @handle / eBay username / PayID below. | Developer setup text. Keep, or drop the em dash: "…to `.env.local`, or type their @handle, eBay username or PayID below." |
| `lib/actions/admin.ts:1034` | The provider rejected the refund. The sale is still disputed — you can retry. | The provider refused the refund. The sale is still disputed, and you can retry. (Staff only) |
| `lib/actions/admin.ts:1169` | Fraud confirmed — you are being compensated | Fraud confirmed: you're being compensated |
| `lib/actions/admin.ts:1178` | Fraud confirmed — your account is permanently suspended | Fraud confirmed: your account is permanently suspended |
| `lib/actions/admin.ts:2589` | eBay could not be read just now. Try again in a moment. | We couldn't reach eBay. Try again in a moment. (Staff only) |
| `domain/services/index.ts:106`, `providerMode.ts:36` | (server configuration errors) | Keep |
| `lib/enrichment/aiTraderCheck.ts:396`, `aiWebScour.ts:179/181/192/724/951/953`, `footprintJudge.ts:75`, `proofChallenge.ts:153`, `screenshotAnalyzer.ts:38` | (instructions sent to AI models) | Keep. Members never see these, and "never" is how the model is told a hard rule. |
