// The browse catalog — the Browse hub.
//
// GEOMETRY. Two columns at every phone width, `tight` between tiles on both
// axes, `group` inset from the viewport edges, and every tile as tall as its own
// cover so the columns stagger (Req 5.1). The web's phone gutter literal of 6
// logical pixels snaps to `tight`; the wider `sm:` gutter never applies at phone
// width and is not ported.
//
// ONE ACKNOWLEDGED DIVERGENCE, recorded in the design's manual-review register as
// R1: the web builds its mosaic in COLUMN-MAJOR order with a shortest-column
// balancer, and `SliverMasonryGrid` fills ROW-MAJOR. Tile sizes agree by
// construction — both read `image_dims` — and row-major keeps reading order
// closer to the ranked list, so the divergence is left in place rather than
// reimplemented.
//
// Requirements 5.1, 5.9, 11.9.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_staggered_grid_view/flutter_staggered_grid_view.dart';
import 'package:go_router/go_router.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/providers/listings_provider.dart';
import 'package:cardtrade/models/item.dart';
import 'package:cardtrade/providers/notifications_provider.dart';
import 'package:cardtrade/widgets/common/controls.dart';
import 'package:cardtrade/widgets/common/empty_state.dart';
import 'package:cardtrade/widgets/common/error_view.dart';
import 'package:cardtrade/widgets/common/load_state.dart';
import 'package:cardtrade/widgets/common/skeleton.dart';
import 'package:cardtrade/features/listings/widgets/filter_sheet.dart';
import 'package:cardtrade/features/listings/widgets/listing_card.dart';

/// The browse grid, its search field and its filter surface.
class CatalogScreen extends ConsumerStatefulWidget {
  const CatalogScreen({super.key});

  /// Columns in the phone mosaic. Two, as on every phone-width marketplace feed.
  static const int mosaicColumns = 2;

  /// Placeholder tiles drawn while the first page loads.
  static const int _skeletonTiles = 6;

  /// How close to the end of the feed a reader gets before the next page starts.
  static const double _loadMoreThreshold = 200;

  @override
  ConsumerState<CatalogScreen> createState() => _CatalogScreenState();
}

