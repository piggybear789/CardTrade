import 'package:flutter/material.dart';

import 'package:cardtrade/core/extensions.dart';
import 'package:cardtrade/core/theme.dart';

/// The alignment/style variant of a message bubble.
enum MessageBubbleVariant { sent, received, system }

/// A single chat message bubble — Xianyu style.
///
/// Supports sent (gold, right-aligned), received (surface variant, left-aligned),
/// and system (centered, no bubble, italic muted) variants.
class MessageBubble extends StatelessWidget {
  const MessageBubble({
    required this.body,
    required this.variant,
    required this.timestamp,
    this.showTimestamp = false,
    super.key,
  });

  /// The message text content.
  final String body;

  /// Visual variant determining alignment and styling.
  final MessageBubbleVariant variant;

  /// When the message was sent.
  final DateTime timestamp;

  /// Whether to show the timestamp below the bubble.
  final bool showTimestamp;

  @override
  Widget build(BuildContext context) {
    if (variant == MessageBubbleVariant.system) {
      return _buildSystemMessage(context);
    }

    final isSent = variant == MessageBubbleVariant.sent;

    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppTheme.spacingLg,
        vertical: AppTheme.spacingXs,
      ),
      child: Column(
        crossAxisAlignment:
            isSent ? CrossAxisAlignment.end : CrossAxisAlignment.start,
        children: [
          Container(
            constraints: BoxConstraints(
              maxWidth: MediaQuery.of(context).size.width * 0.75,
            ),
            padding: const EdgeInsets.symmetric(
              horizontal: AppTheme.spacingLg,
              vertical: AppTheme.spacingMd,
            ),
            decoration: BoxDecoration(
              color: isSent ? AppTheme.gold : AppTheme.surfaceVariant,
              borderRadius: BorderRadius.only(
                topLeft: const Radius.circular(12),
                topRight: const Radius.circular(12),
                bottomLeft: Radius.circular(isSent ? 12 : 4),
                bottomRight: Radius.circular(isSent ? 4 : 12),
              ),
            ),
            child: Text(
              body,
              style: AppTheme.bodyText.copyWith(
                color: isSent ? AppTheme.obsidian : AppTheme.primary,
              ),
            ),
          ),
          if (showTimestamp) ...[
            const SizedBox(height: AppTheme.spacingXs),
            Padding(
              padding: EdgeInsets.only(
                left: isSent ? 0 : 4,
                right: isSent ? 4 : 0,
              ),
              child: Text(
                timestamp.timeOnly,
                style: AppTheme.metaText,
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildSystemMessage(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(
        horizontal: AppTheme.spacingXl,
        vertical: AppTheme.spacingLg,
      ),
      child: Center(
        child: Text(
          body,
          textAlign: TextAlign.center,
          style: AppTheme.supportText.copyWith(
            fontStyle: FontStyle.italic,
            color: AppTheme.muted,
          ),
        ),
      ),
    );
  }
}
