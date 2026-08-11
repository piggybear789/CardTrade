import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:cardtrade/core/extensions.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/models/notification.dart';
import 'package:cardtrade/providers/notifications_provider.dart';
import 'package:cardtrade/widgets/common/empty_state.dart';
import 'package:cardtrade/widgets/common/error_view.dart';

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
      body: notificationsAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => ErrorView(
          message: error.toString(),
          onRetry: () => ref.invalidate(notificationsProvider),
        ),
        data: (notifications) {
          if (notifications.isEmpty) {
            return const EmptyState(
              icon: Icons.notifications_none_rounded,
              title: 'No notifications',
              subtitle: "You're all caught up!",
            );
          }

          return RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(notificationsProvider);
              await ref.read(notificationsProvider.future);
            },
            child: ListView.separated(
              physics: const AlwaysScrollableScrollPhysics(),
              itemCount: notifications.length,
              separatorBuilder: (_, __) => const Divider(
                indent: AppTheme.spacingLg + 40 + AppTheme.spacingMd,
              ),
              itemBuilder: (context, index) {
                final notification = notifications[index];
                return _NotificationTile(
                  notification: notification,
                  onTap: () => _navigate(context, notification),
                );
              },
            ),
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
        NotificationType.offer => (Icons.local_offer_rounded, AppTheme.accent),
        NotificationType.message => (Icons.chat_rounded, AppTheme.accent),
        NotificationType.trade => (Icons.swap_horiz_rounded, AppTheme.warning),
        NotificationType.sale => (Icons.shopping_bag_rounded, AppTheme.success),
        NotificationType.system => (Icons.info_rounded, AppTheme.secondary),
      };

  @override
  Widget build(BuildContext context) {
    final (icon, color) = _typeIcon;
    final isUnread = !notification.isRead;

    return InkWell(
      onTap: onTap,
      child: Container(
        color: isUnread ? AppTheme.accentLight.withValues(alpha: 0.3) : null,
        padding: const EdgeInsets.symmetric(
          horizontal: AppTheme.spacingLg,
          vertical: AppTheme.spacingMd,
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
            const SizedBox(width: AppTheme.spacingMd),

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
              const SizedBox(width: AppTheme.spacingSm),
              Container(
                width: 8,
                height: 8,
                margin: const EdgeInsets.only(top: 6),
                decoration: const BoxDecoration(
                  color: AppTheme.accent,
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
