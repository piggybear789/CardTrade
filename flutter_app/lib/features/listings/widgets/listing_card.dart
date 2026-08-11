import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:cardtrade/core/image_url.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:cardtrade/core/money.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/models/item.dart';
import 'package:cardtrade/providers/watchlist_provider.dart';
import 'package:cardtrade/widgets/common/verified_badge.dart';

/// Compact card for the masonry catalog grid — Xianyu-inspired.
///
/// Displays an item image, price, title, seller info, and condition.
/// Tapping navigates to the listing detail screen.
class ListingCard extends ConsumerStatefulWidget {
  const ListingCard({
    required this.item,
    super.key,
  });

  final ItemSummary item;

  @override
  ConsumerState<ListingCard> createState() => _ListingCardState();
}

class _ListingCardState extends ConsumerState<ListingCard>
    with SingleTickerProviderStateMixin {
  late AnimationController _scaleController;
  late Animation<double> _scaleAnimation;

  @override
  void initState() {
    super.initState();
    _scaleController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 100),
    );
    _scaleAnimation = Tween<double>(begin: 1.0, end: 0.97).animate(
      CurvedAnimation(parent: _scaleController, curve: Curves.easeInOut),
    );
  }

  @override
  void dispose() {
    _scaleController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    final isShopfront = item.listingKind == ListingKind.shopfront;
    final imageUrl = item.imagePaths.isNotEmpty
        ? ImageUrl.itemImage(item.imagePaths.first, size: ImageSize.small)
        : null;

    return Semantics(
      button: true,
      label: '${item.title}, ${Money.format(item.fmvCents, item.currency)}',
      child: AnimatedBuilder(
        animation: _scaleAnimation,
        builder: (context, child) => Transform.scale(
          scale: _scaleAnimation.value,
          child: child,
        ),
        child: GestureDetector(
          onTapDown: (_) => _scaleController.forward(),
          onTapUp: (_) {
            _scaleController.reverse();
            context.push('/listings/${item.id}');
          },
          onTapCancel: () => _scaleController.reverse(),
        child: Container(
          decoration: BoxDecoration(
            color: AppTheme.surface,
            borderRadius: BorderRadius.circular(AppTheme.radiusLg),
            boxShadow: AppTheme.shadowSm,
          ),
          clipBehavior: Clip.antiAlias,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ─── Image ─────────────────────────────────────────────
              Stack(
                children: [
                  AspectRatio(
                    aspectRatio: 3 / 4,
                    child: ClipRRect(
                      borderRadius: const BorderRadius.vertical(
                        top: Radius.circular(AppTheme.radiusLg),
                      ),
                      child: imageUrl != null
                          ? CachedNetworkImage(
                              imageUrl: imageUrl,
                              fit: BoxFit.cover,
                              placeholder: (_, __) => Container(
                                color: AppTheme.surfaceVariant,
                                child: const Center(
                                  child: Icon(
                                    Icons.image_outlined,
                                    color: AppTheme.muted,
                                  ),
                                ),
                              ),
                              errorWidget: (_, __, ___) => Container(
                                color: AppTheme.surfaceVariant,
                                child: const Center(
                                  child: Icon(
                                    Icons.broken_image_outlined,
                                    color: AppTheme.muted,
                                  ),
                                ),
                              ),
                            )
                          : Container(
                              color: AppTheme.surfaceVariant,
                              child: const Center(
                                child: Icon(
                                  Icons.image_outlined,
                                  color: AppTheme.muted,
                                  size: 32,
                                ),
                              ),
                            ),
                    ),
                  ),
                  // Sold/Reserved overlay
                  if (item.status != ItemStatus.available)
                    Positioned.fill(
                      child: Container(
                        decoration: BoxDecoration(
                          color: Colors.black.withValues(alpha: 0.45),
                          borderRadius: const BorderRadius.vertical(
                            top: Radius.circular(AppTheme.radiusLg),
                          ),
                        ),
                        child: Center(
                          child: Text(
                            item.status == ItemStatus.sold
                                ? 'SOLD'
                                : 'RESERVED',
                            style: AppTheme.badgeText.copyWith(
                              color: Colors.white,
                              fontWeight: FontWeight.w700,
                              letterSpacing: 0.5,
                            ),
                          ),
                        ),
                      ),
                    ),
                  // Heart overlay
                  Positioned(
                    top: AppTheme.spacingSm,
                    right: AppTheme.spacingSm,
                    child: _WatchlistHeart(itemId: item.id),
                  ),
                  // Shopfront indicator
                  if (isShopfront)
                    Positioned(
                      top: AppTheme.spacingSm,
                      left: AppTheme.spacingSm,
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                          horizontal: 6,
                          vertical: 3,
                        ),
                        decoration: BoxDecoration(
                          color: AppTheme.primary.withValues(alpha: 0.75),
                          borderRadius:
                              BorderRadius.circular(AppTheme.radiusSm),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(
                              Icons.library_books_rounded,
                              size: 12,
                              color: Colors.white,
                            ),
                            const SizedBox(width: 3),
                            Text(
                              'Binder',
                              style: AppTheme.badgeText.copyWith(
                                color: Colors.white,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                ],
              ),

              // ─── Content ───────────────────────────────────────────
              Padding(
                padding: const EdgeInsets.fromLTRB(6, 6, 6, 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    // Title
                    Text(
                      item.title,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppTheme.cardTitle,
                    ),
                    const SizedBox(height: 2),

                    // Price
                    Text(
                      isShopfront
                          ? 'From ${Money.format(item.fmvCents, item.currency)}'
                          : Money.format(item.fmvCents, item.currency),
                      style: AppTheme.priceCard,
                    ),
                    const SizedBox(height: 2),

                    // Seller row
                    Row(
                      children: [
                        // Tiny avatar
                        CircleAvatar(
                          radius: 8,
                          backgroundColor: AppTheme.surfaceVariant,
                          backgroundImage: item.ownerAvatarPath != null
                              ? CachedNetworkImageProvider(
                                  ImageUrl.avatar(item.ownerAvatarPath))
                              : null,
                          child: item.ownerAvatarPath == null
                              ? const Icon(
                                  Icons.person,
                                  size: 9,
                                  color: AppTheme.muted,
                                )
                              : null,
                        ),
                        const SizedBox(width: AppTheme.spacingXs),
                        Flexible(
                          child: Text(
                            item.ownerDisplayName ?? 'Seller',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppTheme.metaText,
                          ),
                        ),
                        if (item.sellerIdentityVerified) ...[
                          const SizedBox(width: 2),
                          const VerifiedBadge(size: VerifiedBadgeSize.small),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),

                    // Location
                    if (item.locationLabel != null)
                      Text(
                        item.locationLabel!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: AppTheme.metaText,
                      ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
      ),
    );
  }
}

/// Heart icon overlay for watchlist toggle with optimistic UI.
class _WatchlistHeart extends ConsumerStatefulWidget {
  const _WatchlistHeart({required this.itemId});

  final String itemId;

  @override
  ConsumerState<_WatchlistHeart> createState() => _WatchlistHeartState();
}

class _WatchlistHeartState extends ConsumerState<_WatchlistHeart> {
  bool? _optimisticWatching;

  Future<void> _toggle(bool currentlyWatching) async {
    final newValue = !currentlyWatching;
    setState(() => _optimisticWatching = newValue);

    try {
      final service = ref.read(watchlistServiceProvider);
      if (newValue) {
        await service.addToWatchlist(widget.itemId);
      } else {
        await service.removeFromWatchlist(widget.itemId);
      }
      ref.invalidate(isWatchingProvider(widget.itemId));
      ref.invalidate(savedItemsProvider);
    } catch (e) {
      // Revert on failure
      if (mounted) {
        setState(() => _optimisticWatching = currentlyWatching);
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Could not update watchlist'),
            duration: Duration(seconds: 2),
          ),
        );
      }
    } finally {
      if (mounted) {
        // Clear optimistic state once provider has refreshed
        setState(() => _optimisticWatching = null);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final isWatching = ref.watch(isWatchingProvider(widget.itemId));
    final watching = _optimisticWatching ?? (isWatching.value ?? false);

    return Semantics(
      button: true,
      label: watching ? 'Remove from watchlist' : 'Add to watchlist',
      child: SizedBox(
        width: 48,
        height: 48,
        child: Material(
          type: MaterialType.transparency,
          child: InkWell(
            customBorder: const CircleBorder(),
            onTap: () => _toggle(isWatching.value ?? false),
            child: Container(
              decoration: BoxDecoration(
                color: AppTheme.surface.withValues(alpha: 0.9),
                shape: BoxShape.circle,
                boxShadow: AppTheme.shadowSm,
              ),
              child: Icon(
                watching
                    ? Icons.favorite_rounded
                    : Icons.favorite_border_rounded,
                size: 18,
                color: watching ? AppTheme.danger : AppTheme.secondary,
              ),
            ),
          ),
        ),
      ),
    );
  }
}
