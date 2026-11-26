/// Trade Fee — what each trader pays NoDitto for a trade: 2% of the value they receive.
///
/// Mirrors `domain/trade/tradeFee.ts` in the web app. A fee too small for Stripe to
/// charge is 0. Use [resolveTradeSideValues] for what each side
/// is worth, never FMV directly.
///
/// ADVISORY: the server sizes and charges the fee.
library;

import 'package:cardtrade/core/money.dart';

/// Trade fee in basis points: 200. Mirrors `TRADE_FEE_BPS`.
const int tradeFeeBps = Money.tradeFeeBps;

/// The trade fee for one trader, on the value they receive.
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
