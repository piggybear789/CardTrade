// Feature: mobile-release-readiness — the buy flow survives a narrow phone and a
// large system font.
//
// THE DEFECT THESE TESTS PIN. `_PricePreview` laid each label and its amount out in
// a `spaceBetween` row with neither child flexible, so the row was as wide as its
// two children wanted to be and the viewport had no say. On a 390-wide phone with
// the fixture item it overflowed by 46 pixels: a black-and-yellow stripe in debug
// and clipped digits in release, on the money breakdown of the buy flow — the worst
// place on the surface for a number to be unreadable.
//
// WHY 2.0 AND NOT 1.0. `CappedTextScale` honours the system factor up to 2.0, so
// 2.0 is the widest text any member can actually ask for. A layout proven only at
// 1.0 is proven at the one setting that was never in question.
//
// The assertion is `expectNoLayoutOverflow`, which surfaces the layout's own
// exception rather than a measurement of our own — a hand-rolled width check would
// have to agree with Flutter about padding to mean anything.
//
// Validates: Requirements 13.10, 7.4

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/core/money.dart';
import 'package:cardtrade/features/sales/screens/purchase_flow_screen.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/models/item.dart';

import '../support/harness.dart';
import '../support/listing_fixtures.dart';

/// Pumps the buy flow for [item] at [surface] and [textScaleFactor].
///
/// Deliberately not `pumpAndSettle`: the screen holds a skeleton behind the item
/// read, and a settle would time out on a loading state rather than on a bug.
Future<void> pumpPurchase(
  WidgetTester tester, {
  required Item item,
  Size surface = kPhoneViewport,
  double textScaleFactor = 1.0,
}) async {
  await setViewport(tester, surface);
  await tester.pumpWidget(
    withOverrides(
      pumpFixture(
        PurchaseFlowScreen(itemId: item.id),
        textScaleFactor: textScaleFactor,
        reduceMotion: true,
        scaffold: false,
      ),
      listingDetailOverrides(item: item),
    ),
  );
  await tester.pump();
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 250));
}

void main() {
  group('Req 13.10: the price preview fits the phone it is read on', () {
    for (final (String name, Size surface) in <(String, Size)>[
      ('a phone', kPhoneViewport),
      ('the narrowest viewport the design commits to', kNarrowViewport),
    ]) {
      for (final double scale in <double>[1.0, 2.0]) {
        testWidgets('$name at a ${scale}x text scale lays out without overflow',
            (tester) async {
          await pumpPurchase(
            tester,
            item: makeItem(),
            surface: surface,
            textScaleFactor: scale,
          );

          expect(find.text('Price preview'), findsOneWidget);
          expectNoLayoutOverflow(tester);
        });
      }
    }

    testWidgets('a binder, whose breakdown carries the offer the buyer typed',
        (tester) async {
      // The other shape of the same screen: a shopfront adds the request field, the
      // offer field and the nothing-is-held notice above the same breakdown.
      await pumpPurchase(
        tester,
        item: makeItem(listingKind: ListingKind.shopfront),
        textScaleFactor: 2.0,
      );

      // Twice, deliberately: the field's own label and the breakdown's row label.
      expect(find.text('Your offer'), findsNWidgets(2));
      expectNoLayoutOverflow(tester);
    });

    testWidgets('a figure long enough to need the whole row stays on one line',
        (tester) async {
      // The regression this is really about is a WIDE figure, and the fixture item
      // is cheap. A five-figure price at a 2.0 scale is the worst case a member can
      // reach, and the label is the side that must give.
      const int priceCents = 9999999;
      await pumpPurchase(
        tester,
        item: makeItem(fmvCents: priceCents),
        textScaleFactor: 2.0,
      );

      // The summary card shows the same figure, so the finder asks for the one in
      // the breakdown: the row is the only place the amount is right-aligned.
      final String figure = Money.format(priceCents, makeItem().currency);
      final Finder amountInRow = find.byWidgetPredicate(
        (Widget w) =>
            w is Text && w.data == figure && w.textAlign == TextAlign.right,
      );
      expect(amountInRow, findsOneWidget);

      // A money figure that wrapped would read as two numbers. `Money.format` emits
      // no break opportunity inside an amount, so one line is the guarantee — and
      // the drawn height still being the unconstrained height is how one line looks
      // from outside the paragraph.
      final RenderParagraph amount =
          tester.renderObject<RenderParagraph>(amountInRow);
      expect(
        amount.size.height,
        closeTo(amount.getMaxIntrinsicHeight(double.infinity), 0.5),
        reason: 'the amount was broken across lines',
      );

      expectNoLayoutOverflow(tester);
    });
  });
}
