# Verification: round action chips + review fixes

First iteration (no `review-round-buttons.json` existed).

## Ran (targeted only, per the user rule)

```
npx vitest --run tests/component/listingPane.test.tsx tests/component/tradeFeeDisclosure.test.tsx tests/unit/typeScaleFloor.test.ts tests/unit/moneyCurrencyRendering.test.ts tests/unit/navigationGraph.test.ts
```

Result: 5 files, 42 tests, all passed. The first run had one failure in a new test of
mine (`getByText('Seller')` also matched `ListingSellerRow`'s sr-only "Seller" heading).
I narrowed the assertion to the name `span` and re-ran clean.

Not run: build, lint, typecheck, the full suite, e2e, dev server. There was no visual
check because no dev server was running. Types rest on reading the code, not on `tsc`.

## e2e (inspected, not run)

- Accessible names are unchanged ("Buy now", "Propose trade", "Make an offer", "Message
  seller"), so the `getByRole` selectors in `guards.spec.ts`, `trade.spec.ts`,
  `offers.spec.ts`, `debug/guards-probe.spec.ts`, `support/messageSeller.ts` etc. still
  match. They use a case-insensitive substring match and skip hidden copies.
- `us-region.spec.ts`: comment only (Buy now is a `Button` trigger, not `ListingActionIcon`).
- `listings.spec.ts`: comment only (the tile label is now "Binder or bulk listing"). The
  selectors use `/^One item/`, which is unchanged.
- The comment in `guards-probe.spec.ts` ("it's a ListingActionIcon") is true again and
  was left as it is.

## Decisions worth checking

- Save count (B3): it is the last clause of `listingMetaLine` ("· N saved", only when
  N > 0) for every viewer in both layouts. `count` is gone from the desktop heart, so the
  number appears once. It no longer moves optimistically when the heart is toggled.
- Fee note (B2): restored to the gates it had before `7f5fe8d`. Desktop uses
  `!isShopfront && !isOwner`. Phone uses `showTrust && !isShopfront`.
- Phone Message row (B1): it survives (`md:hidden`), so the phone skeleton reserves
  `mt-snug h-10` for it. The desktop skeleton now reserves Buy plus three round-chip slots.

## Left alone, recorded

- `lib/actions/trades.ts:271` "This listing has multiple items…" is a server-action
  message, and server actions are out of scope.
- `components/messages/MessageLog.tsx:337-342` "multi-item listing" mirrors the SQL
  transcript wording of `describe_cash_sale_event` (0119). Changing only the client copy
  would make old and new transcript rows disagree.
- `flutter_app/`: no Dart occurrences. Only `flutter_app/SPEC.md:246` prose, which already
  says "binder listing".
- `ItemCard.tsx` keeps `'Unknown seller'` on the catalog tile, outside B5's scope
  (ListingDetailStack/ListingDesktopPane).
