// One row in the conversation list, and the ONE place Req 9.8 and 9.9 are drawn.
//
// The row is three things: who, what they last said, and when. The name and the
// preview are both at the `body` level and separated by WEIGHT and by token rather
// than by size, which is the Subtext_Rule — the preview was a smaller face before,
// so a long thread list read as two type scales interleaved.
//
// Unread is signalled three ways, not one: the name and preview go semibold, and a
// marker carries the count. Weight and a number both survive greyscale, which is
// what Req 13.11 asks for and what a coloured dot alone would fail.
//
// The relative time comes from `core/relative_time.dart`, whose ladder is the
// web's. `timeago` disagreed with it at every boundary — "a moment ago" under 45
// seconds, "about an hour ago" at 50 minutes — so the two clients reported
// different ages for the same message.
//
// Requirements 9.8, 9.9, 13.6, 13.7, 13.10, 13.11.

import 'package:flutter/material.dart';

import 'package:cardtrade/core/relative_time.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/models/conversation.dart';
import 'package:cardtrade/widgets/common/avatar.dart';

/// A single row in the conversations list.
class ConversationTile extends StatelessWidget {
  const ConversationTile({
    required this.conversation,
    required this.onTap,
    this.now,
    super.key,
  });

  /// The conversation to display.
  final Conversation conversation;

  /// Called when the tile is tapped.
  final VoidCallback onTap;

  /// The instant the relative time is measured against. Injected only by tests.
  final DateTime? now;

  int get _unreadCount => conversation.unreadCount ?? 0;

  bool get _isUnread => _unreadCount > 0;

  /// A short label naming the contract this conversation belongs to, if any.
  String? get _contextLabel {
    if (conversation.tradeId != null) return 'Trade';
    if (conversation.cashSaleId != null) return 'Sale';
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final String name = conversation.otherParticipantName ?? 'NoDitto member';
    final String? label = _contextLabel;
    final FontWeight nameWeight =
        _isUnread ? FontWeight.w700 : FontWeight.w600;

    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.cozy,
          vertical: AppSpacing.cozy,
        ),
        child: ConstrainedBox(
          // The whole row is the control, so its own height is the hit area and
          // `TapTarget` has nothing to add.
          constraints: const BoxConstraints(minHeight: AppMetrics.minHitArea),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            spacing: AppSpacing.cozy,
            children: <Widget>[
              Avatar(
                imageUrl: conversation.otherParticipantAvatar,
                displayName: name,
                size: AvatarSize.md,
              ),

              // ─── Name, preview ───────────────────────────────────────
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: <Widget>[
                    Row(
                      spacing: AppSpacing.snug,
                      children: <Widget>[
                        Flexible(
                          child: Text(
                            name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppText.rowName.copyWith(fontWeight: nameWeight),
                          ),
                        ),
                        if (label != null) _ContextBadge(label: label),
                      ],
                    ),
                    const SizedBox(height: AppSpacing.tight),
                    Text(
                      conversation.lastMessageBody ?? '',
                      // Req 9.8: the preview is the one line in this row that is
                      // deliberately truncated — a list of previews that wrapped
                      // would be a list of paragraphs.
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: _isUnread
                          ? AppText.supportText.copyWith(fontWeight: FontWeight.w600)
                          : AppText.supportText,
                    ),
                  ],
                ),
              ),

              // ─── Time, unread marker ─────────────────────────────────
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                mainAxisSize: MainAxisSize.min,
                children: <Widget>[
                  if (conversation.lastMessageAt != null)
                    Text(
                      relativeTimeLabel(conversation.lastMessageAt!, now: now),
                      style: AppText.metaText,
                    ),
                  if (_isUnread) ...<Widget>[
                    const SizedBox(height: AppSpacing.tight),
                    _UnreadMarker(count: _unreadCount),
                  ],
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The `Trade` / `Sale` eyebrow beside a name, when the thread has a contract.
class _ContextBadge extends StatelessWidget {
  const _ContextBadge({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.snug),
        decoration: BoxDecoration(
          color: AppTint.eyebrow.fill,
          border: Border.all(
            color: AppTint.eyebrow.edge!,
            width: AppMetrics.hairline,
          ),
          borderRadius: BorderRadius.circular(AppRadius.full),
        ),
        child: Text(
          label,
          style: AppText.badgeText.copyWith(color: AppTint.eyebrow.ink),
        ),
      );
}

/// The unread count, as a number and not only as a colour (Req 9.9, 13.11).
class _UnreadMarker extends StatelessWidget {
  const _UnreadMarker({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) {
    final String text = count > 99 ? '99+' : '$count';
    return Semantics(
      // Spoken as a count rather than as a bare number, so a screen reader does
      // not read the marker as part of the relative time above it.
      label: count == 1 ? '1 unread message' : '$count unread messages',
      child: ExcludeSemantics(
        child: Container(
          constraints: const BoxConstraints(
            minWidth: AppSpacing.group,
            minHeight: AppSpacing.group,
          ),
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.tight),
          decoration: BoxDecoration(
            color: AppColors.primary,
            borderRadius: BorderRadius.circular(AppRadius.full),
          ),
          alignment: Alignment.center,
          child: Text(
            text,
            style: AppText.badgeText.copyWith(color: AppColors.primaryForeground),
          ),
        ),
      ),
    );
  }
}
