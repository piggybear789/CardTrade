import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/item.dart';
import '../services/listings_service.dart';
import '../services/storage_service.dart';
import 'auth_provider.dart';

/// Provides the ListingsService.
final listingsServiceProvider = Provider<ListingsService>((ref) {
  return ListingsService(
    ref.watch(supabaseServiceProvider),
    ref.watch(mobileApiClientProvider),
  );
});

/// Provides the StorageService for image uploads.
final storageServiceProvider = Provider<StorageService>((ref) {
  return StorageService(ref.watch(supabaseServiceProvider));
});

/// Catalog filter state.
final catalogFilterProvider =
    NotifierProvider<CatalogFilterNotifier, CatalogFilter>(
        CatalogFilterNotifier.new);

class CatalogFilterNotifier extends Notifier<CatalogFilter> {
  @override
  CatalogFilter build() => const CatalogFilter();

  void update(CatalogFilter Function(CatalogFilter) updater) {
    state = updater(state);
  }
}

class CatalogFilter {
  const CatalogFilter({
    this.category,
    this.condition,
    this.regionCode,
    this.searchQuery,
    this.sort = ListingSortOrder.newest,
  });

  final String? category;
  final String? condition;
  final String? regionCode;
  final String? searchQuery;
  final ListingSortOrder sort;

  CatalogFilter copyWith({
    String? category,
    String? condition,
    String? regionCode,
    String? searchQuery,
    ListingSortOrder? sort,
  }) {
    return CatalogFilter(
      category: category ?? this.category,
      condition: condition ?? this.condition,
      regionCode: regionCode ?? this.regionCode,
      searchQuery: searchQuery ?? this.searchQuery,
      sort: sort ?? this.sort,
    );
  }
}

/// Paginated catalog listings.
final catalogProvider =
    AsyncNotifierProvider<CatalogNotifier, List<ItemSummary>>(
        CatalogNotifier.new);

class CatalogNotifier extends AsyncNotifier<List<ItemSummary>> {
  int _page = 0;
  bool _hasMore = true;

  @override
  FutureOr<List<ItemSummary>> build() async {
    final filter = ref.watch(catalogFilterProvider);
    _page = 0;
    _hasMore = true;
    return _fetch(filter, 0);
  }

  Future<List<ItemSummary>> _fetch(CatalogFilter filter, int page) async {
    final service = ref.read(listingsServiceProvider);
    final items = await service.getCatalog(
      page: page,
      category: filter.category,
      condition: filter.condition,
      regionCode: filter.regionCode,
      searchQuery: filter.searchQuery,
      sort: filter.sort,
    );
    if (items.length < 20) _hasMore = false;
    return items;
  }

  /// Load the next page of results.
  Future<void> loadMore() async {
    if (!_hasMore) return;
    final filter = ref.read(catalogFilterProvider);
    _page++;
    final moreItems = await _fetch(filter, _page);
    final current = state.value ?? [];
    state = AsyncData([...current, ...moreItems]);
  }

  /// Whether there are more pages to load.
  bool get hasMore => _hasMore;
}

/// A single item detail by ID.
final itemDetailProvider =
    FutureProvider.family<Item?, String>((ref, itemId) async {
  final service = ref.read(listingsServiceProvider);
  return service.getItem(itemId);
});

/// The current user's listings.
final myListingsProvider = FutureProvider<List<Item>>((ref) async {
  ref.watch(currentUserProvider);
  final service = ref.read(listingsServiceProvider);
  return service.getMyListings();
});
