// Fixture contracts and provider overrides for the two contract rooms, and for
// the contract golden CASES.
//
// FIXTURES ONLY, for the reason recorded at the head of `listing_fixtures.dart`:
// Req 15.11 requires a golden to build from fixture data rather than a read, and
// a widget test that reaches a database means something different every morning.
// Every provider a room watches is overridden here with a value — the sale and
// trade streams, the line items, the trade holds, the two items a trade values its
// sides from, and the signed-in member.
//
// `conversationId` is deliberately null on every fixture. The conversation panel
// is a separate surface with its own transport, its own tests (task 8.3) and its
// own providers; leaving it out keeps a contract-room test measuring the contract
// room. A room that carries one is not a different PRESENTATION of the contract.
//
// Requirements 7.2–7.9, 7.11–7.12, 15.10, 15.11.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/models/cash_sale.dart';
import 'package:cardtrade/models/cash_sale_item.dart';
import 'package:cardtrade/models/contract_step.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/models/item.dart';
import 'package:cardtrade/models/pre_auth_hold.dart';
import 'package:cardtrade/models/trade.dart';
import 'package:cardtrade/providers/auth_provider.dart';
import 'package:cardtrade/providers/listings_provider.dart';
import 'package:cardtrade/providers/sales_provider.dart';
import 'package:cardtrade/providers/trades_provider.dart';

import 'harness.dart';
import 'listing_fixtures.dart';

/// The fixture contract ids.
const String kFixtureSaleId = 'sale-1';
const String kFixtureTradeId = 'trade-1';

/// The other trader's listing in a fixture trade.
const String kFixtureCounterpartItemId = 'item-2';

/// The counterpart trader, who is not the fixture buyer or owner.
const String kFixtureCounterpartId = 'trader-2';

/// A deadline a fixed number of hours after [kFixtureInstant].
///
/// Read by the inspection cases. The countdown itself measures against
/// `DateTime.now()`, which a widget test cannot pin, so nothing asserts the
/// FIGURE it draws — only that the region is present and lays out.
DateTime fixtureDeadline({int hours = 48}) =>
    kFixtureInstant.add(Duration(hours: hours));

/// A cash sale as the server reports it.
///
/// Money is short on purpose, for the reason `kFixturePriceCents` records: the
/// test font's square glyphs make a four-figure price occupy far more width here
/// than in the shipped typeface.
CashSale makeSale({
  String id = kFixtureSaleId,
  CashSaleStatus status = CashSaleStatus.agreement,
  HandoverMethod? fulfilmentMethod = HandoverMethod.delivery,
  String buyerId = kFixtureBuyerId,
  String sellerId = kFixtureOwnerId,
  int agreedPriceCents = kFixturePriceCents,
  int shippingCostCents = 900,
  int platformFeeCents = 210,
  bool termsAgreed = false,
  bool fromShopfront = false,
  DateTime? shippedAt,
  DateTime? carrierDeliveredAt,
  DateTime? inspectionDeadlineAt,
  DateTime? completedAt,
  DateTime? cancelledAt,
  DateTime? disputedAt,
}) {
  const int termsVersion = 1;
  return CashSale(
    id: id,
    itemId: 'item-1',
    buyerId: buyerId,
    sellerId: sellerId,
    amountCents: agreedPriceCents + shippingCostCents + platformFeeCents,
    agreedPriceCents: agreedPriceCents,
    platformFeeCents: platformFeeCents,
    status: status,
    version: 3,
    itemTitle: 'Charizard Holo 1st Edition',
    itemDescription: descriptionOfLength(80),
    itemCondition: 'Near Mint',
    fulfillmentMethod: fulfilmentMethod,
    shippingCostCents: shippingCostCents,
    termsVersion: termsVersion,
    buyerTermsAcceptedVersion: termsAgreed ? termsVersion : null,
    sellerTermsAcceptedVersion: termsAgreed ? termsVersion : null,
    buyerTermsAcceptedAt: termsAgreed ? kFixtureInstant : null,
    sellerTermsAcceptedAt: termsAgreed ? kFixtureInstant : null,
    trackingCarrier: shippedAt == null ? null : 'Australia Post',
    trackingNumber: shippedAt == null ? null : 'AP123456789AU',
    shippedAt: shippedAt,
    carrierDeliveredAt: carrierDeliveredAt,
    inspectionDeadlineAt: inspectionDeadlineAt,
    completedAt: completedAt,
    cancelledAt: cancelledAt,
    disputedAt: disputedAt,
    sellerPayoutStatus: CashSalePayoutStatus.notDue,
    refundStatus: CashSalePayoutStatus.notDue,
    fromShopfront: fromShopfront,
    createdAt: kFixtureInstant,
    updatedAt: kFixtureInstant,
  );
}

/// One line of a binder contract — what this contract covers when the listing
/// cannot say.
CashSaleItem makeSaleLineItem({
  String id = 'line-1',
  String description = 'Pikachu VMAX, sleeved',
  String? condition = 'Near Mint',
  int quantity = 1,
  int unitPriceCents = kFixturePriceCents,
}) {
  return CashSaleItem(
    id: id,
    cashSaleId: kFixtureSaleId,
    description: description,
    condition: condition,
    quantity: quantity,
    unitPriceCents: unitPriceCents,
    createdAt: kFixtureInstant,
  );
}

