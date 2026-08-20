import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:share_plus/share_plus.dart';
import 'package:smooth_page_indicator/smooth_page_indicator.dart';

import 'package:cardtrade/core/image_url.dart';
import 'package:cardtrade/core/money.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/models/item.dart';
import 'package:cardtrade/providers/listings_provider.dart';
import 'package:cardtrade/providers/offers_provider.dart';
import 'package:cardtrade/providers/watchlist_provider.dart';
import 'package:cardtrade/widgets/common/error_view.dart';
import 'package:cardtrade/widgets/common/fullscreen_image_viewer.dart';
import 'package:cardtrade/widgets/common/loading_indicator.dart';
import 'package:cardtrade/widgets/common/verified_badge.dart';

/// Detail screen for a single listing — Xianyu-style mobile marketplace layout.
///
/// Displays image carousel, seller row, price block, metadata, description,
/// details section, and a sticky bottom action bar with buy/chat/offer CTAs.
class ListingDetailScreen extends ConsumerWidget {
  const ListingDetailScreen({
    required this.itemId,
    super.key,
  });

  final String itemId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final itemAsync = ref.watch(itemDetailProvider(itemId));

    return itemAsync.when(
      loading: () => const Scaffold(
        body: Center(child: LoadingIndicator()),
      ),
      error: (error, _) => Scaffold(
        appBar: AppBar(),
        body: ErrorView(
          message: error.toString(),
          onRetry: () => ref.invalidate(itemDetailProvider(itemId)),
        ),
      ),
      data: (item) {
        if (item == null) {
          return Scaffold(
            appBar: AppBar(),
            body: const ErrorView(
              title: 'Listing not found',
              message: 'This listing may have been removed.',
            ),
          );
        }
        return _DetailContent(item: item);
      },
    );
  }
}

class _DetailContent extends ConsumerStatefulWidget {
  const _DetailContent({required this.item});

  final Item item;

  @override
  ConsumerState<_DetailContent> createState() => _DetailContentState();
}

class _DetailContentState extends ConsumerState<_DetailContent> {
  final PageController _pageController = PageController();
  bool _descriptionExpanded = false;

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  /// Shares this listing via the system share sheet.
  void _shareItem(Item item) {
    final url = '${const String.fromEnvironment('WEB_APP_URL', defaultValue: 'https://cardtrade.app')}/listings/${item.id}';
    SharePlus.instance.share(
      ShareParams(
        text: '${item.title} — $url',
      ),
    );
  }

  /// Shows a modal bottom sheet for reporting this listing.
  Future<void> _showReportSheet(BuildContext context, String itemId) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => _ReportSheet(itemId: itemId),
    );
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    final isShopfront = item.isShopfront;
    final isWatching = ref.watch(isWatchingProvider(item.id));

    return Scaffold(
      body: CustomScrollView(
        slivers: [
          // ─── 1. Image Carousel ──────────────────────────────────────
          SliverToBoxAdapter(
            child: _ImageCarousel(
              images: item.imagePaths,
              pageController: _pageController,
              onShare: () => _shareItem(item),
            ),
          ),

          // ─── Content ────────────────────────────────────────────────
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.symmetric(
                horizontal: AppTheme.spacingLg,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const SizedBox(height: AppTheme.spacingLg),

                  // ─── 2. Seller row ────────────────────────────────
                  _SellerRow(item: item),

                  const SizedBox(height: AppTheme.spacingXl),

                  // ─── 3. Price block ───────────────────────────────
                  _PriceBlock(item: item),

                  const SizedBox(height: AppTheme.spacingMd),

                  // ─── 4. Metadata row ──────────────────────────────
                  _MetadataRow(item: item),

                  const SizedBox(height: AppTheme.spacingXl),

                  // ─── 5. Shopfront banner ──────────────────────────
                  if (isShopfront) ...[
                    _ShopfrontBanner(),
                    const SizedBox(height: AppTheme.spacingXl),
                  ],

                  // ─── 6. Title ─────────────────────────────────────
                  Text(
                    item.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    style: Theme.of(context).textTheme.titleLarge,
                  ),

                  const SizedBox(height: AppTheme.spacingMd),

                  // ─── 7. Description ───────────────────────────────
                  _DescriptionBlock(
                    description: item.description,
                    expanded: _descriptionExpanded,
                    onToggle: () {
                      setState(
                        () => _descriptionExpanded = !_descriptionExpanded,
                      );
                    },
                  ),

                  const SizedBox(height: AppTheme.spacingXl),

                  // ─── 8. Details section ───────────────────────────
                  _DetailsSection(item: item),

                  // ─── 9. Report link ───────────────────────────────
                  const SizedBox(height: AppTheme.spacingXxl),
                  TextButton(
                    onPressed: () => _showReportSheet(context, item.id),
                    style: TextButton.styleFrom(
                      minimumSize: const Size(0, 44),
                      padding: EdgeInsets.zero,
                      foregroundColor: AppTheme.muted,
                      textStyle: AppTheme.metaText,
                    ),
                    child: const Text('Report this listing'),
                  ),

                  // Bottom safe area for action bar
                  const SizedBox(height: 80),
                ],
              ),
            ),
          ),
        ],
      ),

      // ─── Sticky Bottom Action Bar ────────────────────────────────────
      bottomNavigationBar: _BottomBar(
        item: item,
        isShopfront: isShopfront,
        isWatching: isWatching,
      ),
    );
  }
}

