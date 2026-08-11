import 'package:freezed_annotation/freezed_annotation.dart';
import 'enums.dart';

part 'notification.freezed.dart';
part 'notification.g.dart';

/// An in-app notification for the user.
@freezed
abstract class AppNotification with _$AppNotification {
  const factory AppNotification({
    required String id,
    required String userId,
    required NotificationType type,
    required String title,
    String? body,
    String? link,
    DateTime? readAt,
    required DateTime createdAt,
  }) = _AppNotification;

  const AppNotification._();

  factory AppNotification.fromJson(Map<String, dynamic> json) =>
      _$AppNotificationFromJson(json);

  /// Whether this notification has been read.
  bool get isRead => readAt != null;
}
