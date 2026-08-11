import 'package:freezed_annotation/freezed_annotation.dart';
import 'enums.dart';

part 'cash_sale.freezed.dart';
part 'cash_sale.g.dart';

/// A cash sale escrow contract between buyer and seller.
@freezed
abstract class CashSale with _$CashSale {
  const factory CashSale({
    required String id,
    required String itemId,
    required String buyerId,
    required String sellerId,
    required int amountCents,
    required int agreedPriceCents,
    required int platformFeeCents,
    required CashSaleStatus status,
    required int version,
    // Item snapshot
    required String itemTitle,
    String? itemDescription,
    String? itemCondition,
    @Default([]) List<String> itemImagePaths,
    // Fulfilment
    HandoverMethod? fulfillmentMethod,
    @Default(0) int shippingCostCents,
    String? shippingNotes,
    @Default(false) bool deliveryAddressConfigured,
    String? meetingLocation,
    double? meetingLat,
    double? meetingLng,
    String? meetingPlaceId,
    DateTime? meetingAt,
    // Terms
    required int termsVersion,
    DateTime? termsUpdatedAt,
    int? buyerTermsAcceptedVersion,
    int? sellerTermsAcceptedVersion,
    DateTime? buyerTermsAcceptedAt,
    DateTime? sellerTermsAcceptedAt,
    // Tracking
    String? trackingCarrier,
    String? trackingNumber,
    String? trackingUrl,
    String? trackingStatus,
    DateTime? shippedAt,
    DateTime? receivedAt,
    DateTime? carrierDeliveredAt,
    // Inspection
    DateTime? inspectionAcceptedAt,
    DateTime? inspectionDeadlineAt,
    @Default(false) bool autoCompleted,
    // Handover (in-person)
    DateTime? buyerHandoverConfirmedAt,
    DateTime? sellerHandoverConfirmedAt,
    // Completion
    DateTime? completedAt,
    // Cancellation
    DateTime? cancelledAt,
    String? cancelledBy,
    String? cancelReason,
    // Dispute
    DateTime? disputedAt,
    String? disputedBy,
    String? disputeReason,
    String? disputeConversationId,
    // Payout
    required CashSalePayoutStatus sellerPayoutStatus,
    DateTime? sellerPayoutAt,
    // Shopfront
    @Default(false) bool fromShopfront,
    // Currency
    @Default('aud') String currency,
    // Refund
    @Default(0) int refundCents,
    required CashSalePayoutStatus refundStatus,
    // Conversation
    String? conversationId,
    // Timestamps
    required DateTime createdAt,
    required DateTime updatedAt,
  }) = _CashSale;

  const CashSale._();

  factory CashSale.fromJson(Map<String, dynamic> json) =>
      _$CashSaleFromJson(json);

  /// Whether this sale is in a terminal state.
  bool get isTerminal => isTerminalCashSaleStatus(status);

  /// Whether terms are agreed by both parties.
  bool get termsAgreed =>
      buyerTermsAcceptedVersion == termsVersion &&
      sellerTermsAcceptedVersion == termsVersion;

  /// Total the buyer pays: price + shipping + platform fee.
  int get totalCents => agreedPriceCents + shippingCostCents + platformFeeCents;

  /// The viewer's role in this sale.
  CashSaleRole roleFor(String userId) =>
      userId == buyerId ? CashSaleRole.buyer : CashSaleRole.seller;
}

/// The viewer's role in a cash sale.
enum CashSaleRole { buyer, seller }

/// Summary for sale list cards.
@freezed
abstract class CashSaleSummary with _$CashSaleSummary {
  const factory CashSaleSummary({
    required String id,
    required CashSaleStatus status,
    required String itemTitle,
    required int agreedPriceCents,
    @Default([]) List<String> itemImagePaths,
    @Default('aud') String currency,
    required String buyerId,
    required String sellerId,
    required DateTime updatedAt,
    // Joined counterpart info
    String? counterpartDisplayName,
    String? counterpartAvatarPath,
  }) = _CashSaleSummary;

  factory CashSaleSummary.fromJson(Map<String, dynamic> json) =>
      _$CashSaleSummaryFromJson(json);
}
