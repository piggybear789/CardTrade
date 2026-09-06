import 'package:freezed_annotation/freezed_annotation.dart';
import 'enums.dart';

part 'item.freezed.dart';
part 'item.g.dart';

/// A marketplace listing — either a single item or a shopfront (binder).
@freezed
abstract class Item with _$Item {
  const factory Item({
    required String id,
    required String ownerId,
    required String title,
    required String description,
    required String category,
    required String condition,
    required int fmvCents,
    required ItemStatus status,
    required ListingKind listingKind,
    DateTime? closedAt,
    @Default([]) List<String> imagePaths,
    @Default(false) bool hidden,
    double? sellerRating,
    @Default(false) bool sellerIdentityVerified,
    String? locationLabel,
    String? locationPlaceId,
    double? locationLat,
    double? locationLng,
    String? locationCountryCode,
    @Default('aud') String currency,
    required DateTime createdAt,
    required DateTime updatedAt,
  }) = _Item;

  const Item._();

  factory Item.fromJson(Map<String, dynamic> json) => _$ItemFromJson(json);

  /// Whether this is a shopfront/binder listing.
  bool get isShopfront => listingKind == ListingKind.shopfront;

  /// Whether the listing is currently available for purchase/trade.
  bool get isAvailable =>
      status == ItemStatus.available && !hidden && closedAt == null;

  /// First image URL (or null if no images).
  String? get primaryImage => imagePaths.isNotEmpty ? imagePaths.first : null;
}

/// Compact listing card data for catalog browsing.
/// Lighter than full Item — used in grids and lists.
@freezed
abstract class ItemSummary with _$ItemSummary {
  const factory ItemSummary({
    required String id,
    required String title,
    required int fmvCents,
    required String condition,
    required String category,
    required ListingKind listingKind,
    required ItemStatus status,
    @Default([]) List<String> imagePaths,
    @Default(false) bool sellerIdentityVerified,
    double? sellerRating,
    String? locationLabel,
    String? locationCountryCode,
    @Default('aud') String currency,
    // Joined seller info for card display
    String? ownerDisplayName,
    String? ownerAvatarPath,
    /// When the owner retired a binder or bulk listing. A binder is never
    /// RESERVED and never SOLD, so this is the ONLY way one stops trading, and
    /// the catalog tile needs it to draw the CLOSED state (Req 5.11).
    DateTime? closedAt,
    /// Intrinsic pixel size of the COVER photo — `items.image_dims[0]` — so the
    /// tile can reserve a cover box of the right shape before the bytes arrive
    /// and the two mosaic columns stagger without reflowing (Req 5.1, 5.2).
    ///
    /// Not read by `fromJson`: the column is a `jsonb` array aligned with
    /// `image_paths`, so the catalog query lifts entry 0 out of it explicitly.
    /// Absent on every other path, which is exactly the square fallback.
    int? coverWidthPx,
    int? coverHeightPx,
  }) = _ItemSummary;

  factory ItemSummary.fromJson(Map<String, dynamic> json) =>
      _$ItemSummaryFromJson(json);
}
