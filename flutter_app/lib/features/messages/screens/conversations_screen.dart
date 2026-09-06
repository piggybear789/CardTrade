// The inbox — every conversation, most recent first.
//
// One of the three lists Req 11.7 names, and the one whose loading state was worst
// served: a centred spinner for a screen whose shape is entirely predictable. It is
// now a row placeholder that reserves the avatar and both lines of copy, so the
// resolved rows land where the placeholder stood (Req 11.1).
//
// The rest — the 200 ms/500 ms skeleton boundary, the explanation naming the
// request, the single-flight pull, and keeping the conversations on screen when a
// refresh fails offline — is `AsyncStateView`.
//
// Requirements 11.1, 11.3–11.6, 11.8, 11.10.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/models/conversation.dart';
import 'package:cardtrade/providers/messages_provider.dart';
import 'package:cardtrade/widgets/common/avatar.dart';
import 'package:cardtrade/widgets/common/empty_state.dart';
import 'package:cardtrade/widgets/common/load_state.dart';
import 'package:cardtrade/widgets/common/skeleton.dart';
import 'package:cardtrade/features/messages/widgets/conversation_tile.dart';

/// WhatsApp-style conversations list screen.
class ConversationsScreen extends ConsumerWidget {
  const ConversationsScreen({super.key});

  /// Placeholder rows drawn while the first read runs.
  static const int _skeletonRows = 8;

  /// What a failure or a failed refresh calls this request, in member terms.
  static const String _operation = 'your messages';

  /// Inset to the row's text column: the row's own leading pad, the avatar, and
  /// the gap after it. Composed from the row's metrics rather than hand-added, so
  /// moving the avatar size moves this too.
  static double get _separatorIndent =>
      AppSpacing.cozy + AvatarSize.md.diameter + AppSpacing.cozy;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(title: const Text('Messages')),
      body: AsyncStateView<List<Conversation>>(
        value: ref.watch(conversationsProvider),
        operation: _operation,
        onRetry: () async {
          ref.invalidate(conversationsProvider);
          await ref.read(conversationsProvider.future);
        },
        loadingAnnouncement: 'Loading your messages',
        skeleton: (_) => ListView.separated(
          physics: const AlwaysScrollableScrollPhysics(),
          itemCount: _skeletonRows,
          separatorBuilder: (_, _) => Divider(indent: _separatorIndent),
          itemBuilder: (_, _) => const SkeletonListTile(),
        ),
        builder: (context, conversations) {
          if (conversations.isEmpty) {
            return const PullableFill(
              child: EmptyState(
                icon: Icons.chat_bubble_outline_rounded,
                title: 'No messages yet',
                subtitle:
                    'Start a conversation by making an offer or opening a trade.',
              ),
            );
          }

          return ListView.separated(
            physics: const AlwaysScrollableScrollPhysics(),
            itemCount: conversations.length,
            separatorBuilder: (_, _) => Divider(indent: _separatorIndent),
            itemBuilder: (context, index) {
              final conversation = conversations[index];
              return ConversationTile(
                conversation: conversation,
                onTap: () => context.push('/messages/${conversation.id}'),
              );
            },
          );
        },
      ),
    );
  }
}
