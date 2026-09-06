import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:cardtrade/core/money.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/models/item.dart';
import 'package:cardtrade/providers/listings_provider.dart';
import 'package:cardtrade/widgets/common/empty_state.dart';
import 'package:cardtrade/widgets/common/load_state.dart';
import 'package:cardtrade/widgets/common/skeleton.dart';
import 'package:cardtrade/widgets/common/status_badge.dart';

/// Screen displaying the current user's listings.
///
/// Provides a simple list with image, title, price, and status badge per item.
/// Tap navigates to the listing detail. The four states — placeholder, rows,
/// empty and failure — come from [AsyncStateView], which is also what makes the
/// pull ignore a second pull and keeps the rows on screen when a refresh fails
/// (Req 11.1, 11.3–11.6, 11.8, 11.10).
class MyListingsScreen extends ConsumerWidget {
  const MyListingsScreen({super.key});

  /// Placeholder rows drawn while the first read runs.
  static const int _skeletonRows = 6;

  /// What a failure or a failed refresh calls this request, in member terms.
  static const String _operation = 'your listings';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('My Listings'),
        actions: [
          IconButton(
            icon: const Icon(Icons.add_rounded),
            tooltip: 'Create listing',
            onPressed: () => context.push('/listings/new'),
          ),
        ],
      ),
      body: AsyncStateView<List<Item>>(
        value: ref.watch(myListingsProvider),
        operation: _operation,
        onRetry: () async {
          ref.invalidate(myListingsProvider);
          await ref.read(myListingsProvider.future);
        },
        loadingAnnouncement: 'Loading your listings',
        skeleton: (_) => ListView.separated(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(AppSpacing.cozy),
          itemCount: _skeletonRows,
          separatorBuilder: (_, _) => const SizedBox(height: AppSpacing.snug),
          itemBuilder: (_, _) => const SkeletonListTile(),
        ),
        builder: (context, listings) {
          if (listings.isEmpty) {
            return PullableFill(
              child: EmptyState(
                icon: Icons.storefront_outlined,
                title: 'No listings yet',
                subtitle:
                    'Create your first listing to start selling or trading.',
                actionLabel: 'Create your first listing',
                onAction: () => context.push('/listings/new'),
              ),
            );
          }

          return ListView.separated(
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(AppSpacing.cozy),
            itemCount: listings.length,
            separatorBuilder: (_, _) => const SizedBox(height: AppSpacing.snug),
            itemBuilder: (context, index) =>
                _MyListingTile(item: listings[index]),
          );
        },
      ),
    );
  }
}

/// A single listing tile in the "My Listings" list.
class _MyListingTile extends StatelessWidget {
  const _MyListingTile({required this.item});

  final Item item;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final imageUrl = item.primaryImage;
    final isShopfront = item.isShopfront;

    return InkWell(
      onTap: () => context.push('/listings/${item.id}'),
      borderRadius: BorderRadius.circular(AppTheme.radiusLg),
      child: Container(
        padding: const EdgeInsets.all(AppSpacing.snug),
        decoration: BoxDecoration(
          color: AppColors.card,
          borderRadius: BorderRadius.circular(AppTheme.radiusLg),
          border: Border.all(color: AppTheme.border),
        ),
        child: Row(
          children: [
            // Image
            ClipRRect(
              borderRadius: BorderRadius.circular(AppTheme.radiusMd),
              child: SizedBox(
                width: 64,
                height: 64,
                child: imageUrl != null
                    ? CachedNetworkImage(
                        imageUrl: imageUrl,
                        fit: BoxFit.cover,
                        placeholder: (_, _) => Container(
                          color: AppColors.muted,
                        ),
                        errorWidget: (_, _, _) => Container(
                          color: AppColors.muted,
                          child: const Icon(Icons.image_outlined,
                              color: AppColors.mutedForeground),
                        ),
                      )
                    : Container(
                        color: AppColors.muted,
                        child: const Icon(Icons.image_outlined,
                            color: AppColors.mutedForeground),
                      ),
              ),
            ),
            const SizedBox(width: AppSpacing.snug),

            // Content
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Title
                  Text(
                    item.title,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: theme.textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.snug),

                  // Price
                  Text(
                    isShopfront
                        ? 'From ${Money.format(item.fmvCents, item.currency)}'
                        : Money.format(item.fmvCents, item.currency),
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: AppColors.irisInk,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.snug),

                  // Status + Kind
                  Row(
                    children: [
                      _statusBadge(item.status),
                      if (isShopfront) ...[
                        const SizedBox(width: AppSpacing.tight),
                        const StatusBadge(
                          label: 'Binder',
                          variant: StatusBadgeVariant.neutral,
                        ),
                      ],
                      if (item.closedAt != null) ...[
                        const SizedBox(width: AppSpacing.tight),
                        const StatusBadge.error('Closed'),
                      ],
                    ],
                  ),
                ],
              ),
            ),

            // Chevron
            const Icon(
              Icons.chevron_right_rounded,
              color: AppColors.mutedForeground,
            ),
          ],
        ),
      ),
    );
  }

  Widget _statusBadge(ItemStatus status) {
    return switch (status) {
      ItemStatus.available => const StatusBadge.active('Available'),
      ItemStatus.reserved => const StatusBadge.pending('Reserved'),
      ItemStatus.sold => const StatusBadge.completed('Sold'),
    };
  }
}
