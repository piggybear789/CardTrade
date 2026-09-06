// Another member's public profile: who they are, how they have been rated, and
// what they have said about each other.
//
// TOKENS ONLY, AND NO NEW READ. The rating marks are `--action-border`, the same
// amber edge the pastel action carries, rather than the retired `warning` alias; the
// review rows are the shared card and avatar; the ages go through
// `core/relative_time.dart`. Nothing about which listings this member has is
// invented — the listings region was, and remains, a placeholder, because a seller
// listings read is a capability `.kiro/specs/mobile-parity/` owns.
//
// THE BADGE IS THE GATE'S ANSWER. `satisfiesIdentityGate` over the row the server
// returned, never a second predicate (Req 14.11, 14.12).
//
// Requirements 10.1, 13.6–13.12, 14.5, 14.12.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:cardtrade/core/relative_time.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/domain/identity/identity_gate.dart';
import 'package:cardtrade/models/profile.dart';
import 'package:cardtrade/models/review.dart';
import 'package:cardtrade/providers/profile_provider.dart';
import 'package:cardtrade/widgets/common/app_scaffold.dart';
import 'package:cardtrade/widgets/common/avatar.dart';
import 'package:cardtrade/widgets/common/empty_state.dart';
import 'package:cardtrade/widgets/common/error_view.dart';
import 'package:cardtrade/widgets/common/skeleton.dart';
import 'package:cardtrade/widgets/common/verified_badge.dart';

/// A public, read-only member profile.
class SellerProfileScreen extends ConsumerWidget {
  const SellerProfileScreen({required this.userId, super.key});

  /// Whose profile to present.
  final String userId;

  /// The rating marks: the amber edge the pastel action carries.
  static const Color ratingMark = AppColors.actionBorder;

  /// How many marks a rating is out of.
  static const int ratingScale = 5;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final AsyncValue<PublicProfile?> profileAsync =
        ref.watch(publicProfileProvider(userId));
    final AsyncValue<List<Review>> reviewsAsync =
        ref.watch(reviewsProvider(userId));

    return AppScaffold(
      title: 'Seller',
      onBack: () => Navigator.of(context).maybePop(),
      body: profileAsync.when(
        loading: () => const SkeletonRegion(
          announcement: 'Loading this seller',
          child: Padding(
            padding: EdgeInsets.all(AppSpacing.group),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                SkeletonTextLines(level: AppText.rowName, widths: [0.5]),
                SizedBox(height: AppSpacing.snug),
                SkeletonTextLines(
                  level: AppText.supportText,
                  widths: [1.0, 0.8],
                ),
              ],
            ),
          ),
        ),
        error: (Object error, _) => ErrorView(
          title: 'We could not load this seller',
          message: 'This member’s profile did not load. Please try again.',
          onRetry: () => ref.invalidate(publicProfileProvider(userId)),
        ),
        data: (PublicProfile? profile) {
          if (profile == null) {
            return const EmptyState(
              icon: Icons.person_off_outlined,
              title: 'Member not found',
              subtitle: 'This account is no longer on the marketplace.',
            );
          }

          final bool verified =
              satisfiesIdentityGate(profile.identityCheckStatus);

          return ListView(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.group,
              AppSpacing.snug,
              AppSpacing.group,
              AppSpacing.section,
            ),
            children: <Widget>[
              Center(
                child: Column(
                  children: <Widget>[
                    Avatar(
                      imageUrl: profile.avatarPath,
                      displayName: profile.displayName,
                      size: AvatarSize.xl,
                      showVerifiedBadge: verified,
                    ),
                    const SizedBox(height: AppSpacing.snug),
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      spacing: AppSpacing.snug,
                      children: <Widget>[
                        Text(
                          profile.displayName,
                          style: AppType.subhead.copyWith(
                            fontWeight: FontWeight.w600,
                            color: AppColors.foreground,
                          ),
                        ),
                        if (verified) const VerifiedBadge(),
                      ],
                    ),
                    if (profile.regionCode != null) ...<Widget>[
                      const SizedBox(height: AppSpacing.tight),
                      Row(
                        mainAxisSize: MainAxisSize.min,
                        spacing: AppSpacing.tight,
                        children: <Widget>[
                          const ExcludeSemantics(
                            child: Icon(
                              Icons.location_on_outlined,
                              size: AppIconSize.button,
                              color: AppColors.mutedForeground,
                            ),
                          ),
                          Text(
                            profile.regionCode!.toUpperCase(),
                            style: AppText.metaText,
                          ),
                        ],
                      ),
                    ],
                    if (profile.rating != null) ...<Widget>[
                      const SizedBox(height: AppSpacing.snug),
                      _RatingRow(
                        rating: profile.rating!,
                        count: profile.ratingCount,
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.section),

              const Text('Reviews', style: AppText.sectionLabel),
              const SizedBox(height: AppSpacing.snug),
              reviewsAsync.when(
                loading: () => const SkeletonRegion(
                  announcement: 'Loading reviews',
                  child: Column(
                    children: <Widget>[
                      SkeletonListTile(),
                      SkeletonListTile(),
                    ],
                  ),
                ),
                error: (Object error, _) => const Text(
                  'Reviews did not load.',
                  style: AppText.supportText,
                ),
                data: (List<Review> reviews) {
                  if (reviews.isEmpty) {
                    return const EmptyState(
                      icon: Icons.rate_review_outlined,
                      title: 'No reviews yet',
                      subtitle:
                          'Reviews appear here once a contract with this member '
                          'completes.',
                    );
                  }
                  return Column(
                    children: <Widget>[
                      for (final Review review in reviews)
                        Padding(
                          padding: const EdgeInsets.only(bottom: AppSpacing.cozy),
                          child: _ReviewCard(review: review),
                        ),
                    ],
                  );
                },
              ),
            ],
          );
        },
      ),
    );
  }
}

