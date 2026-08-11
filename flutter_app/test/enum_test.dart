import 'package:flutter_test/flutter_test.dart';
import 'package:cardtrade/models/enums.dart';

void main() {
  group('parseEnum()', () {
    test('parses IN_TRANSIT to TradeState.inTransit', () {
      final result = parseEnum('IN_TRANSIT', TradeState.values);
      expect(result, equals(TradeState.inTransit));
    });

    test('parses NEGOTIATING to TradeState.negotiating', () {
      final result = parseEnum('NEGOTIATING', TradeState.values);
      expect(result, equals(TradeState.negotiating));
    });

    test('parses COLLATERAL_PENDING to TradeState.collateralPending', () {
      final result = parseEnum('COLLATERAL_PENDING', TradeState.values);
      expect(result, equals(TradeState.collateralPending));
    });

    test('parses COLLATERAL_LOCKED to TradeState.collateralLocked', () {
      final result = parseEnum('COLLATERAL_LOCKED', TradeState.values);
      expect(result, equals(TradeState.collateralLocked));
    });

    test('parses INSPECTION to TradeState.inspection', () {
      final result = parseEnum('INSPECTION', TradeState.values);
      expect(result, equals(TradeState.inspection));
    });

    test('parses COMPLETED to TradeState.completed', () {
      final result = parseEnum('COMPLETED', TradeState.values);
      expect(result, equals(TradeState.completed));
    });

    test('parses DISPUTED to TradeState.disputed', () {
      final result = parseEnum('DISPUTED', TradeState.values);
      expect(result, equals(TradeState.disputed));
    });

    test('parses FRAUD_RESOLVED to TradeState.fraudResolved', () {
      final result = parseEnum('FRAUD_RESOLVED', TradeState.values);
      expect(result, equals(TradeState.fraudResolved));
    });

    test('parses CANCELLED to TradeState.cancelled', () {
      final result = parseEnum('CANCELLED', TradeState.values);
      expect(result, equals(TradeState.cancelled));
    });

    test('parses CashSaleStatus values correctly', () {
      expect(
        parseEnum('ESCROW_HELD', CashSaleStatus.values),
        equals(CashSaleStatus.escrowHeld),
      );
      expect(
        parseEnum('PAYMENT_PENDING', CashSaleStatus.values),
        equals(CashSaleStatus.paymentPending),
      );
      expect(
        parseEnum('AGREEMENT', CashSaleStatus.values),
        equals(CashSaleStatus.agreement),
      );
    });

    test('parses OfferStatus values correctly', () {
      expect(
        parseEnum('PENDING', OfferStatus.values),
        equals(OfferStatus.pending),
      );
      expect(
        parseEnum('ACCEPTED', OfferStatus.values),
        equals(OfferStatus.accepted),
      );
      expect(
        parseEnum('DECLINED', OfferStatus.values),
        equals(OfferStatus.declined),
      );
      expect(
        parseEnum('COUNTERED', OfferStatus.values),
        equals(OfferStatus.countered),
      );
      expect(
        parseEnum('WITHDRAWN', OfferStatus.values),
        equals(OfferStatus.withdrawn),
      );
    });

    test('parses HandoverMethod values correctly', () {
      expect(
        parseEnum('IN_PERSON', HandoverMethod.values),
        equals(HandoverMethod.inPerson),
      );
      expect(
        parseEnum('DELIVERY', HandoverMethod.values),
        equals(HandoverMethod.delivery),
      );
    });

    test('parses HoldStatus values correctly', () {
      expect(
        parseEnum('ACTIVE', HoldStatus.values),
        equals(HoldStatus.active),
      );
      expect(
        parseEnum('VOIDED', HoldStatus.values),
        equals(HoldStatus.voided),
      );
      expect(
        parseEnum('PARTIALLY_CAPTURED', HoldStatus.values),
        equals(HoldStatus.partiallyCaptured),
      );
      expect(
        parseEnum('FULLY_CAPTURED', HoldStatus.values),
        equals(HoldStatus.fullyCaptured),
      );
    });

    test('returns null for null input', () {
      expect(parseEnum(null, TradeState.values), isNull);
    });

    test('returns null for unknown value', () {
      expect(parseEnum('NONEXISTENT', TradeState.values), isNull);
    });

    test('returns null for empty string', () {
      expect(parseEnum('', TradeState.values), isNull);
    });
  });

  group('enumToString()', () {
    test('converts TradeState.inTransit to IN_TRANSIT', () {
      expect(enumToString(TradeState.inTransit), equals('IN_TRANSIT'));
    });

    test('converts TradeState.negotiating to NEGOTIATING', () {
      expect(enumToString(TradeState.negotiating), equals('NEGOTIATING'));
    });

    test('converts TradeState.collateralPending to COLLATERAL_PENDING', () {
      expect(
        enumToString(TradeState.collateralPending),
        equals('COLLATERAL_PENDING'),
      );
    });

    test('converts TradeState.collateralLocked to COLLATERAL_LOCKED', () {
      expect(
        enumToString(TradeState.collateralLocked),
        equals('COLLATERAL_LOCKED'),
      );
    });

    test('converts TradeState.fraudResolved to FRAUD_RESOLVED', () {
      expect(
        enumToString(TradeState.fraudResolved),
        equals('FRAUD_RESOLVED'),
      );
    });

    test('converts CashSaleStatus.escrowHeld to ESCROW_HELD', () {
      expect(
        enumToString(CashSaleStatus.escrowHeld),
        equals('ESCROW_HELD'),
      );
    });

    test('converts CashSaleStatus.paymentPending to PAYMENT_PENDING', () {
      expect(
        enumToString(CashSaleStatus.paymentPending),
        equals('PAYMENT_PENDING'),
      );
    });

    test('converts HandoverMethod.inPerson to IN_PERSON', () {
      expect(
        enumToString(HandoverMethod.inPerson),
        equals('IN_PERSON'),
      );
    });

    test('converts OfferStatus.pending to PENDING', () {
      expect(enumToString(OfferStatus.pending), equals('PENDING'));
    });

    test('converts HoldStatus.partiallyCaptured to PARTIALLY_CAPTURED', () {
      expect(
        enumToString(HoldStatus.partiallyCaptured),
        equals('PARTIALLY_CAPTURED'),
      );
    });
  });

  group('parseEnum/enumToString roundtrip', () {
    test('every TradeState survives roundtrip', () {
      for (final state in TradeState.values) {
        final serialized = enumToString(state);
        final deserialized = parseEnum(serialized, TradeState.values);
        expect(deserialized, equals(state),
            reason: 'Failed roundtrip for $state → $serialized');
      }
    });

    test('every CashSaleStatus survives roundtrip', () {
      for (final status in CashSaleStatus.values) {
        final serialized = enumToString(status);
        final deserialized = parseEnum(serialized, CashSaleStatus.values);
        expect(deserialized, equals(status),
            reason: 'Failed roundtrip for $status → $serialized');
      }
    });

    test('every OfferStatus survives roundtrip', () {
      for (final status in OfferStatus.values) {
        final serialized = enumToString(status);
        final deserialized = parseEnum(serialized, OfferStatus.values);
        expect(deserialized, equals(status),
            reason: 'Failed roundtrip for $status → $serialized');
      }
    });

    test('every HoldStatus survives roundtrip', () {
      for (final status in HoldStatus.values) {
        final serialized = enumToString(status);
        final deserialized = parseEnum(serialized, HoldStatus.values);
        expect(deserialized, equals(status),
            reason: 'Failed roundtrip for $status → $serialized');
      }
    });

    test('every HandoverMethod survives roundtrip', () {
      for (final method in HandoverMethod.values) {
        final serialized = enumToString(method);
        final deserialized = parseEnum(serialized, HandoverMethod.values);
        expect(deserialized, equals(method),
            reason: 'Failed roundtrip for $method → $serialized');
      }
    });
  });

  group('isTerminalTradeState()', () {
    test('COMPLETED is terminal', () {
      expect(isTerminalTradeState(TradeState.completed), isTrue);
    });

    test('FRAUD_RESOLVED is terminal', () {
      expect(isTerminalTradeState(TradeState.fraudResolved), isTrue);
    });

    test('CANCELLED is terminal', () {
      expect(isTerminalTradeState(TradeState.cancelled), isTrue);
    });

    test('NEGOTIATING is not terminal', () {
      expect(isTerminalTradeState(TradeState.negotiating), isFalse);
    });

    test('IN_TRANSIT is not terminal', () {
      expect(isTerminalTradeState(TradeState.inTransit), isFalse);
    });

    test('INSPECTION is not terminal', () {
      expect(isTerminalTradeState(TradeState.inspection), isFalse);
    });

    test('DISPUTED is not terminal', () {
      expect(isTerminalTradeState(TradeState.disputed), isFalse);
    });
  });

  group('isTerminalCashSaleStatus()', () {
    test('COMPLETED is terminal', () {
      expect(isTerminalCashSaleStatus(CashSaleStatus.completed), isTrue);
    });

    test('CANCELLED is terminal', () {
      expect(isTerminalCashSaleStatus(CashSaleStatus.cancelled), isTrue);
    });

    test('FAILED is terminal', () {
      expect(isTerminalCashSaleStatus(CashSaleStatus.failed), isTrue);
    });

    test('REFUNDED is terminal', () {
      expect(isTerminalCashSaleStatus(CashSaleStatus.refunded), isTrue);
    });

    test('AGREEMENT is not terminal', () {
      expect(isTerminalCashSaleStatus(CashSaleStatus.agreement), isFalse);
    });

    test('ESCROW_HELD is not terminal', () {
      expect(isTerminalCashSaleStatus(CashSaleStatus.escrowHeld), isFalse);
    });

    test('INSPECTION is not terminal', () {
      expect(isTerminalCashSaleStatus(CashSaleStatus.inspection), isFalse);
    });
  });
}
