// The contract-room golden CASES — the sale room and the trade room — staged ahead
// of the harness that captures them.
//
// THIS FILE STILL HOLDS NO `matchesGoldenFile` CALL, for the reason recorded at the
// head of `test/golden/shell/shell_golden_cases.dart`: a case declares a name, a
// surface, the scales it is captured at and the tree to capture, and says nothing
// about pixels. `contract_golden_test.dart` walks this list through the harness and
// owns the references in `goldens/`; `contract_cases_test.dart` builds every case at
// every declared scale and asserts it lays out, which runs on every host unlike the
// comparison.
//
// The references were captured only after `test/golden/_harness/` existed to pin the
// designated host, the typeface, the device pixel ratio, the clock, the text-scale cap
// and the animations. An image taken before that would have to be re-baselined for a
// reason that is not a design change, which is the one thing Req 15.12 forbids.
//
// WHICH STATES ARE HERE. Every case that is not the neutral room supplies a served
// step plan through `saleStepPlanFixture` / `tradeStepPlanFixture`, because the
// rooms no longer declare one — `.kiro/specs/mobile-parity/` Requirement 11 moved
// the derivation to `domain/contract/` and the rooms read it over the mobile API.
// A case that supplied no plan would photograph the neutral room under whatever
// name it was given, which is why the plan is explicit per case and the neutral
// case is the ONLY one that omits it.
//
// The halted room is staged as a CANCELLED sale and a CANCELLED trade, which is
// where each of those genuinely stops, and the served plan marks that column with a
// cross.
//
// EVERY CASE IS FIXTURE-BUILT (Req 15.11): each pumps the real room over the
// provider overrides in `test/support/contract_fixtures.dart`, so no case reads
// Supabase and none of them can change because the database did.
//
// Requirements 7.2–7.9, 7.11, 13.13, 15.10, 15.11.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart' show Override;

import 'package:cardtrade/features/sales/screens/sale_room_screen.dart';
import 'package:cardtrade/features/trades/screens/trade_room_screen.dart';
import 'package:cardtrade/models/cash_sale.dart';
import 'package:cardtrade/models/cash_sale_item.dart';
import 'package:cardtrade/models/contract_step.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/models/pre_auth_hold.dart';
import 'package:cardtrade/models/trade.dart';

import '../../support/contract_fixtures.dart';
import '../../support/listing_fixtures.dart';

/// The phone surface every contract golden is captured on.
const Size kContractGoldenSurface = Size(390, 844);

/// One golden case: a name, a surface, the text scales it is captured at, the
/// tree to capture, and the provider overrides it is captured over.
@immutable
class ContractGoldenCase {
  const ContractGoldenCase({
    required this.name,
    required this.build,
    required this.overrides,
    this.surface = kContractGoldenSurface,
    this.textScales = const <double>[1.0, 2.0],
    this.runsCountdown = false,
  });

  /// File-name stem. The harness appends the scale, so `sale_room_inspection`
  /// becomes `sale_room_inspection@1.0x.png` and `…@2.0x.png`.
  ///
  /// Member-facing vocabulary, and never a retired word: the trade collateral
  /// cases are named for the collateral and not for a bond.
  final String name;

  /// The room under test, built fresh per scale. Every room brings its own
  /// `Scaffold`.
  final Widget Function() build;

  /// The fixture providers the case is built over.
  final List<Override> overrides;

  final Size surface;

  /// Req 13.13 pairs every state with a 2.0 twin at the same surface size.
  final List<double> textScales;

  /// Whether the room starts the inspection countdown, which runs a periodic
  /// timer the capture has to tear down rather than leave pending.
  final bool runsCountdown;
}

ContractGoldenCase _saleCase(
  String name, {
  required CashSale sale,
  String? viewerId = kFixtureBuyerId,
  List<CashSaleItem> lineItems = const <CashSaleItem>[],
  List<ContractStep>? stepPlan,
}) {
  return ContractGoldenCase(
    name: name,
    build: () => SaleRoomScreen(saleId: sale.id),
    overrides: saleRoomOverrides(
      sale: sale,
      viewerId: viewerId,
      lineItems: lineItems,
      stepPlan: stepPlan,
    ),
    runsCountdown: sale.status == CashSaleStatus.inspection,
  );
}

ContractGoldenCase _tradeCase(
  String name, {
  required Trade trade,
  String? viewerId = kFixtureBuyerId,
  List<PreAuthHold> holds = const <PreAuthHold>[],
  List<ContractStep>? stepPlan,
}) {
  return ContractGoldenCase(
    name: name,
    build: () => TradeRoomScreen(tradeId: trade.id),
    overrides: tradeRoomOverrides(
      trade: trade,
      viewerId: viewerId,
      holds: holds,
      stepPlan: stepPlan,
    ),
  );
}

