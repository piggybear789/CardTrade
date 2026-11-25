# E2E findings draft
Drafted by the audit report from failed Pathways and blocking observations. Review
each entry, move real defects into `tests/e2e/FINDINGS.md` with a cause, fix and
guard, and renumber if that file gained entries since this run. Severities are
proposals on the file's 0–4 scale: 4 = the user cannot complete the task, 1 = cosmetic.
---
## F96 — Belgian buyer pays a German seller with Bancontact through the bank redirect fails on desktop (severity 4, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.bank-bancontact` (happy), viewport `desktop`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F97 — Belgian buyer pays a German seller with Bancontact through the bank redirect fails on phone (severity 4, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.bank-bancontact` (happy), viewport `phone`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F98 — Austrian buyer pays a German seller with EPS through the bank redirect fails on desktop (severity 4, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.bank-eps` (happy), viewport `desktop`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F99 — Austrian buyer pays a German seller with EPS through the bank redirect fails on phone (severity 4, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.bank-eps` (happy), viewport `phone`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F100 — Dutch buyer pays a German seller with iDEAL through the bank redirect fails on desktop (severity 4, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.bank-ideal` (happy), viewport `desktop`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F101 — Dutch buyer pays a German seller with iDEAL through the bank redirect fails on phone (severity 4, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.bank-ideal` (happy), viewport `phone`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F102 — Polish buyer pays a German seller with Przelewy24 through the bank redirect fails on desktop (severity 4, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.bank-p24` (happy), viewport `desktop`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F103 — Polish buyer pays a German seller with Przelewy24 through the bank redirect fails on phone (severity 4, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.bank-p24` (happy), viewport `phone`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F104 — Buyer pays a cash sale with PayTo, approved in place fails on desktop (severity 4, OPEN)
**Symptom.** The Pathway failed at step 4, "Buyer sees card and PayTo each priced, and chooses PayTo": no cash sale 58fb877d-6bc2-42d1-bf74-ffdcd814248e
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.bank-payto` (happy), viewport `desktop`, run `2026-11-25T02-58-51Z-hvdl0yz`. Step 4: Buyer sees card and PayTo each priced, and chooses PayTo.
---
## F105 — console on Buyer pays a cash sale with PayTo, approved in place (desktop) (severity 2, OPEN)
**Symptom.** Console error: Error: An unexpected response was received from the server. at I (http://localhost:3100/_next/static/chunks/0id6aevbwms6i.js:2:743) Seen by `buyer` at `http://localhost:3100/sales/58fb877d-6bc2-42d1-bf74-ffdcd814248e?details=1`.
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.bank-payto` (happy), viewport `desktop`, run `2026-11-25T02-58-51Z-hvdl0yz`. Step 3: Buyer sets a delivery address.
---
## F106 — Buyer pays a cash sale with PayTo, approved in place fails on phone (severity 4, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.bank-payto` (happy), viewport `phone`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F107 — Unverified buyer of a sale over the unverified-buyer limit is asked to verify their ID instead of paying fails on desktop (severity 3, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.buyer-identity-required` (refusal), viewport `desktop`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F108 — Unverified buyer of a sale over the unverified-buyer limit is asked to verify their ID instead of paying fails on phone (severity 3, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.buyer-identity-required` (refusal), viewport `phone`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F109 — Buyer pays a cash sale by card and passes the 3-D Secure challenge fails on desktop (severity 4, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.card-3ds` (happy), viewport `desktop`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F110 — Buyer pays a cash sale by card and passes the 3-D Secure challenge fails on phone (severity 4, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.card-3ds` (happy), viewport `phone`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F111 — Buyer fails the 3-D Secure challenge at Pay and nothing is charged fails on desktop (severity 3, OPEN)
**Symptom.** The Pathway failed at step 2, "Buyer adds a 3-D Secure card at Buy Now and reserves": locator.click: Target page, context or browser has been closed Call log: - waiting for getByRole('button', { name: /^Buy( now)?$/ }).filter({ visible: true }).first()
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.card-3ds-failed` (refusal), viewport `desktop`, run `2026-11-25T02-58-51Z-hvdl0yz`. Step 2: Buyer adds a 3-D Secure card at Buy Now and reserves.
---
## F112 — Buyer fails the 3-D Secure challenge at Pay and nothing is charged fails on phone (severity 3, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.card-3ds-failed` (refusal), viewport `phone`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F113 — Buyer is declined at Pay and nothing is charged fails on desktop (severity 3, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.card-declined` (refusal), viewport `desktop`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F114 — Buyer is declined at Pay and nothing is charged fails on phone (severity 3, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.card-declined` (refusal), viewport `phone`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F115 — Buyer pays a cash sale by card with no authentication, charged exactly the total shown fails on desktop (severity 4, OPEN)
**Symptom.** The Pathway failed at step 2, "Buyer reserves it with Buy Now": page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3100/listings/a09f76d9-085e-4071-b5e5-b29b7382d58d Call log: - navigating to "http://localhost:3100/listings/a09f76d9-085e-4071-b5e5-b29b7382d58d", waiting until "load"
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.card-no-auth` (happy), viewport `desktop`, run `2026-11-25T02-58-51Z-hvdl0yz`. Step 2: Buyer reserves it with Buy Now.
---
## F116 — Buyer pays a cash sale by card with no authentication, charged exactly the total shown fails on phone (severity 4, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.card-no-auth` (happy), viewport `phone`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F117 — Buyer whose saved card changes tier after the total was shown is refused with CARD_REPRICED fails on desktop (severity 3, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.card-repriced` (refusal), viewport `desktop`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F118 — Buyer whose saved card changes tier after the total was shown is refused with CARD_REPRICED fails on phone (severity 3, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.card-repriced` (refusal), viewport `phone`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F119 — An Australian buyer cannot open a contract on a US seller’s listing (REGION_MISMATCH) fails on desktop (severity 3, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.region-mismatch` (refusal), viewport `desktop`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F120 — An Australian buyer cannot open a contract on a US seller’s listing (REGION_MISMATCH) fails on phone (severity 3, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.region-mismatch` (refusal), viewport `phone`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F121 — Two accounts sharing a card cannot deal, and the refusal does not say why fails on desktop (severity 3, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.related-accounts` (refusal), viewport `desktop`, run `2026-11-25T02-58-51Z-hvdl0yz`.
**Known findings on this Pathway.** F78. Check whether this is one of them before filing it.
---
## F122 — Two accounts sharing a card cannot deal, and the refusal does not say why fails on phone (severity 3, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.related-accounts` (refusal), viewport `phone`, run `2026-11-25T02-58-51Z-hvdl0yz`.
**Known findings on this Pathway.** F78. Check whether this is one of them before filing it.
---
## F123 — Buyer is refused with SELLER_EXPOSURE_LIMIT when a new seller would exceed their open-sales limit fails on desktop (severity 3, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.seller-exposure-limit` (refusal), viewport `desktop`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F124 — Buyer is refused with SELLER_EXPOSURE_LIMIT when a new seller would exceed their open-sales limit fails on phone (severity 3, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.seller-exposure-limit` (refusal), viewport `phone`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F125 — Buyer of a cross-border sale whose seller cannot receive funds is refused with SELLER_NOT_PAYABLE fails on desktop (severity 3, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.seller-not-payable` (refusal), viewport `desktop`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F126 — Buyer of a cross-border sale whose seller cannot receive funds is refused with SELLER_NOT_PAYABLE fails on phone (severity 3, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `cash-sale.payments.seller-not-payable` (refusal), viewport `phone`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F127 — Authorized job endpoints return 200 and Ship24 webhook accepts valid bearer fails on desktop (severity 4, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `jobs-webhooks.authorized-jobs-and-ship24` (happy), viewport `desktop`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F128 — Missing/wrong job bearer and invalid Stripe webhook signature are refused fails on desktop (severity 3, OPEN)
**Symptom.** The Pathway failed at step 1, "Job endpoint refuses missing and wrong bearer tokens": fetch failed
**Cause.** Not yet investigated.
**Where.** Pathway `jobs-webhooks.unauthorized-job-and-invalid-signature-refused` (refusal), viewport `desktop`, run `2026-11-25T02-58-51Z-hvdl0yz`. Step 1: Job endpoint refuses missing and wrong bearer tokens.
---
## F129 — Member leaves a live reference, /references/people renders, and GET /api/references/graph responds fails on desktop (severity 4, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `references.leave-and-graph-api` (happy), viewport `desktop`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F130 — Member leaves a live reference, /references/people renders, and GET /api/references/graph responds fails on phone (severity 4, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `references.leave-and-graph-api` (happy), viewport `phone`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F131 — Submitting a reference without selecting a sentiment is refused fails on desktop (severity 3, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `references.missing-sentiment-refused` (refusal), viewport `desktop`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F132 — Submitting a reference without selecting a sentiment is refused fails on phone (severity 3, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `references.missing-sentiment-refused` (refusal), viewport `phone`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F133 — Guest attempting to watch or open /saved is routed to sign-in fails on desktop (severity 3, OPEN)
**Symptom.** The Pathway failed at step 1, "Guest visiting /saved is redirected to /sign-in": page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:3100/saved Call log: - navigating to "http://localhost:3100/saved", waiting until "load"
**Cause.** Not yet investigated.
**Where.** Pathway `watchlist-sellers.guest-save-routed-to-signin` (refusal), viewport `desktop`, run `2026-11-25T02-58-51Z-hvdl0yz`. Step 1: Guest visiting /saved is redirected to /sign-in.
---
## F134 — Guest attempting to watch or open /saved is routed to sign-in fails on phone (severity 3, OPEN)
**Symptom.** The Pathway failed at step 1, "Guest visiting /saved is redirected to /sign-in": page.goto: Could not connect to server Call log: - navigating to "http://localhost:3100/saved", waiting until "load"
**Cause.** Not yet investigated.
**Where.** Pathway `watchlist-sellers.guest-save-routed-to-signin` (refusal), viewport `phone`, run `2026-11-25T02-58-51Z-hvdl0yz`. Step 1: Guest visiting /saved is redirected to /sign-in.
---
## F135 — Member toggles watchlist on a listing and views the public seller profile fails on desktop (severity 4, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `watchlist-sellers.watch-toggle-and-seller-page` (happy), viewport `desktop`, run `2026-11-25T02-58-51Z-hvdl0yz`.
---
## F136 — Member toggles watchlist on a listing and views the public seller profile fails on phone (severity 4, OPEN)
**Symptom.** The Pathway failed before any step recorded a failure.
**Cause.** Not yet investigated.
**Where.** Pathway `watchlist-sellers.watch-toggle-and-seller-page` (happy), viewport `phone`, run `2026-11-25T02-58-51Z-hvdl0yz`.
