/// Trade Fee — platform fee calculation for trades.
///
/// Mirrors `domain/trade/tradeFee.ts` in the web app.
///
/// The platform fee is 5% of the trade side value, charged symmetrically
/// to BOTH traders. Use [resolveTradeSideValues] to get the value each
/// side is charged against — never size a fee from FMV directly.
library;

/// Platform fee in basis points.
const int platformFeeBps = 500;

/// Calculates the trade fee for one side.
///
/// 5% of the side value, rounded to nearest cent.
/// Uses integer arithmetic: (value * 500 + 5000) ~/ 10000 for round-half-up.
int tradeFee(int sideValueCents) {
  if (sideValueCents <= 0) return 0;
  return (sideValueCents * platformFeeBps) ~/ 10000;
}

/// Calculates fees for both sides of a trade.
({int initiatorFeeCents, int counterpartFeeCents}) resolveTradeFeesFromValues({
  required int initiatorSideCents,
  required int counterpartSideCents,
}) {
  return (
    initiatorFeeCents: tradeFee(initiatorSideCents),
    counterpartFeeCents: tradeFee(counterpartSideCents),
  );
}
