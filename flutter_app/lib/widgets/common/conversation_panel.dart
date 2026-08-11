import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme.dart';
import '../../features/messages/widgets/message_bubble.dart';
import '../../features/messages/widgets/message_input.dart';
import '../../models/message.dart';
import '../../providers/auth_provider.dart';
import '../../providers/messages_provider.dart';

/// A reusable, real-time conversation panel for embedding in contract rooms.
///
/// Displays message bubbles using the shared [MessageBubble] widget and
/// a [MessageInput] bar for sending messages. Backed by
/// [messagesStreamProvider] for Supabase Realtime updates.
///
/// Used in trade rooms, cash-sale rooms, and any other screen that
/// needs an integrated conversation view.
class ConversationPanel extends ConsumerStatefulWidget {
  const ConversationPanel({
    required this.conversationId,
    this.maxHeight = 300,
    super.key,
  });

  /// The conversation to subscribe to.
  final String conversationId;

  /// Maximum height of the message list area. Defaults to 300.
  final double maxHeight;

  @override
  ConsumerState<ConversationPanel> createState() => _ConversationPanelState();
}

class _ConversationPanelState extends ConsumerState<ConversationPanel> {
  @override
  Widget build(BuildContext context) {
    final messagesAsync = ref.watch(messagesStreamProvider(widget.conversationId));
    final currentUser = ref.watch(currentUserProvider);
    final currentUserId = currentUser?.id ?? '';
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        const Divider(),
        const SizedBox(height: AppTheme.spacingMd),
        Text('Messages', style: theme.textTheme.headlineSmall),
        const SizedBox(height: AppTheme.spacingMd),

        // ─── Message list ──────────────────────────────────────────
        messagesAsync.when(
          loading: () => const Center(
            child: Padding(
              padding: EdgeInsets.all(AppTheme.spacingXl),
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          ),
          error: (error, _) => Padding(
            padding: const EdgeInsets.all(AppTheme.spacingLg),
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.error_outline, color: AppTheme.danger),
                  const SizedBox(height: AppTheme.spacingSm),
                  Text(
                    'Failed to load messages',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: AppTheme.danger,
                    ),
                  ),
                ],
              ),
            ),
          ),
          data: (messages) {
            if (messages.isEmpty) {
              return Padding(
                padding: const EdgeInsets.all(AppTheme.spacingLg),
                child: Center(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.chat_bubble_outline,
                        size: 32,
                        color: AppTheme.muted,
                      ),
                      const SizedBox(height: AppTheme.spacingSm),
                      Text(
                        'No messages yet',
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: AppTheme.muted,
                        ),
                      ),
                    ],
                  ),
                ),
              );
            }

            return ConstrainedBox(
              constraints: BoxConstraints(maxHeight: widget.maxHeight),
              child: ListView.builder(
                shrinkWrap: true,
                reverse: true,
                itemCount: messages.length,
                itemBuilder: (context, index) {
                  final msg = messages[index];
                  final variant = _variantForMessage(msg, currentUserId);
                  // Show timestamp for the first message or when there's
                  // a gap of 5+ minutes from the next message above.
                  final showTimestamp = index == messages.length - 1 ||
                      msg.createdAt
                              .difference(messages[index + 1].createdAt)
                              .inMinutes
                              .abs() >=
                          5;

                  return MessageBubble(
                    body: msg.body,
                    variant: variant,
                    timestamp: msg.createdAt,
                    showTimestamp: showTimestamp,
                  );
                },
              ),
            );
          },
        ),
        const SizedBox(height: AppTheme.spacingSm),

        // ─── Message input ─────────────────────────────────────────
        MessageInput(
          onSubmit: (text) => _sendMessage(text),
        ),
      ],
    );
  }

  MessageBubbleVariant _variantForMessage(Message msg, String currentUserId) {
    if (msg.isSystem) return MessageBubbleVariant.system;
    if (msg.isMine(currentUserId)) return MessageBubbleVariant.sent;
    return MessageBubbleVariant.received;
  }

  void _sendMessage(String text) {
    if (text.isEmpty) return;
    final service = ref.read(messagesServiceProvider);
    service.sendMessage(
      conversationId: widget.conversationId,
      body: text,
    );
  }
}
