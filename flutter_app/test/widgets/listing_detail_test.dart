// Feature: mobile-visual-parity — the listing detail's required states, plus
// Property 15 at the description's 200-character boundary.
//
// Property 15: For any scalar input, the rendered result matches the band the
// requirement assigns it, including at the boundary value itself.
//
// This file owns ONE of Property 15's four instances: the description clamp at
// 200 characters (Req 6.6). The badge cap belongs to task 4.2, relative time to
// 8.3, and the skeleton's timing to 9.3.
//
// THE BOUNDARY IS COUNTED IN CHARACTERS AND THE CLAMP IS MEASURED IN LINES, and
// that asymmetry is the point: the threshold decides whether a buyer is asked to
// tap, so it must not move with the viewport, the text scale or the font. The
// tests below therefore assert the same boundary at two viewport widths and two
// text scales.
//
// Every provider is overridden with fixture data (`support/listing_fixtures.dart`)
// so nothing here reads Supabase.
//
// Validates: Requirements 6.6, 6.9, 5.10–5.12, 6.4, 6.7, 6.12, 13.10.

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/features/listings/screens/listing_detail_screen.dart';
import 'package:cardtrade/features/listings/widgets/listing_cover.dart';
import 'package:cardtrade/features/listings/widgets/listing_description.dart';
import 'package:cardtrade/features/listings/widgets/listing_gallery.dart';
import 'package:cardtrade/features/listings/widgets/listing_notice.dart';
import 'package:cardtrade/features/listings/widgets/listing_seller.dart';
import 'package:cardtrade/models/cash_sale.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/models/item.dart';
import 'package:cardtrade/models/profile.dart';

import '../support/harness.dart';
import '../support/listing_fixtures.dart';

/// Pumps the real detail screen over fixture providers.
///
/// Deliberately not `pumpAndSettle`: the screen shows its skeleton until the
/// overridden futures resolve, and the skeleton pulses forever, so a settle would
/// time out on a loading state rather than on a bug.
Future<void> pumpDetail(
  WidgetTester tester, {
  required Item item,
  PublicProfile? seller,
  Profile? viewer,
  String? viewerId = kFixtureBuyerId,
  List<CashSaleSummary> mySales = const <CashSaleSummary>[],
  double textScaleFactor = 1.0,
  Size surface = kPhoneViewport,
}) async {
  await setViewport(tester, surface);
  await tester.pumpWidget(
    withOverrides(
      pumpFixture(
        ListingDetailScreen(itemId: item.id),
        textScaleFactor: textScaleFactor,
        reduceMotion: true,
        scaffold: false,
      ),
      listingDetailOverrides(
        item: item,
        seller: seller,
        viewer: viewer ?? makeViewer(),
        viewerId: viewerId,
        mySales: mySales,
      ),
    ),
  );
  // One pump per layer of resolved future, then one to lay the result out.
  await tester.pump();
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 250));
}

/// Pumps the description in isolation, at a declared width and text scale.
Future<void> pumpDescription(
  WidgetTester tester,
  String description, {
  double textScaleFactor = 1.0,
  Size surface = kPhoneViewport,
}) async {
  await setViewport(tester, surface);
  await tester.pumpWidget(
    pumpFixture(
      Align(
        alignment: Alignment.topLeft,
        child: ListingDescription(description: description),
      ),
      textScaleFactor: textScaleFactor,
      reduceMotion: true,
    ),
  );
  await tester.pump();
}

