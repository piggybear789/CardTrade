/// Trade Fee — platform fee calculation for trades.
///
/// Mirrors `domain/trade/tradeFee.ts` in the web app.
///
/// The platform fee is 5% of the trade side value, charged symmetrically
/// to BOTH traders, with no minimum. Use [resolveTradeSideValues] to get the value each side is charged against —
/// never size a fee from FMV directly.
///
/// BETA WAIVER: while `Money.betaFeeWaiver` is on, every trader's fee is 0
/// (mirroring `BETA_FEE_WAIVER` in `domain/fees/betaFeeWaiver.ts`).
///
/// ADVISORY: the server sizes and charges the fee.
library;

import 'package:cardtrade/core/money.dart';

/// Platform fee in basis points: the STANDARD rate. The applied rate is 0 while
/// `Money.betaFeeWaiver` is on.
const int platformFeeBps = 500;

/// Calculates the trade fee for one side.
///
/// 5% of the side value, rounded half-up to the nearest cent to match the
/// server's `Math.round`, and 0 during the beta. A side receiving nothing owes
/// nothing.
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
