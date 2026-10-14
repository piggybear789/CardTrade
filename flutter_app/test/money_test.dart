import 'package:flutter_test/flutter_test.dart';
import 'package:cardtrade/core/money.dart';

void main() {
  group('Money.format()', () {
    test('formats AUD correctly — standard amount', () {
      // 1299 cents → "$12.99" (locale pinned to en_AU, so no "A$" prefix)
      final result = Money.format(1299, 'aud');
      expect(result, contains('12.99'));
      expect(result, contains('\$'));
    });

    test('formats AUD correctly — whole dollar', () {
      final result = Money.format(500, 'aud');
      expect(result, contains('5.00'));
    });

    test('formats AUD correctly — zero', () {
      final result = Money.format(0, 'aud');
      expect(result, contains('0.00'));
    });

    test('formats AUD correctly — large amount', () {
      final result = Money.format(99999, 'aud');
      expect(result, contains('999.99'));
    });

    test('formats JPY correctly — zero-decimal currency', () {
      // JPY has 0 minor unit digits, so 1000 yen is just ¥1,000
      final result = Money.format(1000, 'jpy');
      expect(result, contains('1,000'));
      expect(result, contains('¥'));
    });

    test('formats JPY correctly — small amount', () {
      final result = Money.format(50, 'jpy');
      expect(result, contains('50'));
    });

    test('handles uppercase currency code', () {
      final result = Money.format(1299, 'AUD');
      expect(result, contains('12.99'));
    });

    test('handles mixed case currency code', () {
      final result = Money.format(1299, 'Aud');
      expect(result, contains('12.99'));
    });
  });

  group('Money.formatSigned()', () {
    test('positive amount gets + prefix', () {
      final result = Money.formatSigned(500, 'aud');
      expect(result, startsWith('+'));
      expect(result, contains('5.00'));
    });

    test('negative amount gets - prefix', () {
      final result = Money.formatSigned(-500, 'aud');
      expect(result, startsWith('-'));
      expect(result, contains('5.00'));
    });

    test('zero has no prefix', () {
      final result = Money.formatSigned(0, 'aud');
      expect(result, isNot(startsWith('+')));
      expect(result, isNot(startsWith('-')));
    });
  });

  group('Money.platformFee()', () {
    test('is 0 for every price while fees are waived for the beta', () {
      expect(Money.betaFeeWaiver, isTrue);
      expect(Money.platformFee(10000, currency: 'aud'), equals(0));
      expect(Money.platformFee(7777, currency: 'aud'), equals(0));
      expect(Money.platformFee(1000, currency: null), equals(0));
    });

    test('zero price → zero fee', () {
      expect(Money.platformFee(0, currency: 'aud'), equals(0));
    });

    test('rate labels name the standard rate and no minimum', () {
      expect(Money.platformFeeRateLabel('aud'), equals('5%'));
      expect(Money.tradeFeeRateLabel('aud'), equals('5%'));
    });

    test('fee-waiver copy names the normal rate and never says beta', () {
      expect(Money.betaFeeNote(), equals('Open beta: NoDitto fees waived (normally 5%)'));
      expect(Money.feeWaivedHint, equals('Waived during open beta.'));
      expect(Money.feeRowRate(0), equals('waived in open beta, normally 5%'));
      expect(Money.betaFeeNote().toLowerCase(), isNot(contains('beta')));
      expect(Money.feeWaivedHint.toLowerCase(), isNot(contains('beta')));
      expect(Money.feeRowRate(0).toLowerCase(), isNot(contains('beta')));
      expect(Money.feeRowRate(500), equals('5%'));
    });
  });

  group('Money.standardFee() — the rate once the beta ends', () {
    test('calculates 5% — 10000 cents → 500 cents', () {
      expect(Money.standardFeeBps, equals(500));
      expect(Money.standardFee(10000), equals(500));
    });

    test('rounds half-up like the server — 7777 cents → 389 cents', () {
      // 7777 * 500 / 10000 = 388.85 → rounds to 389
      expect(Money.standardFee(7777), equals(389));
    });

    test('has no minimum — small sales pay the plain 5%', () {
      expect(Money.standardFee(1000), equals(50));
      expect(Money.standardFee(2000), equals(100));
      expect(Money.standardFee(1), equals(0));
      expect(Money.standardFee(1999), equals(100));
    });

    test('zero price → zero fee', () {
      expect(Money.standardFee(0), equals(0));
      expect(Money.standardFee(-5), equals(0));
    });
  });

  group('Money.tradeFee()', () {
    test('is 0 while fees are waived for the beta', () {
      expect(Money.tradeFee(10000, currency: 'aud'), equals(0));
      expect(Money.tradeFee(0, currency: 'aud'), equals(0));
    });
  });

  group('Money.cashSaleTotal()', () {
    test('sums price + shipping + platform fee', () {
      // price: 10000, shipping: 200, fee: 0 during the beta → total: 10200
      final total = Money.cashSaleTotal(
        priceCents: 10000,
        shippingCents: 200,
        currency: 'aud',
      );
      expect(total, equals(10200));
    });

    test('adds no fee on a small sale during the beta', () {
      final total = Money.cashSaleTotal(
        priceCents: 1000,
        shippingCents: 0,
        currency: 'aud',
      );
      expect(total, equals(1000));
    });
  });

  group('Money.minorUnitDigits()', () {
    test('returns 2 for AUD', () {
      expect(Money.minorUnitDigits('aud'), equals(2));
    });

    test('returns 0 for JPY', () {
      expect(Money.minorUnitDigits('jpy'), equals(0));
    });

    test('returns 0 for KRW', () {
      expect(Money.minorUnitDigits('krw'), equals(0));
    });

    test('returns 2 for USD', () {
      expect(Money.minorUnitDigits('usd'), equals(2));
    });

    test('returns 2 for GBP', () {
      expect(Money.minorUnitDigits('gbp'), equals(2));
    });

    test('handles uppercase currency code', () {
      expect(Money.minorUnitDigits('JPY'), equals(0));
    });
  });

  group('Money.format() edge cases', () {
    test('invalid currency code (too short) falls back to AUD formatting', () {
      // 'xx' is not a valid 3-letter code, so falls back to AUD
      final result = Money.format(1299, 'xx');
      expect(result, contains('12.99'));
      expect(result, contains('\$'));
    });

    test('empty currency code falls back to AUD formatting', () {
      final result = Money.format(1299, '');
      expect(result, contains('12.99'));
      expect(result, contains('\$'));
    });

    test('unknown but valid 3-letter code degrades to CODE + amount', () {
      // 'xyz' is syntactically valid but not in the intl database
      final result = Money.format(1299, 'xyz');
      expect(result, contains('XYZ'));
      expect(result, contains('12.99'));
    });
  });

  // The money FIELD helpers. These exist because two listing forms each carried
  // their own `/ 100` and their own dollars-to-cents parse, and one of them was a
  // recorded defect: a hand-written divisor renders ¥12,345 as "123.45".
  group('Money.amountText()', () {
    test('AUD keeps two digits', () {
      expect(Money.amountText(1299, 'aud'), '12.99');
      expect(Money.amountText(500, 'aud'), '5.00');
      expect(Money.amountText(1, 'aud'), '0.01');
      expect(Money.amountText(0, 'aud'), '0.00');
    });

    test('JPY has no subunit, so the figure is the whole amount', () {
      expect(Money.amountText(12345, 'jpy'), '12345');
    });

    test('carries no symbol and no digit grouping', () {
      expect(Money.amountText(123456789, 'aud'), '1234567.89');
    });
  });

  group('Money.parseAmountText()', () {
    test('parses with integer arithmetic, so 19.99 is 1999 and not 1998', () {
      expect(Money.parseAmountText('19.99', 'aud'), 1999);
      expect(Money.parseAmountText('9.99', 'aud'), 999);
      expect(Money.parseAmountText('29.99', 'aud'), 2999);
      expect(Money.parseAmountText('0.01', 'aud'), 1);
      expect(Money.parseAmountText('999.99', 'aud'), 99999);
    });

    test('a missing or short fraction is padded, a long one truncated', () {
      expect(Money.parseAmountText('12', 'aud'), 1200);
      expect(Money.parseAmountText('12.', 'aud'), 1200);
      expect(Money.parseAmountText('12.5', 'aud'), 1250);
      expect(Money.parseAmountText('12.999', 'aud'), 1299);
    });

    test('drops anything that is not a digit or a point', () {
      expect(Money.parseAmountText('\$ 12.99', 'aud'), 1299);
      expect(Money.parseAmountText('', 'aud'), 0);
      expect(Money.parseAmountText('abc', 'aud'), 0);
    });

    test('a zero-decimal currency takes the whole number as minor units', () {
      expect(Money.parseAmountText('12345', 'jpy'), 12345);
      expect(Money.parseAmountText('12345.67', 'jpy'), 12345);
    });

    test('round-trips whatever amountText produced', () {
      for (final int minorUnits in <int>[0, 1, 99, 100, 1999, 123456789]) {
        expect(
          Money.parseAmountText(Money.amountText(minorUnits, 'aud'), 'aud'),
          minorUnits,
        );
        expect(
          Money.parseAmountText(Money.amountText(minorUnits, 'jpy'), 'jpy'),
          minorUnits,
        );
      }
    });
  });

  group('Money.symbolFor()', () {
    test('is the bare symbol a field labels itself with', () {
      expect(Money.symbolFor('aud'), '\$');
      expect(Money.symbolFor('jpy'), '¥');
      expect(Money.symbolFor('gbp'), '£');
    });

    test('an unusable code degrades rather than throwing', () {
      expect(Money.symbolFor(''), '\$');
      expect(Money.symbolFor('xyz'), 'XYZ');
    });
  });
}
