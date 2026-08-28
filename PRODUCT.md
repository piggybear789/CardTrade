# Product

## Register

product

## Users

Collectors buying, selling, and swapping high-value trading cards (TCGs and sports cards). They need to assess counterparties quickly, agree clear terms, pay safely, and resolve condition or fraud disputes without relying on anonymous marketplace trust. The go-to-market is deliberately cards-only to concentrate liquidity; the contract and escrow architecture stays category-agnostic so adjacent collectibles (comics, coins, memorabilia) can open later without rework.

## Product Purpose

NoDitto.app is a safety-first peer-to-peer marketplace and clearinghouse for collectibles. It reduces impersonation and transaction risk through Stripe Identity checks, collateral-backed contracts, transparent deal states, and payments handled by Stripe. Success means collectors can confidently complete cash sales, swaps, and private deals while understanding who is verified, what is protected, and what happens next.

## Brand Personality

Playful, protective, and expert. NoDitto uses light Ditto-inspired language to make safety approachable, but stays precise when discussing identity, money, collateral, disputes, and legal obligations. The experience should feel credible enough for serious collectors without becoming cold or institutional.

## Anti-references

- A childish Pokémon fan site that lets character imagery overwhelm transaction clarity.
- A generic fintech dashboard with interchangeable navy gradients and sterile compliance language.
- A loud marketplace that treats trust badges as decoration or hides payment-provider disclosures.
- Any interface that markets payment protection as regulated escrow or a trust account.
- Copy that forces puns into legal, payment, dispute, or error states where precision matters more.

## Design Principles

1. **Trust is visible and specific.** Show what Stripe Identity verified, what collateral protects, and what Stripe handles.
2. **Play at the edges, precision at the core.** Use Ditto personality in welcome moments, guidance, and empty states; use plain language for contracts, payments, disputes, and errors.
3. **Collector credibility comes first, and violet is how we say it.** Ditto purple is not a garnish on a neutral foundation — it *is* the foundation. The palette runs three violets, one per job: a deep `--primary` for fills that carry white text, a mid `--iris-ink` for violet as text, and the bright `--iris` for rings, borders, and markers. Each depth exists because a contrast floor demanded it, not for variety. Character now lives in the logo, the copy, and the typography; the hue is infrastructure. Restraint means the violet does real work — current state, primary action, focus — and never decorates.
4. **Every deal explains itself.** Users should always know the current state, responsible party, next action, and consequence.
5. **Provider transparency is part of safety.** Whenever users pay, clearly name Stripe rather than obscuring the payment provider.

## Features & Functionality

Web is the complete MVP. Flutter is a second client with partial parity. The load-bearing rules live in `.kiro/steering/product.md` — this section is the member-facing map.

**Account.** Email/password and Google sign-in. Password reset. Required onboarding: display name, trading region (AU today), buyer or seller intent. Sellers complete Stripe Identity (photo ID + selfie) then optional Connect payout setup. Buyers may skip card setup. Guests can browse.

**Catalog.** Browse, search, filter, and sort listings by card game, condition, price, region, and seller rating. Single-card listings and binder/bulk listings. Create, edit, close, and watch. Public seller profiles with reviews and social links. Report a listing or a member.

**Cash sales.** Buyer pays through Stripe; NoDitto holds the funds until the buyer accepts. 5% platform fee on the item price. Delivery with carrier tracking, or in-person handover. 7-day inspection. Seller payout after acceptance. Condition disputes, evidence, and return-conditional refunds when a full refund is awarded and the buyer still holds the goods.

**Trades.** Equal-value swaps with a temporary card hold (trade collateral) on both sides — not escrowed cash. 5% fee on each side. Delivery or in-person. In-person handover opens a 72-hour inspection; it does not complete the trade. Condition disputes take a $20 friction tax. Confirmed fraud captures the hold for the victim and permanently bans the account.

**Offers.** Price negotiation on a single card. Accepting an offer opens a cash sale. Binder listings cannot be offered.

**Private deals.** A 14-day invite link (`/t/[token]`) that opens a cash sale or a trade. Uses a hidden card, never a catalog listing.

**Rooms.** Real-time contract rooms with embedded chat, attachments, shipping, inspection countdown, and next-action copy. In-app notifications plus email for deadlines, disputes, payouts, and new requests.

**Money.** Stripe card payments. Saved cards required for trade collateral. Payout dashboard. Staff arbitration and operations consoles. Demo payment panels exist for local development only.

**Not yet at Flutter parity.** Starting a cash sale, identity and payout setup, private deals, returns, leaving a review, reports, and admin.

## Accessibility & Inclusion

Target WCAG 2.2 AA. Support full keyboard operation, visible focus states, reduced motion, accessible names, and sufficient contrast. Never rely on color alone for verification, payment, collateral, or dispute states. Character imagery must have useful alternative text when informative and empty alternative text when decorative.
