// Feature: mobile-visual-parity — the catalog tile's required states, plus
// Property 14 on the cover box.
//
// Property 14: For any fixture content shape, laying out the placeholder and
// laying out the resolved content produce element positions differing by no more
// than 1 logical pixel and an identical scroll extent.
//
// HOW THE COVER'S TWO CONTENT SHAPES ARE OBTAINED. A widget test has no network,
// so the "resolved photo" in this file is not decoded bytes — it is the OTHER
// content the cover draws: `ListingPhotoEmpty`, an icon at the display size on a
// filled box. That is a genuinely different child from the pending fill, with a
// genuinely different intrinsic size, and the property is exactly that the box
// does not care: `AspectRatio` fixes the cover from the declared cover dimensions
// before any child is laid out, which is what makes decoded bytes unable to move
// the tile either (Req 5.2).
//
// Validates: Requirements 5.2, 5.10–5.12, 13.10.

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/features/listings/widgets/listing_card.dart';
import 'package:cardtrade/features/listings/widgets/listing_cover.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/models/item.dart';

import '../support/harness.dart';
import '../support/listing_fixtures.dart';

/// The width one tile occupies in the two-column mosaic at a phone width.
const double kTileWidth = 186;

/// Cover shapes the mosaic has to survive: unknown, square, a trading card in
/// both orientations, a panorama past the clamp, and nonsense.
const List<(String, int?, int?)> _coverShapes = <(String, int?, int?)>[
  ('unknown', null, null),
  ('square', 800, 800),
  ('card portrait', 630, 880),
  ('card landscape', 880, 630),
  ('panorama past the clamp', 4000, 900),
  ('tall past the clamp', 900, 4000),
  ('absurd', 4000, 1),
  ('zero', 0, 0),
];

/// Pumps one tile at the mosaic column width.
Future<void> pumpTile(
  WidgetTester tester,
  ItemSummary item, {
  double textScaleFactor = 1.0,
}) async {
  await setViewport(tester, kPhoneViewport);
  await tester.pumpWidget(
    withOverrides(
      pumpFixture(
        Align(
          alignment: Alignment.topLeft,
          child: SizedBox(width: kTileWidth, child: ListingCard(item: item)),
        ),
        textScaleFactor: textScaleFactor,
        reduceMotion: true,
      ),
      watchOverrides(item.id),
    ),
  );
  // Two pumps: one to run the overridden futures, one to lay out what they
  // resolved to. `pumpAndSettle` is deliberately not used — an unresolved image
  // request keeps a frame scheduled and the settle never returns.
  await tester.pump();
  await tester.pump();
}

/// Everything the tile says in one sentence, as a reader who cannot see it hears
/// it (Req 5.7). Located by its content rather than by position, so a wrapper
/// widget appearing above it does not silently change what is asserted.
String tileLabel(WidgetTester tester) {
  final Semantics node = tester
      .widgetList<Semantics>(find.byType(Semantics))
      .firstWhere((Semantics widget) =>
          widget.properties.button == true &&
          (widget.properties.label ?? '').contains('Charizard'));
  return node.properties.label!;
}

/// Finders scoped inside the tile, so a wrapper's own [Opacity] or
/// [ColorFiltered] cannot answer for the card's.
Finder inTile(Type type) => find.descendant(
      of: find.byType(ListingCard),
      matching: find.byType(type),
    );