/// A trade as the server reports it.
Trade makeTrade({
  String id = kFixtureTradeId,
  TradeState state = TradeState.negotiating,
  HandoverMethod? handoverMethod = HandoverMethod.delivery,
  String initiatorId = kFixtureBuyerId,
  String counterpartId = kFixtureCounterpartId,
  bool termsAgreed = false,
  int cashAmountCents = 0,
  String? counterpartGoodsDescription,
  DateTime? inspectionDeadlineAt,
  DateTime? cancelledAt,
  DateTime? disputedAt,
}) {
  const int termsVersion = 2;
  return Trade(
    id: id,
    initiatorId: initiatorId,
    counterpartId: counterpartId,
    initiatorItemId: 'item-1',
    counterpartItemId: kFixtureCounterpartItemId,
    state: state,
    version: 4,
    termsVersion: termsVersion,
    initiatorTermsAcceptedVersion: termsAgreed ? termsVersion : null,
    counterpartTermsAcceptedVersion: termsAgreed ? termsVersion : null,
    initiatorTermsAcceptedAt: termsAgreed ? kFixtureInstant : null,
    counterpartTermsAcceptedAt: termsAgreed ? kFixtureInstant : null,
    cashAmountCents: cashAmountCents,
    cashDirection:
        cashAmountCents == 0 ? null : TradeCashDirection.proposerPays,
    counterpartGoodsDescription: counterpartGoodsDescription,
    handoverMethod: handoverMethod,
    inspectionDeadlineAt: inspectionDeadlineAt,
    cancelledAt: cancelledAt,
    disputedAt: disputedAt,
    createdAt: kFixtureInstant,
    updatedAt: kFixtureInstant,
  );
}

/// A live card hold behind a trade. Trade collateral, never escrow: no money has
/// moved and the platform holds a claim on a card.
PreAuthHold makeHold({
  String id = 'hold-1',
  String traderId = kFixtureBuyerId,
  int amountCents = kFixturePriceCents,
  HoldStatus status = HoldStatus.active,
  DateTime? expiresAt,
}) {
  return PreAuthHold(
    id: id,
    tradeId: kFixtureTradeId,
    traderId: traderId,
    amountCents: amountCents,
    status: status,
    expiresAt: expiresAt ?? kFixtureInstant.add(const Duration(days: 6)),
    createdAt: kFixtureInstant,
    updatedAt: kFixtureInstant,
  );
}

/// A step plan as `app/api/mobile/cash-sale/step-plan` serves it.
///
/// FIXTURE DATA, NOT A DERIVATION. The rooms declare no step plan any more — it
/// comes from `domain/contract/cashSaleSteps.ts` over the mobile API — so a room
/// test has to supply one, and this is the transcript of what that endpoint returns
/// for the shape under test. It exists so a room test measures the ROOM: nothing
/// here decides which step a status belongs to, it records what the server said.
///
/// Passing an empty list is the NEUTRAL plan and is a legitimate case to stage: it
/// is what a room gets with no session, on a transport failure, or for a status the
/// server declines to place (Req 11.5).
List<ContractStep> saleStepPlanFixture({
  int? reached,
  bool halted = false,
  bool complete = false,
  bool inPerson = false,
}) {
  // The labels and rail labels the derivation returns for a delivery sale, in
  // order: terms, payment, ship, receive, inspect. `inPerson` replaces the two
  // shipping steps with the single mutual handover, exactly as the plan branches.
  final List<List<String>> shape = inPerson
      ? <List<String>>[
          <String>['terms', 'Discuss Terms', 'Set handover terms'],
          <String>['payment', 'Payment', 'Payment collected and held'],
          <String>['handover', 'Delivery', 'Both confirm the handover'],
        ]
      : <List<String>>[
          <String>['terms', 'Discuss Terms', 'Set handover terms'],
          <String>['payment', 'Payment', 'Payment collected and held'],
          <String>['ship', 'Delivery', 'Seller ships with tracking'],
          <String>['receive', 'Received', 'Buyer confirms the item arrived'],
          <String>['inspect', 'Buyer accepts delivery', 'Buyer accepts delivery'],
        ];

  return _planFrom(shape, reached: reached, halted: halted, complete: complete);
}

/// A step plan as `app/api/mobile/trades/step-plan` serves it. Same reasoning as
/// [saleStepPlanFixture].
List<ContractStep> tradeStepPlanFixture({
  int? reached,
  bool halted = false,
  bool complete = false,
  bool inPerson = false,
}) {
  final List<List<String>> shape = inPerson
      ? <List<String>>[
          <String>['collateral', 'Holds', 'Both traders post collateral'],
          <String>['handover', 'Delivery', 'Meet and swap'],
          <String>['accept', 'Accept Terms', 'Both traders accept what they got'],
          <String>['release', 'Both holds released', 'Both holds released'],
        ]
      : <List<String>>[
          <String>['collateral', 'Holds', 'Both traders post collateral'],
          <String>['ship', 'Delivery', 'Both traders post with tracking'],
          <String>['receive', 'Received', 'Both parcels arrive'],
          <String>['accept', 'Accept Terms', 'Both traders accept what they got'],
          <String>['release', 'Both holds released', 'Both holds released'],
        ];

  return _planFrom(shape, reached: reached, halted: halted, complete: complete);
}

