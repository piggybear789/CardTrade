import 'package:freezed_annotation/freezed_annotation.dart';

part 'review.freezed.dart';
part 'review.g.dart';

/// A review left after a completed transaction.
@freezed
abstract class Review with _$Review {
  const factory Review({
    required String id,
    required String reviewerId,
    required String revieweeId,
    required int rating,
    String? comment,
    required String sourceType,
    required String sourceId,
    required DateTime createdAt,
    // Joined reviewer info
    String? reviewerDisplayName,
    String? reviewerAvatarPath,
  }) = _Review;

  factory Review.fromJson(Map<String, dynamic> json) => _$ReviewFromJson(json);
}
