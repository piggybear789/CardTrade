// The contract-room golden COMPARISON: six sale-room presentations and five trade-
// room presentations, each at 1.0 and 2.0.
//
// The references live in `goldens/` beside this file, in version control
// (Req 15.10), and are captured through `test/golden/_harness/golden_harness.dart`
// so the fonts, the device pixel ratio, the surface, the text-scale cap, the clock
// and the animations are all held at a declared value (Req 15.11). The case list is
// `contract_golden_cases.dart`; its naming, pairing and layout are asserted by
// `contract_cases_test.dart`, which runs on every host.
//
// FIXTURES ONLY (Req 15.11). Every case pumps the real room over the provider
// overrides in `test/support/contract_fixtures.dart`, so no reference here can move
// because the database did.
//
// THE INSPECTION ROOM RUNS A CLOCK, AND THAT IS WHY EVERY CASE IS UNMOUNTED. A
// countdown arms a periodic timer that the room cancels on dispose; leaving it
// running fails the test for something the widget would have cleaned up on a device.
// The captured countdown itself is deterministic because the harness pins the
// instant it is read against (Req 15.11) — a room drawing "6d 23h" from the wall
// clock would be a time bomb in the reference image.
//
// EVERY CASE IS PAIRED AT 2.0 (Req 13.13). A room is almost entirely labels: the
// progress rail's step names, the money table, the action card's copy and the
// timeline. The pair is what shows the rail and the action control surviving a
// member who reads at twice the size.
//
// RE-BASELINING, SCOPED (Req 15.12):
//
//   flutter test --update-goldens test/golden/contract
//
// Only ever that directory, only on the designated host, and only after the change
// that moved the pixels has been IDENTIFIED as intended. A mismatch nobody can
// explain is investigated, not regenerated. Commit the regenerated images with the
// change that moved them and name each one in the commit body. The full procedure is
// at the head of `golden_harness.dart`.
//
// Requirements 7.2–7.9, 7.11, 13.13, 15.10–15.12.

import 'package:flutter_test/flutter_test.dart';

import '../_harness/golden_harness.dart';
import 'contract_golden_cases.dart';

void main() {
  setUpAll(setUpGoldenSuite);

  // Req 15.10: the comparison means nothing off the designated host, because font
  // rasterisation differs between platforms. The skip carries the REASON, which is
  // why it sits on the group — `testWidgets` takes only a `bool?` there and would
  // reduce the explanation to a silent true.
  group('Req 7.9: the contract-room states, captured',
      skip: GoldenHost.skipReason, () {
    for (final ContractGoldenCase entry in kContractGoldenCases) {
      for (final double scale in entry.textScales) {
        testWidgets('${entry.name} at ${scale}x', (tester) async {
          await pumpGolden(
            tester,
            entry.build(),
            surface: entry.surface,
            textScale: scale,
            overrides: entry.overrides,
            // Every room brings its own `Scaffold`.
            ownsScaffold: true,
          );
          await expectGolden(entry.name, scale);
          await disposeGolden(tester);
        });
      }
    }
  });
}