/// Assemble a fixture plan: `[id, railLabel, label]` triples plus which column the
/// server marked. The server sends the marks; this only stamps them onto a shape.
List<ContractStep> _planFrom(
  List<List<String>> shape, {
  required int? reached,
  required bool halted,
  required bool complete,
}) {
  return List<ContractStep>.generate(shape.length, (int index) {
    final ContractStepStatus status;
    if (complete) {
      status = ContractStepStatus.done;
    } else if (reached == null) {
      status = ContractStepStatus.pending;
    } else if (index < reached) {
      status = ContractStepStatus.done;
    } else if (index == reached) {
      status = halted ? ContractStepStatus.halted : ContractStepStatus.active;
    } else {
      status = ContractStepStatus.pending;
    }
    return ContractStep(
      id: shape[index][0],
      railLabel: shape[index][1],
      label: shape[index][2],
      status: status,
      detail: 'What happens at this step, in one line.',
    );
  });
}

/// Everything `SaleRoomScreen` watches, for one viewer looking at one sale.
///
/// `stepPlan` defaults to null, which is the NEUTRAL plan — a room whose plan has
/// not arrived. Every case that is not staging the neutral presentation must pass
/// one, because the rail draws only what the server sent.
List<Override> saleRoomOverrides({
  required CashSale sale,
  String? viewerId = kFixtureBuyerId,
  List<CashSaleItem> lineItems = const <CashSaleItem>[],
  List<ContractStep>? stepPlan,
}) {
  return <Override>[
    saleStreamProvider(sale.id).overrideWith((ref) => Stream<CashSale>.value(sale)),
    saleLineItemsProvider(sale.id).overrideWith((ref) => Future.value(lineItems)),
    saleStepPlanProvider(sale.id).overrideWith(
      (ref) => Future.value(stepPlan ?? const <ContractStep>[]),
    ),
    currentUserProvider
        .overrideWithValue(viewerId == null ? null : makeUser(viewerId)),
  ];
}

/// Everything `TradeRoomScreen` watches, for one trader looking at one trade.
///
/// Both items are overridden because the money region reads each side's listing
/// to value it through the same port the server charges from. A trade whose items
/// have not arrived renders no money region at all, which is a loading state and
/// not one of the presentations under test.
List<Override> tradeRoomOverrides({
  required Trade trade,
  String? viewerId = kFixtureBuyerId,
  List<PreAuthHold> holds = const <PreAuthHold>[],
  Item? initiatorItem,
  Item? counterpartItem,
  List<ContractStep>? stepPlan,
}) {
  return <Override>[
    tradeStreamProvider(trade.id).overrideWith((ref) => Stream<Trade>.value(trade)),
    tradeHoldsProvider(trade.id).overrideWith((ref) => Future.value(holds)),
    tradeStepPlanProvider(trade.id).overrideWith(
      (ref) => Future.value(stepPlan ?? const <ContractStep>[]),
    ),
    itemDetailProvider(trade.initiatorItemId).overrideWith(
      (ref) => Future.value(initiatorItem ?? makeItem(id: trade.initiatorItemId)),
    ),
    itemDetailProvider(trade.counterpartItemId).overrideWith(
      (ref) => Future.value(
        counterpartItem ??
            makeItem(
              id: trade.counterpartItemId,
              title: 'Blastoise Holo',
            ),
      ),
    ),
    currentUserProvider
        .overrideWithValue(viewerId == null ? null : makeUser(viewerId)),
  ];
}

/// Pumps a contract room over its overrides and lays out what resolved.
///
/// Deliberately not `pumpAndSettle`. The inspection room runs a one-second
/// countdown, so a settle would never return; and a room whose photo request has
/// not resolved keeps a frame scheduled. Three pumps run the overridden futures
/// and lay out the result, which is what every other fixture test here does.
Future<void> pumpContractRoom(
  WidgetTester tester,
  Widget room, {
  required List<Override> overrides,
  double textScaleFactor = 1.0,
  Size surface = kPhoneViewport,
}) async {
  await setViewport(tester, surface);
  await tester.pumpWidget(
    withOverrides(
      pumpFixture(
        room,
        textScaleFactor: textScaleFactor,
        reduceMotion: true,
        // Both rooms bring their own `Scaffold`.
        scaffold: false,
      ),
      overrides,
    ),
  );
  await tester.pump();
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 250));
}

/// Tears the room down so a room that runs a countdown leaves no pending timer.
///
/// The inspection room starts a periodic timer and cancels it in `dispose`, which
/// only runs when the widget leaves the tree. Without this the binding fails the
/// test for a timer that the room would have cancelled on a device.
Future<void> disposeContractRoom(WidgetTester tester) async {
  await tester.pumpWidget(const SizedBox.shrink());
  await tester.pump();
}
