import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_staggered_grid_view/flutter_staggered_grid_view.dart';
import 'package:go_router/go_router.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/providers/listings_provider.dart';
import 'package:cardtrade/providers/notifications_provider.dart';
import 'package:cardtrade/widgets/common/empty_state.dart';
import 'package:cardtrade/widgets/common/error_view.dart';
import 'package:cardtrade/widgets/common/shimmer_loading.dart';
import 'package:cardtrade/features/listings/widgets/filter_sheet.dart';
import 'package:cardtrade/features/listings/widgets/listing_card.dart';

/// Xianyu-inspired catalog browse screen — the home tab.
///
/// Features a sticky search bar with clear button, masonry grid with
/// infinite scroll pagination, and a notifications FAB.
class CatalogScreen extends ConsumerStatefulWidget {
  const CatalogScreen({super.key});

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
    // Rebuild to show/hide the clear button
    setState(() {});
  }

  void _onScroll() {
    if (_isLoadingMore) return;
    final maxScroll = _scrollController.position.maxScrollExtent;
    final currentScroll = _scrollController.position.pixels;
    // Trigger load when within 200px of the bottom
    if (currentScroll >= maxScroll - 200) {
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

  Future<void> _onRefresh() async {
    ref.invalidate(catalogProvider);
  }

  void _onSearch(String query) {
    ref.read(catalogFilterProvider.notifier).update((filter) => CatalogFilter(
          category: filter.category,
          condition: filter.condition,
          regionCode: filter.regionCode,
          searchQuery: query.isEmpty ? null : query,
          sort: filter.sort,
        ));
  }

  void _clearSearch() {
    _searchController.clear();
    _onSearch('');
  }

  void _clearFilters() {
    _searchController.clear();
    ref.read(catalogFilterProvider.notifier).update((_) => const CatalogFilter());
  }

  void _openFilterSheet() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (_) => const FilterSheet(),
    );
  }

  /// Whether any filter or search is currently active.
  bool get _hasActiveFilters {
    final filter = ref.read(catalogFilterProvider);
    return filter.searchQuery != null ||
        filter.category != null ||
        filter.condition != null;
  }

  @override
  Widget build(BuildContext context) {
    final catalogAsync = ref.watch(catalogProvider);
    final unreadCount = ref.watch(unreadNotificationCountProvider);

    return Scaffold(
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: _onRefresh,
          child: CustomScrollView(
            controller: _scrollController,
            slivers: [
              // ─── Search Bar ───────────────────────────────────────
              SliverToBoxAdapter(
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(
                    AppTheme.spacingLg,
                    AppTheme.spacingMd,
                    AppTheme.spacingLg,
                    AppTheme.spacingSm,
                  ),
                  child: SearchBar(
                    controller: _searchController,
                    hintText: 'Search collectibles...',
                    textStyle: WidgetStateProperty.all(
                      AppTheme.bodyText.copyWith(color: AppTheme.primary),
                    ),
                    hintStyle: WidgetStateProperty.all(
                      AppTheme.bodyText.copyWith(color: AppTheme.muted),
                    ),
                    constraints: const BoxConstraints(
                      minHeight: 38,
                      maxHeight: 38,
                    ),
                    padding: WidgetStateProperty.all(
                      const EdgeInsets.symmetric(horizontal: AppTheme.spacingMd),
                    ),
                    leading: const Icon(
                      Icons.search_rounded,
                      size: 18,
                      color: AppTheme.muted,
                    ),
                    trailing: [
                      if (_searchController.text.isNotEmpty)
                        IconButton(
                          visualDensity: VisualDensity.compact,
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(
                            minWidth: 32,
                            minHeight: 32,
                          ),
                          icon: const Icon(
                            Icons.close_rounded,
                            size: 16,
                            color: AppTheme.secondary,
                          ),
                          onPressed: _clearSearch,
                        ),
                      IconButton(
                        visualDensity: VisualDensity.compact,
                        padding: EdgeInsets.zero,
                        constraints: const BoxConstraints(
                          minWidth: 32,
                          minHeight: 32,
                        ),
                        icon: const Icon(
                          Icons.tune_rounded,
                          size: 18,
                          color: AppTheme.secondary,
                        ),
                        onPressed: _openFilterSheet,
                      ),
                    ],
                    elevation: WidgetStateProperty.all(0),
                    backgroundColor:
                        WidgetStateProperty.all(AppTheme.surfaceVariant),
                    shape: WidgetStateProperty.all(
                      RoundedRectangleBorder(
                        borderRadius:
                            BorderRadius.circular(AppTheme.radiusLg),
                      ),
                    ),
                    onSubmitted: _onSearch,
                    onChanged: (value) {
                      if (value.isEmpty) _onSearch('');
                    },
                  ),
                ),
              ),

              // ─── Catalog Grid ─────────────────────────────────────
              catalogAsync.when(
                loading: () => SliverPadding(
                  padding: const EdgeInsets.symmetric(
                    horizontal: AppTheme.spacingLg,
                  ),
                  sliver: SliverMasonryGrid.count(
                    crossAxisCount: 2,
                    mainAxisSpacing: AppTheme.spacingMd,
                    crossAxisSpacing: AppTheme.spacingMd,
                    childCount: 6,
                    itemBuilder: (_, _) => const ShimmerListingCard(),
                  ),
                ),
                error: (error, _) => SliverFillRemaining(
                  child: ErrorView(
                    message: error.toString(),
                    onRetry: () => ref.invalidate(catalogProvider),
                  ),
                ),
                data: (items) {
                  if (items.isEmpty) {
                    return SliverFillRemaining(
                      child: EmptyState(
                        icon: Icons.search_off_rounded,
                        title: 'No listings found',
                        subtitle:
                            'Try adjusting your filters or searching for something else.',
                        actionLabel:
                            _hasActiveFilters ? 'Clear filters' : null,
                        onAction: _hasActiveFilters ? _clearFilters : null,
                      ),
                    );
                  }

                  return SliverPadding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppTheme.spacingLg,
                    ),
                    sliver: SliverMasonryGrid.count(
                      crossAxisCount: 2,
                      mainAxisSpacing: AppTheme.spacingMd,
                      crossAxisSpacing: AppTheme.spacingMd,
                      childCount: items.length + (_isLoadingMore ? 2 : 0),
                      itemBuilder: (context, index) {
                        if (index >= items.length) {
                          return const ShimmerListingCard();
                        }
                        return ListingCard(item: items[index]);
                      },
                    ),
                  );
                },
              ),

              // ─── Loading More Indicator ────────────────────────────
              if (_isLoadingMore)
                const SliverToBoxAdapter(
                  child: Padding(
                    padding: EdgeInsets.all(AppTheme.spacingXl),
                    child: Center(
                      child: SizedBox(
                        width: 16,
                        height: 16,
                        child: CircularProgressIndicator(
                          strokeWidth: 2,
                          color: AppTheme.muted,
                        ),
                      ),
                    ),
                  ),
                ),

              // Bottom padding
              const SliverToBoxAdapter(
                child: SizedBox(height: AppTheme.spacingXxxl),
              ),
            ],
          ),
        ),
      ),

      // ─── Notifications FAB ──────────────────────────────────────
      floatingActionButton: FloatingActionButton(
        onPressed: () => context.push('/notifications'),
        backgroundColor: AppTheme.accent,
        foregroundColor: Colors.white,
        child: Badge(
          isLabelVisible: (unreadCount.value ?? 0) > 0,
          label: Text(
            '${unreadCount.value ?? 0}',
            style: AppTheme.badgeText,
          ),
          child: const Icon(Icons.notifications_outlined),
        ),
      ),
    );
  }
}
