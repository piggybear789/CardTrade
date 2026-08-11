import 'package:freezed_annotation/freezed_annotation.dart';
import 'enums.dart';

part 'pre_auth_hold.freezed.dart';
part 'pre_auth_hold.g.dart';

/// A pre-authorization hold (trade collateral).
///
/// This is a temporary card hold — no money moves. The platform holds a claim,
/// not funds. Member-facing copy always explains this.
@freezed
abstract class PreAuthHold with _$PreAuthHold {
  const factory PreAuthHold({
    required String id,
    required String tradeId,
    required String traderId,
    String? holdRef,
    required int amountCents,
    @Default(0) int capturedCents,
    required HoldStatus status,
    DateTime? expiresAt,
    required DateTime createdAt,
    required DateTime updatedAt,
  }) = _PreAuthHold;

  const PreAuthHold._();

  factory PreAuthHold.fromJson(Map<String, dynamic> json) =>
      _$PreAuthHoldFromJson(json);

  /// Whether this hold is still active (can be captured or voided).
  bool get isActive => status == HoldStatus.active;

  /// Whether this hold has expired.
  bool get isExpired =>
      status == HoldStatus.expired ||
      (expiresAt != null && DateTime.now().isAfter(expiresAt!));

  /// Amount remaining after partial capture.
  int get remainingCents => amountCents - capturedCents;
}
