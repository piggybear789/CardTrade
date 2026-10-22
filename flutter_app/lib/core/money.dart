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

  /// The service fee per contract currency, as `[bps, fixedMinor]`: a clean rate of
  /// price plus postage by a domestic card, plus a fixed part ("3% + A$0.60").
  ///
  /// Mirrors the domestic card rows of `CARD_FEES` (`serviceFeeRateFor`) in
  /// `domain/fees/processingFee.ts`, and pinned to it by
  /// `tests/unit/mobileDomainAgreement.test.ts`. Each rate covers Stripe's costs and
  /// leaves NoDitto about [nodittoFeeBps]. Every currency here other than aud and usd is
  /// charged on behalf of its seller, so none pays a conversion fee. ADVISORY: the server
  /// sizes the fee it charges, and a card issued outside the seller's card zone pays a
  /// dearer rate there (0159). The server refuses a card total the app did not show,
  /// with a message pointing at the sale room on the website, which prices every tier.
  static const Map<String, List<int>> serviceFeeRates = {
    'aud': [300, 60],
    'usd': [450, 60],
    'eur': [300, 60],
    'gbp': [300, 50],
    'cad': [450, 70],
    'chf': [450, 60],
    'czk': [300, 1320],
    'dkk': [300, 410],
    'nok': [400, 620],
    'sek': [300, 610],
    'pln': [300, 240],
    'ron': [300, 270],
    'bgn': [300, 110],
  };

  /// The rate for a currency missing from [serviceFeeRates]: the most expensive case.
  static const List<int> serviceFeeRateFallback = [600, 60];

  /// NoDitto's target share of a cash sale, in basis points. The rates above are set so
  /// NoDitto keeps about this much. Mirrors `NODITTO_FEE_BPS` in
  /// `domain/fees/processingFee.ts`.
  static const int nodittoFeeBps = 100;

  /// The currency conversion fee on a trade's cash leg, in basis points. Mirrors
  /// `FX_FEE_BPS` in `domain/fees/fxFee.ts`. Cash sales do not pay it.
  static const int fxFeeBps = 200;

  /// Trades carry no fee. Mirrors `TRADE_FEE_BPS` in `domain/trade/tradeFee.ts`.
  static const int tradeFeeBps = 0;

  static String _feeCurrency(String? currency) {
    final String code = (currency ?? '').trim().toLowerCase();
    return code.isEmpty ? 'aud' : code;
  }

  static List<int> _rateFor(String code) =>
      serviceFeeRates[code] ?? serviceFeeRateFallback;

  /// The service fee on a cash sale paid by card: the clean rate of price plus postage,
  /// rounded to the nearest cent, plus the fixed part. Zero for a zero base.
  ///
  /// Mirrors `platformFeeCentsFor` / `cashSaleFeeMinor` in the web app.
  static int platformFee(int priceCents, {required String? currency, int shippingCents = 0}) {
    final int base = (priceCents < 0 ? 0 : priceCents) + (shippingCents < 0 ? 0 : shippingCents);
    if (base <= 0) return 0;
    final List<int> rate = _rateFor(_feeCurrency(currency));
    return ((base * rate[0]) + 5000) ~/ 10000 + rate[1];
  }

  /// The fee for one side of a trade: 0, because trades carry no fee.
  static int tradeFee(int valueCents, {required String? currency}) {
    if (valueCents <= 0 || tradeFeeBps <= 0) return 0;
    return ((valueCents * tradeFeeBps) + 5000) ~/ 10000;
  }

  /// "3% + $0.60": the card service fee as members read it. Exact: the fee is this rate
  /// of price plus postage.
  ///
  /// Mirrors `processingFeeRateLabel` in `lib/fees/feeLabels.ts`.
  static String processingRateLabel(String? currency) {
    final String code = _feeCurrency(currency);
    final List<int> rate = _rateFor(code);
    final double percent = rate[0] / 100;
    final String percentText = percent == percent.roundToDouble()
        ? percent.toStringAsFixed(0)
        : percent.toStringAsFixed(2).replaceAll(RegExp(r'0$'), '');
    return '$percentText% + ${format(rate[1], code)}';
  }

  /// The fee row's name. Mirrors `PROCESSING_FEE_NAME` in `lib/fees/feeLabels.ts`.
  static const String processingFeeName = 'Service fee';

  /// Hint beside the fee row. Mirrors `PROCESSING_FEE_HINT` in `lib/fees/feeLabels.ts`.
  static const String processingFeeHint =
      "Covers Stripe's payment and payout costs, plus about 1% to NoDitto. Returned if the sale is refunded in full.";

  /// Where a trade would show a fee. Mirrors `TRADE_NO_FEE_NOTE` in `lib/fees/feeLabels.ts`.
  static const String tradeNoFeeNote =
      'Trades have no NoDitto fee. The collateral is a card hold, which costs nothing.';

  /// Returns total cost for a cash sale buyer: price + shipping + service fee.
  static int cashSaleTotal({
    required int priceCents,
    required int shippingCents,
    required String? currency,
  }) {
    return priceCents +
        shippingCents +
        platformFee(priceCents, currency: currency, shippingCents: shippingCents);
  }
}