/// The cash sale room's required presentations.
final List<ContractGoldenCase> kSaleRoomGoldenCases = <ContractGoldenCase>[
  // Before payment: the live step carries a primary action and the money region
  // states what the buyer will pay.
  _saleCase(
    'sale_room_before_payment',
    sale: makeSale(status: CashSaleStatus.agreement),
    stepPlan: saleStepPlanFixture(reached: 0),
  ),
  // The same step for a binder contract, where the lines say what is covered.
  _saleCase(
    'sale_room_before_payment_binder',
    sale: makeSale(status: CashSaleStatus.agreement, fromShopfront: true),
    stepPlan: saleStepPlanFixture(reached: 0),
    lineItems: <CashSaleItem>[
      makeSaleLineItem(),
      makeSaleLineItem(
        id: 'line-2',
        description: 'Snorlax VMAX, sleeved',
        quantity: 2,
      ),
    ],
  ),
  _saleCase(
    'sale_room_inspection',
    sale: makeSale(
      status: CashSaleStatus.inspection,
      termsAgreed: true,
      shippedAt: kFixtureInstant,
      carrierDeliveredAt: kFixtureInstant,
      inspectionDeadlineAt: fixtureDeadline(),
    ),
    stepPlan: saleStepPlanFixture(reached: 4),
  ),
  _saleCase(
    'sale_room_completed',
    sale: makeSale(
      status: CashSaleStatus.completed,
      termsAgreed: true,
      shippedAt: kFixtureInstant,
      carrierDeliveredAt: kFixtureInstant,
      completedAt: kFixtureInstant,
    ),
    stepPlan: saleStepPlanFixture(complete: true),
  ),
  // Halted: a cross at the column the sale stopped on, and no action.
  _saleCase(
    'sale_room_cancelled',
    sale: makeSale(
      status: CashSaleStatus.cancelled,
      cancelledAt: kFixtureInstant,
    ),
    stepPlan: saleStepPlanFixture(reached: 0, halted: true),
  ),
  // The neutral room: the plan is UNAVAILABLE, which is what no session, a
  // transport failure or a status the server declines to place all produce
  // (mobile-parity Req 11.5). No plan is supplied on purpose — the file name is
  // kept so the reference image stays comparable, but what it depicts is now a
  // room whose plan never arrived rather than a status a local list could not
  // place, because there is no local list left to fail.
  _saleCase(
    'sale_room_status_not_recognised',
    sale: makeSale(
      status: CashSaleStatus.disputed,
      termsAgreed: true,
      disputedAt: kFixtureInstant,
    ),
  ),
];

/// The trade room's required presentations.
final List<ContractGoldenCase> kTradeRoomGoldenCases = <ContractGoldenCase>[
  // Before collateral: the terms notice, the disclosed fee, and the explanation
  // of what trade collateral is — which a trader needs BEFORE accepting.
  _tradeCase(
    'trade_room_before_collateral',
    trade: makeTrade(state: TradeState.negotiating),
    stepPlan: tradeStepPlanFixture(reached: 0),
  ),
  _tradeCase(
    'trade_room_collateral_held',
    trade: makeTrade(state: TradeState.collateralLocked, termsAgreed: true),
    stepPlan: tradeStepPlanFixture(reached: 1),
    holds: <PreAuthHold>[
      makeHold(),
      makeHold(id: 'hold-2', traderId: kFixtureCounterpartId),
    ],
  ),
  _tradeCase(
    'trade_room_inspection',
    trade: makeTrade(
      state: TradeState.inspection,
      termsAgreed: true,
      inspectionDeadlineAt: fixtureDeadline(hours: 72),
    ),
    stepPlan: tradeStepPlanFixture(reached: 3),
    holds: <PreAuthHold>[makeHold()],
  ),
  _tradeCase(
    'trade_room_completed',
    trade: makeTrade(state: TradeState.completed, termsAgreed: true),
    stepPlan: tradeStepPlanFixture(complete: true),
    holds: <PreAuthHold>[makeHold(status: HoldStatus.voided)],
  ),
  _tradeCase(
    'trade_room_cancelled',
    trade: makeTrade(
      state: TradeState.cancelled,
      cancelledAt: kFixtureInstant,
    ),
    stepPlan: tradeStepPlanFixture(reached: 0, halted: true),
  ),
];

/// Every contract golden case, the sale room then the trade room.
final List<ContractGoldenCase> kContractGoldenCases = <ContractGoldenCase>[
  ...kSaleRoomGoldenCases,
  ...kTradeRoomGoldenCases,
];
