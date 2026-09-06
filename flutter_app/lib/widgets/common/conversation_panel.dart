import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/result.dart';
import '../../core/theme.dart';
import '../../features/messages/widgets/message_input.dart';
import '../../features/messages/widgets/message_thread.dart';
import '../../providers/auth_provider.dart';
import '../../providers/messages_provider.dart';
import 'error_view.dart';

/// The conversation region a contract room embeds, and the ONE conversation
/// surface both rooms use, so a message renders identically in a room and in a
/// standalone thread (Req 7.8).
///
/// Presentation only: [MessageThread] owns the bubbles, the runs and their single
/// timestamps, and [MessageInput] owns the composer. This widget owns the region's
/// frame — the label, the spacing steps between its parts, and its loading, failed
/// and empty states.
///
/// It previously carried its own copy of the run rule, which is why the panel and
/// the standalone screen disagreed about when to draw a clock. That rule now lives
/// once, in `message_runs.dart`.
class ConversationPanel extends ConsumerStatefulWidget {
  const ConversationPanel({
    required this.conversationId,
    this.maxHeight = _defaultMaxHeight,
    super.key,
  });

  /// The conversation to subscribe to.
  final String conversationId;

  /// Maximum height of the message list area.
  final double maxHeight;

  /// Roughly four bubbles: enough to read the last exchange without the room's
  /// own regions scrolling out of reach.
  static const double _defaultMaxHeight = 300;

  @override
  ConsumerState<ConversationPanel> createState() => _ConversationPanelState();
}

class _ConversationPanelState extends ConsumerState<ConversationPanel> {
  @override
  Widget build(BuildContext context) {
    final messagesAsync = ref.watch(messagesStreamProvider(widget.conversationId));
    final currentUser = ref.watch(currentUserProvider);
    final currentUserId = currentUser?.id ?? '';

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        const Divider(),
        const SizedBox(height: AppSpacing.cozy),
        Text(
          'Messages',
          style: AppType.subhead.copyWith(
            fontWeight: FontWeight.w600,
            color: AppColors.foreground,
          ),
        ),
        const SizedBox(height: AppSpacing.snug),

        // ─── Message list ──────────────────────────────────────────
        messagesAsync.when(
          loading: () => const Center(
            child: Padding(
              padding: EdgeInsets.all(AppSpacing.group),
              child: CircularProgressIndicator(strokeWidth: 2),
            ),
          ),
          error: (error, _) => Padding(
            padding: const EdgeInsets.all(AppSpacing.cozy),
            child: Center(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const ExcludeSemantics(
                    child: Icon(
                      Icons.error_outline,
                      size: AppIconSize.large,
                      color: AppColors.destructive,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.tight),
                  Text(
                    'Failed to load messages',
                    style: AppText.bodyText.copyWith(color: AppColors.destructive),
                  ),
                ],
              ),
            ),
          ),
          data: (messages) => ConstrainedBox(
            constraints: BoxConstraints(maxHeight: widget.maxHeight),
            child: MessageThread(
              messages: messages,
              currentUserId: currentUserId,
              shrinkWrap: true,
              // The room already insets its own regions horizontally, so the
              // thread adds only the vertical rhythm here.
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.snug),
              emptyHint: 'No messages yet',
            ),
          ),
        ),
        const SizedBox(height: AppSpacing.snug),

        // ─── Message input ─────────────────────────────────────────
        MessageInput(onSubmit: _sendMessage),
      ],
    );
  }

  /// Sends [text], returning null on success or the failure's own words, so the
  /// composer can put the draft back rather than losing it (Req 9.7).
  Future<String?> _sendMessage(String text) async {
    final service = ref.read(messagesServiceProvider);
    final Result<dynamic> result = await service.sendMessage(
      conversationId: widget.conversationId,
      body: text,
    );
    if (result.isOk) return null;
    return ErrorView.sanitise(result.errorMessage);
  }
}
