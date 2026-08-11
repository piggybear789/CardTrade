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
import 'package:cardtrade/widgets/common/error_view.dart';
import 'package:cardtrade/widgets/common/shimmer_loading.dart';
import 'package:cardtrade/widgets/common/status_badge.dart';

/// Screen displaying the current user's listings.
///
/// Provides a simple list with image, title, price, and status badge per item.
/// Tap navigates to the listing detail. Pull-to-refresh supported.
class MyListingsScreen extends ConsumerWidget {
  const MyListingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final listingsAsync = ref.watch(myListingsProvider);

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
      body: listingsAsync.when(
        loading: () => ListView.builder(
          itemCount: 6,
          padding: const EdgeInsets.all(AppTheme.spacingLg),
          itemBuilder: (_, __) => const Padding(
            padding: EdgeInsets.only(bottom: AppTheme.spacingMd),
            child: ShimmerListTile(),
          ),
        ),
        error: (error, _) => ErrorView(
          message: error.toString(),
          onRetry: () => ref.invalidate(myListingsProvider),
        ),
        data: (listings) {
          if (listings.isEmpty) {
            return EmptyState(
              icon: Icons.storefront_outlined,
              title: 'No listings yet',
              subtitle: 'Create your first listing to start selling or trading.',
              actionLabel: 'Create your first listing',
              onAction: () => context.push('/listings/new'),
            );
          }

          return RefreshIndicator(
            onRefresh: () async => ref.invalidate(myListingsProvider),
            child: ListView.separated(
              padding: const EdgeInsets.all(AppTheme.spacingLg),
              itemCount: listings.length,
              separatorBuilder: (_, __) =>
                  const SizedBox(height: AppTheme.spacingMd),
              itemBuilder: (context, index) {
                return _MyListingTile(item: listings[index]);
              },
            ),
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
        padding: const EdgeInsets.all(AppTheme.spacingMd),
        decoration: BoxDecoration(
          color: AppTheme.surface,
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
                        placeholder: (_, __) => Container(
                          color: AppTheme.surfaceVariant,
                        ),
                        errorWidget: (_, __, ___) => Container(
                          color: AppTheme.surfaceVariant,
                          child: const Icon(Icons.image_outlined,
                              color: AppTheme.muted),
                        ),
                      )
                    : Container(
                        color: AppTheme.surfaceVariant,
                        child: const Icon(Icons.image_outlined,
                            color: AppTheme.muted),
                      ),
              ),
            ),
            const SizedBox(width: AppTheme.spacingMd),

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
                  const SizedBox(height: AppTheme.spacingXs),

                  // Price
                  Text(
                    isShopfront
                        ? 'From ${Money.format(item.fmvCents, item.currency)}'
                        : Money.format(item.fmvCents, item.currency),
                    style: theme.textTheme.bodySmall?.copyWith(
                      fontWeight: FontWeight.w600,
                      color: AppTheme.primary,
                    ),
                  ),
                  const SizedBox(height: AppTheme.spacingXs),

                  // Status + Kind
                  Row(
                    children: [
                      _statusBadge(item.status),
                      if (isShopfront) ...[
                        const SizedBox(width: AppTheme.spacingSm),
                        const StatusBadge(
                          label: 'Binder',
                          variant: StatusBadgeVariant.neutral,
                        ),
                      ],
                      if (item.closedAt != null) ...[
                        const SizedBox(width: AppTheme.spacingSm),
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
              color: AppTheme.muted,
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
