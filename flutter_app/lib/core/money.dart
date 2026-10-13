import 'package:intl/intl.dart';

/// Money formatting utilities.
///
/// All money in the app is integer minor units (cents for most currencies,
/// yen for JPY). This matches the web app's convention end-to-end.
///
/// Mirrors `lib/format.ts` in the web app.
abstract final class Money {
  /// Returns the number of minor unit digits for a currency.
  ///
  /// 0 for zero-decimal (JPY, KRW, etc.), 2 for most, 3 is unsupported.
  static int minorUnitDigits(String currency) {
    const zeroDecimal = {
      'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw',
      'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
    };
    final lower = currency.toLowerCase();
    if (zeroDecimal.contains(lower)) return 0;
    return 2;
  }

  /// The locale a currency is usually presented in.
  ///
  /// Pinned per currency so a figure renders identically regardless of the
  /// device's own locale. Without this, an AUD price reads "$12.99" on an
  /// en-AU handset and "A$12.99" on an en-US one — the same contract showing
  /// two different labels. Mirrors `localeForCurrency` in `lib/format.ts`.
  static const Map<String, String> _localeForCurrency = {
    'aud': 'en_AU',
    'nzd': 'en_NZ',
    'usd': 'en_US',
    'cad': 'en_CA',
    'gbp': 'en_GB',
    'eur': 'en_IE',
    'jpy': 'ja_JP',
    'sgd': 'en_SG',
    'myr': 'ms_MY',
    'chf': 'de_CH',
    'sek': 'sv_SE',
    'nok': 'nb_NO',
    'dkk': 'da_DK',
    'pln': 'pl_PL',
    'czk': 'cs_CZ',
    'huf': 'hu_HU',
    'ron': 'ro_RO',
    'bgn': 'bg_BG',
    'brl': 'pt_BR',
    'mxn': 'es_MX',
    'aed': 'ar_AE',
  };

  /// Formats an integer minor-unit amount in a given currency.
  ///
  /// Minor units, NOT cents: `format(12345, 'aud')` is "$123.45" but
  /// `format(12345, 'jpy')` is "¥12,345", because the yen has no subunit.
  /// [minorUnitDigits] owns that division, so the divisor is never assumed.
  ///
  /// An unrecognised currency code degrades to a readable figure rather than
  /// throwing: a display helper must not be able to take down a contract room
  /// over a bad label. Arithmetic paths get the strict treatment instead.
  static String format(int minorUnits, String currency) {
    final lower = currency.trim().toLowerCase();

    // Reject anything that isn't a 3-letter code before handing it to intl.
    if (!RegExp(r'^[a-z]{3}$').hasMatch(lower)) {
      return format(minorUnits, 'aud');
    }

    final digits = minorUnitDigits(lower);
    final divisor = digits == 0 ? 1 : (digits == 2 ? 100 : 1000);
    final value = minorUnits / divisor;

    try {
      return NumberFormat.simpleCurrency(
        locale: _localeForCurrency[lower] ?? 'en_AU',
        name: lower.toUpperCase(),
        decimalDigits: digits,
      ).format(value);
    } catch (_) {
      // intl throws on a syntactically valid but unknown currency. Degrade to
      // a readable figure rather than losing the amount entirely.
      return '${lower.toUpperCase()} ${value.toStringAsFixed(digits)}';
    }
  }

  /// The bare symbol a money FIELD labels itself with, e.g. `$`, `£`, `¥`.
  ///
  /// Mirrors `currencyPresentation().symbol` in `lib/format.ts`, and exists for the
  /// same reason: inside an input the member is typing an amount whose currency is
  /// fixed by their region, so repeating the code would be noise. Derived from
  /// [format] rather than from a second table, so a currency cannot be shown with
  /// one symbol in a field and another in a price.
  static String symbolFor(String currency) {
    final String formatted = format(0, currency);
    final String symbol = formatted.replaceAll(RegExp(r'[\d.,\s]'), '');
    return symbol.isEmpty ? formatted.trim() : symbol;
  }

  /// An integer minor-unit amount as the plain text a money field holds.
  ///
  /// No symbol and no digit grouping: this is an editable value, not a display
  /// figure. [minorUnitDigits] owns the division, so 12345 is "123.45" in AUD and
  /// "12345" in JPY — a hand-written `/ 100` is a silent tenfold error on a
  /// zero-decimal currency and Req 14.5 forbids one.
  static String amountText(int minorUnits, String currency) {
    final int digits = minorUnitDigits(currency);
    if (digits == 0) return minorUnits.toString();
    final int divisor = digits == 2 ? 100 : 1000;
    final int whole = minorUnits ~/ divisor;
    final int fraction = minorUnits.remainder(divisor).abs();
    return '$whole.${fraction.toString().padLeft(digits, '0')}';
  }

