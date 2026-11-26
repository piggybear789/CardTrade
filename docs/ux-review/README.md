# UX review: 26 November 2026

This is a full pass over the e2e screenshots from run `2026-11-26T01-42-49Z-g4ea9pj`:
728 distinct screens across about 230 tests, at 1280×720 desktop and iPhone 14. Each
area was compared with the same screen types on Mobbin.

| Area | File | P1 | P2 | P3 |
|---|---|---|---|---|
| Cash sale (buy, pay, room) | [A-cash-sale.md](A-cash-sale.md) | 9 | 15 | 9 |
| Disputes, returns, journeys | [B-disputes-journeys.md](B-disputes-journeys.md) | 11 | 12 | 6 |
| Trades and trade disputes | [C-trades.md](C-trades.md) | 9 | 14 | 6 |
| Listings, catalog, offers, private deals | [D-listings-catalog.md](D-listings-catalog.md) | 4 | 16 | 8 |
| Account, onboarding, messages, notifications | [E-account.md](E-account.md) | 6 | 14 | 5 |
| References, Trusted Sellers, scam reports, admin | [F-trust-admin.md](F-trust-admin.md) | 4 | 11 | 8 |
| **Total** | | **43** | **82** | **42** |

- **P1:** blocks or confuses a member, or misleads about money.
- **P2:** clutter, too much text, or layout breaking at one size.
- **P3:** polish.

## The themes

1. **The same fact is said three to five times on one screen.** The hold amount, "no
   money has moved" and the fee are each repeated in the lead, the row hint, the card
   row and the dock. Rare cases (a hold expiring mid-dispute) sit in the main flow.
2. **The primary button ends up below the fold.** Dialogs scroll as one block, so on a
   720px-tall desktop and on phones, Pay and Accept sit under the explanation.
3. **Refusals only appear as toasts.** When Pay or Accept is refused (unverified, no
   card, region, the seller not payable), the room still looks payable, and the reason
   disappears after a few seconds.
4. **1280px is cramped.** A 256px rail plus a 590px pane plus a 390px chat column. The
   dock and action bars truncate or wrap, and amounts wrap.
5. **Some copy was wrong, not just long.** "Held until the item is handed over", "Payment
   held by Stripe", "about seven days", a raw ISO date, a rounded-down price headline, and
   a "% good" reference score.

## Fixed in this pass

| Finding | Fix |
|---|---|
| Primary button below the fold in every long dialog | `DialogFooter` is now sticky to the bottom of the scrolling sheet (`components/ui/dialog.tsx`). Short dialogs are unchanged. |
| 1280px desktop cramped (all six reviews) | Type scales with the window between 1024 and 1440px: 14.5px at 1024, about 15.4px at 1280, 16px from 1440 (`app/globals.css`). Every rem-based size scales with it, so the layout gains room. The rail is capped at 13.5rem in that band (`MarketplaceShell`). Phones keep 16px, because iOS zooms into smaller fields. |
| The Pay dialog said the money is held "until the item is handed over" | Now "NoDitto holds your payment until you accept the item. If something's wrong, you can raise a problem first." This is one sentence and it's true. It no longer names the card when PayTo or a bank transfer is chosen. |
| "Payment held by Stripe" | Now "Payment held by NoDitto" (`FundsHeldMark`). |
| Accepting a trade's terms: hold stated three times, fee twice, edge case in the main flow, button below the fold | The lead is one sentence. The rows read "A temporary hold, released when the trade completes. Charged only if a problem is still open when it expires." and "2% of the value you receive. Refunded if the swap doesn't go ahead." The full detail is behind "How holds and disputes work". |
| The collateral explainer said holds last "about seven days" (they can lapse after less than five) | Now "Card holds only last a few days, so the meeting and inspection are planned to finish well before they expire." |
| The return deadline showed as "2026-12-03T01:55:13.595Z" | It's a readable date now ("Thu 3 Dec"). This applies to new events only; old timeline rows keep their text. |
| The listing headline rounded the buyer's total down ("$46 AUD" for $46.35) | Cents now show whenever there are any. A round total still reads "$50 AUD". |
| References showed "96% good", a score the product rules forbid, and it hid bad counts | Now counts: "12 good · 1 so-so · 2 bad". |
| `/safety` said "you always know there's a real, verified person on the other side", but buyers aren't ID-checked | Now says the seller or trader on the other side is a verified person. |
| Multiple items said "Buy now" on desktop and "Request" on phone | Both say "Request". |
| The progress rail showed blank numbers for the return steps and the trade's last step | They now read Check, Refund and Done. This was fixed earlier today. |

## Not fixed yet, worth doing next

These are larger changes. Each needs a decision or more than a copy edit, and the area
files have the detail.

- **Make refusals inline, not toasts** (A, C). When Pay or Accept is refused, the dock
  should show why, with a "nothing was charged" line, and disable the action until it's
  fixed. The in-room "Verify ID to pay" bar is the pattern to copy.
- **Hide the bottom tab bar inside contract rooms and threads** on phone (A, B, E). It
  takes about 56pt the composer and dock need. The room layouts reserve its height, so
  the change has to be made per layout.
- **Show the terms in the phone trade room** (C, P1). Members accept terms they can't see
  without opening the details sheet.
- **Show refund amount and destination** on refunded contracts (B, P1), and show the
  seller the chargeback payout hold (B, P1).
- **The Multiple items side of a trade shows the A$500 "from" price** as its value (C,
  P1). It should show the trade side value.
- **Make the notification counts agree** across the bell, the rail and the account hub
  (E, P1).
- **Add paging** to Payouts, Inbox, Activity and the admin queues (E, F).
- **The trade fee:** the code charges 2% (`TRADE_FEE_BPS = 200`) and the copy says 2%,
  but some older screens and docs said "Trades have no fee". Two reviewers flagged this;
  the main dialogs are consistent now.

## How to check the fixes

The videos in `docs/e2e-videos/` were regenerated after these fixes. Watch:

- Cash sale → Pay: the sticky button and the new sentence
- Trades → accepting terms: the shorter dialog
- Any contract room at desktop size: the type now scales

## Test results after the fixes

These come from run `2026-11-26T15-24-17Z-4wguabr`, against the sandbox and Stripe test mode.

| Check | Result |
|---|---|
| Unit and component tests | 2,060 passed, 18 failed. Those 18 already fail on `main` (references, account closure, region parity and others), and none are new. |
| Lint | Clean. |
| Full e2e suite with video, 4 workers | 236 passed, 3 failed. |
| The 3 failures | Saving a listing (desktop and phone) and creating a listing (phone). All 3 passed when rerun on their own, so it was load during the video run. |

The regenerated videos are `docs/e2e-videos/noditto-e2e-desktop.mp4` (44 min) and
`noditto-e2e-phone.mp4` (53 min). They cover every test that passed in that run, with
the scaled type at 1280px, the sticky dialog footers and the new copy.

**Two files I moved out of the app** are in `docs/ux-review/parked/`. They were
`app/listings/new/loading.tsx` and `app/listings/[id]/edit/loading.tsx`, untracked
files that appeared during the run. They imported a `components/listings/ItemFormSkeleton`
that doesn't exist, so the production build failed. Your structure steering also says the
web app has no `loading.tsx` files. The edit-page copy is a reconstruction: the original
was lost when the copy step failed on the `[id]` path.
