// The list-state golden COMPARISON: the catalog in five states, the contracts list
// and the inbox in four each — every one at 1.0 and 2.0.
//
// The references live in `goldens/` beside this file, in version control
// (Req 15.10), and are captured through `test/golden/_harness/golden_harness.dart`
// so the fonts, the device pixel ratio, the surface, the text-scale cap, the clock
// and the animations are all held at a declared value (Req 15.11). The case list is
// `state_golden_cases.dart`; its naming, pairing, per-state content and the
// filtered-to-empty split are asserted by `state_cases_test.dart`, which runs on
// every host.
//
// THE SKELETON PHASE IS DECLARED, WHICH IS WHAT REQ 11.7 ASKS FOR. Two controls give
// the "fixed point in the pulse cycle": reduce-motion holds the pulse at full opacity
// (Req 11.2), and the surface is pumped to `kGoldenPhase` — just past
// `SkeletonGate.suppressBelow` — so the placeholder is on screen at a stated instant.
// A capture inside the suppression window would be a picture of an empty box, which is
// correct behaviour and a useless reference image.
//
// THE TWO FAILURES ARE SEPARATE REFERENCES BECAUSE THEY ARE SEPARATE MESSAGES. An
// offline read says the device is not connected; a fault says nothing has changed. One
// image for both would let the pair collapse into the generic apology Req 11.10 exists
// to prevent, and a collapse is exactly the change a reviewer would otherwise wave
// through.
//
// FIXTURES ONLY (Req 15.11): each screen is pumped over the provider overrides in
// `test/support/state_fixtures.dart`, so nothing here reads Supabase and nothing can
// move because the database did.
//
// EVERY CASE IS PAIRED AT 2.0 (Req 13.13). An empty state is a heading, an
// explanation and sometimes one control, and a failure state is an explanation plus a
// retry — all of it copy that reflows.
//
// RE-BASELINING, SCOPED (Req 15.12):
//
//   flutter test --update-goldens test/golden/states
//
// Only ever that directory, only on the designated host, and only after the change
// that moved the pixels has been IDENTIFIED as intended. A mismatch nobody can
// explain is investigated, not regenerated. Commit the regenerated images with the
// change that moved them and name each one in the commit body. The full procedure is
// at the head of `golden_harness.dart`.
//
// Requirements 11.1–11.4, 11.7, 11.9, 11.10, 13.13, 15.10–15.12.

import 'package:flutter_test/flutter_test.dart';

import '../_harness/golden_harness.dart';
import 'state_golden_cases.dart';

void main() {
  setUpAll(setUpGoldenSuite);

  // Req 15.10: the comparison means nothing off the designated host, because font
  // rasterisation differs between platforms. The skip carries the REASON, which is
  // why it sits on the group — `testWidgets` takes only a `bool?` there and would
  // reduce the explanation to a silent true.
  group('Req 11.7: the list states, captured', skip: GoldenHost.skipReason, () {
    for (final StateGoldenCase entry in kStateGoldenCases) {
      for (final double scale in entry.textScales) {
        testWidgets('${entry.name} at ${scale}x', (tester) async {
          await pumpGolden(
            tester,
            entry.build(),
            surface: entry.surface,
            textScale: scale,
            overrides: entry.overrides,
            // Each of the three screens brings its own `Scaffold`.
            ownsScaffold: true,
          );
          await expectGolden(entry.name, scale);
          // A loading case leaves `SkeletonGate`'s minimum-duration timer armed;
          // every case is unmounted rather than only those three.
          await disposeGolden(tester);
        });
      }
    }
  });
}
