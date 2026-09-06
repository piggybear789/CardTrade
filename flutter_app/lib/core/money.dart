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

  /// Calculates platform fee from item price in cents.
  ///
  /// 5% of item price (PLATFORM_FEE_BPS = 500). Uses rounding (not truncation)
  /// to match `platformFeeCentsFor` in `domain/orchestrator/cashSaleOrchestrator.ts`.
  static int platformFee(int priceCents) {
    return ((priceCents * 500) + 5000) ~/ 10000;
  }

  /// Calculates trade fee for one side (5% of value). Rounds to match the server.
  static int tradeFee(int valueCents) {
    return ((valueCents * 500) + 5000) ~/ 10000;
  }

  /// Returns total cost for a cash sale buyer: price + shipping + platform fee.
  static int cashSaleTotal({
    required int priceCents,
    required int shippingCents,
  }) {
    return priceCents + shippingCents + platformFee(priceCents);
  }
}
