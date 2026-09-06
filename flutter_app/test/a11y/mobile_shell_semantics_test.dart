// Feature: mobile-visual-parity — Property 20, over the app shell.
//
// Property 20: for any screen state, every node carrying an action has a non-empty
// label naming that action, no node without an action is reachable by traversal,
// and traversal order sorts by top-then-leading position.
//
// The shell is the one surface every screen wears, so an unlabelled destination
// here costs a screen-reader member the whole app. It is also where Req 4.11 puts
// its only guest affordance: the visible treatment gives a signed-out visitor no
// clue that four of the five destinations land on sign-in, so the label has to say
// it out loud. No golden can see either fact.
//
// Every test disposes its semantics handle INSIDE the body: the framework's
// end-of-test verification runs before tear-downs, so a handle released in
// `addTearDown` is still reported as leaked.
//
// Validates: Requirements 4.11, 13.7, 13.9.

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/router/hub_set.dart';
import 'package:cardtrade/router/router.dart';
import 'package:cardtrade/widgets/common/bottom_nav_shell.dart';
import 'package:cardtrade/widgets/common/mobile_chrome.dart';

import '../support/harness.dart';

Widget _bar({
  MobileHubId? currentHubId,
  bool isAuthenticated = true,
  int? unreadMessageCount,
}) {
  return Align(
    alignment: Alignment.bottomCenter,
    child: MobileShellBar(
      currentHubId: currentHubId,
      isAuthenticated: isAuthenticated,
      unreadMessageCount: unreadMessageCount,
      onSelected: (_) {},
    ),
  );
}

