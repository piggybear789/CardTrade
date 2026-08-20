/// Trade Side Values — what each side of a trade is WORTH.
///
/// Mirrors `domain/trade/tradeSideValues.ts` in the web app.
///
/// THE SHOPFRONT/BINDER RULE: A shopfront side is valued at whatever
/// is offered against it. Its own `fmv_cents` is the whole inventory's
/// "from" price and is NEVER used for collateral or fee purposes.
///
/// Three call sites read this ONE function:
/// 1. Collateral sizing (bond placement)
/// 2. Charged fee (trade fee calculation)
/// 3. Fee disclosure in the trade room UI
///
/// If disclosure disagrees with the charge, we have a money bug.
/// Never re-derive a side value by summing `fmv_cents`.
library;
import 'dart:math' as math;

/// The resolved values for both sides of a trade.
typedef TradeSideValues = ({int initiatorSideCents, int counterpartSideCents});

/// Resolves the value of each side of a trade for collateral and fee purposes.
///
/// [initiatorGoodsCents] — FMV of the initiator's offered goods.
/// [counterpartGoodsCents] — FMV of the counterpart's offered goods.
/// [counterpartIsShopfront] — whether the counterpart's item is a shopfront/binder.
///
/// When `counterpartIsShopfront` is true, the binder rule applies:
/// the counterpart side is worth whatever is offered against it
/// (= the initiator side's value), because "some cards out of a binder"
/// has no determinate price.
TradeSideValues resolveTradeSideValues({
  required int initiatorGoodsCents,
  required int counterpartGoodsCents,
  required bool counterpartIsShopfront,
}) {
  final initiatorSideCents = math.max(initiatorGoodsCents, 0);

  final int counterpartSideCents;
  if (counterpartIsShopfront) {
    // THE BINDER RULE: shopfront side = whatever is offered against it.
    counterpartSideCents = initiatorSideCents;
  } else {
    counterpartSideCents = math.max(counterpartGoodsCents, 0);
  }

  return (
    initiatorSideCents: initiatorSideCents,
    counterpartSideCents: counterpartSideCents,
  );
}

/// Whether both trade sides have a value > 0.
///
/// Zero sides are REFUSED — a zero side would mean requiredBondCents
/// returning 0, which confirms escrow with no collateral behind it.
bool tradeSidesAreValued(TradeSideValues sides) {
  return sides.initiatorSideCents > 0 && sides.counterpartSideCents > 0;
}
