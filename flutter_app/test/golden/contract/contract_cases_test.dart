// The host-independent cover for the contract-room golden cases.
//
// This file makes NO pixel comparison: `contract_golden_test.dart` does that and owns
// the references in `goldens/`. The split is the one recorded at the head of
// `contract_golden_cases.dart` — the comparison is scoped to the designated host
// because font rasterisation differs between platforms, and everything here measures
// geometry and reads names, so it runs everywhere.
//
// What it asserts instead is that the case LIST is the set task 7.2 asks for —
// pre-payment, inspection, completed, cancelled and unrecognised, on both rooms —
// that every case pairs a 1.0 capture with a 2.0 twin at one surface size
// (Req 13.13), that no case names retired vocabulary, and that every case builds
// and lays out at both scales. A golden of a tree that overflows is a picture of a
// bug.
//
// Requirements 7.2–7.9, 7.11, 13.10, 13.13, 15.10, 15.11.

import 'package:flutter_test/flutter_test.dart';

import '../../support/contract_fixtures.dart';
import '../../support/harness.dart';
import 'contract_golden_cases.dart';

void main() {
  group('the contract golden case list', () {
    test('covers the required sale and trade presentations', () {
      expect(
        kContractGoldenCases.map((ContractGoldenCase entry) => entry.name).toList(),
        <String>[
          'sale_room_before_payment',
          'sale_room_before_payment_binder',
          'sale_room_inspection',
          'sale_room_completed',
          'sale_room_cancelled',
          'sale_room_status_not_recognised',
          'trade_room_before_collateral',
          'trade_room_collateral_held',
          'trade_room_inspection',
          'trade_room_completed',
          'trade_room_cancelled',
        ],
      );
    });

    test('names collide with nothing', () {
      final List<String> names =
          kContractGoldenCases.map((ContractGoldenCase e) => e.name).toList();
      expect(names.toSet(), hasLength(names.length));
    });

    test('pairs every case with a 2.0 text-scale twin at one surface size', () {
      for (final ContractGoldenCase entry in kContractGoldenCases) {
        // Req 13.13: the factor is the only difference between a pair, so the
        // surface is declared once per case and never per scale.
        expect(entry.textScales, <double>[1.0, 2.0], reason: entry.name);
        expect(entry.surface, kContractGoldenSurface, reason: entry.name);
      }
    });

    test('names no retired vocabulary', () {
      // Req 14.4 covers identifiers, strings and routes; a golden file name is
      // all three at once, and Flutter is the client that has reintroduced a
      // retired concept by naming it before. `escrow` is included because a card
      // hold is trade collateral and the platform holds no funds behind it, and
      // `shopfront` because it is the internal listing kind and never a word a
      // member has seen.
      for (final ContractGoldenCase entry in kContractGoldenCases) {
        for (final String retired in <String>[
          'deal',
          'ditto',
          'kyc',
          'shopfront',
          'escrow',
          'bond',
        ]) {
          expect(
            entry.name.toLowerCase(),
            isNot(contains(retired)),
            reason: '${entry.name} names retired vocabulary "$retired"',
          );
        }
      }
    });
  });

  group('every staged case lays out at every scale it will be captured at', () {
    for (final ContractGoldenCase entry in kContractGoldenCases) {
      for (final double scale in entry.textScales) {
        testWidgets('${entry.name} at ${scale}x', (tester) async {
          await pumpContractRoom(
            tester,
            entry.build(),
            overrides: entry.overrides,
            textScaleFactor: scale,
            surface: entry.surface,
          );

          expectNoLayoutOverflow(tester);

          // The inspection room runs a periodic countdown it cancels on dispose.
          // Every case is torn down, not only that one: a capture that leaves a
          // room mounted is a capture that leaks into the next case.
          await disposeContractRoom(tester);
        });
      }
    }
  });
}
