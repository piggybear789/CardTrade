// The Mobile_Shell golden COMPARISON: eight states, each at 1.0 and 2.0.
//
// The references live in `goldens/` beside this file, in version control
// (Req 15.10), and are captured through `test/golden/_harness/golden_harness.dart`
// so the fonts, the device pixel ratio, the surface, the text-scale cap, the clock
// and the animations are all held at a declared value (Req 15.11). The case list
// itself is `shell_golden_cases.dart`; its layout, naming and pairing are asserted
// by `shell_cases_test.dart`, which runs on every host.
//
// EVERY CASE IS PAIRED AT 2.0 (Req 13.13). Every shell case draws destination
// labels, and a label is the thing that reflows — the pair is what shows whether
// the bar's 56dp row and its safe-area inset survive a member who reads at twice
// the size.
//
// RE-BASELINING, SCOPED (Req 15.12):
//
//   flutter test --update-goldens test/golden/shell
//
// Only ever that directory, only on the designated host, and only after the change
// that moved the pixels has been IDENTIFIED as intended. A mismatch nobody can
// explain is investigated, not regenerated: the diff a person looks at is the whole
// value of this file. Commit the regenerated images with the change that moved
// them and name each one in the commit body. The full procedure, and what the
// `failures/` artefacts are, is at the head of `golden_harness.dart`.
//
// Requirements 4.14, 13.13, 15.10–15.12.

import 'package:flutter_test/flutter_test.dart';

import '../_harness/golden_harness.dart';
import 'shell_golden_cases.dart';

void main() {
  setUpAll(setUpGoldenSuite);

  // Req 15.10: the comparison means nothing off the designated host, because font
  // rasterisation differs between platforms. The skip carries the REASON, which is
  // why it sits on the group — `testWidgets` takes only a `bool?` there and would
  // reduce the explanation to a silent true.
  group('Req 4.14: the shell states, captured', skip: GoldenHost.skipReason, () {
    for (final ShellGoldenCase entry in kShellGoldenCases) {
      for (final double scale in entry.textScales) {
        testWidgets('${entry.name} at ${scale}x', (tester) async {
          await pumpGolden(
            tester,
            entry.build(),
            surface: entry.surface,
            textScale: scale,
          );
          await expectGolden(entry.name, scale);
          // Torn down even though a bar arms no timer: a capture that leaves a
          // tree mounted is a capture that leaks into the next case.
          await disposeGolden(tester);
        });
      }
    }
  });
}