void main() {
  group('ListingCover.aspectRatio clamps the mosaic (Req 5.1, 5.2)', () {
    test('unknown, zero and absurd dimensions fall back to a square', () {
      expect(ListingCover.aspectRatio(null, null),
          ListingCover.aspectFallback);
      expect(ListingCover.aspectRatio(800, null), ListingCover.aspectFallback);
      expect(ListingCover.aspectRatio(0, 0), ListingCover.aspectFallback);
      expect(ListingCover.aspectRatio(-3, 4), ListingCover.aspectFallback);
      expect(ListingCover.aspectRatio(4000, 1), ListingCover.aspectFallback);
    });

    test('every plausible shape lands inside the mosaic range', () {
      for (final (String name, int? w, int? h) in _coverShapes) {
        final double ratio = ListingCover.aspectRatio(w, h);
        expect(
          ratio,
          inInclusiveRange(ListingCover.aspectMin, ListingCover.aspectMax),
          reason: '$name resolved to $ratio, outside the clamp',
        );
      }
    });
  });

  group('Property 14: the cover box occupies its content\'s layout', () {
    testWidgets('the cover is its declared shape, whatever the photo is doing',
        (tester) async {
      for (final (String name, int? w, int? h) in _coverShapes) {
        for (final bool hasPhoto in <bool>[true, false]) {
          await pumpTile(
            tester,
            makeSummary(
              coverWidthPx: w,
              coverHeightPx: h,
              imagePaths:
                  hasPhoto ? const <String>[kFixturePhotoPath] : const <String>[],
            ),
          );

          final Size cover = tester.getSize(find.byType(ListingCoverBox));
          expect(
            cover.height,
            closeTo(kTileWidth / ListingCover.aspectRatio(w, h), 0.01),
            reason: '$name (photo: $hasPhoto) reserved the wrong cover box',
          );
        }
      }
    });

    testWidgets('a pending photo and a resolved absence lay out identically',
        (tester) async {
      for (final (String name, int? w, int? h) in _coverShapes) {
        await pumpTile(
          tester,
          makeSummary(
            id: 'pending',
            coverWidthPx: w,
            coverHeightPx: h,
          ),
        );
        final double pendingCover =
            tester.getSize(find.byType(ListingCoverBox)).height;
        final double pendingTile =
            tester.getSize(find.byType(ListingCard)).height;

        await pumpTile(
          tester,
          makeSummary(
            id: 'empty',
            coverWidthPx: w,
            coverHeightPx: h,
            imagePaths: const <String>[],
          ),
        );

        // The empty treatment IS resolved content, and a substantial one: an
        // icon at the display size inside a filled box.
        expect(find.byType(ListingPhotoEmpty), findsOneWidget);
        expect(
          tester.getSize(find.byType(ListingCoverBox)).height,
          closeTo(pendingCover, 1.0),
          reason: '$name: the cover moved by more than one logical pixel',
        );
        expect(
          tester.getSize(find.byType(ListingCard)).height,
          closeTo(pendingTile, 1.0),
          reason: '$name: the tile moved by more than one logical pixel',
        );
      }
    });

    testWidgets('a mosaic of pending covers has the resolved scroll extent',
        (tester) async {
      await setViewport(tester, kPhoneViewport);

      // Long enough to scroll, so equal extents are an assertion rather than two
      // zeroes agreeing, and long enough that a per-tile rounding error would
      // accumulate past the tolerance.
      const int tiles = 20;

      Future<double> extentOf({required bool hasPhoto}) async {
        final List<ItemSummary> items = <ItemSummary>[
          for (int index = 0; index < tiles; index++)
            makeSummary(
              id: 'item-$index',
              coverWidthPx: 630,
              coverHeightPx: 880,
              imagePaths: hasPhoto
                  ? const <String>[kFixturePhotoPath]
                  : const <String>[],
            ),
        ];

        await tester.pumpWidget(
          withOverrides(
            pumpFixture(
              ListView(
                children: <Widget>[
                  for (final ItemSummary item in items)
                    SizedBox(width: kTileWidth, child: ListingCard(item: item)),
                ],
              ),
              reduceMotion: true,
            ),
            watchOverridesForAll(
              items.map((ItemSummary item) => item.id),
            ),
          ),
        );
        await tester.pump();
        await tester.pump();

        return tester
            .state<ScrollableState>(find.byType(Scrollable))
            .position
            .maxScrollExtent;
      }

      final double pending = await extentOf(hasPhoto: true);
      final double resolved = await extentOf(hasPhoto: false);

      expect(pending, greaterThan(0), reason: 'the fixture must actually scroll');
      expect(
        resolved,
        closeTo(pending, 1.0),
        reason: 'the mosaic must not reflow as photos arrive (Req 5.2)',
      );
    });
  });

  group('Card states (Req 5.11, 5.12)', () {
    testWidgets('an open single listing carries no marker and no scrim',
        (tester) async {
      await pumpTile(tester, makeSummary());

      expect(find.text('RESERVED'), findsNothing);
      expect(find.text('SOLD'), findsNothing);
      expect(find.text('CLOSED'), findsNothing);
      expect(inTile(Opacity), findsNothing);
      expect(inTile(ColorFiltered), findsNothing);
    });

    testWidgets('a reserved single listing is marked, dimmed and desaturated',
        (tester) async {
      await pumpTile(tester, makeSummary(status: ItemStatus.reserved));

      expect(find.text('RESERVED'), findsOneWidget);
      expect(inTile(ColorFiltered), findsOneWidget);
      expect(tester.widget<Opacity>(inTile(Opacity)).opacity, 0.7);
      // Req 13.11: the state is stated in words as well as drawn, so it does not
      // rest on the scrim alone.
      expect(tileLabel(tester), contains('Under contract'));
    });

    testWidgets('a sold single listing is marked SOLD', (tester) async {
      await pumpTile(tester, makeSummary(status: ItemStatus.sold));

      expect(find.text('SOLD'), findsOneWidget);
      expect(tester.widget<Opacity>(inTile(Opacity)).opacity, 0.7);
      expect(tileLabel(tester), contains('Sold'));
    });

    testWidgets('a binder is never reserved or sold — only closed',
        (tester) async {
      // A binder holds nothing, so its row's `status` says nothing about it. The
      // tile must read `closed_at` and nothing else (Req 5.11).
      await pumpTile(
        tester,
        makeSummary(
          listingKind: ListingKind.shopfront,
          status: ItemStatus.reserved,
        ),
      );
      expect(find.text('RESERVED'), findsNothing);
      expect(find.text('CLOSED'), findsNothing);

      await pumpTile(
        tester,
        makeSummary(
          listingKind: ListingKind.shopfront,
          status: ItemStatus.available,
          closedAt: kFixtureInstant,
        ),
      );
      expect(find.text('CLOSED'), findsOneWidget);
    });

    testWidgets('a listing with no photo draws the empty treatment, not a '
        'broken-image glyph', (tester) async {
      await pumpTile(tester, makeSummary(imagePaths: const <String>[]));

      expect(find.byType(ListingPhotoEmpty), findsOneWidget);
      expect(find.byIcon(Icons.broken_image), findsNothing);
      expect(find.byIcon(Icons.broken_image_outlined), findsNothing);
      // Named for assistive technology, since there is nothing to look at.
      expect(
        find.bySemanticsLabel(
          RegExp('No photo available for Charizard Holo 1st Edition'),
        ),
        findsOneWidget,
      );
    });

    testWidgets('a binder is marked Binder, states no condition, and says '
        'nothing is held', (tester) async {
      await pumpTile(
        tester,
        makeSummary(listingKind: ListingKind.shopfront, condition: 'Near Mint'),
      );

      expect(find.text('Binder'), findsOneWidget);
      // Never the internal name for the listing kind (Req 5.8).
      expect(find.textContaining('hopfront'), findsNothing);
      // Mixed stock states no single condition.
      expect(find.text('Near Mint'), findsNothing);
      expect(find.textContaining('From'), findsOneWidget);

      final String label = tileLabel(tester);
      expect(label, contains('Binder or bulk listing'));
      expect(label, contains('Nothing is held'));
    });
  });

  group('The tile survives the applied text-scale range (Req 13.10)', () {
    testWidgets('no layout overflow at 1.0 or 2.0 in a mosaic column',
        (tester) async {
      for (final double factor in <double>[1.0, 1.5, 2.0]) {
        for (final ItemSummary item in <ItemSummary>[
          makeSummary(),
          makeSummary(listingKind: ListingKind.shopfront),
          makeSummary(status: ItemStatus.sold),
          makeSummary(
            title: 'Reallylongsinglewordwithnobreakopportunityanywhereinside',
            condition: 'Lightly Played',
            category: 'Magic: The Gathering',
            imagePaths: const <String>[],
          ),
        ]) {
          await pumpTile(tester, item, textScaleFactor: factor);
          expectNoLayoutOverflow(tester);
        }
      }
    });

    testWidgets('the game and the condition reflow rather than being cut',
        (tester) async {
      // THREE DELIBERATE CLAMPS, AND NO FOURTH. The tile clamps the same three
      // facts the web's phone tile does: the title to two lines (Req 5.3), the
      // price to one because a figure broken mid-number is worse than one that
      // does not fit, and the seller's name to one. The game and the condition are
      // reading text with no cap, so Req 13.10 says they reflow — which is what
      // this asserts, by exempting exactly those three and nothing else.
      const String title =
          'Charizard Holo 1st Edition, Base Set, sleeved since pull';
      await pumpTile(
        tester,
        makeSummary(
          title: title,
          category: 'Magic: The Gathering',
          condition: 'Lightly Played',
        ),
        textScaleFactor: 2.0,
      );

      const Set<String> clampedByDesign = <String>{
        title,
        'CardMaster',
      };

      for (final RenderParagraph paragraph in allParagraphs(tester)) {
        final String text = paragraph.text.toPlainText();
        if (clampedByDesign.contains(text)) continue;
        // The price, located by its digits. It is also where the test font's
        // square glyph metrics bite hardest (see `kFixturePriceCents`), so an
        // assertion on it would measure the fixture font and not the design.
        if (text.contains('42')) continue;
        expect(
          paragraph.didExceedMaxLines,
          isFalse,
          reason: 'the tile truncated "$text" at a 2.0 text scale',
        );
      }
    });
  });
}
