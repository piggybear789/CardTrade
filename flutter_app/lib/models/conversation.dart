import 'package:freezed_annotation/freezed_annotation.dart';

part 'conversation.freezed.dart';
part 'conversation.g.dart';

/// A conversation between two users, optionally linked to a listing/trade/sale.
@freezed
abstract class Conversation with _$Conversation {
  const factory Conversation({
    required String id,
    String? itemId,
    String? tradeId,
    String? cashSaleId,
    required String participantA,
    required String participantB,
    DateTime? lastMessageAt,
    required DateTime createdAt,
    // Joined display fields for list view
    String? otherParticipantName,
    String? otherParticipantAvatar,
    String? lastMessageBody,
    String? contextTitle,
    int? unreadCount,
  }) = _Conversation;

  const Conversation._();

  factory Conversation.fromJson(Map<String, dynamic> json) =>
      _$ConversationFromJson(json);

  /// Returns the other participant's ID given the current user.
  String otherParticipant(String currentUserId) =>
      currentUserId == participantA ? participantB : participantA;

  /// Whether this conversation has a linked contract.
  bool get hasContract => tradeId != null || cashSaleId != null;
}