class _CatalogScreenState extends ConsumerState<CatalogScreen> {
  final ScrollController _scrollController = ScrollController();
  final TextEditingController _searchController = TextEditingController();
  bool _isLoadingMore = false;

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
    _searchController.addListener(_onSearchTextChanged);
  }

  @override
  void dispose() {
    _scrollController.removeListener(_onScroll);
    _scrollController.dispose();
    _searchController.removeListener(_onSearchTextChanged);
    _searchController.dispose();
    super.dispose();
  }

  void _onSearchTextChanged() {
    // Rebuild to show or hide the clear control.
    setState(() {});
  }

  void _onScroll() {
    if (_isLoadingMore) return;
    final double maxScroll = _scrollController.position.maxScrollExtent;
    final double currentScroll = _scrollController.position.pixels;
    if (currentScroll >= maxScroll - CatalogScreen._loadMoreThreshold) {
      _loadMore();
    }
  }

  Future<void> _loadMore() async {
    final notifier = ref.read(catalogProvider.notifier);
    if (!notifier.hasMore) return;
    setState(() => _isLoadingMore = true);
    await notifier.loadMore();
    if (mounted) setState(() => _isLoadingMore = false);
  }

  /// Reissues the catalog read the screen already had, and AWAITS it.
  ///
  /// The await is the point: `invalidate` alone returns before the request does,
  /// so the indicator retired immediately and a second pull issued a second
  /// request (Req 11.6). It also lets a failed refresh be reported without the
  /// rows on screen being replaced (Req 11.5).
  Future<void> _onRefresh() async {
    ref.invalidate(catalogProvider);
    await ref.read(catalogProvider.future);
  }

  void _onSearch(String query) {
    final CatalogFilter current = ref.read(catalogFilterProvider);
    ref.read(catalogFilterProvider.notifier).update(
          (_) => CatalogFilter(
            category: current.category,
            condition: current.condition,
            regionCode: current.regionCode,
            searchQuery: query.isEmpty ? null : query,
            sort: current.sort,
          ),
        );
  }

  void _clearSearch() {
    _searchController.clear();
    _onSearch('');
  }

  void _clearFilters() {
    _searchController.clear();
    ref
        .read(catalogFilterProvider.notifier)
        .update((_) => const CatalogFilter());
  }

  void _openFilterSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => const FilterSheet(),
    );
  }

  /// What the member has narrowed the feed by, in their own words.
  ///
  /// Names the reason a filtered feed came back empty, so the empty state can say
  /// which filter to drop rather than implying the catalog is bare (Req 11.9).
  List<String> _activeFilterLabels(CatalogFilter filter) {
    return <String>[
      if (filter.searchQuery != null) '“${filter.searchQuery}”',
      if (filter.category != null) filter.category!,
      if (filter.condition != null) filter.condition!,
      if (filter.regionCode != null) filter.regionCode!,
    ];
  }

  @override
  Widget build(BuildContext context) {
    final catalogAsync = ref.watch(catalogProvider);
    final CatalogFilter filter = ref.watch(catalogFilterProvider);
    final AsyncValue<int> unreadCount =
        ref.watch(unreadNotificationCountProvider);
    final List<String> activeFilters = _activeFilterLabels(filter);

    return Scaffold(
      body: SafeArea(
        child: PullToRefresh(
          onRefresh: _onRefresh,
          operation: _operation,
          child: CustomScrollView(
            controller: _scrollController,
            physics: const AlwaysScrollableScrollPhysics(),
            slivers: <Widget>[
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    AppSpacing.group,
                    AppSpacing.snug,
                    AppSpacing.group,
                    AppSpacing.snug,
                  ),
                  child: Row(
                    spacing: AppSpacing.snug,
                    children: <Widget>[
                      Expanded(
                        child: AppTextField(
                          controller: _searchController,
                          hint: 'Search cards',
                          textInputAction: TextInputAction.search,
                          prefixIcon: const Icon(
                            Icons.search_rounded,
                            size: AppIconSize.base,
                            color: AppColors.mutedForeground,
                          ),
                          onSubmitted: _onSearch,
                          onChanged: (value) {
                            if (value.isEmpty) _onSearch('');
                          },
                        ),
                      ),
                      if (_searchController.text.isNotEmpty)
                        AppIconButton(
                          icon: Icons.close_rounded,
                          semanticLabel: 'Clear the search',
                          onPressed: _clearSearch,
                        ),
                      AppIconButton(
                        icon: Icons.tune_rounded,
                        semanticLabel: 'Filter listings',
                        onPressed: _openFilterSheet,
                      ),
                    ],
                  ),
                ),
              ),

              _feed(catalogAsync, activeFilters),

              const SliverToBoxAdapter(
                child: SizedBox(height: AppSpacing.section),
              ),
            ],
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton(
        onPressed: () => context.push('/notifications'),
        backgroundColor: AppColors.primary,
        foregroundColor: AppColors.primaryForeground,
        child: Badge(
          isLabelVisible: (unreadCount.value ?? 0) > 0,
          label: Text('${unreadCount.value ?? 0}', style: AppText.badgeText),
          child: const Icon(Icons.notifications_outlined),
        ),
      ),
    );
  }

  /// The feed, in whichever of its states it is in.
  ///
  /// Branch order is deliberate and is NOT `AsyncValue.when`. A page of listings
  /// that has been reported once stays on screen while the next read runs and even
  /// when that read FAILS — `PullToRefresh` reports the failure over the top
  /// instead (Req 11.5, 11.10). Only a first load with nothing to show reaches the
  /// placeholder or the error state.
  Widget _feed(
    AsyncValue<List<ItemSummary>> catalogAsync,
    List<String> activeFilters,
  ) {
    // The gate encloses every branch, so the 500 ms floor survives the value
    // arriving — inside the loading branch it would not (Req 11.8).
    return SkeletonGate(
      isLoading: !catalogAsync.hasValue && !catalogAsync.hasError,
      builder: (BuildContext context, bool showSkeleton) {
        if (showSkeleton) return _skeletonFeed();
        return _settledFeed(catalogAsync, activeFilters);
      },
    );
  }

  /// The placeholder mosaic: the same grid at the same inset as the feed, so the
  /// tiles resolve where the blocks stood (Req 11.1).
  Widget _skeletonFeed() {
    return LoadingAnnouncement(
      announcement: 'Loading listings',
      child: SliverPadding(
        padding: _gridInset,
        sliver: SliverMasonryGrid.count(
          crossAxisCount: CatalogScreen.mosaicColumns,
          mainAxisSpacing: AppSpacing.tight,
          crossAxisSpacing: AppSpacing.tight,
          childCount: CatalogScreen._skeletonTiles,
          itemBuilder: _skeletonTile,
        ),
      ),
    );
  }

  Widget _settledFeed(
    AsyncValue<List<ItemSummary>> catalogAsync,
    List<String> activeFilters,
  ) {
    if (catalogAsync.hasValue) {
      final List<ItemSummary> items = catalogAsync.requireValue;
      if (items.isEmpty) return _emptyFeed(activeFilters);
      return SliverPadding(
        padding: _gridInset,
        sliver: SliverMasonryGrid.count(
          crossAxisCount: CatalogScreen.mosaicColumns,
          mainAxisSpacing: AppSpacing.tight,
          crossAxisSpacing: AppSpacing.tight,
          childCount:
              items.length + (_isLoadingMore ? CatalogScreen.mosaicColumns : 0),
          itemBuilder: (context, index) {
            if (index >= items.length) return _skeletonTile(context, index);
            return ListingCard(item: items[index]);
          },
        ),
      );
    }

    if (catalogAsync.hasError) {
      return SliverFillRemaining(
        hasScrollBody: false,
        child: ErrorView.forFailure(
          RequestFailure.from(catalogAsync.error!, operation: _operation),
          onRetry: _onRefresh,
        ),
      );
    }

    // Inside the suppression window: nothing, rather than a second loading
    // treatment for 200 milliseconds.
    return const SliverToBoxAdapter(child: SizedBox.shrink());
  }

  /// Zero rows. Which of the two empty states applies is a question about the
  /// FILTERS and not about the catalog (Req 11.9).
  Widget _emptyFeed(List<String> activeFilters) {
    return SliverFillRemaining(
      hasScrollBody: false,
      child: activeFilters.isEmpty
          ? const EmptyState(
              icon: Icons.storefront_outlined,
              title: 'No listings yet',
              subtitle: 'New cards appear here as members list them.',
            )
          : EmptyState(
              icon: Icons.search_off_rounded,
              title: 'Nothing matches those filters',
              subtitle: 'Nothing is listed for ${activeFilters.join(', ')}.',
              actionLabel: 'Clear filters',
              onAction: _clearFilters,
            ),
    );
  }

  /// The grid's inset from the viewport edges. Horizontal only: the vertical
  /// rhythm above the grid is the search row's own padding.
  static const EdgeInsets _gridInset =
      EdgeInsets.symmetric(horizontal: AppSpacing.group);

  /// What a failure or a failed refresh calls this request, in member terms.
  static const String _operation = 'the catalog';

  static Widget _skeletonTile(BuildContext context, int index) =>
      const SkeletonListingCard();
}
