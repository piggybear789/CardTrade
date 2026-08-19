import 'package:flutter/foundation.dart';
import '../core/api_routes.dart';
import '../core/constants.dart';
import '../core/result.dart';
import '../models/item.dart';
import '../models/enums.dart';
import 'mobile_api_client.dart';
import 'supabase_service.dart';

/// Service for listing CRUD and catalog browsing.
class ListingsService {
  ListingsService(this._supabase, this._api);

  final SupabaseService _supabase;
  final MobileApiClient _api;

  /// Fetch paginated catalog listings with optional filters.
  ///
  /// Returns an empty list on error rather than crashing.
  Future<List<ItemSummary>> getCatalog({
    int page = 0,
    int pageSize = AppConstants.defaultPageSize,
    String? category,
    String? condition,
    String? regionCode,
    String? searchQuery,
    ListingSortOrder sort = ListingSortOrder.newest,
  }) async {
    try {
      var query = _supabase
          .from('items')
          .select()
          .eq('status', 'AVAILABLE')
          .eq('hidden', false)
          .isFilter('closed_at', null);

      if (category != null && AppConstants.games.contains(category)) {
        query = query.eq('category', category);
      } else {
        query = query.inFilter('category', AppConstants.games);
      }
      if (condition != null && condition.isNotEmpty) {
        query = query.eq('condition', condition);
      }
      if (regionCode != null && regionCode.isNotEmpty) {
        query = query.eq('location_country_code', regionCode);
      }
      if (searchQuery != null && searchQuery.isNotEmpty) {
        query = query.ilike('title', '%$searchQuery%');
      }

      // Sort
      final String orderColumn;
      final bool ascending;
      switch (sort) {
        case ListingSortOrder.newest:
          orderColumn = 'created_at';
          ascending = false;
        case ListingSortOrder.priceLowHigh:
          orderColumn = 'fmv_cents';
          ascending = true;
        case ListingSortOrder.priceHighLow:
          orderColumn = 'fmv_cents';
          ascending = false;
      }

      final response = await query
          .order(orderColumn, ascending: ascending)
          .range(page * pageSize, (page + 1) * pageSize - 1);

      return (response as List).map((json) {
        try {
          return ItemSummary(
            id: json['id'] as String? ?? '',
            title: json['title'] as String? ?? 'Untitled',
            fmvCents: (json['fmv_cents'] as num?)?.toInt() ?? 0,
            condition: json['condition'] as String? ?? '',
            category: json['category'] as String? ?? '',
            listingKind: _parseListingKind(json['listing_kind']),
            status: _parseItemStatus(json['status']),
            imagePaths: _parseStringList(json['image_paths']),
            sellerIdentityVerified: json['seller_identity_verified'] as bool? ?? false,
            sellerRating: (json['seller_rating'] as num?)?.toDouble(),
            locationLabel: json['location_label'] as String?,
            locationCountryCode: json['location_country_code'] as String?,
            currency: json['currency'] as String? ?? 'aud',
            ownerDisplayName: json['owner_display_name'] as String?,
            ownerAvatarPath: json['owner_avatar_path'] as String?,
          );
        } catch (e) {
          debugPrint('Failed to parse item: $e');
          return null;
        }
      }).whereType<ItemSummary>().toList();
    } catch (e) {
      debugPrint('getCatalog error: $e');
      rethrow;
    }
  }

  /// Fetch a single listing by ID.
  Future<Item?> getItem(String id) async {
    try {
      final response = await _supabase
          .from('items')
          .select()
          .eq('id', id)
          .maybeSingle();

      if (response == null) return null;
      return Item.fromJson(response);
    } catch (e) {
      debugPrint('getItem error: $e');
      rethrow;
    }
  }

  /// Fetch the current user's listings.
  Future<List<Item>> getMyListings() async {
    final userId = _supabase.currentUserId;
    if (userId == null) return [];

    try {
      final response = await _supabase
          .from('items')
          .select()
          .eq('owner_id', userId)
          .order('created_at', ascending: false);

      return (response as List).map((json) {
        try {
          return Item.fromJson(json);
        } catch (e) {
          debugPrint('Failed to parse my listing: $e');
          return null;
        }
      }).whereType<Item>().toList();
    } catch (e) {
      debugPrint('getMyListings error: $e');
      rethrow;
    }
  }

  /// Create a new listing via the mobile API.
  ///
  /// Delegates to `createItem` on the server, which evaluates the Identity_Gate
  /// and seller disclosure. Returns a typed Result so the UI can show
  /// `not-verified` as an actionable prompt.
  Future<Result<Item>> createItem({
    required String title,
    required String description,
    required String category,
    required String condition,
    required int fmvCents,
    required List<String> imagePaths,
    required String listingKind,
    String? locationLabel,
    String? locationPlaceId,
    double? locationLat,
    double? locationLng,
    String? locationCountryCode,
  }) async {
    return _api.post<Item>(
      ApiRoutes.listingsCreate,
      body: {
        'title': title,
        'description': description,
        'category': category,
        'condition': condition,
        'fmvCents': fmvCents,
        'images': imagePaths,
        'listingKind': listingKind.toUpperCase(),
        if (locationLabel != null)
          'location': {
            'label': locationLabel,
            'placeId': locationPlaceId ?? '',
            'lat': locationLat ?? 0,
            'lng': locationLng ?? 0,
            'countryCode': locationCountryCode,
            'precision': 'suburb',
          },
      },
      transform: (data) => Item.fromJson(data as Map<String, dynamic>),
    );
  }

  /// Update an existing listing via the mobile API.
  Future<Result<Item>> updateItem(String id, Map<String, dynamic> updates) async {
    return _api.post<Item>(
      ApiRoutes.listingsUpdate,
      body: {
        'itemId': id,
        ...updates,
      },
      transform: (data) => Item.fromJson(data as Map<String, dynamic>),
    );
  }

  /// Close a shopfront listing via the mobile API.
  Future<Result<dynamic>> closeShopfront(String id) async {
    return _api.post(
      ApiRoutes.listingsClose,
      body: {'itemId': id},
    );
  }

  // ─── Parsing Helpers ──────────────────────────────────────────────────────

  static ListingKind _parseListingKind(dynamic value) {
    if (value == null) return ListingKind.single;
    final str = value.toString().toUpperCase();
    if (str == 'SHOPFRONT') return ListingKind.shopfront;
    return ListingKind.single;
  }

  static ItemStatus _parseItemStatus(dynamic value) {
    if (value == null) return ItemStatus.available;
    final str = value.toString().toUpperCase();
    switch (str) {
      case 'RESERVED': return ItemStatus.reserved;
      case 'SOLD': return ItemStatus.sold;
      default: return ItemStatus.available;
    }
  }

  static List<String> _parseStringList(dynamic value) {
    if (value == null) return [];
    if (value is List) return value.cast<String>();
    return [];
  }
}

/// Sort order for catalog browsing.
enum ListingSortOrder { newest, priceLowHigh, priceHighLow }
