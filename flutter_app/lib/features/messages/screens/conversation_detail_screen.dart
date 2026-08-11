import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/models/message.dart';
import 'package:cardtrade/providers/auth_provider.dart';
import 'package:cardtrade/providers/messages_provider.dart';
import 'package:cardtrade/widgets/common/error_view.dart';
import 'package:cardtrade/features/messages/widgets/message_bubble.dart';
import 'package:cardtrade/features/messages/widgets/message_input.dart';

/// Real-time chat screen for a single conversation.
///
/// Uses reverse ListView for chat-style scrolling, marks messages as read
/// on open, and provides a send input bar at the bottom. Shows a pinned
/// contract card below the AppBar when linked to a trade or sale.
class ConversationDetailScreen extends ConsumerStatefulWidget {
  const ConversationDetailScreen({
    required this.conversationId,
    super.key,
  });

  /// The ID of the conversation to display.
  final String conversationId;

  @override
  ConsumerState<ConversationDetailScreen> createState() =>
      _ConversationDetailScreenState();
}

class _ConversationDetailScreenState
    extends ConsumerState<ConversationDetailScreen> {
  final ScrollController _scrollController = ScrollController();

  @override
  void initState() {
    super.initState();
    // Mark messages as read on open
    WidgetsBinding.instance.addPostFrameCallback((_) {
      _markAsRead();
    });
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _markAsRead() async {
    final service = ref.read(messagesServiceProvider);
    await service.markAsRead(widget.conversationId);
    ref.invalidate(conversationsProvider);
  }

  Future<void> _sendMessage(String text) async {
    final service = ref.read(messagesServiceProvider);
    await service.sendMessage(
      conversationId: widget.conversationId,
      body: text,
    );
  }

  /// Determines whether to show a timestamp for this message.
  ///
  /// Shows timestamp if it's the first message, or if more than 10 minutes
  /// have passed since the previous message.
  bool _shouldShowTimestamp(List<Message> messages, int index) {
    // Messages are reversed, so index 0 is the newest
    if (index == messages.length - 1) return true;
    final current = messages[index];
    final previous = messages[index + 1];
    final diff = current.createdAt.difference(previous.createdAt).inMinutes;
    return diff.abs() >= 10;
  }

  @override
  Widget build(BuildContext context) {
    final messagesAsync =
        ref.watch(messagesStreamProvider(widget.conversationId));
    final conversationsAsync = ref.watch(conversationsProvider);
    final currentUser = ref.watch(currentUserProvider);

    // Find the conversation to check for contract link
    final conversation = conversationsAsync.whenData((list) {
      return list.where((c) => c.id == widget.conversationId).firstOrNull;
    });

    final hasContract = conversation.value?.hasContract ?? false;
    final tradeId = conversation.value?.tradeId;
    final cashSaleId = conversation.value?.cashSaleId;
    final contextTitle = conversation.value?.contextTitle;
    final otherName =
        conversation.value?.otherParticipantName ?? 'Chat';

    return Scaffold(
      appBar: AppBar(
        title: Text(otherName),
      ),
      body: Column(
        children: [
          // ─── Pinned Contract Card ──────────────────────────────────
          if (hasContract)
            _ContractCard(
              contextTitle: contextTitle,
              tradeId: tradeId,
              cashSaleId: cashSaleId,
            ),

          // ─── Messages List ───────────────────────────────────────
          Expanded(
            child: messagesAsync.when(
              loading: () =>
                  const Center(child: CircularProgressIndicator()),
              error: (error, _) => ErrorView(
                message: error.toString(),
                onRetry: () => ref.invalidate(
                  messagesStreamProvider(widget.conversationId),
                ),
              ),
              data: (messages) {
                if (messages.isEmpty) {
                  return Center(
                    child: Text(
                      'No messages yet. Say hello!',
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                            color: AppTheme.muted,
                          ),
                    ),
                  );
                }

                return ListView.builder(
                  controller: _scrollController,
                  reverse: true,
                  padding: const EdgeInsets.symmetric(
                    vertical: AppTheme.spacingSm,
                  ),
                  itemCount: messages.length,
                  itemBuilder: (context, index) {
                    final message = messages[index];
                    final showTime =
                        _shouldShowTimestamp(messages, index);

                    if (message.isSystem) {
                      return MessageBubble(
                        body: message.body,
                        variant: MessageBubbleVariant.system,
                        timestamp: message.createdAt,
                        showTimestamp: showTime,
                      );
                    }

                    final isMine =
                        message.isMine(currentUser?.id ?? '');

                    return MessageBubble(
                      body: message.body,
                      variant: isMine
                          ? MessageBubbleVariant.sent
                          : MessageBubbleVariant.received,
                      timestamp: message.createdAt,
                      showTimestamp: showTime,
                    );
                  },
                );
              },
            ),
          ),

          // ─── Input Bar ───────────────────────────────────────────
          MessageInput(onSubmit: _sendMessage),
        ],
      ),
    );
  }
}

/// Xianyu-style pinned contract card shown below the AppBar.
class _ContractCard extends StatelessWidget {
  const _ContractCard({
    required this.contextTitle,
    required this.tradeId,
    required this.cashSaleId,
  });

  final String? contextTitle;
  final String? tradeId;
  final String? cashSaleId;

  String get _label {
    if (contextTitle != null && contextTitle!.isNotEmpty) return contextTitle!;
    if (tradeId != null) return 'Trade';
    return 'Sale';
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppTheme.spacingMd),
      decoration: const BoxDecoration(
        color: AppTheme.surface,
        border: Border(
          bottom: BorderSide(color: AppTheme.border, width: 0.5),
        ),
      ),
      child: Row(
        children: [
          // Item thumbnail placeholder
          Container(
            width: 44,
            height: 44,
            decoration: BoxDecoration(
              color: AppTheme.surfaceVariant,
              borderRadius: BorderRadius.circular(6),
            ),
            child: const Icon(
              Icons.receipt_long_outlined,
              size: 20,
              color: AppTheme.muted,
            ),
          ),
          const SizedBox(width: AppTheme.spacingMd),

          // Title + subtitle
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _label,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppTheme.rowName.copyWith(fontSize: 12),
                ),
                const SizedBox(height: 2),
                const Text(
                  'Tap to view contract',
                  style: AppTheme.metaText,
                ),
              ],
            ),
          ),
          const SizedBox(width: AppTheme.spacingMd),

          // View button
          SizedBox(
            height: 28,
            child: FilledButton(
              onPressed: () {
                if (tradeId != null) {
                  context.push('/trades/$tradeId');
                } else if (cashSaleId != null) {
                  context.push('/sales/$cashSaleId');
                }
              },
              style: FilledButton.styleFrom(
                backgroundColor: AppTheme.gold,
                foregroundColor: AppTheme.surface,
                padding: const EdgeInsets.symmetric(horizontal: 12),
                textStyle: Theme.of(context).textTheme.labelSmall,
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                ),
              ),
              child: const Text('View'),
            ),
          ),
        ],
      ),
    );
  }
}
