import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:cardtrade/core/extensions.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/models/notification.dart';
import 'package:cardtrade/providers/notifications_provider.dart';
import 'package:cardtrade/widgets/common/empty_state.dart';
import 'package:cardtrade/widgets/common/load_state.dart';
import 'package:cardtrade/widgets/common/skeleton.dart';

/// Notifications list screen.
///
/// Each notification shows a type-colored icon, title, body preview,
/// relative timestamp, and unread indicator. Tap navigates to the
/// linked resource. App bar action to mark all as read.
class NotificationsScreen extends ConsumerStatefulWidget {
  const NotificationsScreen({super.key});

  @override
  ConsumerState<NotificationsScreen> createState() => _NotificationsScreenState();
}

class _NotificationsScreenState extends ConsumerState<NotificationsScreen> {
  bool _isMarkingRead = false;

  /// Placeholder rows drawn while the first read runs.
  static const int _skeletonRows = 8;

  /// What a failure or a failed refresh calls this request, in member terms.
  static const String _operation = 'your notifications';

  /// Inset to the row's text column, past the type disc and the gap after it.
  static const double _rowIndent =
      AppSpacing.cozy + _discDiameter + AppSpacing.snug;

  /// Diameter of the type disc each row leads with.
  static const double _discDiameter = 40;

  Future<void> _markAllRead() async {
    setState(() => _isMarkingRead = true);
    try {
      final service = ref.read(notificationsServiceProvider);
      await service.markAllAsRead();
      ref.invalidate(notificationsProvider);
      ref.invalidate(unreadNotificationCountProvider);
    } finally {
      if (mounted) setState(() => _isMarkingRead = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final notificationsAsync = ref.watch(notificationsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Notifications'),
        actions: [
          TextButton(
            onPressed: _isMarkingRead ? null : _markAllRead,
            child: _isMarkingRead
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Mark all read'),
          ),
        ],
      ),
      body: AsyncStateView<List<AppNotification>>(
        value: notificationsAsync,
        operation: _operation,
        onRetry: () async {
          ref.invalidate(notificationsProvider);
          await ref.read(notificationsProvider.future);
        },
        loadingAnnouncement: 'Loading your notifications',
        skeleton: (_) => ListView.separated(
          physics: const AlwaysScrollableScrollPhysics(),
          itemCount: _skeletonRows,
          separatorBuilder: (_, _) => const Divider(indent: _rowIndent),
          itemBuilder: (_, _) => const SkeletonListTile(),
        ),
        builder: (context, notifications) {
          if (notifications.isEmpty) {
            return const PullableFill(
              child: EmptyState(
                icon: Icons.notifications_none_rounded,
                title: 'No notifications',
                subtitle: "You're all caught up!",
              ),
            );
          }

          return ListView.separated(
            physics: const AlwaysScrollableScrollPhysics(),
            itemCount: notifications.length,
            separatorBuilder: (_, _) => const Divider(indent: _rowIndent),
            itemBuilder: (context, index) {
              final notification = notifications[index];
              return _NotificationTile(
                notification: notification,
                onTap: () => _navigate(context, notification),
              );
            },
          );
        },
      ),
    );
  }

  void _navigate(BuildContext context, AppNotification notification) {
    final link = notification.link;
    if (link != null && link.isNotEmpty) {
      context.push(link);
    }
  }
}

/// A single notification list tile.
class _NotificationTile extends StatelessWidget {
  const _NotificationTile({
    required this.notification,
    required this.onTap,
  });

  final AppNotification notification;
  final VoidCallback onTap;

  (IconData, Color) get _typeIcon => switch (notification.type) {
        NotificationType.offer => (Icons.local_offer_rounded, AppColors.irisInk),
        NotificationType.message => (Icons.chat_rounded, AppColors.irisInk),
        NotificationType.trade => (Icons.swap_horiz_rounded, AppColors.actionBorder),
        NotificationType.sale => (Icons.shopping_bag_rounded, AppColors.trust),
        NotificationType.system => (Icons.info_rounded, AppColors.mutedForeground),
      };

  @override
  Widget build(BuildContext context) {
    final (icon, color) = _typeIcon;
    final isUnread = !notification.isRead;

    return InkWell(
      onTap: onTap,
      child: Container(
        color: isUnread ? AppTint.eyebrow.fill!.withValues(alpha: 0.3) : null,
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.cozy,
          vertical: AppSpacing.snug,
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ─── Type Icon ───────────────────────────────────────
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: color.withValues(alpha: 0.1),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, size: 20, color: color),
            ),
            const SizedBox(width: AppSpacing.snug),

            // ─── Content ─────────────────────────────────────────
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          notification.title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: AppTheme.rowName.copyWith(
                            fontWeight:
                                isUnread ? FontWeight.w600 : FontWeight.w400,
                          ),
                        ),
                      ),
                      Text(
                        notification.createdAt.timeAgo,
                        style: AppTheme.metaText,
                      ),
                    ],
                  ),
                  if (notification.body != null &&
                      notification.body!.isNotEmpty) ...[
                    const SizedBox(height: 2),
                    Text(
                      notification.body!,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: AppTheme.supportText,
                    ),
                  ],
                ],
              ),
            ),

            // ─── Unread Dot ──────────────────────────────────────
            if (isUnread) ...[
              const SizedBox(width: AppSpacing.tight),
              Container(
                width: 8,
                height: 8,
                margin: const EdgeInsets.only(top: 6),
                decoration: const BoxDecoration(
                  color: AppColors.irisInk,
                  shape: BoxShape.circle,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
