// The profile golden COMPARISON: the four gate combinations, plus the Account hub
// with its counts still outstanding — each at 1.0 and 2.0.
//
// The references live in `goldens/` beside this file, in version control
// (Req 15.10), and are captured through `test/golden/_harness/golden_harness.dart`
// so the fonts, the device pixel ratio, the surface, the text-scale cap, the clock
// and the animations are all held at a declared value (Req 15.11). The case list is
// `profile_golden_cases.dart`; its naming, pairing, gate-state agreement and layout
// are asserted by `profile_cases_test.dart`, which runs on every host.
//
// WHY FOUR COMBINATIONS AND NOT THREE STAGES. Identity and payout setup are
// INDEPENDENT in both directions, so a verified member with no payout account and a
// payable member who has not verified are both valid states. The second is the one
// most easily drawn as a fault, and capturing the four separately is what makes a
// regression there visible rather than inferred.
//
// THE LOADING CASE IS CAPTURED AT A DECLARED PHASE. Its three count reads never
// settle, so the hub is pumped just past `SkeletonGate.suppressBelow` and held there
// by reduce-motion, which pins the pulse at full opacity (Req 11.2). Inside the
// suppression window there is deliberately nothing on screen, and a reference image of
// an empty box would report nothing.
//
// FIXTURES ONLY (Req 15.11): the section is handed the answers the hub's own ports
// produced from `identity_check_status` and the merchant trio, so a case cannot pass
// by being told what to draw. Nothing here reads Supabase.
//
// EVERY CASE IS PAIRED AT 2.0 (Req 13.13). A pending step carries two explanations
// and two controls, which is exactly the content that reflows.
//
// RE-BASELINING, SCOPED (Req 15.12):
//
//   flutter test --update-goldens test/golden/profile
//
// Only ever that directory, only on the designated host, and only after the change
// that moved the pixels has been IDENTIFIED as intended. A mismatch nobody can
// explain is investigated, not regenerated. Commit the regenerated images with the
// change that moved them and name each one in the commit body. The full procedure is
// at the head of `golden_harness.dart`.
//
// Requirements 10.3, 10.9, 11.2, 13.13, 15.10–15.12.

import 'package:flutter_test/flutter_test.dart';

import '../_harness/golden_harness.dart';
import 'profile_golden_cases.dart';

void main() {
  setUpAll(setUpGoldenSuite);

  // Req 15.10: the comparison means nothing off the designated host, because font
  // rasterisation differs between platforms. The skip carries the REASON, which is
  // why it sits on the group — `testWidgets` takes only a `bool?` there and would
  // reduce the explanation to a silent true.
  group('Req 10.9: the profile states, captured',
      skip: GoldenHost.skipReason, () {
    for (final ProfileGoldenCase entry in kProfileGoldenCases) {
      for (final double scale in entry.textScales) {
        testWidgets('${entry.name} at ${scale}x', (tester) async {
          await pumpGolden(
            tester,
            entry.build(),
            surface: entry.surface,
            textScale: scale,
            overrides: entry.overrides,
            // A whole screen brings its own `Scaffold`.
            ownsScaffold: entry.ownsScaffold,
          );
          await expectGolden(entry.name, scale);
          // The loading hub leaves `SkeletonGate`'s minimum-duration timer armed;
          // every case is unmounted rather than only that one.
          await disposeGolden(tester);
        });
      }
    }
  });
}
