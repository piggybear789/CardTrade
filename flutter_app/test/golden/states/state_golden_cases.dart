// The list-state golden CASES — the catalog, the contracts list and the inbox in
// each of the states Req 11.7 names — staged ahead of the harness that captures them.
//
// THIS FILE STILL HOLDS NO `matchesGoldenFile` CALL, for the reason recorded at the
// head of `test/golden/shell/shell_golden_cases.dart`: a case declares a surface, the
// state it is in and the fixtures behind it, and says nothing about pixels.
// `state_golden_test.dart` walks this list through the harness and owns the references
// in `goldens/`; `state_cases_test.dart` builds every case and asserts both its layout
// and its content, which runs on every host unlike the comparison. The references were
// captured only after `test/golden/_harness/` existed to pin the designated host, the
// typeface, the device pixel ratio, the clock, the text-scale cap and the animations —
// an image taken before that would have to be re-baselined for a reason that is not a
// design change (Req 15.12).
//
// THE SKELETON PHASE IS DECLARED, NOT INCIDENTAL. Req 11.7 requires each state to be
// captured "at a fixed point in the skeleton's pulse cycle". Two controls give that:
// reduce-motion holds the pulse at full opacity (Req 11.2), and the surface is pumped
// to `kSkeletonPhase` — just past `SkeletonGate.suppressBelow` — so the placeholder is
// on screen at a stated instant rather than at whichever one the frame landed on. A
// capture inside the suppression window would be a picture of an empty box, which is
// correct behaviour and a useless reference image.
//
// FILTERED-TO-EMPTY EXISTS FOR THE CATALOG ALONE, DELIBERATELY. Req 11.9 governs a
// list that came back empty WITH a filter or search term active, and the catalog is
// the only one of the three that has either. Giving the contracts list or the inbox a
// filter surface would be a new capability rather than a presentation of an existing
// one (Req 14.12), and staging a golden for a state a screen cannot enter would be a
// reference image of a fiction. `state_cases_test.dart` asserts this split rather
// than leaving it as an omission a reader has to notice.
//
// THE TWO FAILURES ARE SEPARATE CASES because they are separate messages. An offline
// read says the device is not connected and keeps its retry live; a fault says
// nothing has changed. One golden for both would let the pair collapse into the
// generic apology that Req 11.10 exists to prevent.
//
// EVERY CASE IS FIXTURE-BUILT (Req 15.11): each screen is pumped over the provider
// overrides in `test/support/state_fixtures.dart`, so nothing here reads Supabase and
// nothing here can change because the database did.
//
// Requirements 11.1–11.4, 11.7, 11.9, 11.10, 13.13, 15.10, 15.11.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart' show Override;

import 'package:cardtrade/features/listings/screens/catalog_screen.dart';
import 'package:cardtrade/features/messages/screens/conversations_screen.dart';
import 'package:cardtrade/features/trades/screens/trades_list_screen.dart';

import '../../support/state_fixtures.dart';

/// The phone surface every state golden is captured on.
const Size kStateGoldenSurface = Size(390, 844);

/// The three surfaces Req 11.7 names.
enum StateSurface {
  /// The browse catalog — the only one of the three with a filter surface.
  catalog,

  /// The member's trades: one of the two contract lists.
  contracts,

  /// Every conversation, most recent first.
  inbox,
}

/// One golden case: a surface, the state it is in, and the fixtures behind it.
@immutable
class StateGoldenCase {
  const StateGoldenCase({
    required this.surfaceKind,
    required this.state,
    required this.build,
    required this.overrides,
    this.surface = kStateGoldenSurface,
    this.textScales = const <double>[1.0, 2.0],
  });

  final StateSurface surfaceKind;
  final ListStateKind state;

  /// The screen under test, built fresh per scale. Each brings its own `Scaffold`.
  final Widget Function() build;

  /// The fixture providers the case is built over.
  final List<Override> overrides;

  final Size surface;

  /// Req 13.13 pairs every state with a 2.0 twin at the same surface size.
  final List<double> textScales;

  /// File-name stem, derived from the pair rather than typed, so a case cannot be
  /// named for a state it is not in. The harness appends the scale, so this becomes
  /// `catalog_loading@1.0x.png` and `…@2.0x.png`.
  String get name => '${surfaceKind.name}_${_stateStem(state)}';

  /// Whether the capture has a placeholder on screen, and so depends on the clock
  /// having passed the skeleton's suppression window.
  bool get pumpsSkeleton => state == ListStateKind.loading;

  static String _stateStem(ListStateKind state) => switch (state) {
        ListStateKind.loading => 'loading',
        ListStateKind.empty => 'empty',
        ListStateKind.filteredEmpty => 'filtered_empty',
        ListStateKind.error => 'error',
        ListStateKind.offline => 'offline',
      };
}

/// The states each surface can actually be in.
///
/// Four for the two lists with no filter surface, five for the catalog.
const List<ListStateKind> kUnfilteredStates = <ListStateKind>[
  ListStateKind.loading,
  ListStateKind.empty,
  ListStateKind.error,
  ListStateKind.offline,
];

const List<ListStateKind> kCatalogStates = <ListStateKind>[
  ListStateKind.loading,
  ListStateKind.empty,
  ListStateKind.filteredEmpty,
  ListStateKind.error,
  ListStateKind.offline,
];

/// Every catalog state, including the filtered-to-empty one.
final List<StateGoldenCase> kCatalogGoldenCases = <StateGoldenCase>[
  for (final ListStateKind state in kCatalogStates)
    StateGoldenCase(
      surfaceKind: StateSurface.catalog,
      state: state,
      build: () => const CatalogScreen(),
      overrides: catalogStateOverrides(state),
    ),
];

/// Every contracts-list state.
final List<StateGoldenCase> kContractsGoldenCases = <StateGoldenCase>[
  for (final ListStateKind state in kUnfilteredStates)
    StateGoldenCase(
      surfaceKind: StateSurface.contracts,
      state: state,
      build: () => const TradesListScreen(),
      overrides: contractsStateOverrides(state),
    ),
];

/// Every inbox state.
final List<StateGoldenCase> kInboxGoldenCases = <StateGoldenCase>[
  for (final ListStateKind state in kUnfilteredStates)
    StateGoldenCase(
      surfaceKind: StateSurface.inbox,
      state: state,
      build: () => const ConversationsScreen(),
      overrides: inboxStateOverrides(state),
    ),
];

/// Every list-state golden case, one surface at a time.
final List<StateGoldenCase> kStateGoldenCases = <StateGoldenCase>[
  ...kCatalogGoldenCases,
  ...kContractsGoldenCases,
  ...kInboxGoldenCases,
];
