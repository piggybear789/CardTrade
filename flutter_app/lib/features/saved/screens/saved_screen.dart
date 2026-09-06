// The watchlist — saved listings, in the catalog's own mosaic.
//
// The four states come from `AsyncStateView`, so this screen states its
// placeholder, its rows and the member-facing name of its request and nothing
// else. What that buys it, which it did not have: a placeholder shaped like the
// tiles it stands in for rather than a centred spinner, an explanation naming the
// request that failed rather than `error.toString()`, a pull that ignores a second
// pull while the first is in flight, and saved tiles that stay on screen when a
// refresh fails offline.
//
// Requirements 11.1, 11.3–11.6, 11.8, 11.10.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_staggered_grid_view/flutter_staggered_grid_view.dart';
import 'package:go_router/go_router.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/models/item.dart';
import 'package:cardtrade/providers/watchlist_provider.dart';
import 'package:cardtrade/widgets/common/empty_state.dart';
import 'package:cardtrade/widgets/common/load_state.dart';
import 'package:cardtrade/widgets/common/skeleton.dart';
import '../../listings/widgets/listing_card.dart';

/// Saved/watchlisted items screen.
class SavedScreen extends ConsumerWidget {
  const SavedScreen({super.key});

  /// Columns in the mosaic. The catalog's, so a tile is the same tile.
  static const int _columns = 2;

  /// Placeholder tiles drawn while the first read runs.
  static const int _skeletonTiles = 4;

  /// What a failure or a failed refresh calls this request, in member terms.
  static const String _operation = 'your saved listings';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: const Text('Saved')),
      body: AsyncStateView<List<ItemSummary>>(
        value: ref.watch(savedItemsProvider),
        operation: _operation,
        onRetry: () async {
          ref.invalidate(savedItemsProvider);
          await ref.read(savedItemsProvider.future);
        },
        loadingAnnouncement: 'Loading your saved listings',
        skeleton: (_) => _mosaic(
          childCount: _skeletonTiles,
          itemBuilder: (_, _) => const SkeletonListingCard(),
        ),
        builder: (context, items) {
          if (items.isEmpty) {
            return PullableFill(
              child: EmptyState(
                icon: Icons.favorite_border_rounded,
                title: 'Save listings to find them later',
                subtitle:
                    'Tap the heart on any listing to add it to your saved items.',
                actionLabel: 'Browse listings',
                onAction: () => context.go('/home'),
              ),
            );
          }

          return _mosaic(
            childCount: items.length,
            itemBuilder: (context, index) => ListingCard(item: items[index]),
          );
        },
      ),
    );
  }

  /// One grid for both the placeholder and the rows, so replacing one with the
  /// other changes the tiles and not the geometry (Req 11.1).
  static Widget _mosaic({
    required int childCount,
    required Widget Function(BuildContext, int) itemBuilder,
  }) {
    return CustomScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      slivers: <Widget>[
        SliverPadding(
          padding: const EdgeInsets.all(AppSpacing.cozy),
          sliver: SliverMasonryGrid.count(
            crossAxisCount: _columns,
            mainAxisSpacing: AppSpacing.snug,
            crossAxisSpacing: AppSpacing.snug,
            childCount: childCount,
            itemBuilder: itemBuilder,
          ),
        ),
      ],
    );
  }
}