  /// The text a money field holds, back to integer minor units.
  ///
  /// Integer arithmetic throughout, deliberately: `19.99` must be 1999 and
  /// `double * 100` gives 1998. Anything that is not a digit or a decimal point is
  /// dropped, and surplus fraction digits are truncated rather than rounded,
  /// because rounding a typed amount up would charge more than was typed.
  static int parseAmountText(String text, String currency) {
    final String cleaned = text.replaceAll(RegExp(r'[^0-9.]'), '');
    if (cleaned.isEmpty) return 0;

    final int digits = minorUnitDigits(currency);
    final List<String> parts = cleaned.split('.');
    final int whole = int.tryParse(parts[0]) ?? 0;
    if (digits == 0) return whole;

    final int scale = digits == 2 ? 100 : 1000;
    if (parts.length == 1) return whole * scale;
    final String fraction = parts[1].padRight(digits, '0').substring(0, digits);
    return whole * scale + (int.tryParse(fraction) ?? 0);
  }

  /// Formats a money amount with an explicit sign for non-zero values.
  ///
  /// Example: formatSigned(500, 'aud') → "+$5.00"
  static String formatSigned(int minorUnits, String currency) {
    final formatted = format(minorUnits.abs(), currency);
    if (minorUnits > 0) return '+$formatted';
    if (minorUnits < 0) return '-$formatted';
    return formatted;
  }

  /// True while every platform fee is waived for the beta.
  ///
  /// Mirrors `BETA_FEE_WAIVER` in `domain/fees/betaFeeWaiver.ts`, and is pinned to it
  /// by `tests/unit/mobileDomainAgreement.test.ts`. Ending the beta means flipping
  /// both. ADVISORY: the server decides the fee it charges.
  static const bool betaFeeWaiver = true;

  /// The STANDARD fee rate in basis points (5%), once the beta ends.
  ///
  /// Mirrors `PLATFORM_FEE_BPS` / `TRADE_FEE_BPS` in the web app.
  static const int standardFeeBps = 500;

  /// [standardFeeBps] of [baseCents], rounded half-up to the nearest minor unit,
  /// with no minimum. Zero or negative base → 0. The standard rate, regardless of
  /// [betaFeeWaiver].
  ///
  /// Mirrors `percentageFeeMinor` in `domain/fees/percentageFee.ts`.
  static int standardFee(int baseCents) {
    if (baseCents <= 0) return 0;
    return ((baseCents * standardFeeBps) + 5000) ~/ 10000;
  }

  /// The fee actually applied: 0 while [betaFeeWaiver], else [standardFee].
  ///
  /// Mirrors `effectiveFeeBps` in `domain/fees/betaFeeWaiver.ts`.
  static int _percentageFee(int baseCents) {
    return betaFeeWaiver ? 0 : standardFee(baseCents);
  }

  /// Calculates platform fee from item price in the currency's minor units.
  ///
  /// 5% of item price (PLATFORM_FEE_BPS = 500), no minimum, and 0 while
  /// [betaFeeWaiver]. Uses rounding (not
  /// truncation) to match `platformFeeCentsFor` in
  /// `domain/orchestrator/cashSaleOrchestrator.ts`. [currency] does not affect
  /// the result. ADVISORY: the server sizes the fee.
  static int platformFee(int priceCents, {required String? currency}) {
    return _percentageFee(priceCents);
  }

  /// Calculates trade fee for one side (5% of value, no minimum; 0 while
  /// [betaFeeWaiver]).
  /// Rounds to match the server's `tradeFeeCentsFor`.
  static int tradeFee(int valueCents, {required String? currency}) {
    return _percentageFee(valueCents);
  }

  /// The Cash_Sale fee rate as members read it: "5%".
  ///
  /// Mirrors `platformFeeRateLabel` in `lib/fees/feeLabels.ts`.
  static String platformFeeRateLabel(String currency) {
    return '5%';
  }

  /// The per-trader Trade_Fee rate as members read it: "5%".
  ///
  /// Mirrors `tradeFeeRateLabel` in `lib/fees/feeLabels.ts`.
  static String tradeFeeRateLabel(String currency) {
    return '5%';
  }

  /// "No fees during beta (normally 5%)", the one sentence prose surfaces use.
  ///
  /// Mirrors `betaFeeNote` in `lib/fees/feeLabels.ts`.
  static String betaFeeNote() => 'No fees during beta (normally 5%)';

  /// Parenthetical for a fee row: "waived during beta, normally 5%" when the fee
  /// is 0, else "5%". Decided by the figure, so a stored pre-beta fee reads "5%".
  ///
  /// Mirrors `platformFeeRowRate` / `tradeFeeRowRate` in `lib/fees/feeLabels.ts`.
  static String feeRowRate(int feeCents) =>
      feeCents == 0 ? 'waived during beta, normally 5%' : '5%';

  /// Returns total cost for a cash sale buyer: price + shipping + platform fee.
  static int cashSaleTotal({
    required int priceCents,
    required int shippingCents,
    required String? currency,
  }) {
    return priceCents +
        shippingCents +
        platformFee(priceCents, currency: currency);
  }
}
