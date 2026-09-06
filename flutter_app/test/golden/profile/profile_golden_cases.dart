// The profile golden CASES — the four gate combinations and the hub with its counts
// still loading — staged ahead of the harness that captures them.
//
// THIS FILE STILL HOLDS NO `matchesGoldenFile` CALL, for the reason recorded at the
// head of `test/golden/shell/shell_golden_cases.dart`: a case declares a name, a
// surface, the scales it is captured at and the tree to capture, and says nothing about
// pixels. `profile_golden_test.dart` walks this list through the harness and owns the
// references in `goldens/`; `profile_cases_test.dart` builds every case at every
// declared scale and asserts it lays out, which runs on every host unlike the
// comparison. The references were captured only after `test/golden/_harness/` existed
// to pin the designated host, the typeface, the device pixel ratio, the clock, the
// text-scale cap and the animations — an image taken before that would have to be
// re-baselined for a reason that is not a design change (Req 15.12).
//
// THE SPLIT BETWEEN SECTION AND SCREEN IS REQ 10.9'S OWN. The criterion asks for one
// golden per combination of the two STEPS — which is the verification section — and
// one golden of the PROFILE SCREEN with its counts still loading. So the four
// combinations are captured at the section, where the marks are the whole subject,
// and the loading-count case is captured at the screen, where the count row is.
//
// EVERY CASE IS BUILT FROM A PROFILE'S COLUMNS (Req 15.11). The section is handed the
// two answers the screen's own ports produced from `identity_check_status` and the
// merchant trio, so a case cannot pass by being told what to draw.
//
// THE COUNTS-LOADING CASE HAS A DECLARED PHASE. Its three count reads never settle,
// so the hub is pumped just past `SkeletonGate.suppressBelow` and held there by
// reduce-motion — a stated instant rather than whenever the frame landed (Req 15.11).
//
// Requirements 10.3, 10.9, 13.13, 15.10, 15.11.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart' show Override;

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/domain/identity/identity_gate.dart' as gate;
import 'package:cardtrade/features/profile/screens/my_profile_screen.dart';
import 'package:cardtrade/features/profile/widgets/profile_sections.dart';
import 'package:cardtrade/features/profile/widgets/verification_section.dart';
import 'package:cardtrade/models/profile.dart';

import '../../support/state_fixtures.dart';

/// The phone surface every profile golden is captured on.
const Size kProfileGoldenSurface = Size(390, 844);

/// One golden case: a name, a surface, the text scales it is captured at, the tree
/// to capture, and the fixture providers it is captured over.
@immutable
class ProfileGoldenCase {
  const ProfileGoldenCase({
    required this.name,
    required this.build,
    this.overrides = const <Override>[],
    this.surface = kProfileGoldenSurface,
    this.textScales = const <double>[1.0, 2.0],
    this.ownsScaffold = false,
    this.pumpsSkeleton = false,
  });

  /// File-name stem. The harness appends the scale, so `verification_both_passed`
  /// becomes `verification_both_passed@1.0x.png` and `…@2.0x.png`.
  final String name;

  /// The tree under test, built fresh per scale.
  final Widget Function() build;

  /// The fixture providers the case is built over.
  final List<Override> overrides;

  final Size surface;

  /// Req 13.13 pairs every state with a 2.0 twin at the same surface size.
  final List<double> textScales;

  /// Whether [build] brings its own `Scaffold` — a whole screen does.
  final bool ownsScaffold;

  /// Whether the capture contains a placeholder, and so depends on the clock being
  /// advanced past the skeleton's suppression window before the frame is taken.
  final bool pumpsSkeleton;
}

/// The section as the Account hub renders it, inside its own titled region.
Widget _section({required bool identityPassed, required bool payoutPassed}) {
  // Built through the ports, not from the two flags: the hub reads
  // `satisfiesIdentityGate` and `canReceiveFunds` and this stage does the same, so
  // the reference image is a picture of what those two answered.
  final Profile profile = makeAccountProfile(
    identityPassed: identityPassed,
    payoutPassed: payoutPassed,
  );

  // SCROLLABLE, because the hub is. At a 2.0 text scale a pending step's two
  // explanations and two controls are taller than a phone viewport, and on the real
  // screen the section sits inside the hub's `ListView` — so staging it in a fixed
  // column would report an overflow the hub does not have. The capture is then the
  // top of the region at a declared surface, which is what a reference image of a
  // region longer than the screen can be.
  return SingleChildScrollView(
    padding: const EdgeInsets.all(AppSpacing.group),
    child: Align(
      alignment: Alignment.topCenter,
      child: ProfileSection(
        title: 'Verification',
        child: VerificationSection(
          identityPassed:
              gate.satisfiesIdentityGate(profile.identityCheckStatus),
          payoutPassed: gate.canReceiveFunds(
            merchantStatus: profile.merchantStatus,
            merchantSettlementsEnabled: profile.merchantSettlementsEnabled,
            merchantRef: profile.merchantRef,
          ),
          onIdentityDetail: () {},
          onPayoutDetail: () {},
        ),
      ),
    ),
  );
}

ProfileGoldenCase _combination(
  String name, {
  required bool identityPassed,
  required bool payoutPassed,
}) {
  return ProfileGoldenCase(
    name: name,
    build: () => _section(
      identityPassed: identityPassed,
      payoutPassed: payoutPassed,
    ),
  );
}

/// The four combinations Req 10.3 names, each its own state.
final List<ProfileGoldenCase> kVerificationGoldenCases = <ProfileGoldenCase>[
  _combination(
    'verification_neither_passed',
    identityPassed: false,
    payoutPassed: false,
  ),
  _combination(
    'verification_identity_passed',
    identityPassed: true,
    payoutPassed: false,
  ),
  // The combination most easily drawn as a fault, and the reason the four are
  // captured separately rather than as a before-and-after pair.
  _combination(
    'verification_payout_passed',
    identityPassed: false,
    payoutPassed: true,
  ),
  _combination(
    'verification_both_passed',
    identityPassed: true,
    payoutPassed: true,
  ),
];

/// The hub with its three counts still outstanding — the last state Req 10.9 names.
final List<ProfileGoldenCase> kAccountGoldenCases = <ProfileGoldenCase>[
  ProfileGoldenCase(
    name: 'account_counts_loading',
    build: () => const MyProfileScreen(),
    ownsScaffold: true,
    pumpsSkeleton: true,
    overrides: accountOverrides(
      profile: makeAccountProfile(identityPassed: true),
      countsLoading: true,
    ),
  ),
];

/// Every profile golden case: the four combinations, then the loading hub.
final List<ProfileGoldenCase> kProfileGoldenCases = <ProfileGoldenCase>[
  ...kVerificationGoldenCases,
  ...kAccountGoldenCases,
];
