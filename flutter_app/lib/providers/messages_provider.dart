import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/conversation.dart';
import '../models/message.dart';
import '../services/messages_service.dart';
import 'auth_provider.dart';

/// Provides the MessagesService.
final messagesServiceProvider = Provider<MessagesService>((ref) {
  return MessagesService(
    ref.watch(supabaseServiceProvider),
    ref.watch(mobileApiClientProvider),
  );
});

/// The current user's conversations.
final conversationsProvider = FutureProvider<List<Conversation>>((ref) async {
  ref.watch(currentUserProvider);
  final service = ref.read(messagesServiceProvider);
  return service.getConversations();
});

/// Messages for a conversation (real-time).
final messagesStreamProvider =
    StreamProvider.family<List<Message>, String>((ref, conversationId) {
  final service = ref.read(messagesServiceProvider);
  return service.watchMessages(conversationId);
});

/// Total unread message count across all conversations.
final unreadMessagesCountProvider = FutureProvider<int>((ref) async {
  ref.watch(currentUserProvider);
  final supabase = ref.read(supabaseServiceProvider);
  final userId = supabase.currentUserId;
  if (userId == null) return 0;

  final response = await supabase
      .from('messages')
      .select('id')
      .neq('sender_id', userId)
      .isFilter('read_at', null);

  return (response as List).length;
});
