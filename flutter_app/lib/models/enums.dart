/// All domain enums matching the cardtrade Postgres schema.
///
/// Each enum value uses @JsonValue to map to the UPPERCASE Postgres string.
/// Postgres stores: 'SINGLE', 'SHOPFRONT', 'AVAILABLE', 'IN_TRANSIT', etc.
/// Dart uses: ListingKind.single, ItemStatus.available, etc.
library;
import 'package:json_annotation/json_annotation.dart';

// ─── Identity & Merchant ─────────────────────────────────────────────────────

enum MerchantStatus {
  @JsonValue('NONE') none,
  @JsonValue('PENDING') pending,
  @JsonValue('APPROVED') approved,
  @JsonValue('REJECTED') rejected,
}

enum IdentityCheckStatus {
  @JsonValue('NONE') none,
  @JsonValue('PENDING') pending,
  @JsonValue('VERIFIED') verified,
  @JsonValue('FAILED') failed,
}

// ─── Items ───────────────────────────────────────────────────────────────────

enum ItemStatus {
  @JsonValue('AVAILABLE') available,
  @JsonValue('RESERVED') reserved,
  @JsonValue('SOLD') sold,
}

enum ListingKind {
  @JsonValue('SINGLE') single,
  @JsonValue('SHOPFRONT') shopfront,
}

// ─── Trades ──────────────────────────────────────────────────────────────────

enum TradeState {
  @JsonValue('NEGOTIATING') negotiating,
  @JsonValue('COLLATERAL_PENDING') collateralPending,
  @JsonValue('COLLATERAL_LOCKED') collateralLocked,
  @JsonValue('IN_TRANSIT') inTransit,
  @JsonValue('INSPECTION') inspection,
  @JsonValue('COMPLETED') completed,
  @JsonValue('DISPUTED') disputed,
  @JsonValue('FRAUD_RESOLVED') fraudResolved,
  @JsonValue('CANCELLED') cancelled,
}

enum TradeEvent {
  @JsonValue('TERMS_AGREED') termsAgreed,
  @JsonValue('OFFER_DECLINED') offerDeclined,
  @JsonValue('HOLDS_CONFIRMED') holdsConfirmed,
  @JsonValue('HOLDS_FAILED') holdsFailed,
  @JsonValue('BOTH_SHIPPED') bothShipped,
  @JsonValue('BOTH_RECEIVED') bothReceived,
  @JsonValue('BOTH_HANDOVER_CONFIRMED') bothHandoverConfirmed,
  @JsonValue('HANDOVER_FAILED') handoverFailed,
  @JsonValue('BOTH_ACCEPTED') bothAccepted,
  @JsonValue('INSPECTION_EXPIRED') inspectionExpired,
  @JsonValue('CONDITION_DISPUTE') conditionDispute,
  @JsonValue('DISPUTE_RESOLVED') disputeResolved,
  @JsonValue('FRAUD_CONFIRMED') fraudConfirmed,
}

enum TradeAction {
  @JsonValue('PROPOSE_TERMS') proposeTerms,
  @JsonValue('ACCEPT_TERMS') acceptTerms,
  @JsonValue('DECLINE_OFFER') declineOffer,
  @JsonValue('RECORD_SHIPMENT') recordShipment,
  @JsonValue('RECORD_RECEIPT') recordReceipt,
  @JsonValue('CONFIRM_HANDOVER') confirmHandover,
  @JsonValue('REPORT_HANDOVER_FAILED') reportHandoverFailed,
  @JsonValue('RECORD_ACCEPTANCE') recordAcceptance,
  @JsonValue('RAISE_DISPUTE') raiseDispute,
  @JsonValue('REPORT_FRAUD') reportFraud,
}

enum TradeCashDirection {
  @JsonValue('PROPOSER_PAYS') proposerPays,
  @JsonValue('COUNTERPART_PAYS') counterpartPays,
}

enum TradeFeeStatus {
  @JsonValue('PENDING') pending,
  @JsonValue('SETTLED') settled,
  @JsonValue('FAILED') failed,
  @JsonValue('REFUNDED') refunded,
}

// ─── Cash Sales ──────────────────────────────────────────────────────────────

