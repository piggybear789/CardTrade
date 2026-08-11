import 'package:intl/intl.dart';

/// Money formatting utilities.
///
/// All money in the app is integer minor units (cents for most currencies,
/// yen for JPY). This matches the web app's convention end-to-end.
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
