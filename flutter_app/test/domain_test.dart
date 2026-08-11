import 'package:flutter_test/flutter_test.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/domain/identity/identity_gate.dart';
import 'package:cardtrade/domain/bond/bond_policy.dart';
import 'package:cardtrade/domain/trade/trade_side_values.dart';
import 'package:cardtrade/domain/trade/trade_fee.dart';
import 'package:cardtrade/domain/state_machine/machine.dart';
import 'package:cardtrade/domain/region/regions.dart';
import 'package:cardtrade/domain/fulfilment/validation.dart';

void main() {
  // ═══════════════════════════════════════════════════════════════════════════
  // Identity Gate
  // ═══════════════════════════════════════════════════════════════════════════

  group('Identity Gate', () {
    test('satisfiesIdentityGate only returns true for VERIFIED', () {
      expect(satisfiesIdentityGate(IdentityCheckStatus.verified), isTrue);
      expect(satisfiesIdentityGate(IdentityCheckStatus.none), isFalse);
      expect(satisfiesIdentityGate(IdentityCheckStatus.pending), isFalse);
      expect(satisfiesIdentityGate(IdentityCheckStatus.failed), isFalse);
    });

    test('verificationState maps correctly', () {
      expect(verificationState(IdentityCheckStatus.none), VerificationState.notStarted);
      expect(verificationState(IdentityCheckStatus.pending), VerificationState.inProgress);
      expect(verificationState(IdentityCheckStatus.failed), VerificationState.notApproved);
      expect(verificationState(IdentityCheckStatus.verified), VerificationState.verified);
    });

    test('showsVerifiedBadge matches satisfiesIdentityGate', () {
      for (final status in IdentityCheckStatus.values) {
        expect(
          showsVerifiedBadge(status),
          satisfiesIdentityGate(status),
          reason: 'Badge and gate must agree for $status',
        );
      }
    });

    test('canReceiveFunds requires all three conditions', () {
      expect(
        canReceiveFunds(
          merchantStatus: MerchantStatus.approved,
          merchantSettlementsEnabled: true,
          merchantRef: 'acct_123',
        ),
        isTrue,
      );

      // Missing merchantRef
      expect(
        canReceiveFunds(
          merchantStatus: MerchantStatus.approved,
          merchantSettlementsEnabled: true,
          merchantRef: null,
        ),
        isFalse,
      );

      // Not approved
      expect(
        canReceiveFunds(
          merchantStatus: MerchantStatus.pending,
          merchantSettlementsEnabled: true,
          merchantRef: 'acct_123',
        ),
        isFalse,
      );

      // Settlements not enabled
      expect(
        canReceiveFunds(
          merchantStatus: MerchantStatus.approved,
          merchantSettlementsEnabled: false,
          merchantRef: 'acct_123',
        ),
        isFalse,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Bond Policy
  // ═══════════════════════════════════════════════════════════════════════════

  group('Bond Policy', () {
    test('trade bonds are NEVER exempt regardless of verification', () {
      // 100% of value, always
      expect(requiredTradeBondCents(valueCents: 5000), 5000);
      expect(requiredTradeBondCents(valueCents: 10000), 10000);
      expect(requiredTradeBondCents(valueCents: 1), 1);
    });

    test('cash sale bonds exempt verified sellers', () {
      expect(
        requiredCashSaleBondCents(verified: true, fmvCents: 5000),
        0, // Exempt
      );
      expect(
        requiredCashSaleBondCents(verified: false, fmvCents: 5000),
        5000, // Not exempt
      );
    });

    test('resolveTradeBonds bonds BOTH parties (never exempt)', () {
      final bonds = resolveTradeBonds(
        initiatorSideCents: 3000,
        counterpartSideCents: 5000,
      );
      // Each bonds the OTHER side's value (what they receive)
      expect(bonds.initiatorBondCents, 5000);
      expect(bonds.counterpartBondCents, 3000);
    });

    test('bond never exceeds value at stake', () {
      final policy = BondPolicy(
        unverifiedRateBps: 20000, // 200% rate (capped at value)
      );
      expect(requiredTradeBondCents(valueCents: 1000, policy: policy), 1000);
    });

    test('bond respects ceiling', () {
      final policy = BondPolicy(ceilingCents: 500);
      expect(requiredTradeBondCents(valueCents: 10000, policy: policy), 500);
    });

    test('zero value returns zero bond', () {
      expect(requiredTradeBondCents(valueCents: 0), 0);
      expect(requiredTradeBondCents(valueCents: -100), 0);
    });

    test('canPostRequiredBond requires saved card', () {
      expect(canPostRequiredBond(valueCents: 1000, payerId: 'cus_123'), isTrue);
      expect(canPostRequiredBond(valueCents: 1000, payerId: null), isFalse);
      expect(canPostRequiredBond(valueCents: 0, payerId: null), isTrue); // No bond needed
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Trade Side Values
  // ═══════════════════════════════════════════════════════════════════════════

  group('Trade Side Values', () {
    test('normal trade: both sides use their own FMV', () {
      final sides = resolveTradeSideValues(
        initiatorGoodsCents: 3000,
        counterpartGoodsCents: 5000,
        counterpartIsShopfront: false,
      );
      expect(sides.initiatorSideCents, 3000);
      expect(sides.counterpartSideCents, 5000);
    });

    test('THE BINDER RULE: shopfront side equals initiator side', () {
      final sides = resolveTradeSideValues(
        initiatorGoodsCents: 4000,
        counterpartGoodsCents: 99999, // This is ignored for shopfronts
        counterpartIsShopfront: true,
      );
      expect(sides.initiatorSideCents, 4000);
      expect(sides.counterpartSideCents, 4000); // = initiatorSideCents
    });

    test('tradeSidesAreValued rejects zero sides', () {
      expect(
        tradeSidesAreValued((initiatorSideCents: 1000, counterpartSideCents: 1000)),
        isTrue,
      );
      expect(
        tradeSidesAreValued((initiatorSideCents: 0, counterpartSideCents: 1000)),
        isFalse,
      );
      expect(
        tradeSidesAreValued((initiatorSideCents: 1000, counterpartSideCents: 0)),
        isFalse,
      );
    });

    test('negative values clamped to 0', () {
      final sides = resolveTradeSideValues(
        initiatorGoodsCents: -500,
        counterpartGoodsCents: 3000,
        counterpartIsShopfront: false,
      );
      expect(sides.initiatorSideCents, 0);
      expect(sides.counterpartSideCents, 3000);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Trade Fee
  // ═══════════════════════════════════════════════════════════════════════════

  group('Trade Fee', () {
    test('5% of side value', () {
      expect(tradeFee(10000), 500); // 5% of $100
      expect(tradeFee(1999), 99); // 5% of $19.99 = $0.99
      expect(tradeFee(100), 5); // 5% of $1.00
    });

    test('zero and negative values return 0', () {
      expect(tradeFee(0), 0);
      expect(tradeFee(-1000), 0);
    });

    test('resolveTradeFeesFromValues is symmetric', () {
      final fees = resolveTradeFeesFromValues(
        initiatorSideCents: 5000,
        counterpartSideCents: 5000,
      );
      expect(fees.initiatorFeeCents, fees.counterpartFeeCents);
      expect(fees.initiatorFeeCents, 250); // 5% of $50
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // State Machine
  // ═══════════════════════════════════════════════════════════════════════════

  group('State Machine', () {
    test('all 9 states are in the transitions table', () {
      expect(transitions.length, 9);
      for (final state in TradeState.values) {
        expect(transitions.containsKey(state), isTrue,
            reason: '$state missing from transitions');
      }
    });

    test('terminal states have empty transition maps', () {
      expect(transitions[TradeState.completed], isEmpty);
      expect(transitions[TradeState.fraudResolved], isEmpty);
      expect(transitions[TradeState.cancelled], isEmpty);
    });

    test('isTerminal correctly identifies terminal states', () {
      expect(isTerminal(TradeState.completed), isTrue);
      expect(isTerminal(TradeState.fraudResolved), isTrue);
      expect(isTerminal(TradeState.cancelled), isTrue);
      expect(isTerminal(TradeState.negotiating), isFalse);
      expect(isTerminal(TradeState.inspection), isFalse);
    });

    test('NEGOTIATING transitions', () {
      expect(tryTransition(TradeState.negotiating, TradeEvent.termsAgreed),
          TradeState.collateralPending);
      expect(tryTransition(TradeState.negotiating, TradeEvent.offerDeclined),
          TradeState.cancelled);
      expect(tryTransition(TradeState.negotiating, TradeEvent.bothShipped),
          isNull); // Invalid
    });

    test('COLLATERAL_LOCKED two routes to INSPECTION', () {
      // DELIVERY: shipped → transit → received → inspection
      expect(tryTransition(TradeState.collateralLocked, TradeEvent.bothShipped),
          TradeState.inTransit);
      expect(tryTransition(TradeState.inTransit, TradeEvent.bothReceived),
          TradeState.inspection);

      // IN_PERSON: handover confirmed → inspection (skips IN_TRANSIT)
      expect(
          tryTransition(
              TradeState.collateralLocked, TradeEvent.bothHandoverConfirmed),
          TradeState.inspection);
    });

    test('BOTH_HANDOVER_CONFIRMED goes to INSPECTION not COMPLETED', () {
      // This is critical — in-person trades still get an inspection window
      final next = tryTransition(
          TradeState.collateralLocked, TradeEvent.bothHandoverConfirmed);
      expect(next, TradeState.inspection);
      expect(next, isNot(TradeState.completed));
    });

    test('HANDOVER_FAILED goes to DISPUTED from both states', () {
      expect(tryTransition(TradeState.collateralLocked, TradeEvent.handoverFailed),
          TradeState.disputed);
      expect(tryTransition(TradeState.inTransit, TradeEvent.handoverFailed),
          TradeState.disputed);
    });

    test('HOLDS_FAILED is a self-loop (retry)', () {
      expect(tryTransition(TradeState.collateralPending, TradeEvent.holdsFailed),
          TradeState.collateralPending);
    });

    test('canTransition validates correctly', () {
      expect(canTransition(TradeState.negotiating, TradeEvent.termsAgreed), isTrue);
      expect(canTransition(TradeState.negotiating, TradeEvent.bothShipped), isFalse);
      expect(canTransition(TradeState.completed, TradeEvent.termsAgreed), isFalse);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Regions
  // ═══════════════════════════════════════════════════════════════════════════

  group('Regions', () {
    test('41 regions defined', () {
      expect(allRegions.length, 41);
    });

    test('only AU is trading-enabled', () {
      final trading = tradingRegions();
      expect(trading.length, 1);
      expect(trading.first.code, 'AU');
    });

    test('JPY is zero-decimal', () {
      final jp = findRegion('JP');
      expect(jp, isNotNull);
      expect(jp!.minorUnitDigits, 0);
    });

    test('normalizeRegionCode handles edge cases', () {
      expect(normalizeRegionCode('au'), 'AU');
      expect(normalizeRegionCode(' GB '), 'GB');
      expect(normalizeRegionCode(''), isNull);
      expect(normalizeRegionCode('X'), isNull);
      expect(normalizeRegionCode('ZZZ'), isNull);
      expect(normalizeRegionCode('XX'), isNull); // Unknown
      expect(normalizeRegionCode(null), isNull);
    });

    test('checkRegionCompatibility allows same enabled region', () {
      expect(checkRegionCompatibility('AU', 'AU'), isNull); // Compatible
    });

    test('checkRegionCompatibility rejects cross-region', () {
      final mismatch = checkRegionCompatibility('AU', 'GB');
      expect(mismatch, isNotNull);
      expect(mismatch!.reason, RegionMismatchReason.crossRegion);
    });

    test('checkRegionCompatibility rejects non-enabled region', () {
      final mismatch = checkRegionCompatibility('GB', 'GB');
      expect(mismatch, isNotNull);
      expect(mismatch!.reason, RegionMismatchReason.regionNotEnabled);
    });

    test('checkRegionCompatibility rejects absent regions', () {
      final mismatch = checkRegionCompatibility(null, 'AU');
      expect(mismatch, isNotNull);
      expect(mismatch!.reason, RegionMismatchReason.unknownRegion);
    });

    test('isTradingRegion checks both existence and enabled flag', () {
      expect(isTradingRegion('AU'), isTrue);
      expect(isTradingRegion('GB'), isFalse); // Exists but not enabled
      expect(isTradingRegion('XX'), isFalse); // Doesn't exist
      expect(isTradingRegion(null), isFalse);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Fulfilment Validation
  // ═══════════════════════════════════════════════════════════════════════════

  group('Fulfilment Validation', () {
    test('method is required', () {
      final result = validateFulfilmentTerms(const FulfilmentTerms());
      expect(result, isA<FulfilmentInvalid>());
      expect((result as FulfilmentInvalid).error, FulfilmentError.methodRequired);
    });

    test('in-person requires resolved place', () {
      final result = validateFulfilmentTerms(const FulfilmentTerms(
        method: HandoverMethod.inPerson,
      ));
      expect(result, isA<FulfilmentInvalid>());
      expect((result as FulfilmentInvalid).error, FulfilmentError.meetingPlaceRequired);
    });

    test('in-person requires future meeting time', () {
      final result = validateFulfilmentTerms(FulfilmentTerms(
        method: HandoverMethod.inPerson,
        meetingPlace: const ResolvedPlace(
          label: 'Town Hall', placeId: 'abc', lat: -33.8, lng: 151.2,
        ),
        meetingAt: DateTime.now().subtract(const Duration(hours: 1)),
      ));
      expect(result, isA<FulfilmentInvalid>());
      expect((result as FulfilmentInvalid).error, FulfilmentError.meetingTimePast);
    });

    test('valid in-person terms pass', () {
      final result = validateFulfilmentTerms(FulfilmentTerms(
        method: HandoverMethod.inPerson,
        meetingPlace: const ResolvedPlace(
          label: 'Town Hall', placeId: 'abc', lat: -33.8, lng: 151.2,
        ),
        meetingAt: DateTime.now().add(const Duration(days: 1)),
      ));
      expect(result, isA<FulfilmentValid>());
    });

    test('delivery requires cost', () {
      final result = validateFulfilmentTerms(const FulfilmentTerms(
        method: HandoverMethod.delivery,
      ));
      expect(result, isA<FulfilmentInvalid>());
      expect((result as FulfilmentInvalid).error, FulfilmentError.deliveryCostRequired);
    });

    test('delivery cost 0 is valid (free postage)', () {
      final result = validateFulfilmentTerms(const FulfilmentTerms(
        method: HandoverMethod.delivery,
        deliveryCostCents: 0,
      ));
      expect(result, isA<FulfilmentValid>());
    });

    test('negative delivery cost is invalid', () {
      final result = validateFulfilmentTerms(const FulfilmentTerms(
        method: HandoverMethod.delivery,
        deliveryCostCents: -100,
      ));
      expect(result, isA<FulfilmentInvalid>());
      expect((result as FulfilmentInvalid).error, FulfilmentError.deliveryCostInvalid);
    });
  });
}
