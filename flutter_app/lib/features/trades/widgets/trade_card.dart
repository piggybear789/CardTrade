import 'package:flutter/material.dart';

import 'package:cardtrade/core/extensions.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/models/trade.dart';
import 'package:cardtrade/widgets/common/avatar.dart';
import 'package:cardtrade/widgets/common/status_badge.dart';

/// A card showing a trade summary for the trades list.
///
/// Displays two small item images with a swap icon between them,
/// the trade state badge, counterpart avatar + name, and the
/// relative timestamp of the last update.
class TradeCard extends StatelessWidget {
  const TradeCard({
    required this.trade,
    this.onTap,
    super.key,
  });

  /// The trade summary data.
  final TradeSummary trade;

  /// Tap callback (typically navigates to trade room).
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(AppTheme.spacingLg),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ─── Item images row ─────────────────────────────────────
              Row(
                children: [
                  _ItemThumbnail(imagePath: trade.initiatorItemImage),
                  const SizedBox(width: AppTheme.spacingSm),
                  const Icon(
                    Icons.swap_horiz_rounded,
                    size: 20,
                    color: AppTheme.muted,
                  ),
                  const SizedBox(width: AppTheme.spacingSm),
                  _ItemThumbnail(imagePath: trade.counterpartItemImage),
                  const Spacer(),
                  _buildStateBadge(trade.state),
                ],
              ),
              const SizedBox(height: AppTheme.spacingMd),

              // ─── Item titles ─────────────────────────────────────────
              Text(
                '${trade.initiatorItemTitle ?? 'Your item'} ↔ ${trade.counterpartItemTitle ?? 'Their item'}',
                style: theme.textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w500,
                ),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
              const SizedBox(height: AppTheme.spacingSm),

              // ─── Counterpart + timestamp ─────────────────────────────
              Row(
                children: [
                  Avatar(
                    imageUrl: trade.counterpartAvatarPath,
                    displayName: trade.counterpartDisplayName,
                    size: AvatarSize.xs,
                  ),
                  const SizedBox(width: AppTheme.spacingSm),
                  Expanded(
                    child: Text(
                      trade.counterpartDisplayName ?? 'Unknown',
                      style: theme.textTheme.bodySmall,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  Text(
                    trade.updatedAt.timeAgo,
                    style: theme.textTheme.labelSmall,
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  StatusBadge _buildStateBadge(TradeState state) {
    final label = enumToString(state).enumLabel;
    return switch (state) {
      TradeState.completed => StatusBadge.completed(label),
      TradeState.collateralLocked ||
      TradeState.inTransit ||
      TradeState.inspection =>
        StatusBadge.active(label),
      TradeState.negotiating || TradeState.collateralPending =>
        StatusBadge.pending(label),
      TradeState.disputed ||
      TradeState.fraudResolved ||
      TradeState.cancelled =>
        StatusBadge.error(label),
    };
  }
}

/// Small square thumbnail for item images.
class _ItemThumbnail extends StatelessWidget {
  const _ItemThumbnail({this.imagePath});

  final String? imagePath;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 48,
      height: 48,
      decoration: BoxDecoration(
        color: AppTheme.surfaceVariant,
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
        border: Border.all(color: AppTheme.border),
      ),
      clipBehavior: Clip.antiAlias,
      child: imagePath != null
          ? Image.network(
              imagePath!,
              fit: BoxFit.cover,
              errorBuilder: (_, _, _) => _placeholder(),
            )
          : _placeholder(),
    );
  }

  Widget _placeholder() {
    return const Center(
      child: Icon(
        Icons.image_outlined,
        size: 20,
        color: AppTheme.muted,
      ),
    );
  }
}
