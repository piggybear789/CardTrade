// The message golden COMPARISON: eight thread states, two composer states and three
// conversation rows, each at 1.0 and 2.0.
//
// The references live in `goldens/` beside this file, in version control
// (Req 15.10), and are captured through `test/golden/_harness/golden_harness.dart`
// so the fonts, the device pixel ratio, the surface, the text-scale cap, the clock
// and the animations are all held at a declared value (Req 15.11). The case list is
// `message_golden_cases.dart`; its naming, pairing, wall-clock independence and
// layout are asserted by `message_cases_test.dart`, which runs on every host.
//
// THIS IS THE AREA WHERE THE PINNED CLOCK MATTERS MOST. A thread draws a day
// separator, a run clock and a relative age, all read from a `now` the surface is
// GIVEN. Each case hands the widget `kMessageNow` — the same instant the harness
// exposes as `kGoldenInstant` — so `Today` and `12m ago` are the same words in the
// reference image as in every later capture. A relative label read from
// `DateTime.now()` is a reference image with a fuse on it, and the failure would read
// as a rendering change rather than as a clock.
//
// FIXTURES ONLY (Req 15.11): every case is built from `test/support/message_fixtures.dart`.
// The attachment cases are deliberately the UNRESOLVED-attachment branch, which is
// the state this client can actually reach — the bucket is private and the mobile API
// exposes no participation-checked signing call, so the thread draws the labelled
// placeholder. Capturing a real photo would need a network read, which Req 15.11
// forbids.
//
// EVERY CASE IS PAIRED AT 2.0 (Req 13.13). A bubble is bounded as a fraction of the
// viewport and its body wraps inside that bound, so the pair is the only thing that
// shows a bubble growing rather than clipping.
//
// RE-BASELINING, SCOPED (Req 15.12):
//
//   flutter test --update-goldens test/golden/messages
//
// Only ever that directory, only on the designated host, and only after the change
// that moved the pixels has been IDENTIFIED as intended. A mismatch nobody can
// explain is investigated, not regenerated. Commit the regenerated images with the
// change that moved them and name each one in the commit body. The full procedure is
// at the head of `golden_harness.dart`.
//
// Requirements 9.3–9.6, 9.10, 13.13, 15.10–15.12.

import 'package:flutter_test/flutter_test.dart';

import '../_harness/golden_harness.dart';
import 'message_golden_cases.dart';

void main() {
  setUpAll(setUpGoldenSuite);

  // Req 15.10: the comparison means nothing off the designated host, because font
  // rasterisation differs between platforms. The skip carries the REASON, which is
  // why it sits on the group — `testWidgets` takes only a `bool?` there and would
  // reduce the explanation to a silent true.
  group('Req 9.10: the message states, captured',
      skip: GoldenHost.skipReason, () {
    for (final MessageGoldenCase entry in kMessageGoldenCases) {
      for (final double scale in entry.textScales) {
        testWidgets('${entry.name} at ${scale}x', (tester) async {
          await pumpGolden(
            tester,
            entry.build(),
            surface: entry.surface,
            textScale: scale,
          );
          await expectGolden(entry.name, scale);
          await disposeGolden(tester);
        });
      }
    }
  });
}
