import 'package:freezed_annotation/freezed_annotation.dart';
import 'enums.dart';

part 'profile.freezed.dart';
part 'profile.g.dart';

/// Full profile for the authenticated user.
@freezed
abstract class Profile with _$Profile {
  const factory Profile({
    required String id,
    required String displayName,
    required String contactEmail,
    String? payerId,
    String? paymentMethodLabel,
    String? paymentSourceId,
    String? merchantRef,
    required MerchantStatus merchantStatus,
    @Default(false) bool merchantSettlementsEnabled,
    double? rating,
    @Default(0) int ratingCount,
    @Default(false) bool isAdmin,
    @Default(false) bool isSupport,
    String? regionCode,
    String? avatarPath,
    required IdentityCheckStatus identityCheckStatus,
    String? identityCheckName,
    String? identityCheckSessionId,
    DateTime? identityCheckVerifiedAt,
    DateTime? onboardingCompletedAt,
    DateTime? fraudBannedAt,
    required DateTime createdAt,
    required DateTime updatedAt,
  }) = _Profile;

  const Profile._();

  factory Profile.fromJson(Map<String, dynamic> json) => _$ProfileFromJson(json);

  /// Whether this profile has passed the Identity Gate.
  bool get isVerified => identityCheckStatus == IdentityCheckStatus.verified;

  /// Whether this profile can receive funds (payout setup complete).
  bool get canReceiveFunds =>
      merchantStatus == MerchantStatus.approved &&
      merchantSettlementsEnabled &&
      merchantRef != null;

  /// Whether this profile is banned for fraud.
  bool get isFraudBanned => fraudBannedAt != null;
}

/// Public-facing profile visible to other users.
@freezed
abstract class PublicProfile with _$PublicProfile {
  const factory PublicProfile({
    required String id,
    required String displayName,
    double? rating,
    @Default(0) int ratingCount,
    @Default(false) bool isVerified,
    String? regionCode,
    String? avatarPath,
    required IdentityCheckStatus identityCheckStatus,
    String? identityCheckName,
  }) = _PublicProfile;

  factory PublicProfile.fromJson(Map<String, dynamic> json) =>
      _$PublicProfileFromJson(json);
}