void main() {
  group('Property 20: the shell bar is completely and orderly labelled', () {
    testWidgets('five actionable nodes, one per destination, each named',
        (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await setViewport(tester, kPhoneViewport);

      await tester.pumpWidget(pumpFixture(_bar(currentHubId: MobileHubId.browse)));

      final List<SemanticsNode> actionable = actionableSemanticsNodes(tester);
      expect(actionable, hasLength(kMobileHubs.length));
      for (final SemanticsNode node in actionable) {
        expect(
          node.getSemanticsData().label.trim(),
          isNotEmpty,
          reason: 'an unlabelled destination at ${node.rect} is unreachable',
        );
      }

      handle.dispose();
    });

    testWidgets('a destination is ONE node, not a glyph beside a label',
        (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await setViewport(tester, kPhoneViewport);

      await tester.pumpWidget(pumpFixture(_bar(currentHubId: MobileHubId.inbox)));

      // The glyph and the label are excluded from semantics and the destination
      // announces itself once, as a selected button. Two nodes would have a screen
      // reader read the icon separately from what tapping it does.
      expect(
        tester.getSemantics(find.bySemanticsLabel('Inbox')),
        isSemantics(
          label: 'Inbox',
          isButton: true,
          isSelected: true,
          hasTapAction: true,
        ),
      );
      expect(
        tester.getSemantics(find.bySemanticsLabel('Browse')),
        isSemantics(label: 'Browse', isButton: true, isSelected: false),
      );

      handle.dispose();
    });

    testWidgets('traversal order is the left-to-right Hub_Set order',
        (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await setViewport(tester, kPhoneViewport);

      await tester.pumpWidget(pumpFixture(_bar()));

      final List<Rect> declared = <Rect>[
        for (final MobileHub hub in kMobileHubs)
          tester.getRect(find.bySemanticsLabel(hub.label)),
      ];
      final List<Rect> visual = <Rect>[...declared]..sort((Rect a, Rect b) {
        final int byTop = a.top.compareTo(b.top);
        return byTop != 0 ? byTop : a.left.compareTo(b.left);
      });

      // Req 13.9 wants focus to follow reading order, and Req 4.5 fixes that order
      // as the web's. On one row the two claims are the same claim.
      expect(declared, visual, reason: 'focus would not follow the Hub_Set order');

      handle.dispose();
    });

    testWidgets('the count badge is announced as part of its destination',
        (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await setViewport(tester, kPhoneViewport);

      await tester.pumpWidget(pumpFixture(_bar(unreadMessageCount: 1000)));

      // The badge is excluded from semantics along with the rest of the button's
      // interior, so it must not appear as a stray reachable `99+`.
      final List<String> labels = allSemanticsNodes(tester)
          .map((SemanticsNode node) => node.getSemanticsData().label)
          .where((String label) => label.isNotEmpty)
          .toList();
      expect(labels, isNot(contains('99+')));
      expect(actionableSemanticsNodes(tester), hasLength(kMobileHubs.length));

      handle.dispose();
    });
  });

  group('Req 4.11: a guest is told that a destination needs a session', () {
    testWidgets('each gated destination says so, and the catalog does not',
        (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await setViewport(tester, kPhoneViewport);

      await tester.pumpWidget(pumpFixture(_bar(isAuthenticated: false)));

      for (final MobileHub hub in kMobileHubs) {
        final String expected =
            hub.requiresAuth ? '${hub.label}, sign-in required' : hub.label;
        expect(
          find.bySemanticsLabel(expected),
          findsOneWidget,
          reason: '${hub.label} must announce "$expected" to a guest',
        );
      }

      // Present and enabled, not hidden or disabled: a guest may still press every
      // one, and the shell aims the sign-in at that destination.
      for (final SemanticsNode node in actionableSemanticsNodes(tester)) {
        expect(node.getSemanticsData().hasAction(SemanticsAction.tap), isTrue);
      }

      handle.dispose();
    });

    testWidgets('a signed-in member gets the plain labels back', (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await setViewport(tester, kPhoneViewport);

      await tester.pumpWidget(pumpFixture(_bar(isAuthenticated: true)));

      for (final MobileHub hub in kMobileHubs) {
        expect(find.bySemanticsLabel(hub.label), findsOneWidget);
      }
      expect(find.bySemanticsLabel(RegExp('sign-in required')), findsNothing);

      handle.dispose();
    });
  });

  group('Property 20: a hub sheet is labelled and ordered', () {
    testWidgets('one named node per row, in the declared order', (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await setViewport(tester, kPhoneViewport);

      final MobileHub contracts = kMobileHubs
          .firstWhere((MobileHub hub) => hub.id == MobileHubId.contracts);

      await tester.pumpWidget(
        pumpFixture(
          HubSheet(
            hub: contracts,
            location: AppRoutes.sales,
            onDestination: (_) {},
          ),
        ),
      );

      final List<SemanticsNode> actionable = actionableSemanticsNodes(tester);
      expect(actionable, hasLength(contracts.destinations.length));
      expect(
        actionable.map((SemanticsNode node) => node.getSemanticsData().label).toList(),
        contracts.destinations
            .map((HubDestination destination) => destination.label)
            .toList(),
      );

      // The row for the screen the member is already on says so, so the sheet is
      // not a list of five identical-sounding options.
      expect(
        tester.getSemantics(find.bySemanticsLabel('Sales')),
        isSemantics(label: 'Sales', isButton: true, isSelected: true),
      );
      expect(
        tester.getSemantics(find.bySemanticsLabel('Trades')),
        isSemantics(label: 'Trades', isButton: true, isSelected: false),
      );

      handle.dispose();
    });

    testWidgets('every row is a full touch target and none overlap',
        (tester) async {
      await setViewport(tester, kPhoneViewport);

      final MobileHub sell =
          kMobileHubs.firstWhere((MobileHub hub) => hub.id == MobileHubId.sell);

      await tester.pumpWidget(
        pumpFixture(
          HubSheet(hub: sell, location: AppRoutes.sell, onDestination: (_) {}),
        ),
      );

      final Finder rows = find.descendant(
        of: find.byType(HubSheet),
        matching: find.byType(InkWell),
      );
      final List<Rect> rects = List<Rect>.generate(
        rows.evaluate().length,
        (int index) => tester.getRect(rows.at(index)),
      );

      expect(rects, hasLength(sell.destinations.length));
      for (final Rect rect in rects) {
        expect(rect.height, greaterThanOrEqualTo(48));
      }
      for (int i = 0; i < rects.length; i += 1) {
        for (int j = i + 1; j < rects.length; j += 1) {
          expect(rects[i].overlaps(rects[j]), isFalse);
        }
      }
    });

    testWidgets('a row reports the destination it names', (tester) async {
      await setViewport(tester, kPhoneViewport);

      final MobileHub sell =
          kMobileHubs.firstWhere((MobileHub hub) => hub.id == MobileHubId.sell);
      final List<String> chosen = <String>[];

      await tester.pumpWidget(
        pumpFixture(
          HubSheet(
            hub: sell,
            location: AppRoutes.sell,
            onDestination: (HubDestination destination) =>
                chosen.add(destination.path),
          ),
        ),
      );

      await tester.tap(find.text('Offers'));
      await tester.pump();

      expect(chosen, <String>[AppRoutes.offers]);
    });
  });

  group('Property 20: the top chrome names every control it draws', () {
    testWidgets('the back affordance and each action carry an action label',
        (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await setViewport(tester, kPhoneViewport);

      await tester.pumpWidget(
        pumpFixture(
          MobileChrome(
            title: 'Charizard',
            onBack: () {},
            actions: <ChromeAction>[
              ChromeAction(
                icon: Icons.favorite_border_rounded,
                semanticLabel: 'Save this listing',
                onPressed: () {},
              ),
              ChromeAction(
                icon: Icons.share_outlined,
                semanticLabel: 'Share this listing',
                onPressed: () {},
              ),
            ],
          ),
        ),
      );

      final List<String> labels = actionableSemanticsNodes(tester)
          .map((SemanticsNode node) => node.getSemanticsData().label)
          .toList();

      // Three glyph-only controls, each naming what it does rather than what it
      // looks like. The title is reading text and carries no action.
      expect(labels, <String>['Go back', 'Save this listing', 'Share this listing']);

      handle.dispose();
    });

    testWidgets('the compact form contributes no reachable node', (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await setViewport(tester, kPhoneViewport);

      await tester.pumpWidget(pumpFixture(const MobileChrome(compact: true)));

      expect(actionableSemanticsNodes(tester), isEmpty);

      handle.dispose();
    });
  });
}
