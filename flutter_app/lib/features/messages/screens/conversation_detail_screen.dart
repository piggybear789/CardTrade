import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:cardtrade/core/result.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/providers/auth_provider.dart';
import 'package:cardtrade/providers/messages_provider.dart';
import 'package:cardtrade/widgets/common/controls.dart';
import 'package:cardtrade/widgets/common/error_view.dart';
import 'package:cardtrade/widgets/common/loading_indicator.dart';
import 'package:cardtrade/features/messages/widgets/message_input.dart';
import 'package:cardtrade/features/messages/widgets/message_thread.dart';

/// The standalone conversation screen.
///
/// It owns the chrome, the pinned contract card and the transport; the thread's
/// bubbles, runs and timestamps are [MessageThread]'s, and the composer's bounds
/// and its retry behaviour are [MessageInput]'s. The screen used to carry its own
/// copy of the grouping rule — a stamp after ten minutes rather than the five
/// Req 9.4 fixes — which is why the same conversation grouped differently here
/// and in a contract room.
///
/// Requirements 9.1, 9.4, 9.6, 9.7, 11.4.
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

  /// Sends [text], returning null on success or the failure's own words.
  ///
  /// Req 9.7: the result is READ rather than discarded, so the composer can put
  /// the draft back and say what failed. The explanation goes through
  /// [ErrorView.sanitise] because the transport's message can be a provider
  /// exception, and a table name or a `pi_…` reference is a disclosure (Req 11.4).
  Future<String?> _sendMessage(String text) async {
    final service = ref.read(messagesServiceProvider);
    final Result<dynamic> result = await service.sendMessage(
      conversationId: widget.conversationId,
      body: text,
    );
    if (result.isOk) return null;
    return ErrorView.sanitise(result.errorMessage);
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
    final otherName = conversation.value?.otherParticipantName ?? 'Chat';

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
              loading: () => const LoadingIndicator(),
              error: (error, _) => ErrorView(
                message: error.toString(),
                onRetry: () => ref.invalidate(
                  messagesStreamProvider(widget.conversationId),
                ),
              ),
              data: (messages) => MessageThread(
                messages: messages,
                currentUserId: currentUser?.id ?? '',
                controller: _scrollController,
                emptyHint: 'No messages yet. Say hello to start the conversation.',
              ),
            ),
          ),

          // ─── Input Bar ───────────────────────────────────────────
          MessageInput(onSubmit: _sendMessage),
        ],
      ),
    );
  }
}

/// The pinned contract card below the chrome: what this thread is about, and the
/// one way into the room that owns it.
///
/// It states where the contract lives and hands off. It deliberately holds no
/// control that changes the contract — those belong to the room, which is the only
/// surface with the whole record in front of it.
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
    return DecoratedBox(
      decoration: const BoxDecoration(
        color: AppColors.card,
        border: Border(
          bottom: BorderSide(color: AppColors.border, width: AppMetrics.hairline),
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.cozy),
        child: Row(
          spacing: AppSpacing.cozy,
          children: [
            // The contract's stand-in, at the same 40 pixels a control is drawn
            // at, so the row's height is set by one number rather than by a
            // hand-tuned thumbnail.
            Container(
              width: AppMetrics.controlHeight,
              height: AppMetrics.controlHeight,
              decoration: BoxDecoration(
                color: AppColors.muted,
                borderRadius: BorderRadius.circular(AppRadius.md),
              ),
              child: const ExcludeSemantics(
                child: Icon(
                  Icons.receipt_long_outlined,
                  size: AppIconSize.large,
                  color: AppColors.mutedForeground,
                ),
              ),
            ),

            // Title + subtitle
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    _label,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: AppText.rowName,
                  ),
                  const Text(
                    'The contract is handled in its own room',
                    maxLines: 2,
                    style: AppText.metaText,
                  ),
                ],
              ),
            ),

            AppButton(
              label: 'Open contract',
              variant: AppButtonVariant.primary,
              onPressed: () {
                if (tradeId != null) {
                  context.push('/trades/$tradeId');
                } else if (cashSaleId != null) {
                  context.push('/sales/$cashSaleId');
                }
              },
            ),
          ],
        ),
      ),
    );
  }
}