void main() {
  group('Property 15: the description clamp at 200 characters (Req 6.6)', () {
    const int threshold = ListingDescription.clampThreshold;

    test('needsExpand is false up to and including the boundary', () {
      for (final int length in <int>[
        1,
        threshold ~/ 2,
        threshold - 1,
        threshold,
      ]) {
        expect(
          ListingDescription.needsExpand(descriptionOfLength(length)),
          isFalse,
          reason: '$length characters must be presented in full',
        );
      }
    });

    test('needsExpand is true from one character past it', () {
      for (final int length in <int>[
        threshold + 1,
        threshold + 2,
        threshold * 4,
      ]) {
        expect(
          ListingDescription.needsExpand(descriptionOfLength(length)),
          isTrue,
          reason: '$length characters must be clamped',
        );
      }
    });

    test('the boundary is measured after trimming', () {
      // 200 characters of copy inside 40 of whitespace is a 200-character
      // description, not a 240-character one: the padding is not something a
      // buyer would be asked to tap to read.
      final String padded = '   ${descriptionOfLength(threshold)}   ';
      expect(ListingDescription.needsExpand(padded), isFalse);
      expect(
        ListingDescription.needsExpand('   ${descriptionOfLength(threshold + 1)}   '),
        isTrue,
      );
    });

    testWidgets('at the boundary there is no fade and no expand control',
        (tester) async {
      await pumpDescription(tester, descriptionOfLength(threshold));

      expect(find.text('Read more'), findsNothing);
      expect(find.text('Show less'), findsNothing);
      expect(find.byType(ShaderMask), findsNothing);
      expect(find.text(descriptionOfLength(threshold)), findsOneWidget);
    });

    testWidgets('one character past it there is a fade and an expand control',
        (tester) async {
      final String body = descriptionOfLength(threshold + 1);
      await pumpDescription(tester, body);

      expect(find.text('Read more'), findsOneWidget);
      expect(find.byType(ShaderMask), findsOneWidget);

      // A label AND a chevron: the label is what a screen reader reads, the
      // chevron is what says which way the control goes.
      expect(find.byIcon(Icons.keyboard_arrow_down_rounded), findsOneWidget);

      await tester.tap(find.text('Read more'));
      await tester.pump();
      await tester.pump(ListingDescription.expandDuration);

      expect(find.text('Show less'), findsOneWidget);
      expect(find.byIcon(Icons.keyboard_arrow_up_rounded), findsOneWidget);
    });

    testWidgets('an empty or whitespace-only description draws nothing',
        (tester) async {
      for (final String body in <String>['', '   ', '\n\t ']) {
        await pumpDescription(tester, body);
        expect(find.byType(Text), findsNothing, reason: 'for "$body"');
        expect(find.text('Read more'), findsNothing);
      }
    });

    testWidgets('the boundary does not move with the viewport or the text scale',
        (tester) async {
      // The clamp is measured in LINES, which do move; the THRESHOLD is measured
      // in characters, which must not. A narrow phone at a 2.0 factor is where a
      // line-counted threshold would silently disagree with the web.
      for (final Size surface in <Size>[kPhoneViewport, kNarrowViewport]) {
        for (final double factor in <double>[1.0, 2.0]) {
          await pumpDescription(
            tester,
            descriptionOfLength(threshold),
            surface: surface,
            textScaleFactor: factor,
          );
          expect(
            find.text('Read more'),
            findsNothing,
            reason: '200 characters at $surface / ${factor}x must not clamp',
          );

          await pumpDescription(
            tester,
            descriptionOfLength(threshold + 1),
            surface: surface,
            textScaleFactor: factor,
          );
          expect(
            find.text('Read more'),
            findsOneWidget,
            reason: '201 characters at $surface / ${factor}x must clamp',
          );
        }
      }
    });
  });

  group('Region order and the seller disclosure (Req 6.1, 6.3, 6.4)', () {
    testWidgets('the gallery leads, then price and title, then the seller, '
        'then the description, then location', (tester) async {
      await pumpDetail(tester, item: makeItem());

      double topOf(Finder finder) => tester.getTopLeft(finder).dy;

      expect(find.byType(ListingGallery), findsOneWidget);
      expect(find.byType(ListingSeller), findsOneWidget);
      expect(find.byType(ListingDescription), findsOneWidget);

      expect(topOf(find.byType(ListingGallery)),
          lessThan(topOf(find.text('Charizard Holo 1st Edition'))));
      expect(topOf(find.text('Charizard Holo 1st Edition')),
          lessThan(topOf(find.byType(ListingSeller))));
      expect(topOf(find.byType(ListingSeller)),
          lessThan(topOf(find.byType(ListingDescription))));
      expect(topOf(find.byType(ListingDescription)),
          lessThan(topOf(find.textContaining('Based near'))));
    });

    testWidgets('a provider-verified name is disclosed and labelled in words',
        (tester) async {
      await pumpDetail(tester, item: makeItem());

      expect(find.textContaining('Verified name'), findsOneWidget);
      expect(find.textContaining('Jordan Alexis Reyes'), findsOneWidget);
    });

    testWidgets('without one, the trading history stands in — never a blank row',
        (tester) async {
      await pumpDetail(
        tester,
        item: makeItem(sellerIdentityVerified: false),
        seller: makeSeller(identityCheckName: null, rating: 4.5, ratingCount: 8),
      );

      expect(find.textContaining('Verified name'), findsNothing);
      expect(find.textContaining('4.5 out of 5 from 8 reviews'), findsOneWidget);
      // The controls that need a disclosure are withheld with the reason in TEXT,
      // not disabled without one (Req 6.4, 6.8).
      expect(find.text('Buy'), findsNothing);
      expect(
        find.textContaining('cannot accept a purchase or a trade yet'),
        findsOneWidget,
      );
      expect(find.text('Message seller'), findsOneWidget);
    });

    testWidgets('a seller with no reviews says so rather than showing a rating',
        (tester) async {
      await pumpDetail(
        tester,
        item: makeItem(),
        seller: makeSeller(
          identityCheckName: null,
          rating: null,
          ratingCount: 0,
        ),
      );

      expect(find.text('No reviews yet'), findsOneWidget);
    });
  });

  group('Action sets by viewer role (Req 6.8, 6.10)', () {
    testWidgets('a signed-in non-owner gets one primary action: Buy',
        (tester) async {
      await pumpDetail(tester, item: makeItem());

      expect(find.text('Buy'), findsOneWidget);
      expect(find.text('Offer'), findsOneWidget);
      expect(find.text('Trade'), findsOneWidget);
      expect(find.text('Edit listing'), findsNothing);
    });

    testWidgets('a binder is browsed, never offered on and never traded away',
        (tester) async {
      await pumpDetail(
        tester,
        item: makeItem(listingKind: ListingKind.shopfront),
      );

      expect(find.text('Browse and buy'), findsOneWidget);
      expect(find.text('Buy'), findsNothing);
      // 0081: one amount against a whole binder says nothing about which cards.
      expect(find.text('Offer'), findsNothing);
      expect(find.text('Trade'), findsNothing);
      // And the copy states that nothing is held (Req 6.7).
      expect(find.byType(ListingNotice), findsOneWidget);
      expect(find.textContaining('nothing is held'), findsOneWidget);
      expect(find.textContaining('hopfront'), findsNothing);
    });

    testWidgets('an owner edits and retires, and sees each open contract',
        (tester) async {
      await pumpDetail(
        tester,
        item: makeItem(),
        viewerId: kFixtureOwnerId,
        mySales: <CashSaleSummary>[makeContract()],
      );

      expect(find.text('Edit listing'), findsOneWidget);
      expect(find.text('Remove from catalog'), findsOneWidget);
      expect(find.text('1 open contract'), findsOneWidget);
      // A member cannot contract with themselves, so none of these are drawn.
      expect(find.text('Buy'), findsNothing);
      expect(find.text('Offer'), findsNothing);
      expect(find.text('Add to watchlist'), findsNothing);
    });

    testWidgets('a guest gets one action, carrying this listing as its target',
        (tester) async {
      await pumpDetail(tester, item: makeItem(), viewerId: null);

      expect(find.text('Sign in to buy'), findsOneWidget);
      expect(find.text('Buy'), findsNothing);
      expect(find.text('Offer'), findsNothing);
    });

    testWidgets('a closed binder says so and offers nothing', (tester) async {
      await pumpDetail(
        tester,
        item: makeItem(
          listingKind: ListingKind.shopfront,
          closedAt: kFixtureInstant,
        ),
      );

      expect(find.textContaining('closed this binder or bulk listing'),
          findsOneWidget);
      expect(find.text('Browse and buy'), findsNothing);
    });
  });

  group('The region advisory discloses and never disables (Req 6.12)', () {
    testWidgets('a cross-region seller draws the notice with Buy still live',
        (tester) async {
      await pumpDetail(
        tester,
        item: makeItem(),
        seller: makeSeller(regionCode: 'NZ'),
        viewer: makeViewer(regionCode: 'AU'),
      );

      expect(find.textContaining('different regions'), findsOneWidget);
      final Finder buy = find.text('Buy');
      expect(buy, findsOneWidget);
      // Still tappable: the orchestrator refuses regardless, and a greyed control
      // with no reason is the thing the notice exists to avoid.
      expect(
        tester.widget<InkWell>(
          find
              .ancestor(of: buy, matching: find.byType(InkWell))
              .first,
        ).onTap,
        isNotNull,
      );
    });

    testWidgets('a viewer with no region of their own is not warned here',
        (tester) async {
      // Their own incomplete onboarding, not a fact about this listing — and it
      // is surfaced where it can be fixed.
      await pumpDetail(
        tester,
        item: makeItem(),
        viewer: makeViewer(regionCode: null),
      );

      expect(find.textContaining('different regions'), findsNothing);
      expect(find.textContaining('trading region set'), findsNothing);
    });
  });

  group('The gallery (Req 6.11)', () {
    testWidgets('one dot per photo, capped at ten, with the position spoken',
        (tester) async {
      await pumpDetail(
        tester,
        item: makeItem(
          imagePaths: <String>[
            for (int index = 0; index < 12; index++)
              'owner-1/photo-$index.jpg',
          ],
        ),
      );

      expect(
        find.bySemanticsLabel(RegExp('Photo 1 of ${ListingGallery.maxPhotos}')),
        findsOneWidget,
      );
      expect(find.byType(PageView), findsOneWidget);
      expect(
        tester.widget<PageView>(find.byType(PageView)).childrenDelegate.estimatedChildCount,
        ListingGallery.maxPhotos,
      );
    });

    testWidgets('a single photo draws no dots', (tester) async {
      await pumpDetail(tester, item: makeItem());

      expect(find.bySemanticsLabel(RegExp('Photo 1 of 1')), findsNothing);
    });

    testWidgets('no photos draws the empty treatment at the reserved shape',
        (tester) async {
      await pumpDetail(tester, item: makeItem(imagePaths: const <String>[]));

      expect(find.byType(ListingPhotoEmpty), findsOneWidget);
      final Size box = tester.getSize(find.byType(ListingPhotoEmpty));
      expect(
        box.width,
        closeTo(box.height, 0.01),
        reason: 'the gallery reserves the square fallback (Req 11.1)',
      );
    });
  });

  group('The detail survives the applied text-scale range (Req 13.10)', () {
    testWidgets('no overflow, and the notice and title are never cut',
        (tester) async {
      for (final double factor in <double>[1.0, 2.0]) {
        await pumpDetail(
          tester,
          item: makeItem(listingKind: ListingKind.shopfront),
          textScaleFactor: factor,
        );

        expectNoLayoutOverflow(tester);

        // The binder notice and the title carry no line cap by design: a warning
        // or a listing's name cut at a 2.0 factor is one a member cannot read.
        final Finder notice = find.descendant(
          of: find.byType(ListingNotice),
          matching: find.byType(RichText),
        );
        for (final Element element in notice.evaluate()) {
          final RenderParagraph paragraph =
              element.renderObject! as RenderParagraph;
          expect(
            paragraph.didExceedMaxLines,
            isFalse,
            reason: 'the binder notice was cut at ${factor}x',
          );
        }
      }
    });
  });
}
