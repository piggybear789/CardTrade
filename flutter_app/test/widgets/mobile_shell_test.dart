// Feature: mobile-visual-parity — Properties 15 and 19, over the app shell.
//
// Property 15: a piecewise threshold function respects its boundaries. Here that
// is the Inbox badge: nothing at zero and while unresolved, the number itself from
// 1 to 99, and `99+` above it (Req 4.13).
//
// Property 19: every hit area contains its control and touches no other. The
// design names the top chrome as the case this catches — at the web's 6 logical
// pixel gap two 40dp controls sit 46 apart and their 48dp rectangles overlap, so
// the port uses the `snug` step and the rectangles touch without intersecting.
//
// Geometry is MEASURED rather than eyeballed against a golden. A golden proves an
// image did not move; it cannot say that the bar is 56 tall, that the safe-area
// inset sits below that 56 rather than inside it, or that two touch rectangles are
// disjoint.
//
// Validates: Requirements 4.2, 4.4, 4.8, 4.13, 4.16, 13.6, 13.10.

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/router/hub_set.dart';
import 'package:cardtrade/widgets/common/bottom_nav_shell.dart';
import 'package:cardtrade/widgets/common/mobile_chrome.dart';
import 'package:cardtrade/widgets/common/tap_target.dart';

import '../support/harness.dart';

/// A phone's bottom inset, so the Req 4.8 arithmetic has something to add.
const double kBottomInset = 34;

/// A phone's status-bar inset, so the Req 4.2 arithmetic has something to add.
const double kTopInset = 47;

Widget _withInsets(Widget child, {double top = 0, double bottom = 0}) {
  return Builder(
    builder: (BuildContext context) => MediaQuery(
      data: MediaQuery.of(context).copyWith(
        viewPadding: EdgeInsets.only(top: top, bottom: bottom),
        padding: EdgeInsets.only(top: top, bottom: bottom),
      ),
      child: child,
    ),
  );
}

Widget _bar({
  MobileHubId? currentHubId,
  bool isAuthenticated = true,
  int? unreadMessageCount,
  ValueChanged<MobileHub>? onSelected,
  double bottomInset = 0,
}) {
  return _withInsets(
    Align(
      alignment: Alignment.bottomCenter,
      child: MobileShellBar(
        currentHubId: currentHubId,
        isAuthenticated: isAuthenticated,
        unreadMessageCount: unreadMessageCount,
        onSelected: onSelected ?? (_) {},
      ),
    ),
    bottom: bottomInset,
  );
}

/// The five destination hit areas, left to right.
List<Rect> _hubRects(WidgetTester tester) {
  final Finder buttons = find.descendant(
    of: find.byType(MobileShellBar),
    matching: find.byType(InkWell),
  );
  return List<Rect>.generate(
    buttons.evaluate().length,
    (int index) => tester.getRect(buttons.at(index)),
  )..sort((Rect a, Rect b) => a.left.compareTo(b.left));
}

List<RenderTapTarget> _targets(WidgetTester tester) =>
    tester.renderObjectList<RenderTapTarget>(find.byType(TapTarget)).toList();

void _expectDisjoint(List<Rect> rects) {
  for (int i = 0; i < rects.length; i += 1) {
    for (int j = i + 1; j < rects.length; j += 1) {
      expect(
        rects[i].overlaps(rects[j]),
        isFalse,
        reason: '${rects[i]} and ${rects[j]} share interior area',
      );
    }
  }
}

