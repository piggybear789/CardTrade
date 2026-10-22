/// Trade Fee — what each trader pays NoDitto for a trade. It is zero.
///
/// Mirrors `domain/trade/tradeFee.ts` in the web app. NoDitto charges no fee on a trade and passes
/// Stripe's costs through; a swap's collateral is a card hold that costs nothing, so
/// there is nothing to pass through. Use [resolveTradeSideValues] for what each side
/// is worth, never FMV directly.
///
/// ADVISORY: the server sizes and charges the fee.
library;

import 'package:cardtrade/core/money.dart';

/// Trade fee in basis points: 0. Mirrors `TRADE_FEE_BPS`.
const int tradeFeeBps = Money.tradeFeeBps;

/// The trade fee for one side: 0.
int tradeFee(int sideValueCents, {required String? currency}) {
  return Money.tradeFee(sideValueCents, currency: currency);
}

/// Calculates fees for both sides of a trade.
({int initiatorFeeCents, int counterpartFeeCents}) resolveTradeFeesFromValues({
  required int initiatorSideCents,
  required int counterpartSideCents,
  required String? currency,
}) {
  return (
    initiatorFeeCents: tradeFee(initiatorSideCents, currency: currency),
    counterpartFeeCents: tradeFee(counterpartSideCents, currency: currency),
  );
}
