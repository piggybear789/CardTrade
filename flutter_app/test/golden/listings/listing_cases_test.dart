// The host-independent cover for the listing golden cases.
//
// This file makes NO pixel comparison: `listing_golden_test.dart` does that and owns
// the references in `goldens/`. The split is the one recorded at the head of
// `listing_golden_cases.dart` — the comparison is scoped to the designated host
// because font rasterisation differs between platforms, and everything here measures
// geometry and reads names, so it runs everywhere.
//
// What it asserts instead is that the case LIST is the set Req 5.10 and 6.9
// ask for, that every case pairs a 1.0 capture with a 2.0 twin at one surface
// size (Req 13.13), that no case names retired vocabulary, and that every case
// builds and lays out at both scales. A golden of a tree that overflows is a
// picture of a bug.
//
// Requirements 5.10, 6.9, 13.10, 13.13, 15.10, 15.11.

import 'package:flutter_test/flutter_test.dart';

import '../../support/harness.dart';
import '../../support/listing_fixtures.dart';
import 'listing_golden_cases.dart';

void main() {
  group('Req 5.10 and 6.9: the listing golden case list', () {
    test('covers the required card and detail states', () {
      expect(
        kListingGoldenCases.map((ListingGoldenCase entry) => entry.name).toList(),
        <String>[
          'listing_card_single',
          'listing_card_binder',
          'listing_card_reserved',
          'listing_card_sold',
          'listing_card_no_image',
          'listing_detail_single',
          'listing_detail_binder',
          'listing_detail_owner',
          'listing_detail_guest',
          'listing_detail_region_mismatch',
        ],
      );
    });

    test('names collide with nothing', () {
      final List<String> names =
          kListingGoldenCases.map((ListingGoldenCase e) => e.name).toList();
      expect(names.toSet(), hasLength(names.length));
    });

    test('pairs every case with a 2.0 text-scale twin at one surface size', () {
      for (final ListingGoldenCase entry in kListingGoldenCases) {
        // Req 13.13: the factor is the only difference between a pair, so the
        // surface is declared once per case and never per scale.
        expect(entry.textScales, <double>[1.0, 2.0], reason: entry.name);
        expect(entry.surface, kListingGoldenSurface, reason: entry.name);
      }
    });

    test('names no retired vocabulary', () {
      // Req 14.4 covers identifiers, strings and routes; a golden file name is
      // all three at once, and Flutter is the client that has reintroduced a
      // retired concept by naming it before. `shopfront` is included because it
      // is the internal listing kind and never a word a member has seen.
      for (final ListingGoldenCase entry in kListingGoldenCases) {
        for (final String retired in <String>[
          'deal',
          'ditto',
          'kyc',
          'shopfront',
          'escrow',
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
    for (final ListingGoldenCase entry in kListingGoldenCases) {
      for (final double scale in entry.textScales) {
        testWidgets('${entry.name} at ${scale}x', (tester) async {
          await setViewport(tester, entry.surface);
          await tester.pumpWidget(
            withOverrides(
              pumpFixture(
                entry.build(),
                textScaleFactor: scale,
                reduceMotion: true,
                scaffold: !entry.ownsScaffold,
              ),
              entry.overrides,
            ),
          );
          // Not `pumpAndSettle`: a case whose photo request has not resolved
          // keeps a frame scheduled, so a settle would time out on a loading
          // state rather than on a defect. Three pumps run the overridden
          // futures and lay out what they resolved to.
          await tester.pump();
          await tester.pump();
          await tester.pump(const Duration(milliseconds: 250));

          expectNoLayoutOverflow(tester);
        });
      }
    }
  });
}
