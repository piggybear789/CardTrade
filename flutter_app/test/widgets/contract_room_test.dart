// Feature: mobile-visual-parity — the contract rooms' required presentations,
// plus Property 22.
//
// Property 22: a room with no step plan produces the NEUTRAL room — no step marked
// done, active or halted, and no action — with every other region still readable
// (Req 7.11).
//
// WHAT CHANGED, AND WHY THE PROPERTY IS STATED DIFFERENTLY NOW. This file used to
// enumerate both closed enums and assert that whatever the rooms' own interim step
// lists could not place was presented neutrally. Those lists are gone:
// `.kiro/specs/mobile-parity/` Requirement 11 moved the derivation to
// `domain/contract/cashSaleSteps.ts` / `tradeSteps.ts` and the rooms now render the
// plan the server sends. So "a status the phone cannot place" no longer exists as a
// category — a phone places nothing — and the neutral case is exactly the one
// Req 11.5 names: no session, a transport failure, or a status the server declines
// to place, all of which arrive as NO PLAN.
//
// The property is therefore asserted where it is now decidable, and in both halves:
//   * on the parse (`contractStepsFromServed`), exhaustively over the ways a plan
//     can fail to arrive — that is the code that decides neutral-or-not, and it is
//     pure, so the enumeration is complete rather than sampled;
//   * on both rooms, pumped with no plan, which is the presentation Req 7.11 owns.
// Nothing here asserts which column a status belongs to, because nothing in this
// app decides that any more. The agreement between the served plan and the web's is
// pinned on the server side, where the one derivation lives.
//
// Every provider is overridden with fixture data (`support/contract_fixtures.dart`)
// so nothing here reads Supabase.
//
// Validates: Requirements 7.2–7.9, 7.11, 7.12, 13.10; P22; mobile-parity 11.5, 11.6.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/features/sales/screens/sale_room_screen.dart';
import 'package:cardtrade/features/sales/widgets/sale_progress_rail.dart';
import 'package:cardtrade/features/trades/screens/trade_room_screen.dart';
import 'package:cardtrade/features/trades/widgets/trade_progress_rail.dart';
import 'package:cardtrade/models/cash_sale.dart';
import 'package:cardtrade/models/cash_sale_item.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/models/pre_auth_hold.dart';
import 'package:cardtrade/models/trade.dart';
import 'package:cardtrade/widgets/contract/contract.dart';

import '../support/contract_fixtures.dart';
import '../support/harness.dart';
import '../support/listing_fixtures.dart';

/// The height of the action card, which is zero exactly when it renders nothing.
double _actionCardHeight(WidgetTester tester) =>
    tester.getSize(find.byType(ContractActionCard)).height;

/// Whether the plan marks any column as reached, stopped, or live.
bool _isNeutral(List<ContractStep> steps) => steps.every(
      (ContractStep step) => step.status == ContractStepStatus.pending,
    );

/// The regions that must stay readable whatever the status is (Req 7.11).
///
/// The headings are matched UPPERCASE because that is what a region heading is
/// drawn as — the shared section shell renders `title.toUpperCase()`, so the
/// member-facing string is the one asserted here rather than the argument.
void _expectRoomStillReadable(String context) {
  expect(find.text('MONEY'), findsOneWidget, reason: context);
  expect(find.text('HISTORY'), findsOneWidget, reason: context);
  expect(find.byType(ContractMoneyTable), findsWidgets, reason: context);
  expect(find.byType(ContractTimeline), findsOneWidget, reason: context);
}

/// Fails unless the inspection region is present, whichever side of the deadline
/// the clock is on.
///
/// The countdown measures against `DateTime.now()`, which a widget test cannot
/// pin, so asserting one of the two headings would pass or fail on the date. The
/// region's PRESENCE is the presentation under test; the figure it draws is not.
void _expectInspectionCountdown() {
  final int headings = find.text('Inspection window').evaluate().length +
      find.text('Inspection expired').evaluate().length;
  expect(headings, 1, reason: 'the inspection region was not presented once');
}

