import 'package:freezed_annotation/freezed_annotation.dart';
import 'enums.dart';

part 'offer.freezed.dart';
part 'offer.g.dart';

/// An offer on a listing (single items only, never shopfronts).
@freezed
abstract class Offer with _$Offer {
  const factory Offer({
    required String id,
    required String itemId,
    required String sellerId,
    required String buyerId,
    required String offeredBy,
    required int amountCents,
    required OfferStatus status,
    String? parentOfferId,
    String? message,
    required DateTime createdAt,
    required DateTime updatedAt,
  }) = _Offer;

  const Offer._();

  factory Offer.fromJson(Map<String, dynamic> json) => _$OfferFromJson(json);

  /// Whether this offer was made by the given user.
  bool isOfferedBy(String userId) => offeredBy == userId;

  /// Whether the offer is still actionable.
  bool get isPending => status == OfferStatus.pending;
}
