import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:cardtrade/core/extensions.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/providers/profile_provider.dart';
import 'package:cardtrade/widgets/common/avatar.dart';
import 'package:cardtrade/widgets/common/empty_state.dart';
import 'package:cardtrade/widgets/common/error_view.dart';
import 'package:cardtrade/widgets/common/verified_badge.dart';

/// Public-facing seller profile screen.
///
/// Shows the user's avatar, name, verified badge, rating, member since,
/// region, active listings, and reviews. Read-only for other users.
class SellerProfileScreen extends ConsumerWidget {
  const SellerProfileScreen({
    required this.userId,
    super.key,
  });

  /// The ID of the user whose profile to display.
  final String userId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profileAsync = ref.watch(publicProfileProvider(userId));
    final reviewsAsync = ref.watch(reviewsProvider(userId));
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Seller')),
      body: profileAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => ErrorView(
          message: error.toString(),
          onRetry: () => ref.invalidate(publicProfileProvider(userId)),
        ),
        data: (profile) {
          if (profile == null) {
            return const Center(child: Text('User not found.'));
          }

          return SingleChildScrollView(
            padding: const EdgeInsets.all(AppTheme.spacingLg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // ─── Profile Header ────────────────────────────────
                Center(
                  child: Column(
                    children: [
                      Avatar(
                        imageUrl: profile.avatarPath,
                        displayName: profile.displayName,
                        size: AvatarSize.xl,
                        showVerifiedBadge: profile.isVerified,
                      ),
                      const SizedBox(height: AppTheme.spacingMd),
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(
                            profile.displayName,
                            style: theme.textTheme.headlineMedium,
                          ),
                          if (profile.isVerified) ...[
                            const SizedBox(width: AppTheme.spacingSm),
                            const VerifiedBadge(),
                          ],
                        ],
                      ),
                      if (profile.regionCode != null) ...[
                        const SizedBox(height: AppTheme.spacingXs),
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(
                              Icons.location_on_outlined,
                              size: 14,
                              color: AppTheme.secondary,
                            ),
                            const SizedBox(width: 4),
                            Text(
                              profile.regionCode!.toUpperCase(),
                              style: theme.textTheme.bodySmall,
                            ),
                          ],
                        ),
                      ],
                      if (profile.rating != null) ...[
                        const SizedBox(height: AppTheme.spacingSm),
                        Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            ...List.generate(5, (i) {
                              return Icon(
                                i < profile.rating!.round()
                                    ? Icons.star_rounded
                                    : Icons.star_border_rounded,
                                size: 18,
                                color: AppTheme.warning,
                              );
                            }),
                            const SizedBox(width: AppTheme.spacingXs),
                            Text(
                              '${profile.rating!.toStringAsFixed(1)} (${profile.ratingCount})',
                              style: theme.textTheme.bodySmall,
                            ),
                          ],
                        ),
                      ],
                    ],
                  ),
                ),

                const SizedBox(height: AppTheme.spacingXxl),

                // ─── Active Listings ───────────────────────────────
                Text(
                  'Active Listings',
                  style: theme.textTheme.headlineSmall,
                ),
                const SizedBox(height: AppTheme.spacingMd),

                // Placeholder: in a real app, use sellerListingsProvider(userId)
                const EmptyState(
                  icon: Icons.storefront_outlined,
                  title: 'No active listings',
                  subtitle: 'This seller has no items listed right now.',
                ),

                const SizedBox(height: AppTheme.spacingXxl),

                // ─── Reviews ───────────────────────────────────────
                Text(
                  'Reviews',
                  style: theme.textTheme.headlineSmall,
                ),
                const SizedBox(height: AppTheme.spacingMd),

                reviewsAsync.when(
                  loading: () =>
                      const Center(child: CircularProgressIndicator()),
                  error: (error, _) => Text(
                    'Failed to load reviews.',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: AppTheme.danger,
                    ),
                  ),
                  data: (reviews) {
                    if (reviews.isEmpty) {
                      return const EmptyState(
                        icon: Icons.rate_review_outlined,
                        title: 'No reviews yet',
                      );
                    }

                    return Column(
                      children: reviews.map((review) {
                        return Card(
                          margin: const EdgeInsets.only(
                            bottom: AppTheme.spacingMd,
                          ),
                          child: Padding(
                            padding:
                                const EdgeInsets.all(AppTheme.spacingLg),
                            child: Column(
                              crossAxisAlignment:
                                  CrossAxisAlignment.start,
                              children: [
                                Row(
                                  children: [
                                    Avatar(
                                      imageUrl:
                                          review.reviewerAvatarPath,
                                      displayName:
                                          review.reviewerDisplayName,
                                      size: AvatarSize.sm,
                                    ),
                                    const SizedBox(
                                        width: AppTheme.spacingSm),
                                    Expanded(
                                      child: Column(
                                        crossAxisAlignment:
                                            CrossAxisAlignment.start,
                                        children: [
                                          Text(
                                            review.reviewerDisplayName ??
                                                'Anonymous',
                                            style: theme
                                                .textTheme.bodyMedium
                                                ?.copyWith(
                                              fontWeight: FontWeight.w500,
                                            ),
                                          ),
                                          Text(
                                            review.createdAt.timeAgo,
                                            style:
                                                theme.textTheme.labelSmall,
                                          ),
                                        ],
                                      ),
                                    ),
                                    // Star rating
                                    Row(
                                      mainAxisSize: MainAxisSize.min,
                                      children: List.generate(5, (i) {
                                        return Icon(
                                          i < review.rating
                                              ? Icons.star_rounded
                                              : Icons
                                                  .star_border_rounded,
                                          size: 14,
                                          color: AppTheme.warning,
                                        );
                                      }),
                                    ),
                                  ],
                                ),
                                if (review.comment != null &&
                                    review.comment!.isNotEmpty) ...[
                                  const SizedBox(
                                      height: AppTheme.spacingSm),
                                  Text(
                                    review.comment!,
                                    style: theme.textTheme.bodyMedium
                                        ?.copyWith(
                                      color: AppTheme.secondary,
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ),
                        );
                      }).toList(),
                    );
                  },
                ),
              ],
            ),
          );
        },
      ),
    );
  }
}