/// Fails if a stopped column wears a tick, or if a stopped plan has a live step
/// (Req 7.3, 7.6).
///
/// The columns BEFORE the halted one stay done on purpose: a trade that stopped
/// at inspection genuinely got that far, and blanking its history would be a
/// different lie from the one Req 7.3 forbids. What must never happen is the
/// stopped column itself, or anything after it, reading as complete.
void _expectHaltedPlan(List<ContractStep> steps, String context) {
  final int stopped = steps.indexWhere(
    (ContractStep step) => step.status == ContractStepStatus.halted,
  );
  expect(stopped, greaterThanOrEqualTo(0), reason: '$context: nothing is halted');
  for (int index = stopped; index < steps.length; index++) {
    expect(
      steps[index].status,
      index == stopped ? ContractStepStatus.halted : ContractStepStatus.pending,
      reason: '$context: column $index reads as reached past the stop',
    );
  }
  expect(activeContractStep(steps), isNull, reason: context);
}

Future<void> _pumpSale(
  WidgetTester tester, {
  required CashSale sale,
  String? viewerId = kFixtureBuyerId,
  List<CashSaleItem> lineItems = const <CashSaleItem>[],
  List<ContractStep>? stepPlan,
  double textScaleFactor = 1.0,
}) async {
  await pumpContractRoom(
    tester,
    SaleRoomScreen(saleId: sale.id),
    overrides: saleRoomOverrides(
      sale: sale,
      viewerId: viewerId,
      lineItems: lineItems,
      stepPlan: stepPlan,
    ),
    textScaleFactor: textScaleFactor,
  );
}

Future<void> _pumpTrade(
  WidgetTester tester, {
  required Trade trade,
  String? viewerId = kFixtureBuyerId,
  List<PreAuthHold> holds = const <PreAuthHold>[],
  List<ContractStep>? stepPlan,
  double textScaleFactor = 1.0,
}) async {
  await pumpContractRoom(
    tester,
    TradeRoomScreen(tradeId: trade.id),
    overrides: tradeRoomOverrides(
      trade: trade,
      viewerId: viewerId,
      holds: holds,
      stepPlan: stepPlan,
    ),
    textScaleFactor: textScaleFactor,
  );
}

