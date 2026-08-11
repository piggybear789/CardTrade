import 'package:freezed_annotation/freezed_annotation.dart';
import 'enums.dart';

part 'message.freezed.dart';
part 'message.g.dart';

/// A single message within a conversation.
@freezed
abstract class Message with _$Message {
  const factory Message({
    required String id,
    required String conversationId,
    String? senderId,
    required MessageKind kind,
    String? systemEvent,
    required String body,
    DateTime? readAt,
    required DateTime createdAt,
  }) = _Message;

  const Message._();

  factory Message.fromJson(Map<String, dynamic> json) =>
      _$MessageFromJson(json);

  /// Whether this is a system-generated message.
  bool get isSystem => kind == MessageKind.system;

  /// Whether this message has been read.
  bool get isRead => readAt != null;

  /// Whether this message was sent by the given user.
  bool isMine(String currentUserId) => senderId == currentUserId;
}
