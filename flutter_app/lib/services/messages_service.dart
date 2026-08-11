import '../core/api_routes.dart';
import '../core/result.dart';
import '../models/conversation.dart';
import '../models/message.dart';
import 'mobile_api_client.dart';
import 'supabase_service.dart';

/// Service for messaging / conversations.
///
/// Most reads go through Supabase directly (RLS handles access control).
/// Message sends and conversation creation go through the mobile API.
/// The `messages.read_at` direct update stays — RLS is the whole rule there.
class MessagesService {
  MessagesService(this._supabase, this._api);

  final SupabaseService _supabase;
  final MobileApiClient _api;

  // ─── Reads (direct Supabase, RLS-enforced) ──────────────────────────────────

  /// Fetch the current user's conversations.
  Future<List<Conversation>> getConversations() async {
    final userId = _supabase.currentUserId;
    if (userId == null) return [];

    final response = await _supabase
        .from('conversations')
        .select()
        .or('participant_a.eq.$userId,participant_b.eq.$userId')
        .order('last_message_at', ascending: false);

    return (response as List)
        .map((json) => Conversation.fromJson(json))
        .toList();
  }

  /// Fetch a single conversation by ID.
  Future<Conversation?> getConversation(String id) async {
    final response = await _supabase
        .from('conversations')
        .select()
        .eq('id', id)
        .maybeSingle();

    if (response == null) return null;
    return Conversation.fromJson(response);
  }

  /// Fetch messages for a conversation.
  Future<List<Message>> getMessages(
    String conversationId, {
    int limit = 50,
    int offset = 0,
  }) async {
    final response = await _supabase
        .from('messages')
        .select()
        .eq('conversation_id', conversationId)
        .order('created_at', ascending: false)
        .range(offset, offset + limit - 1);

    return (response as List)
        .map((json) => Message.fromJson(json))
        .toList()
        .reversed
        .toList();
  }

  /// Subscribe to new messages in a conversation (real-time).
  Stream<List<Message>> watchMessages(String conversationId) {
    return _supabase
        .client
        .schema('cardtrade')
        .from('messages')
        .stream(primaryKey: ['id'])
        .eq('conversation_id', conversationId)
        .order('created_at')
        .map((rows) => rows.map((j) => Message.fromJson(j)).toList());
  }

  // ─── Writes ─────────────────────────────────────────────────────────────────

  /// Get or create a conversation with a user about an item.
  /// Goes through the mobile API because the server action handles the
  /// de-duplication logic (find existing or create new).
  Future<Result<dynamic>> getOrCreateConversation({
    required String otherUserId,
    String? itemId,
  }) async {
    return _api.post(
      ApiRoutes.messagesGetOrCreate,
      body: {
        'otherUserId': otherUserId,
        if (itemId != null) 'itemId': itemId,
      },
    );
  }

  /// Send a message in a conversation.
  /// Goes through the mobile API rather than a direct insert so the server
  /// can handle notifications and metadata updates atomically.
  Future<Result<dynamic>> sendMessage({
    required String conversationId,
    required String body,
  }) async {
    return _api.post(
      ApiRoutes.messagesSend,
      body: {
        'conversationId': conversationId,
        'body': body,
      },
    );
  }

  /// Mark messages as read. Direct update stays — RLS is the whole rule here.
  Future<void> markAsRead(String conversationId) async {
    final userId = _supabase.currentUserId;
    if (userId == null) return;

    await _supabase
        .from('messages')
        .update({'read_at': DateTime.now().toIso8601String()})
        .eq('conversation_id', conversationId)
        .neq('sender_id', userId)
        .isFilter('read_at', null);
  }
}