void main() {
  group('Req 7.2–7.6: the cash sale room before payment', () {
    testWidgets('presents the live step, one primary action, and the money',
        (tester) async {
      await _pumpSale(
        tester,
        sale: makeSale(status: CashSaleStatus.agreement),
        stepPlan: saleStepPlanFixture(reached: 0),
      );

      // The header states the status the server reported and the viewer's side.
      expect(find.text('Agreement'), findsWidgets);
      expect(find.text('You are buying'), findsOneWidget);

      // Req 7.6: one primary for the live step, everything else outlined.
      expect(_actionCardHeight(tester), greaterThan(0));
      expect(find.text('Accept terms'), findsOneWidget);
      expect(find.text('Cancel sale'), findsOneWidget);

      // Req 7.4: the money the contract records, the viewer's own total last.
      expect(find.text('Item price'), findsOneWidget);
      expect(find.text('You pay'), findsOneWidget);
      expect(find.text('Platform fee (5%)'), findsOneWidget);

      expectNoLayoutOverflow(tester);
      await disposeContractRoom(tester);
    });

    testWidgets('draws the rail labels the server chose, not labels of its own',
        (tester) async {
      // The point of Req 11.6: what a column reads is the server's `railLabel`.
      // The old room drew 'Agreement', 'Payment', 'Escrow', 'Delivery',
      // 'Inspection', 'Complete' from a list in its own bundle whatever the
      // server said.
      await _pumpSale(
        tester,
        sale: makeSale(status: CashSaleStatus.agreement),
        stepPlan: saleStepPlanFixture(reached: 0),
      );

      expect(find.text('Discuss Terms'), findsOneWidget);
      expect(find.text('Received'), findsOneWidget);
      // A label the retired local list carried and the served plan does not.
      expect(find.text('Escrow'), findsNothing);
      await disposeContractRoom(tester);
    });

    testWidgets('offers no accept control once both parties have accepted',
        (tester) async {
      await _pumpSale(
        tester,
        sale: makeSale(status: CashSaleStatus.agreement, termsAgreed: true),
        stepPlan: saleStepPlanFixture(reached: 1),
      );

      expect(find.text('Accept terms'), findsNothing);
      expect(find.text('Cancel sale'), findsOneWidget);
      await disposeContractRoom(tester);
    });

    testWidgets('says a binder holds nothing, and lists what the contract covers',
        (tester) async {
      await _pumpSale(
        tester,
        sale: makeSale(status: CashSaleStatus.agreement, fromShopfront: true),
        stepPlan: saleStepPlanFixture(reached: 0),
        lineItems: <CashSaleItem>[makeSaleLineItem()],
      );

      // Member-facing copy: binder or bulk listing, and nothing is held on it.
      expect(
        find.text('From a binder or bulk listing — nothing is held on it'),
        findsOneWidget,
      );
      expect(find.text('WHAT THIS COVERS'), findsOneWidget);
      expect(find.text('Pikachu VMAX, sleeved'), findsOneWidget);
      await disposeContractRoom(tester);
    });
  });

  group('Req 7.2–7.6: the cash sale room during inspection', () {
    testWidgets('presents the inspection window and the buyer\'s two controls',
        (tester) async {
      final List<ContractStep> plan = saleStepPlanFixture(reached: 4);
      await _pumpSale(
        tester,
        sale: makeSale(
          status: CashSaleStatus.inspection,
          termsAgreed: true,
          shippedAt: kFixtureInstant,
          carrierDeliveredAt: kFixtureInstant,
          inspectionDeadlineAt: fixtureDeadline(),
        ),
        stepPlan: plan,
      );

      expect(activeContractStep(plan)?.label, 'Buyer accepts delivery');

      expect(_actionCardHeight(tester), greaterThan(0));
      expect(find.text('Accept the item'), findsOneWidget);
      expect(find.text('Raise a dispute'), findsOneWidget);

      // The countdown is a live region, and its figure is never asserted: it is
      // measured against the wall clock a test cannot pin.
      _expectInspectionCountdown();

      expectNoLayoutOverflow(tester);
      await disposeContractRoom(tester);
    });

    testWidgets('offers the seller no inspection control', (tester) async {
      await _pumpSale(
        tester,
        viewerId: kFixtureOwnerId,
        sale: makeSale(
          status: CashSaleStatus.inspection,
          termsAgreed: true,
          inspectionDeadlineAt: fixtureDeadline(),
        ),
        stepPlan: saleStepPlanFixture(reached: 4),
      );

      expect(find.text('You are selling'), findsOneWidget);
      expect(find.text('Accept the item'), findsNothing);
      // Req 7.6 permits no primary at all where the live step is not the
      // viewer's move, so the card is the sentence that says whose move it is.
      expect(find.text('You receive'), findsOneWidget);
      await disposeContractRoom(tester);
    });
  });

  group('Req 7.3, 7.6: a settled cash sale', () {
    testWidgets('completed marks every step done and offers no action',
        (tester) async {
      final List<ContractStep> plan = saleStepPlanFixture(complete: true);
      await _pumpSale(
        tester,
        sale: makeSale(
          status: CashSaleStatus.completed,
          termsAgreed: true,
          completedAt: kFixtureInstant,
        ),
        stepPlan: plan,
      );

      expect(
        plan.map((ContractStep step) => step.status).toSet(),
        <ContractStepStatus>{ContractStepStatus.done},
      );
      expect(activeContractStep(plan), isNull);
      expect(_actionCardHeight(tester), 0);
      _expectRoomStillReadable('completed sale');
      await disposeContractRoom(tester);
    });

    testWidgets('cancelled is drawn with a cross and never with a tick',
        (tester) async {
      // Cancellation is only reachable before payment, so the server marks the
      // first column as where the sale stopped.
      final List<ContractStep> plan =
          saleStepPlanFixture(reached: 0, halted: true);
      await _pumpSale(
        tester,
        sale: makeSale(
          status: CashSaleStatus.cancelled,
          cancelledAt: kFixtureInstant,
        ),
        stepPlan: plan,
      );

      expect(plan.first.status, ContractStepStatus.halted);
      expect(
        plan.map((ContractStep step) => step.status),
        isNot(contains(ContractStepStatus.done)),
      );
      _expectHaltedPlan(plan, 'cancelled sale');

      // Req 7.3 in the drawn rail: the cross is present and no tick is.
      expect(find.byIcon(Icons.close_rounded), findsWidgets);
      expect(find.byIcon(Icons.check_rounded), findsNothing);
      expect(_actionCardHeight(tester), 0);
      _expectRoomStillReadable('cancelled sale');
      await disposeContractRoom(tester);
    });
  });

  group('Req 7.2–7.7: the trade room', () {
    testWidgets('before collateral presents the terms, the fee and the controls',
        (tester) async {
      await _pumpTrade(
        tester,
        trade: makeTrade(state: TradeState.negotiating),
        stepPlan: tradeStepPlanFixture(reached: 0),
      );

      expect(find.text('Negotiating'), findsWidgets);
      expect(find.text('You opened this trade'), findsOneWidget);
      expect(_actionCardHeight(tester), greaterThan(0));
      expect(find.text('Accept terms'), findsOneWidget);
      expect(find.text('Cancel trade'), findsOneWidget);

      // Req 7.5: the disclosed side values and fee, from the advisory ports.
      expect(find.text('Your side is worth'), findsOneWidget);
      expect(find.text('Their side is worth'), findsOneWidget);

      // Req 7.7: trade collateral, explained as the temporary card hold it is,
      // and present before a hold exists.
      expect(find.text('TRADE COLLATERAL'), findsOneWidget);
      expect(
        find.textContaining('temporary hold on your card'),
        findsOneWidget,
      );
      expectNoLayoutOverflow(tester);
      await disposeContractRoom(tester);
    });

    testWidgets('never calls trade collateral escrow', (tester) async {
      await _pumpTrade(
        tester,
        trade: makeTrade(state: TradeState.collateralLocked, termsAgreed: true),
        stepPlan: tradeStepPlanFixture(reached: 1),
        holds: <PreAuthHold>[makeHold()],
      );

      // The platform holds a claim on a card, not funds, so the word that would
      // imply otherwise appears nowhere in the room.
      expect(find.textContaining('escrow', findRichText: true), findsNothing);
      expect(find.textContaining('Escrow', findRichText: true), findsNothing);
      await disposeContractRoom(tester);
    });

    testWidgets('during inspection presents the trader\'s two controls',
        (tester) async {
      final List<ContractStep> plan = tradeStepPlanFixture(reached: 3);
      await _pumpTrade(
        tester,
        trade: makeTrade(
          state: TradeState.inspection,
          termsAgreed: true,
          inspectionDeadlineAt: fixtureDeadline(hours: 72),
        ),
        stepPlan: plan,
        holds: <PreAuthHold>[makeHold()],
      );

      expect(
        activeContractStep(plan)?.label,
        'Both traders accept what they got',
      );
      expect(find.text('Accept what you received'), findsOneWidget);
      expect(find.text('Raise a dispute'), findsOneWidget);
      expectNoLayoutOverflow(tester);
      await disposeContractRoom(tester);
    });

    testWidgets('completed marks every step done and offers no action',
        (tester) async {
      final List<ContractStep> plan = tradeStepPlanFixture(complete: true);
      await _pumpTrade(
        tester,
        trade: makeTrade(state: TradeState.completed, termsAgreed: true),
        stepPlan: plan,
        holds: <PreAuthHold>[makeHold(status: HoldStatus.voided)],
      );

      expect(
        plan.map((ContractStep step) => step.status).toSet(),
        <ContractStepStatus>{ContractStepStatus.done},
      );
      expect(_actionCardHeight(tester), 0);
      _expectRoomStillReadable('completed trade');
      await disposeContractRoom(tester);
    });

    testWidgets('cancelled is drawn with a cross and never with a tick',
        (tester) async {
      // A trade is cancelled out of negotiation, so the server marks column 0.
      final List<ContractStep> plan =
          tradeStepPlanFixture(reached: 0, halted: true);
      await _pumpTrade(
        tester,
        trade: makeTrade(
          state: TradeState.cancelled,
          cancelledAt: kFixtureInstant,
        ),
        stepPlan: plan,
      );

      expect(plan.first.status, ContractStepStatus.halted);
      expect(
        plan.map((ContractStep step) => step.status),
        isNot(contains(ContractStepStatus.done)),
      );
      _expectHaltedPlan(plan, 'cancelled trade');
      expect(find.byIcon(Icons.close_rounded), findsWidgets);
      expect(find.byIcon(Icons.check_rounded), findsNothing);
      expect(_actionCardHeight(tester), 0);
      _expectRoomStillReadable('cancelled trade');
      await disposeContractRoom(tester);
    });

    testWidgets('a halted column at the end is never drawn as a completion',
        (tester) async {
      // The case this guards is a fraud finding, which the server places at the
      // last column: a tick there would tell a defrauded trader their trade
      // succeeded. The rail must draw a cross wherever the halt falls.
      final List<ContractStep> plan =
          tradeStepPlanFixture(reached: 3, halted: true);
      await _pumpTrade(
        tester,
        trade: makeTrade(state: TradeState.fraudResolved, termsAgreed: true),
        stepPlan: plan,
      );

      expect(plan[3].status, ContractStepStatus.halted);
      _expectHaltedPlan(plan, 'fraud finding');
      expect(find.byIcon(Icons.close_rounded), findsWidgets);
      expect(_actionCardHeight(tester), 0);
      await disposeContractRoom(tester);
    });
  });

  group('P22: no served plan produces the neutral room', () {
    /// Validates: Requirements 7.11; P22; mobile-parity 11.5
    test('every way a plan can fail to arrive yields no step at all', () {
      // Exhaustive over the shapes `contractStepsFromServed` can be handed. This
      // is the code that decides neutral-or-not, it is pure, and each entry is one
      // of the failures Req 11.5 names — a refusal body, a truncated payload, or a
      // wire spelling this build does not know.
      final Map<String, dynamic> cases = <String, dynamic>{
        'no data at all (no session, or a transport failure)': null,
        'a refusal body with no data': <String, dynamic>{},
        'a plan with no steps key': <String, dynamic>{'contractId': 'sale-1'},
        'an empty steps list': <String, dynamic>{'steps': <dynamic>[]},
        'steps that are not a list': <String, dynamic>{'steps': 'terms'},
        'a step that is not an object': <String, dynamic>{
          'steps': <dynamic>['terms'],
        },
        'a step with no id': <String, dynamic>{
          'steps': <dynamic>[
            <String, dynamic>{'label': 'Set handover terms', 'status': 'active'},
          ],
        },
        'a step with a blank label': <String, dynamic>{
          'steps': <dynamic>[
            <String, dynamic>{'id': 'terms', 'label': '  ', 'status': 'active'},
          ],
        },
        'a status spelling this build does not know': <String, dynamic>{
          'steps': <dynamic>[
            <String, dynamic>{
              'id': 'terms',
              'label': 'Set handover terms',
              'status': 'blocked',
            },
          ],
        },
      };

      cases.forEach((String why, dynamic payload) {
        final List<ContractStep> steps = contractStepsFromServed(payload);
        expect(steps, isEmpty, reason: why);
        expect(_isNeutral(steps), isTrue, reason: why);
        expect(activeContractStep(steps), isNull, reason: why);
      });
    });

    /// Validates: Requirements 7.11; P22; mobile-parity 11.5
    test('one bad step discards the whole plan rather than half of it', () {
      // Half a plan renders as a contract that has not got as far as it has, so a
      // step it cannot read makes the whole thing unavailable.
      final List<ContractStep> steps = contractStepsFromServed(<String, dynamic>{
        'steps': <dynamic>[
          <String, dynamic>{
            'id': 'terms',
            'label': 'Set handover terms',
            'railLabel': 'Discuss Terms',
            'status': 'done',
          },
          <String, dynamic>{'id': 'payment', 'label': 'Payment', 'status': 'nope'},
        ],
      });
      expect(steps, isEmpty);
    });

    /// Validates: Requirements 7.11; P22
    test('a served plan is read exactly as sent, and never reordered', () {
      final List<ContractStep> steps = contractStepsFromServed(<String, dynamic>{
        'steps': <dynamic>[
          <String, dynamic>{
            'id': 'terms',
            'label': 'Set handover terms',
            'railLabel': 'Discuss Terms',
            'detail': 'Choose shipping or a meet-up.',
            'status': 'done',
          },
          <String, dynamic>{
            'id': 'payment',
            'label': 'Payment collected and held',
            'railLabel': '',
            'status': 'active',
          },
        ],
      });

      expect(steps.map((ContractStep s) => s.id), <String>['terms', 'payment']);
      expect(steps.first.railLabel, 'Discuss Terms');
      expect(steps.first.detail, 'Choose shipping or a meet-up.');
      // An empty rail label falls back to the full one: a phone marker with no
      // accessible name is not reachable, which the web rail can afford and this
      // cannot.
      expect(steps.last.railLabel, 'Payment collected and held');
      expect(activeContractStep(steps)?.id, 'payment');
    });

    /// Validates: Requirements 7.11, 13.10; P22; mobile-parity 11.5
    testWidgets('the sale room with no plan marks nothing and stays readable',
        (tester) async {
      // Exhaustive over the closed enum: whatever the status, a room whose plan
      // did not arrive marks no column and offers no action. There is no status
      // for which this app draws a rail of its own.
      for (final CashSaleStatus status in CashSaleStatus.values) {
        await _pumpSale(
          tester,
          sale: makeSale(status: status, termsAgreed: true),
        );

        // The status the server reported is presented, not a step guessed for it.
        expect(find.byType(SaleProgressRail), findsOneWidget, reason: '$status');
        expect(find.byIcon(Icons.check_rounded), findsNothing, reason: '$status');
        expect(find.byIcon(Icons.close_rounded), findsNothing, reason: '$status');
        expect(_actionCardHeight(tester), 0, reason: '$status');
        _expectRoomStillReadable('$status');
        expectNoLayoutOverflow(tester);
        await disposeContractRoom(tester);
      }
    });

    /// Validates: Requirements 7.11; P22; mobile-parity 11.5
    testWidgets('the trade room with no plan marks nothing and offers no action',
        (tester) async {
      for (final TradeState state in TradeState.values) {
        await _pumpTrade(
          tester,
          trade: makeTrade(state: state, termsAgreed: true),
          holds: <PreAuthHold>[makeHold()],
        );

        expect(find.byType(TradeProgressRail), findsOneWidget, reason: '$state');
        expect(find.byIcon(Icons.check_rounded), findsNothing, reason: '$state');
        expect(find.byIcon(Icons.close_rounded), findsNothing, reason: '$state');
        expect(_actionCardHeight(tester), 0, reason: '$state');
        _expectRoomStillReadable('$state');
        await disposeContractRoom(tester);
      }
    });
  });
}
