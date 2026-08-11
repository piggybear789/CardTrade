import '../models/item.dart';
import 'supabase_service.dart';

/// Service for watchlist/saved items.
class WatchlistService {
  WatchlistService(this._supabase);

  final SupabaseService _supabase;

  /// Fetch the current user's saved items (with item details).
  Future<List<ItemSummary>> getSavedItems() async {
    final userId = _supabase.currentUserId;
    if (userId == null) return [];

    final response = await _supabase
        .from('watchlist')
        .select('''
          item_id,
          items!watchlist_item_id_fkey(
            id, title, fmv_cents, condition, category, listing_kind, status,
            image_paths, seller_identity_verified, seller_rating,
            location_label, location_country_code, currency,
            profiles!items_owner_id_fkey(display_name, avatar_path)
          )
        ''')
        .eq('user_id', userId)
        .order('created_at', ascending: false);

    return (response as List).map((json) {
      final item = json['items'] as Map<String, dynamic>;
      final profile = item['profiles'] as Map<String, dynamic>?;
      return ItemSummary.fromJson({
        ...item,
        'owner_display_name': profile?['display_name'],
        'owner_avatar_path': profile?['avatar_path'],
      });
    }).toList();
  }

  /// Check if an item is in the current user's watchlist.
  Future<bool> isWatching(String itemId) async {
    final userId = _supabase.currentUserId;
    if (userId == null) return false;

    final response = await _supabase
        .from('watchlist')
        .select('item_id')
        .eq('user_id', userId)
        .eq('item_id', itemId)
        .maybeSingle();

    return response != null;
  }

  /// Add an item to the watchlist.
  Future<void> addToWatchlist(String itemId) async {
    final userId = _supabase.currentUserId!;
    await _supabase.from('watchlist').insert({
      'user_id': userId,
      'item_id': itemId,
    });
  }

  /// Remove an item from the watchlist.
  Future<void> removeFromWatchlist(String itemId) async {
    final userId = _supabase.currentUserId!;
    await _supabase
        .from('watchlist')
        .delete()
        .eq('user_id', userId)
        .eq('item_id', itemId);
  }

  /// Toggle watchlist status for an item.
  Future<bool> toggleWatchlist(String itemId) async {
    final watching = await isWatching(itemId);
    if (watching) {
      await removeFromWatchlist(itemId);
      return false;
    } else {
      await addToWatchlist(itemId);
      return true;
    }
  }

  /// Returns how many users have saved this item.
  Future<int> getWatchCount(String itemId) async {
    try {
      final response = await _supabase
          .from('watchlist')
          .select()
          .eq('item_id', itemId)
          .count();
      return response.count;
    } catch (e) {
      return 0;
    }
  }
}