enum CashSaleStatus {
  @JsonValue('AGREEMENT') agreement,
  @JsonValue('PAYMENT_PENDING') paymentPending,
  @JsonValue('ESCROW_HELD') escrowHeld,
  @JsonValue('IN_TRANSIT') inTransit,
  @JsonValue('HANDOVER') handover,
  @JsonValue('INSPECTION') inspection,
  @JsonValue('COMPLETED') completed,
  @JsonValue('DISPUTED') disputed,
  @JsonValue('CANCELLED') cancelled,
  @JsonValue('FAILED') failed,
  @JsonValue('REFUNDED') refunded,
}

enum CashSalePayoutStatus {
  @JsonValue('NOT_DUE') notDue,
  @JsonValue('PENDING') pending,
  @JsonValue('SETTLED') settled,
  @JsonValue('FAILED') failed,
}

// ─── Fulfilment ──────────────────────────────────────────────────────────────

enum HandoverMethod {
  @JsonValue('IN_PERSON') inPerson,
  @JsonValue('DELIVERY') delivery,
}

enum FulfilmentTrackingState {
  @JsonValue('LABEL_CREATED') labelCreated,
  @JsonValue('IN_TRANSIT') inTransit,
  @JsonValue('OUT_FOR_DELIVERY') outForDelivery,
  @JsonValue('DELIVERED') delivered,
  @JsonValue('EXCEPTION') exception,
  @JsonValue('UNKNOWN') unknown,
}

// ─── Holds ───────────────────────────────────────────────────────────────────

enum HoldStatus {
  @JsonValue('ACTIVE') active,
  @JsonValue('VOIDED') voided,
  @JsonValue('PARTIALLY_CAPTURED') partiallyCaptured,
  @JsonValue('FULLY_CAPTURED') fullyCaptured,
  @JsonValue('FAILED') failed,
  @JsonValue('EXPIRED') expired,
}

// ─── Offers ──────────────────────────────────────────────────────────────────

enum OfferStatus {
  @JsonValue('PENDING') pending,
  @JsonValue('ACCEPTED') accepted,
  @JsonValue('DECLINED') declined,
  @JsonValue('COUNTERED') countered,
  @JsonValue('WITHDRAWN') withdrawn,
}

// ─── Notifications ───────────────────────────────────────────────────────────

enum NotificationType {
  @JsonValue('OFFER') offer,
  @JsonValue('MESSAGE') message,
  @JsonValue('TRADE') trade,
  @JsonValue('SALE') sale,
  @JsonValue('SYSTEM') system,
}

// ─── Messages ────────────────────────────────────────────────────────────────

enum MessageKind {
  @JsonValue('USER') user,
  @JsonValue('SYSTEM') system,
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/// Whether a trade state is terminal (no further transitions possible).
bool isTerminalTradeState(TradeState state) {
  return state == TradeState.completed ||
      state == TradeState.fraudResolved ||
      state == TradeState.cancelled;
}

/// Whether a cash sale status is terminal.
bool isTerminalCashSaleStatus(CashSaleStatus status) {
  return status == CashSaleStatus.completed ||
      status == CashSaleStatus.cancelled ||
      status == CashSaleStatus.failed ||
      status == CashSaleStatus.refunded;
}

/// Maps a Postgres SNAKE_CASE enum string to a Dart enum value.
///
/// Example: parseEnum('IN_TRANSIT', TradeState.values) → TradeState.inTransit
T? parseEnum<T extends Enum>(String? value, List<T> values) {
  if (value == null) return null;
  final normalized = _snakeToCamel(value);
  for (final v in values) {
    if (v.name == normalized) return v;
  }
  return null;
}

/// Converts a Dart enum value to Postgres SNAKE_CASE string.
///
/// Example: enumToString(TradeState.inTransit) → 'IN_TRANSIT'
String enumToString<T extends Enum>(T value) {
  return _camelToSnake(value.name);
}

String _snakeToCamel(String snake) {
  final parts = snake.toLowerCase().split('_');
  return parts.first +
      parts.skip(1).map((p) => p.isEmpty ? '' : '${p[0].toUpperCase()}${p.substring(1)}').join('');
}

String _camelToSnake(String camel) {
  return camel.replaceAllMapped(
    RegExp(r'[A-Z]'),
    (m) => '_${m.group(0)!.toLowerCase()}',
  ).toUpperCase();
}