void main() {
  group('Req 4.8: the bar is 56 tall and the inset sits below it', () {
    // MEASURED WIDE, DELIBERATELY. `flutter test` renders with a stand-in font
    // whose every glyph is a square of the font size, so at a phone's 78 logical
    // pixels per destination the nine characters of `Contracts` want 108 and wrap
    // onto a second line — the bar then correctly grows to 58, which is Req 13.10
    // working rather than Req 4.8 failing. Plus Jakarta Sans at the `meta` level
    // needs about 57 for that label, so the real bar is 56.
    //
    // The 56 is therefore measured on a viewport wide enough that the stand-in
    // font's labels fit on one line, and the phone-width case below asserts the
    // floor and the reflow instead. The exact measurement at 390 arrives with the
    // golden harness's `loadAppFonts()` (task 11.1, Req 12.5).
    const Size wideEnoughForTestFontLabels = Size(600, 844);

    testWidgets('measures exactly 56 with no safe-area inset', (tester) async {
      await setViewport(tester, wideEnoughForTestFontLabels);
      await tester.pumpWidget(pumpFixture(_bar()));

      expectNoTruncatedText(tester, context: 'shell bar');
      expect(
        tester.getSize(find.byType(MobileShellBar)).height,
        closeTo(AppMetrics.navBar, 1),
      );
    });

    testWidgets('adds the inset below the 56 rather than swallowing it',
        (tester) async {
      await setViewport(tester, wideEnoughForTestFontLabels);
      await tester.pumpWidget(pumpFixture(_bar(bottomInset: kBottomInset)));

      // A bar that counted the inset inside itself would still measure 56 here and
      // stand 34 logical pixels shorter than the web's on a notched phone, so both
      // the whole and the destination row are measured.
      expect(
        tester.getSize(find.byType(MobileShellBar)).height,
        closeTo(AppMetrics.navBar + kBottomInset, 1),
      );
      for (final Rect rect in _hubRects(tester)) {
        expect(rect.height, closeTo(AppMetrics.navBar, 1));
      }
    });

    testWidgets('at phone width it holds the floor and reflows rather than clips',
        (tester) async {
      await setViewport(tester, kPhoneViewport);
      await tester.pumpWidget(pumpFixture(_bar()));

      expectNoLayoutOverflow(tester);
      expectNoTruncatedText(tester, context: 'shell bar at phone width');
      expect(
        tester.getSize(find.byType(MobileShellBar)).height,
        greaterThanOrEqualTo(AppMetrics.navBar),
      );
    });

    testWidgets('grows rather than clips a label at a 2.0 text scale',
        (tester) async {
      await setViewport(tester, kPhoneViewport);
      await tester.pumpWidget(pumpFixture(_bar(), textScaleFactor: 2.0));

      expectNoLayoutOverflow(tester);
      expectNoTruncatedText(tester, context: 'shell bar at 2.0');
      expect(
        tester.getSize(find.byType(MobileShellBar)).height,
        greaterThan(AppMetrics.navBar),
      );
    });
  });

  group('Property 19: the five destinations are disjoint 48dp targets', () {
    testWidgets('each destination is at least 48 on both axes', (tester) async {
      await setViewport(tester, kPhoneViewport);
      await tester.pumpWidget(pumpFixture(_bar(bottomInset: kBottomInset)));

      final List<Rect> rects = _hubRects(tester);
      expect(rects, hasLength(kMobileHubs.length));
      for (final Rect rect in rects) {
        expect(rect.width, greaterThanOrEqualTo(AppMetrics.minHitArea));
        expect(rect.height, greaterThanOrEqualTo(AppMetrics.minHitArea));
      }
      _expectDisjoint(rects);
    });

    testWidgets('they stay disjoint on the narrowest supported viewport',
        (tester) async {
      await setViewport(tester, kNarrowViewport);
      await tester.pumpWidget(pumpFixture(_bar()));

      // 320 / 5 = 64, still clear of 48. The assertion exists because a sixth
      // destination would break it and that is worth failing on.
      _expectDisjoint(_hubRects(tester));
      for (final Rect rect in _hubRects(tester)) {
        expect(rect.width, greaterThanOrEqualTo(AppMetrics.minHitArea));
      }
    });
  });

  group('Property 15: the Inbox badge respects its boundaries', () {
    // One case per band and one on each side of every boundary the requirement
    // draws. `null` and `0` are distinct inputs that must look the same.
    const Map<String, int?> unresolvedOrEmpty = <String, int?>{
      'unresolved': null,
      'zero': 0,
    };

    testWidgets('shows nothing while unresolved or empty', (tester) async {
      await setViewport(tester, kPhoneViewport);

      for (final MapEntry<String, int?> entry in unresolvedOrEmpty.entries) {
        await tester.pumpWidget(pumpFixture(_bar(unreadMessageCount: entry.value)));
        // Nothing that reads as a count, and specifically not a `0`.
        expect(find.text('0'), findsNothing, reason: entry.key);
        expect(
          find.textContaining(RegExp(r'^\d+\+?$')),
          findsNothing,
          reason: entry.key,
        );
      }
    });

    testWidgets('renders 1 to 99 as the number and above 99 as 99+',
        (tester) async {
      await setViewport(tester, kPhoneViewport);

      const Map<int, String> bands = <int, String>{
        1: '1',
        2: '2',
        98: '98',
        99: '99',
        100: '99+',
        101: '99+',
        4321: '99+',
      };

      for (final MapEntry<int, String> band in bands.entries) {
        await tester.pumpWidget(pumpFixture(_bar(unreadMessageCount: band.key)));
        expect(find.text(band.value), findsOneWidget, reason: '${band.key}');
        expectNoLayoutOverflow(tester);
        expectNoTruncatedText(tester, context: 'badge ${band.key}');
      }
    });

    testWidgets('the badge belongs to Inbox and to no other destination',
        (tester) async {
      await setViewport(tester, kPhoneViewport);
      await tester.pumpWidget(pumpFixture(_bar(unreadMessageCount: 7)));

      // Sourced from the unread MESSAGE count, so it must sit on the destination a
      // member taps expecting unread mail (Req 4.13).
      final Rect badge = tester.getRect(find.text('7'));
      final int inboxIndex =
          kMobileHubs.indexWhere((MobileHub hub) => hub.id == MobileHubId.inbox);
      final List<Rect> rects = _hubRects(tester);

      expect(rects[inboxIndex].overlaps(badge), isTrue);
      for (int index = 0; index < rects.length; index += 1) {
        if (index == inboxIndex) continue;
        expect(rects[index].overlaps(badge), isFalse, reason: 'index $index');
      }
    });

    testWidgets('a capped badge does not cover the glyph it belongs to',
        (tester) async {
      await setViewport(tester, kPhoneViewport);
      await tester.pumpWidget(pumpFixture(_bar(unreadMessageCount: 1000)));

      final Rect badge = tester.getRect(find.text('99+'));
      final Rect glyph = tester.getRect(
        find.descendant(
          of: find.byType(MobileShellBar),
          matching: find.byIcon(kMobileHubs
              .firstWhere((MobileHub hub) => hub.id == MobileHubId.inbox)
              .icon),
        ),
      );

      expect(
        badge.overlaps(glyph),
        isFalse,
        reason: 'the count must rise off the glyph, not sit on top of it',
      );
    });
  });

  group('Req 4.16: an unowned route marks no destination current', () {
    testWidgets('null current leaves every destination in the muted treatment',
        (tester) async {
      await setViewport(tester, kPhoneViewport);
      await tester.pumpWidget(pumpFixture(_bar(currentHubId: null)));

      // Colour, read off the laid-out glyphs, because "marks nothing current" is a
      // claim about what is drawn and not about which id was passed in.
      final Iterable<Icon> glyphs = tester.widgetList<Icon>(
        find.descendant(
          of: find.byType(MobileShellBar),
          matching: find.byType(Icon),
        ),
      );
      expect(glyphs, hasLength(kMobileHubs.length));
      for (final Icon glyph in glyphs) {
        expect(glyph.color, AppColors.mutedForeground);
      }
    });

    testWidgets('exactly one destination is marked for an owned route',
        (tester) async {
      await setViewport(tester, kPhoneViewport);

      for (final MobileHub hub in kMobileHubs) {
        await tester.pumpWidget(pumpFixture(_bar(currentHubId: hub.id)));

        final List<Icon> glyphs = tester
            .widgetList<Icon>(find.descendant(
              of: find.byType(MobileShellBar),
              matching: find.byType(Icon),
            ))
            .toList();
        expect(
          glyphs.where((Icon glyph) => glyph.color == AppColors.irisInk),
          hasLength(1),
          reason: '${hub.label}: weight and colour together mark exactly one',
        );

        // Weight as well as colour, so the mark survives greyscale (Req 4.9).
        final List<Text> labels = tester
            .widgetList<Text>(find.descendant(
              of: find.byType(MobileShellBar),
              matching: find.byType(Text),
            ))
            .toList();
        expect(
          labels
              .where((Text label) => label.style?.fontWeight == FontWeight.w600)
              .map((Text label) => label.data),
          <String>[hub.label],
        );
      }
    });
  });

  group('selection', () {
    testWidgets('a tap reports the destination it belongs to', (tester) async {
      await setViewport(tester, kPhoneViewport);
      final List<MobileHubId> selected = <MobileHubId>[];

      await tester.pumpWidget(
        pumpFixture(_bar(onSelected: (MobileHub hub) => selected.add(hub.id))),
      );

      for (int index = 0; index < kMobileHubs.length; index += 1) {
        await tester.tapAt(_hubRects(tester)[index].center);
        await tester.pump();
      }

      expect(selected, kMobileHubs.map((MobileHub hub) => hub.id).toList());
    });

    testWidgets('a guest sees all five, enabled, and every one reports a tap',
        (tester) async {
      await setViewport(tester, kPhoneViewport);
      final List<MobileHubId> selected = <MobileHubId>[];

      await tester.pumpWidget(
        pumpFixture(_bar(
          isAuthenticated: false,
          onSelected: (MobileHub hub) => selected.add(hub.id),
        )),
      );

      // Req 4.11: present, in the same order, enabled rather than hidden or
      // disabled. Where the tap LEADS is the shell's business, not the bar's.
      expect(_hubRects(tester), hasLength(kMobileHubs.length));
      for (int index = 0; index < kMobileHubs.length; index += 1) {
        await tester.tapAt(_hubRects(tester)[index].center);
        await tester.pump();
      }
      expect(selected, kMobileHubs.map((MobileHub hub) => hub.id).toList());
    });
  });

  group('Req 4.2, 4.4: the top chrome geometry', () {
    Widget chrome({
      double topInset = 0,
      bool compact = false,
      List<ChromeAction> actions = const <ChromeAction>[],
      String? title = 'Listing',
    }) {
      return _withInsets(
        Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            MobileChrome(
              title: title,
              compact: compact,
              onBack: () {},
              actions: actions,
            ),
          ],
        ),
        top: topInset,
      );
    }

    testWidgets('the content edge is the inset plus 54', (tester) async {
      await setViewport(tester, kPhoneViewport);

      for (final double inset in <double>[0, kTopInset]) {
        await tester.pumpWidget(pumpFixture(chrome(topInset: inset)));
        expect(
          tester.getSize(find.byType(MobileChrome)).height,
          closeTo(inset + AppMetrics.chromeContent, 1),
          reason: 'inset $inset',
        );
      }
    });

    testWidgets('the compact form is the inset alone', (tester) async {
      await setViewport(tester, kPhoneViewport);

      for (final double inset in <double>[0, kTopInset]) {
        await tester.pumpWidget(
          pumpFixture(chrome(topInset: inset, compact: true)),
        );
        expect(
          tester.getSize(find.byType(MobileChrome)).height,
          closeTo(inset, 1),
          reason: 'inset $inset',
        );
      }
    });

    testWidgets('two actions plus the back affordance keep disjoint targets',
        (tester) async {
      await setViewport(tester, kPhoneViewport);
      await tester.pumpWidget(
        pumpFixture(chrome(
          topInset: kTopInset,
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
        )),
      );

      final List<RenderTapTarget> targets = _targets(tester);
      expect(targets, hasLength(3));
      for (final RenderTapTarget target in targets) {
        // 40 drawn, 48 touched: the hit area may not be reached by inflating what
        // the control draws, or the row exceeds `min-h-10` and the 54 moves.
        expect(target.drawnRect.height, closeTo(AppMetrics.controlHeight, 1));
        expect(target.targetRect.width, greaterThanOrEqualTo(AppMetrics.minHitArea));
        expect(target.targetRect.height, greaterThanOrEqualTo(AppMetrics.minHitArea));
      }

      // The whole reason the port uses `snug` rather than the web's 6: at 6 the
      // two trailing controls sit 46 apart, centre to centre, and these
      // rectangles would overlap by 2.
      _expectDisjoint(
        targets.map((RenderTapTarget target) => target.globalTargetRect).toList(),
      );

      // And the divergence bought no height: the content edge is still 54.
      expect(
        tester.getSize(find.byType(MobileChrome)).height,
        closeTo(kTopInset + AppMetrics.chromeContent, 1),
      );
    });

    testWidgets('a long title reflows rather than being cut', (tester) async {
      await setViewport(tester, kNarrowViewport);
      await tester.pumpWidget(
        pumpFixture(
          chrome(title: 'Charizard 1999 Base Set Holo, graded PSA 9'),
          textScaleFactor: 2.0,
        ),
      );

      expectNoLayoutOverflow(tester);
      expectNoTruncatedText(tester, context: 'chrome title at 2.0');
    });
  });
}
