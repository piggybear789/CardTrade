import 'package:flutter/material.dart';

import 'package:cardtrade/core/extensions.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/models/conversation.dart';
import 'package:cardtrade/widgets/common/avatar.dart';

/// A single row in the conversations list — Xianyu-style layout.
///
/// Three-column layout: avatar (with unread badge), content (name + badge,
/// last message, timestamp), and optional item thumbnail placeholder.
class ConversationTile extends StatelessWidget {
  const ConversationTile({
    required this.conversation,
    required this.onTap,
    super.key,
  });

  /// The conversation to display.
  final Conversation conversation;

  /// Called when the tile is tapped.
  final VoidCallback onTap;

  bool get _isUnread => (conversation.unreadCount ?? 0) > 0;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppTheme.spacingLg,
          vertical: AppTheme.spacingLg,
        ),
        child: ConstrainedBox(
          constraints: const BoxConstraints(minHeight: 48),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // ─── Avatar with unread badge ─────────────────────────
              _AvatarWithBadge(
                imageUrl: conversation.otherParticipantAvatar,
                displayName: conversation.otherParticipantName,
                unreadCount: conversation.unreadCount ?? 0,
              ),
              const SizedBox(width: AppTheme.spacingMd),

              // ─── Middle content ──────────────────────────────────
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    // Row 1: Name + status badge
                    Row(
                      children: [
                        Flexible(
                          child: Text(
                            conversation.otherParticipantName ?? 'Unknown',
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: AppTheme.rowName.copyWith(
                              fontWeight: _isUnread ? FontWeight.w700 : FontWeight.w600,
                              color: AppTheme.primary,
                            ),
                          ),
                        ),
                        if (_statusLabel != null) ...[
                          const SizedBox(width: AppTheme.spacingSm),
                          Container(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 5,
                              vertical: 1,
                            ),
                            decoration: BoxDecoration(
                              color: AppTheme.parchment,
                              borderRadius:
                                  BorderRadius.circular(AppTheme.radiusFull),
                            ),
                            child: Text(
                              _statusLabel!,
                              style: AppTheme.badgeText.copyWith(
                                color: AppTheme.secondary,
                              ),
                            ),
                          ),
                        ],
                      ],
                    ),
                    const SizedBox(height: 2),

                    // Row 2: Last message preview
                    Text(
                      conversation.lastMessageBody ?? '',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: _isUnread
                          ? AppTheme.supportText.copyWith(
                              color: AppTheme.primary,
                              fontWeight: FontWeight.w500,
                            )
                          : AppTheme.supportText,
                    ),
                    const SizedBox(height: 2),

                    // Row 3: Relative timestamp
                    if (conversation.lastMessageAt != null)
                      Text(
                        conversation.lastMessageAt!.timeAgo,
                        style: AppTheme.metaText,
                      ),
                  ],
                ),
              ),

              // ─── Right: item thumbnail placeholder ────────────────
              if (conversation.contextTitle != null) ...[
                const SizedBox(width: AppTheme.spacingMd),
                Container(
                  width: 44,
                  height: 44,
                  decoration: BoxDecoration(
                    color: AppTheme.surfaceVariant,
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: const Icon(
                    Icons.image_outlined,
                    size: 20,
                    color: AppTheme.muted,
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  /// Derives a short status label from the contract link.
  String? get _statusLabel {
    if (conversation.tradeId != null) return 'Trade';
    if (conversation.cashSaleId != null) return 'Sale';
    return null;
  }
}

/// Avatar circle with an overlaid unread count badge (top-right).
class _AvatarWithBadge extends StatelessWidget {
  const _AvatarWithBadge({
    required this.imageUrl,
    required this.displayName,
    required this.unreadCount,
  });

  final String? imageUrl;
  final String? displayName;
  final int unreadCount;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 48,
      height: 48,
      child: Stack(
        children: [
          Positioned(
            left: 0,
            top: 2,
            child: SizedBox(
              width: 44,
              height: 44,
              child: Avatar(
                imageUrl: imageUrl,
                displayName: displayName,
                size: AvatarSize.md,
              ),
            ),
          ),
          if (unreadCount > 0)
            Positioned(
              right: 0,
              top: 0,
              child: Container(
                constraints: const BoxConstraints(
                  minWidth: 16,
                  minHeight: 16,
                ),
                padding: const EdgeInsets.symmetric(horizontal: 4),
                decoration: BoxDecoration(
                  color: AppTheme.danger,
                  borderRadius: BorderRadius.circular(8),
                ),
                alignment: Alignment.center,
                child: Text(
                  unreadCount > 99 ? '99+' : '$unreadCount',
                  style: AppTheme.badgeText.copyWith(
                    color: Colors.white,
                    fontSize: 9,
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}
