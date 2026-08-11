import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_staggered_grid_view/flutter_staggered_grid_view.dart';
import 'package:go_router/go_router.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/providers/watchlist_provider.dart';
import 'package:cardtrade/widgets/common/empty_state.dart';
import 'package:cardtrade/widgets/common/error_view.dart';
import '../../listings/widgets/listing_card.dart';

/// Saved/watchlisted items screen.
///
/// Displays saved listings in the same masonry grid card style as the
/// catalog. Supports pull-to-refresh and shows an empty state with a
/// 'Browse listings' action when the watchlist is empty.
class SavedScreen extends ConsumerWidget {
  const SavedScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final savedAsync = ref.watch(savedItemsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Saved'),
      ),
      body: savedAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => ErrorView(
          message: error.toString(),
          onRetry: () => ref.invalidate(savedItemsProvider),
        ),
        data: (items) {
          if (items.isEmpty) {
            return EmptyState(
              icon: Icons.favorite_border_rounded,
              title: 'Save listings to find them later',
              subtitle:
                  'Tap the heart on any listing to add it to your saved items.',
              actionLabel: 'Browse listings',
              onAction: () => context.go('/home'),
            );
          }

          return RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(savedItemsProvider);
            },
            child: CustomScrollView(
              physics: const AlwaysScrollableScrollPhysics(),
              slivers: [
                SliverPadding(
                  padding: const EdgeInsets.all(AppTheme.spacingLg),
                  sliver: SliverMasonryGrid.count(
                    crossAxisCount: 2,
                    mainAxisSpacing: AppTheme.spacingMd,
                    crossAxisSpacing: AppTheme.spacingMd,
                    childCount: items.length,
                    itemBuilder: (context, index) {
                      return ListingCard(item: items[index]);
                    },
                  ),
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}