// ─── 2. Seller Row ────────────────────────────────────────────────────────────

class _SellerRow extends StatelessWidget {
  const _SellerRow({required this.item});

  final Item item;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'View seller profile',
      child: Material(
        type: MaterialType.transparency,
        child: InkWell(
          borderRadius: BorderRadius.circular(AppTheme.radiusMd),
          onTap: () => context.push('/sellers/${item.ownerId}'),
          child: ConstrainedBox(
            constraints: const BoxConstraints(minHeight: 44),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: AppTheme.spacingSm),
              child: Row(
                children: [
                  // Small avatar
                  const CircleAvatar(
                    radius: 14,
                    backgroundColor: AppTheme.border,
                    child: Icon(Icons.person, size: 14, color: AppTheme.muted),
                  ),
                  const SizedBox(width: AppTheme.spacingMd),

                  // Display name
                  const Text(
                    'Seller',
                    style: AppTheme.rowName,
                  ),

                  // Verified badge
                  if (item.sellerIdentityVerified) ...[
                    const SizedBox(width: AppTheme.spacingXs),
                    const VerifiedBadge(size: VerifiedBadgeSize.small),
                  ],

                  const Spacer(),

                  // Location on right
                  if (item.locationLabel != null)
                    Text(
                      item.locationLabel!,
                      style: AppTheme.metaText,
                    ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

// ─── 3. Price Block ───────────────────────────────────────────────────────────

class _PriceBlock extends StatelessWidget {
  const _PriceBlock({required this.item});

  final Item item;

  @override
  Widget build(BuildContext context) {
    final isShopfront = item.isShopfront;
    final priceText = Money.format(item.fmvCents, item.currency);

    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        // Price with optional 'from' prefix
        Expanded(
          child: Text.rich(
            TextSpan(
              children: [
                if (isShopfront)
                  TextSpan(
                    text: 'from ',
                    style: AppTheme.supportText.copyWith(color: AppTheme.gold),
                  ),
                TextSpan(
                  text: priceText,
                  style: AppTheme.priceHero,
                ),
              ],
            ),
          ),
        ),

        // Condition pill on right
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
          decoration: BoxDecoration(
            color: AppTheme.parchment,
            borderRadius: BorderRadius.circular(AppTheme.radiusFull),
          ),
          child: Text(
            item.condition,
            style: AppTheme.badgeText.copyWith(color: AppTheme.secondary),
          ),
        ),
      ],
    );
  }
}

// ─── 4. Metadata Row ──────────────────────────────────────────────────────────

class _MetadataRow extends ConsumerWidget {
  const _MetadataRow({required this.item});

  final Item item;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final watchCount = ref.watch(watchCountProvider(item.id)).value ?? 0;
    final savesLabel = watchCount == 1 ? '1 save' : '$watchCount saves';
    final kindLabel =
        item.isShopfront ? 'Binder listing' : 'Single item';
    final parts = <String>[
      savesLabel,
      item.category,
      kindLabel,
    ];

    return Text(
      parts.join(' · '),
      style: AppTheme.metaText,
    );
  }
}

// ─── 5. Shopfront Banner ──────────────────────────────────────────────────────

class _ShopfrontBanner extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: AppTheme.accentLight,
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
        border: Border.all(
          color: AppTheme.gold.withValues(alpha: 0.3),
        ),
      ),
      child: Row(
        children: [
          const Icon(
            Icons.library_books_rounded,
            size: 16,
            color: AppTheme.accent,
          ),
          const SizedBox(width: AppTheme.spacingSm),
          Expanded(
            child: Text(
              'This is a binder listing. Browse the collection and request '
              'specific items — nothing is held until you agree on terms.',
              style: AppTheme.supportText.copyWith(color: AppTheme.accentDark),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── 7. Description Block ─────────────────────────────────────────────────────

class _DescriptionBlock extends StatelessWidget {
  const _DescriptionBlock({
    required this.description,
    required this.expanded,
    required this.onToggle,
  });

  final String description;
  final bool expanded;
  final VoidCallback onToggle;

  @override
  Widget build(BuildContext context) {
    final needsExpand = description.length > 200;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Semantics(
          button: needsExpand,
          label: needsExpand
              ? (expanded ? 'Collapse description' : 'Expand description')
              : null,
          child: GestureDetector(
            onTap: needsExpand ? onToggle : null,
            child: AnimatedCrossFade(
              firstChild: ShaderMask(
                shaderCallback: (bounds) => const LinearGradient(
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                  colors: [Colors.white, Colors.white, Colors.transparent],
                  stops: [0.0, 0.7, 1.0],
                ).createShader(bounds),
                blendMode: BlendMode.dstIn,
                child: Text(
                  description,
                  maxLines: 4,
                  overflow: TextOverflow.ellipsis,
                  style: AppTheme.bodyText,
                ),
              ),
              secondChild: Text(
                description,
                style: AppTheme.bodyText,
              ),
              crossFadeState: expanded
                  ? CrossFadeState.showSecond
                  : CrossFadeState.showFirst,
              duration: const Duration(milliseconds: 200),
            ),
          ),
        ),
        if (needsExpand) ...[
          const SizedBox(height: AppTheme.spacingXs),
          TextButton(
            onPressed: onToggle,
            style: TextButton.styleFrom(
              minimumSize: const Size(0, 40),
              padding: EdgeInsets.zero,
              foregroundColor: AppTheme.accent,
              textStyle: AppTheme.supportText.copyWith(
                fontWeight: FontWeight.w500,
                color: AppTheme.accent,
              ),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  expanded ? Icons.expand_less : Icons.expand_more,
                  size: 14,
                  color: AppTheme.accent,
                ),
                const SizedBox(width: 2),
                Text(
                  expanded ? 'Show less' : 'Read more',
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

// ─── 8. Details Section ───────────────────────────────────────────────────────

class _DetailsSection extends StatelessWidget {
  const _DetailsSection({required this.item});

  final Item item;

  @override
  Widget build(BuildContext context) {
    final kindLabel =
        item.isShopfront ? 'Binder listing' : 'Single item';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _DetailLabelValue(label: 'Condition', value: item.condition),
        const SizedBox(height: AppTheme.spacingSm),
        _DetailLabelValue(label: 'Game', value: item.category),
        const SizedBox(height: AppTheme.spacingSm),
        _DetailLabelValue(label: 'Listing type', value: kindLabel),
        if (item.locationLabel != null) ...[
          const SizedBox(height: AppTheme.spacingSm),
          _DetailLabelValue(label: 'Location', value: item.locationLabel!),
        ],
      ],
    );
  }
}

class _DetailLabelValue extends StatelessWidget {
  const _DetailLabelValue({
    required this.label,
    required this.value,
  });

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(
          width: 80,
          child: Text(
            label,
            style: AppTheme.detailLabel,
          ),
        ),
        Expanded(
          child: Text(
            value,
            style: AppTheme.detailValue,
          ),
        ),
      ],
    );
  }
}

// ─── Sticky Bottom Bar ────────────────────────────────────────────────────────

class _BottomBar extends ConsumerStatefulWidget {
  const _BottomBar({
    required this.item,
    required this.isShopfront,
    required this.isWatching,
  });

  final Item item;
  final bool isShopfront;
  final AsyncValue<bool> isWatching;

  @override
  ConsumerState<_BottomBar> createState() => _BottomBarState();
}

class _BottomBarState extends ConsumerState<_BottomBar> {
  bool _isToggling = false;

  Future<void> _handleWatchlistToggle() async {
    if (_isToggling) return;
    setState(() => _isToggling = true);
    try {
      final service = ref.read(watchlistServiceProvider);
      final watching = widget.isWatching.value ?? false;
      if (watching) {
        await service.removeFromWatchlist(widget.item.id);
      } else {
        await service.addToWatchlist(widget.item.id);
      }
      ref.invalidate(isWatchingProvider(widget.item.id));
      ref.invalidate(watchCountProvider(widget.item.id));
      ref.invalidate(savedItemsProvider);
    } finally {
      if (mounted) setState(() => _isToggling = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final item = widget.item;
    final isShopfront = widget.isShopfront;
    final isWatching = widget.isWatching;

    return Container(
      padding: EdgeInsets.fromLTRB(
        AppTheme.spacingLg,
        AppTheme.spacingMd,
        AppTheme.spacingLg,
        MediaQuery.of(context).padding.bottom + AppTheme.spacingMd,
      ),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        border: const Border(
          top: BorderSide(color: AppTheme.border),
        ),
        boxShadow: AppTheme.shadowMd,
      ),
      child: Row(
        children: [
          // Chat icon button (44x44 touch target)
          SizedBox(
            width: 44,
            height: 44,
            child: IconButton(
              onPressed: () => context.push('/messages'),
              icon: const Icon(
                Icons.chat_bubble_outline,
                size: 20,
                color: AppTheme.secondary,
              ),
            ),
          ),

          // Save/star icon button (44x44 touch target)
          SizedBox(
            width: 44,
            height: 44,
            child: IconButton(
              onPressed: _handleWatchlistToggle,
              icon: Icon(
                isWatching.value == true
                    ? Icons.star_rounded
                    : Icons.star_border_rounded,
                size: 22,
                color: isWatching.value == true
                    ? AppTheme.gold
                    : AppTheme.secondary,
              ),
            ),
          ),

          const SizedBox(width: AppTheme.spacingSm),

          // Offer text button (single listings only)
          if (!isShopfront) ...[
            TextButton(
              onPressed: () => showModalBottomSheet<void>(
                context: context,
                isScrollControlled: true,
                builder: (_) => _MakeOfferSheet(item: item),
              ),
              style: TextButton.styleFrom(
                foregroundColor: AppTheme.primary,
                padding: const EdgeInsets.symmetric(horizontal: 8),
                minimumSize: const Size(0, 36),
                textStyle: AppTheme.supportText.copyWith(
                  fontWeight: FontWeight.w500,
                ),
              ),
              child: const Text('Offer'),
            ),
            const SizedBox(width: AppTheme.spacingSm),
          ],

          // Buy Now / Browse & Buy
          Expanded(
            child: OutlinedButton(
              onPressed: () => context.push('/sales/buy/${item.id}'),
              child: Text(isShopfront ? 'Browse & Buy' : 'Buy Now'),
            ),
          ),

          const SizedBox(width: AppTheme.spacingSm),

          // Chat filled button
          Expanded(
            child: FilledButton(
              onPressed: () => context.push('/messages'),
              style: FilledButton.styleFrom(
                backgroundColor: AppTheme.gold,
              ),
              child: const Text('Chat'),
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Image Carousel ───────────────────────────────────────────────────────────

/// Image carousel with PageView and smooth page indicator dots.
class _ImageCarousel extends StatelessWidget {
  const _ImageCarousel({
    required this.images,
    required this.pageController,
    this.onShare,
  });

  final List<String> images;
  final PageController pageController;
  final VoidCallback? onShare;

  @override
  Widget build(BuildContext context) {
    if (images.isEmpty) {
      return Container(
        height: 350,
        color: AppTheme.surfaceVariant,
        child: const Center(
          child: Icon(Icons.image_outlined, size: 64, color: AppTheme.muted),
        ),
      );
    }

    return Stack(
      alignment: Alignment.bottomCenter,
      children: [
        SizedBox(
          height: 350,
          child: PageView.builder(
            controller: pageController,
            itemCount: images.length,
            itemBuilder: (context, index) {
              return Semantics(
                button: true,
                label: 'View image ${index + 1} of ${images.length} fullscreen',
                child: GestureDetector(
                  onTap: () => FullscreenImageViewer.show(
                    context,
                    images,
                    initialIndex: index,
                  ),
                child: CachedNetworkImage(
                  imageUrl:
                      ImageUrl.itemImage(images[index], size: ImageSize.large),
                  fit: BoxFit.cover,
                  width: double.infinity,
                  placeholder: (_, _) => Container(
                    color: AppTheme.surfaceVariant,
                    child: const Center(child: CircularProgressIndicator()),
                  ),
                  errorWidget: (_, _, _) => Container(
                    color: AppTheme.surfaceVariant,
                    child: const Icon(Icons.broken_image_outlined,
                        size: 48, color: AppTheme.muted),
                  ),
                ),
              ),
              );
            },
          ),
        ),

        // Back button
        Positioned(
          top: MediaQuery.of(context).padding.top + AppTheme.spacingSm,
          left: AppTheme.spacingMd,
          child: Semantics(
            button: true,
            label: 'Go back',
            child: SizedBox(
              width: 48,
              height: 48,
              child: Material(
                color: AppTheme.surface.withValues(alpha: 0.9),
                shape: const CircleBorder(),
                clipBehavior: Clip.antiAlias,
                child: InkWell(
                  customBorder: const CircleBorder(),
                  onTap: () => context.pop(),
                  child: const Center(
                    child: Icon(Icons.arrow_back_rounded,
                        size: 20, color: AppTheme.primary),
                  ),
                ),
              ),
            ),
          ),
        ),

        // Share button
        Positioned(
          top: MediaQuery.of(context).padding.top + AppTheme.spacingSm,
          right: AppTheme.spacingMd,
          child: Semantics(
            button: true,
            label: 'Share this listing',
            child: SizedBox(
              width: 48,
              height: 48,
              child: Material(
                color: AppTheme.surface.withValues(alpha: 0.9),
                shape: const CircleBorder(),
                clipBehavior: Clip.antiAlias,
                child: InkWell(
                  customBorder: const CircleBorder(),
                  onTap: onShare,
                  child: const Center(
                    child: Icon(Icons.share_rounded,
                        size: 20, color: AppTheme.primary),
                  ),
                ),
              ),
            ),
          ),
        ),

        // Page indicator dots
        if (images.length > 1)
          Positioned(
            bottom: AppTheme.spacingLg,
            child: SmoothPageIndicator(
              controller: pageController,
              count: images.length,
              effect: WormEffect(
                dotHeight: 8,
                dotWidth: 8,
                spacing: 6,
                activeDotColor: AppTheme.accent,
                dotColor: AppTheme.surface.withValues(alpha: 0.6),
              ),
            ),
          ),
      ],
    );
  }
}

// ─── Report Sheet ─────────────────────────────────────────────────────────────

/// Modal bottom sheet for reporting a listing.
///
/// Collects a reason and optional details, then submits (Req: user safety).
class _ReportSheet extends StatefulWidget {
  const _ReportSheet({required this.itemId});

  final String itemId;

  @override
  State<_ReportSheet> createState() => _ReportSheetState();
}

class _ReportSheetState extends State<_ReportSheet> {
  static const _reasons = [
    'Inappropriate content',
    'Counterfeit/fake item',
    'Misleading description',
    'Scam/fraud',
    'Other',
  ];

  String? _selectedReason;
  final _detailsController = TextEditingController();
  bool _isSubmitting = false;

  @override
  void dispose() {
    _detailsController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_selectedReason == null) return;

    setState(() => _isSubmitting = true);

    // Report submission is not yet implemented — the server has no report
    // endpoint. Show an honest message rather than faking success.
    await Future<void>.delayed(const Duration(milliseconds: 300));

    if (!mounted) return;
    setState(() => _isSubmitting = false);
    Navigator.of(context).pop();
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Reporting is not yet available. Please contact support if you believe this listing violates our policies.'),
        duration: Duration(seconds: 5),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: EdgeInsets.fromLTRB(
        AppTheme.spacingLg,
        AppTheme.spacingLg,
        AppTheme.spacingLg,
        MediaQuery.of(context).viewInsets.bottom + AppTheme.spacingLg,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Drag handle
          Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppTheme.border,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: AppTheme.spacingLg),

          // Title
          Text(
            'Report this listing',
            style: theme.textTheme.headlineSmall,
          ),
          const SizedBox(height: AppTheme.spacingLg),

          // Reason dropdown
          DropdownButtonFormField<String>(
            initialValue: _selectedReason,
            decoration: const InputDecoration(
              labelText: 'Reason',
              border: OutlineInputBorder(),
            ),
            items: _reasons
                .map((r) => DropdownMenuItem(value: r, child: Text(r)))
                .toList(),
            onChanged: (value) => setState(() => _selectedReason = value),
          ),
          const SizedBox(height: AppTheme.spacingMd),

          // Details text field
          TextField(
            controller: _detailsController,
            decoration: const InputDecoration(
              labelText: 'Details (optional)',
              border: OutlineInputBorder(),
              alignLabelWithHint: true,
            ),
            maxLines: 3,
            textCapitalization: TextCapitalization.sentences,
          ),
          const SizedBox(height: AppTheme.spacingLg),

          // Submit button
          FilledButton(
            onPressed:
                _selectedReason != null && !_isSubmitting ? _submit : null,
            child: _isSubmitting
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Text('Submit Report'),
          ),
        ],
      ),
    );
  }
}


// ─── Make Offer Sheet ─────────────────────────────────────────────────────────

/// Modal bottom sheet for making an offer on a listing.
///
/// Collects a dollar amount and optional message, then submits via the
/// offers service. Uses integer-only math to convert dollars to cents.
class _MakeOfferSheet extends ConsumerStatefulWidget {
  const _MakeOfferSheet({required this.item});

  final Item item;

  @override
  ConsumerState<_MakeOfferSheet> createState() => _MakeOfferSheetState();
}

class _MakeOfferSheetState extends ConsumerState<_MakeOfferSheet> {
  final _amountController = TextEditingController();
  final _messageController = TextEditingController();
  bool _isSubmitting = false;

  @override
  void dispose() {
    _amountController.dispose();
    _messageController.dispose();
    super.dispose();
  }

  /// Parses a dollar string to integer cents using INTEGER math only.
  /// Returns null if the input is invalid.
  int? _parseDollarsToCents(String input) {
    final trimmed = input.trim();
    if (trimmed.isEmpty) return null;

    final parts = trimmed.split('.');
    if (parts.length > 2) return null;

    final wholePart = int.tryParse(parts[0]);
    if (wholePart == null || wholePart < 0) return null;

    int fracPart = 0;
    if (parts.length == 2) {
      var fracStr = parts[1];
      if (fracStr.length > 2) return null; // max 2 decimal places
      fracStr = fracStr.padRight(2, '0');
      fracPart = int.tryParse(fracStr) ?? 0;
    }

    return wholePart * 100 + fracPart;
  }

  Future<void> _submit() async {
    final cents = _parseDollarsToCents(_amountController.text);
    if (cents == null || cents <= 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Enter a valid amount greater than \$0')),
      );
      return;
    }

    setState(() => _isSubmitting = true);
    try {
      final message = _messageController.text.trim();
      await ref.read(offersServiceProvider).makeOffer(
            itemId: widget.item.id,
            amountCents: cents,
            message: message.isNotEmpty ? message : null,
          );
      if (!mounted) return;
      Navigator.of(context).pop();
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Offer sent successfully')),
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Failed to send offer: $e')),
      );
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: EdgeInsets.fromLTRB(
        AppTheme.spacingLg,
        AppTheme.spacingLg,
        AppTheme.spacingLg,
        MediaQuery.of(context).viewInsets.bottom + AppTheme.spacingLg,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Drag handle
          Center(
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: AppTheme.border,
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
          const SizedBox(height: AppTheme.spacingLg),

          // Title
          Text(
            'Make an offer',
            style: Theme.of(context).textTheme.titleLarge,
          ),
          const SizedBox(height: AppTheme.spacingMd),

          // Asking price reference
          Text(
            'Asking: ${Money.format(widget.item.fmvCents, widget.item.currency)}',
            style: AppTheme.supportText,
          ),
          const SizedBox(height: AppTheme.spacingXl),

          // Amount text field
          TextField(
            controller: _amountController,
            keyboardType: const TextInputType.numberWithOptions(decimal: true),
            style: AppTheme.priceCard.copyWith(fontSize: 18),
            decoration: InputDecoration(
              prefixText: '\$ ',
              prefixStyle: AppTheme.priceCard.copyWith(fontSize: 18),
              border: const OutlineInputBorder(),
              hintText: '0.00',
            ),
          ),
          const SizedBox(height: AppTheme.spacingLg),

          // Optional message
          TextField(
            controller: _messageController,
            maxLines: 2,
            textCapitalization: TextCapitalization.sentences,
            decoration: const InputDecoration(
              hintText: 'Add a message (optional)',
              border: OutlineInputBorder(),
              alignLabelWithHint: true,
            ),
          ),
          const SizedBox(height: AppTheme.spacingXl),

          // Submit button
          FilledButton(
            onPressed: _isSubmitting ? null : _submit,
            child: _isSubmitting
                ? const SizedBox(
                    width: 20,
                    height: 20,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: Colors.white,
                    ),
                  )
                : const Text('Submit Offer'),
          ),
        ],
      ),
    );
  }
}
