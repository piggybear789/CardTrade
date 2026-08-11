import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/item.dart';
import '../services/watchlist_service.dart';
import 'auth_provider.dart';

/// Provides the WatchlistService.
final watchlistServiceProvider = Provider<WatchlistService>((ref) {
  return WatchlistService(ref.watch(supabaseServiceProvider));
});

/// The current user's saved/watchlist items.
final savedItemsProvider = FutureProvider<List<ItemSummary>>((ref) async {
  ref.watch(currentUserProvider);
  final service = ref.read(watchlistServiceProvider);
  return service.getSavedItems();
});

/// Whether a specific item is in the watchlist.
final isWatchingProvider =
    FutureProvider.family<bool, String>((ref, itemId) async {
  final service = ref.read(watchlistServiceProvider);
  return service.isWatching(itemId);
});

/// How many users have saved a given item.
final watchCountProvider =
    FutureProvider.family<int, String>((ref, itemId) async {
  final service = ref.read(watchlistServiceProvider);
  return service.getWatchCount(itemId);
});
