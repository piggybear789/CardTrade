// The listing golden COMPARISON: five catalog tiles and five listing details, each
// at 1.0 and 2.0.
//
// The references live in `goldens/` beside this file, in version control
// (Req 15.10), and are captured through `test/golden/_harness/golden_harness.dart`
// so the fonts, the device pixel ratio, the surface, the text-scale cap, the clock
// and the animations are all held at a declared value (Req 15.11). The case list is
// `listing_golden_cases.dart`; its naming, pairing and layout are asserted by
// `listing_cases_test.dart`, which runs on every host.
//
// FIXTURES ONLY (Req 15.11). Every detail case pumps the real screen over the
// provider overrides in `test/support/listing_fixtures.dart`, so no reference here
// can move because the database did, and none of them reads Supabase or the network.
//
// EVERY CASE IS PAIRED AT 2.0 (Req 13.13). A tile is title, price, condition badge
// and seller line — all labels, all able to reflow — and the detail screen is the
// same copy given more room. The pair is where a clamped line or a collapsed control
// shows up.
//
// RE-BASELINING, SCOPED (Req 15.12):
//
//   flutter test --update-goldens test/golden/listings
//
// Only ever that directory, only on the designated host, and only after the change
// that moved the pixels has been IDENTIFIED as intended. A mismatch nobody can
// explain is investigated, not regenerated. Commit the regenerated images with the
// change that moved them and name each one in the commit body. The full procedure is
// at the head of `golden_harness.dart`.
//
// Requirements 5.10, 6.9, 13.13, 15.10–15.12.

import 'package:flutter_test/flutter_test.dart';

import '../_harness/golden_harness.dart';
import 'listing_golden_cases.dart';

void main() {
  setUpAll(setUpGoldenSuite);

  // Req 15.10: the comparison means nothing off the designated host, because font
  // rasterisation differs between platforms. The skip carries the REASON, which is
  // why it sits on the group — `testWidgets` takes only a `bool?` there and would
  // reduce the explanation to a silent true.
  group('Req 5.10 and 6.9: the listing states, captured',
      skip: GoldenHost.skipReason, () {
    for (final ListingGoldenCase entry in kListingGoldenCases) {
      for (final double scale in entry.textScales) {
        testWidgets('${entry.name} at ${scale}x', (tester) async {
          await pumpGolden(
            tester,
            entry.build(),
            surface: entry.surface,
            textScale: scale,
            overrides: entry.overrides,
            // A whole screen brings its own `Scaffold`; nesting one inside another
            // puts two bottom-bar slots in the tree.
            ownsScaffold: entry.ownsScaffold,
          );
          await expectGolden(entry.name, scale);
          // A detail case whose photo request has not resolved leaves a frame
          // scheduled, so every case is unmounted rather than only that one.
          await disposeGolden(tester);
        });
      }
    }
  });
}
