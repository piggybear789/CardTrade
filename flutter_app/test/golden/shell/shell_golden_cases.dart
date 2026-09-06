// The Mobile_Shell golden CASES: the eight states Req 4.14 names, declared once and
// read by two files.
//
// THIS FILE STILL HOLDS NO `matchesGoldenFile` CALL, AND THAT SPLIT IS DELIBERATE.
// A case is a name, a surface, the scales it is captured at and the tree to capture;
// it says nothing about pixels. `shell_golden_test.dart` walks this list through the
// harness and owns the references in `goldens/`, and `shell_cases_test.dart` pumps
// every case at every declared scale and asserts it lays out — which runs on every
// host, unlike the comparison. So a case that overflows is caught as a layout defect
// rather than committed as a picture of one.
//
// The references were captured only after `test/golden/_harness/` existed to pin the
// designated host, the typeface, the device pixel ratio, the clock, the text-scale
// cap and the animations. An image taken before that would have to be re-baselined
// for a reason that is not a design change, which is the one thing Req 15.12 forbids.
//
// Requirements 4.14, 13.13, 15.10, 15.11.

import 'package:flutter/material.dart';

import 'package:cardtrade/router/hub_set.dart';
import 'package:cardtrade/widgets/common/bottom_nav_shell.dart';

/// The phone surface every shell golden is captured on.
const Size kShellGoldenSurface = Size(390, 844);

/// A phone's bottom safe-area inset, so the captured bar shows the Req 4.8 split
/// between the 56 and the inset below it.
const double kShellGoldenBottomInset = 34;

/// One golden case: a name, a surface, the text scales it is captured at, and the
/// tree to capture.
@immutable
class ShellGoldenCase {
  const ShellGoldenCase({
    required this.name,
    required this.build,
    this.surface = kShellGoldenSurface,
    this.textScales = const <double>[1.0, 2.0],
  });

  /// File-name stem. The harness appends the scale, so `shell_guest` becomes
  /// `shell_guest@1.0x.png` and `shell_guest@2.0x.png`.
  ///
  /// Retired vocabulary is forbidden in a golden name as much as in an identifier,
  /// which is why these are named for the Hub_Set entry and never for a `Deal`.
  final String name;

  /// The tree under test. A plain builder rather than a pumped widget so each case
  /// is built fresh per scale.
  final Widget Function() build;

  final Size surface;

  /// Req 13.13 pairs every state with a 2.0 twin at the same surface size. Every
  /// shell case pairs, because every case draws labels that reflow.
  final List<double> textScales;
}

Widget _bar({
  MobileHubId? currentHubId,
  bool isAuthenticated = true,
  int? unreadMessageCount,
}) {
  return Builder(
    builder: (BuildContext context) => MediaQuery(
      data: MediaQuery.of(context).copyWith(
        viewPadding: const EdgeInsets.only(bottom: kShellGoldenBottomInset),
        padding: const EdgeInsets.only(bottom: kShellGoldenBottomInset),
      ),
      child: Align(
        alignment: Alignment.bottomCenter,
        child: MobileShellBar(
          currentHubId: currentHubId,
          isAuthenticated: isAuthenticated,
          unreadMessageCount: unreadMessageCount,
          onSelected: (_) {},
        ),
      ),
    ),
  );
}

/// The eight states Req 4.14 requires: one per Hub_Set entry current, one with
/// none current, one for a guest, and one with the badge at its capped form.
///
/// Derived from `kMobileHubs` rather than written out, so a sixth destination
/// arrives with its golden case instead of without one.
final List<ShellGoldenCase> kShellGoldenCases = <ShellGoldenCase>[
  for (final MobileHub hub in kMobileHubs)
    ShellGoldenCase(
      name: 'shell_current_${hub.id.name}',
      build: () => _bar(currentHubId: hub.id),
    ),
  // Req 4.16: a route no entry owns leaves all five in the not-current treatment,
  // rather than marking the first one.
  ShellGoldenCase(
    name: 'shell_current_none',
    build: () => _bar(currentHubId: null),
  ),
  // Req 4.11: all five, in the same order, enabled — the guest case differs from
  // the signed-in one only in the semantics, which is exactly why it also needs a
  // widget test and cannot rest on the image.
  ShellGoldenCase(
    name: 'shell_guest',
    build: () => _bar(isAuthenticated: false, currentHubId: MobileHubId.browse),
  ),
  // Req 4.13: the capped form. 1000 rather than 100, so a change that dropped the
  // cap produces a visibly different width instead of one extra glyph.
  ShellGoldenCase(
    name: 'shell_badge_capped',
    build: () => _bar(currentHubId: MobileHubId.browse, unreadMessageCount: 1000),
  ),
];
