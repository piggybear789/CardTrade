// Feature: mobile-parity — which of the member's OWN listings the trade proposal
// screen offers as the offering side.
//
// This file exists because the filter behind that decision was
// `item.status == 'AVAILABLE'` — an `ItemStatus` enum compared to a String, which
// is always false, so the selector was always empty and the screen always said
// "You have no available items to trade." The analyzer reported it as
// `unrelated_type_equality_checks`; the record is in
// `.kiro/specs/mobile-parity/tasks.md`.
//
// The filter is a client-side AFFORDANCE. `openTradeNegotiation` and
// `open_trade_negotiation` re-evaluate ownership, availability and the 0081
// shopfront rule regardless, so nothing here is permission — it is only about
// which tiles a member is shown. The set asserted below is the same one the
// website's own-item picker selects: AVAILABLE and SINGLE.
//
// Validates: Requirements 6.10 (offerability), 0081 (a binder is never offered).

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/features/trades/screens/propose_trade_screen.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/models/item.dart';
import 'package:cardtrade/providers/listings_provider.dart';

import '../support/harness.dart';
import '../support/listing_fixtures.dart';

/// Pumps the real screen over a fixed set of the member's own listings.
Future<void> pumpProposeTrade(
  WidgetTester tester,
  List<Item> myListings, {
  Size surface = kPhoneViewport,
}) async {
  await setViewport(tester, surface);
  await tester.pumpWidget(
    withOverrides(
      pumpFixture(
        const ProposeTradeScreen(itemId: 'target-1', counterpartId: 'owner-2'),
        reduceMotion: true,
        scaffold: false,
      ),
      <Override>[
        myListingsProvider
            .overrideWith((ref) => Future<List<Item>>.value(myListings)),
      ],
    ),
  );
  // The override resolves on a microtask, so one extra pump moves the screen off
  // its loading indicator. Not `pumpAndSettle`: the loading indicator animates
  // forever, so a settle would time out on a state rather than fail on a bug.
  await tester.pump();
}

const String kEmptyCopy = 'You have no available items to trade.';

void main() {
  group('the trade proposal selector offers', () {
    testWidgets('an AVAILABLE single listing', (tester) async {
      await pumpProposeTrade(tester, <Item>[
        makeItem(id: 'single-available', title: 'Charizard'),
      ]);

      expect(find.text(kEmptyCopy), findsNothing);
      expect(find.text('Charizard'), findsOneWidget);
    });

    testWidgets('nothing when the member has no listings at all',
        (tester) async {
      await pumpProposeTrade(tester, const <Item>[]);

      expect(find.text(kEmptyCopy), findsOneWidget);
    });
  });

  group('the trade proposal selector refuses', () {
    testWidgets('a RESERVED single listing — a contract already holds it',
        (tester) async {
      await pumpProposeTrade(tester, <Item>[
        makeItem(
          id: 'single-reserved',
          title: 'Reserved card',
          status: ItemStatus.reserved,
        ),
      ]);

      expect(find.text('Reserved card'), findsNothing);
      expect(find.text(kEmptyCopy), findsOneWidget);
    });

    testWidgets('a SOLD single listing', (tester) async {
      await pumpProposeTrade(tester, <Item>[
        makeItem(
          id: 'single-sold',
          title: 'Sold card',
          status: ItemStatus.sold,
        ),
      ]);

      expect(find.text('Sold card'), findsNothing);
      expect(find.text(kEmptyCopy), findsOneWidget);
    });

    testWidgets(
        'a binder, which is permanently AVAILABLE but may never be offered (0081)',
        (tester) async {
      await pumpProposeTrade(tester, <Item>[
        makeItem(
          id: 'binder',
          title: 'My binder',
          listingKind: ListingKind.shopfront,
        ),
      ]);

      expect(find.text('My binder'), findsNothing);
      expect(find.text(kEmptyCopy), findsOneWidget);
    });
  });

  testWidgets('a mixed inventory offers only the available single listings',
      (tester) async {
    await pumpProposeTrade(tester, <Item>[
      makeItem(id: 'a', title: 'Offerable A'),
      makeItem(id: 'b', title: 'Offerable B'),
      makeItem(id: 'c', title: 'Held', status: ItemStatus.reserved),
      makeItem(id: 'd', title: 'Gone', status: ItemStatus.sold),
      makeItem(id: 'e', title: 'Binder', listingKind: ListingKind.shopfront),
    ]);

    expect(find.text(kEmptyCopy), findsNothing);
    expect(find.text('Offerable A'), findsOneWidget);
    expect(find.text('Offerable B'), findsOneWidget);
    expect(find.text('Held'), findsNothing);
    expect(find.text('Gone'), findsNothing);
    expect(find.text('Binder'), findsNothing);
  });

  group('canOfferItemInTrade', () {
    test('is true only for an AVAILABLE single listing', () {
      expect(canOfferItemInTrade(makeItem()), isTrue);
      expect(
        canOfferItemInTrade(makeItem(status: ItemStatus.reserved)),
        isFalse,
      );
      expect(canOfferItemInTrade(makeItem(status: ItemStatus.sold)), isFalse);
      expect(
        canOfferItemInTrade(makeItem(listingKind: ListingKind.shopfront)),
        isFalse,
      );
    });

    test('keeps a hidden item, as the website picker does', () {
      // An item held privately for an invite is still a legitimate thing to put
      // up; the server decides, and it does not exclude one.
      expect(canOfferItemInTrade(makeItem(hidden: true)), isTrue);
    });
  });
}