/// A rating as marks, its figure and its count.
class _RatingRow extends StatelessWidget {
  const _RatingRow({required this.rating, required this.count});

  final double rating;
  final int count;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      excludeSemantics: true,
      label: '${rating.toStringAsFixed(1)} out of '
          '${SellerProfileScreen.ratingScale}, from $count reviews',
      child: Row(
        mainAxisSize: MainAxisSize.min,
        spacing: AppSpacing.tight,
        children: <Widget>[
          for (int i = 0; i < SellerProfileScreen.ratingScale; i++)
            Icon(
              i < rating.round() ? Icons.star_rounded : Icons.star_border_rounded,
              size: AppIconSize.base,
              color: SellerProfileScreen.ratingMark,
            ),
          Text(
            '${rating.toStringAsFixed(1)} ($count)',
            style: AppText.metaText,
          ),
        ],
      ),
    );
  }
}

/// One review: who left it, when, at what rating, and what they said.
class _ReviewCard extends StatelessWidget {
  const _ReviewCard({required this.review});

  final Review review;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.cozy),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              spacing: AppSpacing.snug,
              children: <Widget>[
                Avatar(
                  imageUrl: review.reviewerAvatarPath,
                  displayName: review.reviewerDisplayName,
                  size: AvatarSize.sm,
                ),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Text(
                        review.reviewerDisplayName ?? 'Anonymous',
                        style: AppText.rowName,
                      ),
                      Text(
                        relativeTimeLabel(review.createdAt),
                        style: AppText.metaText,
                      ),
                    ],
                  ),
                ),
                Semantics(
                  container: true,
                  excludeSemantics: true,
                  label: '${review.rating} out of '
                      '${SellerProfileScreen.ratingScale}',
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: <Widget>[
                      for (int i = 0;
                          i < SellerProfileScreen.ratingScale;
                          i++)
                        Icon(
                          i < review.rating
                              ? Icons.star_rounded
                              : Icons.star_border_rounded,
                          size: AppIconSize.button,
                          color: SellerProfileScreen.ratingMark,
                        ),
                    ],
                  ),
                ),
              ],
            ),
            if (review.comment != null && review.comment!.isNotEmpty) ...<Widget>[
              const SizedBox(height: AppSpacing.snug),
              Text(review.comment!, style: AppText.supportText, softWrap: true),
            ],
          ],
        ),
      ),
    );
  }
}
