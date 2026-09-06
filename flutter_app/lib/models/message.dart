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
    // ─── Attachment metadata (migration 0100) ──────────────────────────────
    //
    // Read-only here. These four columns already come down with the `select()`
    // the messages service issues; naming them lets the bubble present what a
    // message carries (Req 9.5) instead of silently dropping it, which is what
    // it did before. The bucket is PRIVATE, so a stored path is not a URL:
    // resolving one needs the participation-checked signing the website does
    // server-side, and there is no mobile endpoint for it. The bubble therefore
    // takes a resolved URL as a parameter and presents the unavailable branch
    // without one — see `.kiro/specs/mobile-parity/` for that gap.
    String? attachmentPath,
    String? attachmentName,
    String? attachmentMime,
    int? attachmentBytes,
  }) = _Message;

  const Message._();

  factory Message.fromJson(Map<String, dynamic> json) =>
      _$MessageFromJson(json);

  /// Whether this is a system-generated message.
  bool get isSystem => kind == MessageKind.system;

  /// Whether this message carries a file. The four attachment columns are
  /// all-or-nothing by CHECK constraint, so the path alone answers it.
  bool get hasAttachment => attachmentPath != null;

  /// Whether the attachment is a picture rather than a document.
  bool get isImageAttachment => (attachmentMime ?? '').startsWith('image/');

  /// Whether this message has been read.
  bool get isRead => readAt != null;

  /// Whether this message was sent by the given user.
  bool isMine(String currentUserId) => senderId == currentUserId;
}
