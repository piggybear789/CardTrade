import 'package:freezed_annotation/freezed_annotation.dart';
import 'enums.dart';

part 'trade.freezed.dart';
part 'trade.g.dart';

/// A two-way trade collateral contract between two users.
@freezed
abstract class Trade with _$Trade {
  const factory Trade({
    required String id,
    required String initiatorId,
    required String counterpartId,
    required String initiatorItemId,
    required String counterpartItemId,
    required TradeState state,
    required int version,
    required int termsVersion,
    DateTime? termsUpdatedAt,
    int? initiatorTermsAcceptedVersion,
    int? counterpartTermsAcceptedVersion,
    DateTime? initiatorTermsAcceptedAt,
    DateTime? counterpartTermsAcceptedAt,
    String? offerMessage,
    int? declaredValueCents,
    String? counterpartGoodsDescription,
    // Cancellation
    String? cancelledBy,
    String? cancelReason,
    DateTime? cancelledAt,
    // Shipping — initiator
    DateTime? initiatorShippedAt,
    String? initiatorTrackingCarrier,
    String? initiatorTrackingNumber,
    String? initiatorTrackingUrl,
    String? initiatorTrackingStatus,
    DateTime? initiatorCarrierDeliveredAt,
    DateTime? initiatorReceivedAt,
    DateTime? initiatorAcceptedAt,
    DateTime? initiatorHandoverConfirmedAt,
    @Default(false) bool initiatorDeliveryAddressConfigured,
    // Shipping — counterpart
    DateTime? counterpartShippedAt,
    String? counterpartTrackingCarrier,
    String? counterpartTrackingNumber,
    String? counterpartTrackingUrl,
    String? counterpartTrackingStatus,
    DateTime? counterpartCarrierDeliveredAt,
    DateTime? counterpartReceivedAt,
    DateTime? counterpartAcceptedAt,
    DateTime? counterpartHandoverConfirmedAt,
    @Default(false) bool counterpartDeliveryAddressConfigured,
    // Inspection
    DateTime? inspectionDeadlineAt,
    @Default(false) bool autoCompleted,
    // Dispute
    String? disputeRaisedBy,
    String? disputedAgainst,
    DateTime? disputedAt,
    String? disputeReason,
    // Fraud
    String? fraudVictimId,
    String? fraudClaimedBy,
    String? fraudClaimedAgainst,
    String? fraudClaimReason,
    DateTime? fraudClaimedAt,
    // Cash adjustment
    @Default(0) int cashAmountCents,
    @Default('aud') String currency,
    TradeCashDirection? cashDirection,
    // Fulfilment
    HandoverMethod? handoverMethod,
    String? meetingLocation,
    double? meetingLat,
    double? meetingLng,
    String? meetingPlaceId,
    DateTime? meetingAt,
    String? deliveryDetails,
    int? deliveryCostCents,
    // Conversation
    String? conversationId,
    // Timestamps
    required DateTime createdAt,
    required DateTime updatedAt,
  }) = _Trade;

  const Trade._();

  factory Trade.fromJson(Map<String, dynamic> json) => _$TradeFromJson(json);

  /// Whether this trade is in a terminal state.
  bool get isTerminal => isTerminalTradeState(state);

  /// Whether terms are fully agreed by both parties.
  bool get termsAgreed =>
      initiatorTermsAcceptedVersion == termsVersion &&
      counterpartTermsAcceptedVersion == termsVersion;

  /// The viewer's role in this trade.
  TradeViewerRole roleFor(String userId) =>
      userId == initiatorId ? TradeViewerRole.initiator : TradeViewerRole.counterpart;

  /// Whether the given user has shipped.
  bool hasShipped(String userId) =>
      userId == initiatorId
          ? initiatorShippedAt != null
          : counterpartShippedAt != null;

  /// Whether the given user has accepted inspection.
  bool hasAccepted(String userId) =>
      userId == initiatorId
          ? initiatorAcceptedAt != null
          : counterpartAcceptedAt != null;

  /// Whether both parties have shipped.
  bool get bothShipped =>
      initiatorShippedAt != null && counterpartShippedAt != null;

  /// Whether both parties have received.
  bool get bothReceived =>
      initiatorReceivedAt != null && counterpartReceivedAt != null;
}

/// The viewer's role in a trade.
enum TradeViewerRole { initiator, counterpart }

/// Summary for trade list cards.
@freezed
abstract class TradeSummary with _$TradeSummary {
  const factory TradeSummary({
    required String id,
    required TradeState state,
    required String initiatorItemId,
    required String counterpartItemId,
    required DateTime updatedAt,
    // Joined item info
    String? initiatorItemTitle,
    String? initiatorItemImage,
    String? counterpartItemTitle,
    String? counterpartItemImage,
    // Joined user info
    String? counterpartDisplayName,
    String? counterpartAvatarPath,
  }) = _TradeSummary;

  factory TradeSummary.fromJson(Map<String, dynamic> json) =>
      _$TradeSummaryFromJson(json);
}
