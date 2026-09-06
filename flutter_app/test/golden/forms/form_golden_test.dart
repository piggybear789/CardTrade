// The form-control golden COMPARISON: four field states, four button treatments in
// three states each, and two composed form states — each at 1.0 and 2.0.
//
// The references live in `goldens/` beside this file, in version control
// (Req 15.10), and are captured through `test/golden/_harness/golden_harness.dart`
// so the fonts, the device pixel ratio, the surface, the text-scale cap, the clock
// and the animations are all held at a declared value (Req 15.11). The case list is
// `form_golden_cases.dart`; its naming, pairing, busy-flag agreement and layout are
// asserted by `form_cases_test.dart`, which runs on every host.
//
// TWO CASE FLAGS CHANGE HOW THE CAPTURE IS TAKEN, AND BOTH ARE LOAD-BEARING:
//
//   `focusField`     — focus is a state no argument expresses. Req 8.2 is precisely
//                      that focus recolours the border and moves NOTHING, so the
//                      focused reference has to be captured with the field actually
//                      focused, at the same drawn bounds as the resting one. The
//                      harness's `beforeCapture` runs against a laid-out tree, which
//                      is what lets a finder resolve there.
//   `pumpsAnimation` — a busy button draws a `CircularProgressIndicator`, which
//                      animates forever. Reduce-motion is turned OFF for those cases
//                      and the surface is pumped to a DECLARED phase instead, so the
//                      sweep in the reference is the sweep at a stated instant rather
//                      than at whichever one the frame landed on. Capturing them with
//                      the indicator held still would be a picture of a state the app
//                      only shows under reduce-motion.
//
// WHY THE BUSY PAIR IS WORTH A REFERENCE AT ALL. `AppButton` draws its spinner over a
// label held at zero opacity, so a busy button is the same WIDTH as its enabled twin.
// `form_cases_test.dart` asserts that in geometry; the pair of images is what makes it
// reviewable. The defect it replaced collapsed a 186-pixel control to 48 the moment it
// was pressed.
//
// FIXTURES ONLY (Req 15.11): every case is a shared primitive over constant copy.
// Nothing here reads Supabase or the network.
//
// EVERY CASE IS PAIRED AT 2.0 (Req 13.13). A field has a label, a hint, helper text
// and an error line, and a button has a label — every one of them reflows.
//
// RE-BASELINING, SCOPED (Req 15.12):
//
//   flutter test --update-goldens test/golden/forms
//
// Only ever that directory, only on the designated host, and only after the change
// that moved the pixels has been IDENTIFIED as intended. A mismatch nobody can
// explain is investigated, not regenerated. Commit the regenerated images with the
// change that moved them and name each one in the commit body. The full procedure is
// at the head of `golden_harness.dart`.
//
// Requirements 8.2, 8.10, 8.12, 13.13, 15.10–15.12.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../_harness/golden_harness.dart';
import 'form_golden_cases.dart';

void main() {
  setUpAll(setUpGoldenSuite);

  // Req 15.10: the comparison means nothing off the designated host, because font
  // rasterisation differs between platforms. The skip carries the REASON, which is
  // why it sits on the group — `testWidgets` takes only a `bool?` there and would
  // reduce the explanation to a silent true.
  group('Req 8.12: the form-control states, captured',
      skip: GoldenHost.skipReason, () {
    for (final FormGoldenCase entry in kFormGoldenCases) {
      for (final double scale in entry.textScales) {
        testWidgets('${entry.name} at ${scale}x', (tester) async {
          await pumpGolden(
            tester,
            entry.build(),
            surface: entry.surface,
            textScale: scale,
            // Req 11.7: the one animated capture per surface, at a stated point in
            // the cycle. Everything else is held still.
            reduceMotion: !entry.pumpsAnimation,
            beforeCapture: entry.focusField
                ? (WidgetTester tester) async {
                    await tester.tap(find.byType(TextField));
                  }
                : null,
          );
          if (entry.focusField) {
            expect(
              tester.binding.focusManager.primaryFocus,
              isNotNull,
              reason: '${entry.name} is a focused capture and took no focus',
            );
          }
          await expectGolden(entry.name, scale);
          // A focused field arms a cursor-blink timer and a busy button holds a
          // running ticker; both are the widget's to cancel on a device and have to
          // be unmounted here.
          await disposeGolden(tester);
        });
      }
    }
  });
}
