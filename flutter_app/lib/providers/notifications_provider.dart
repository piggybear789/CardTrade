import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/notification.dart';
import '../services/notifications_service.dart';
import 'auth_provider.dart';

/// Provides the NotificationsService.
final notificationsServiceProvider = Provider<NotificationsService>((ref) {
  return NotificationsService(ref.watch(supabaseServiceProvider));
});

/// Notifications list.
final notificationsProvider = FutureProvider<List<AppNotification>>((ref) async {
  ref.watch(currentUserProvider);
  final service = ref.read(notificationsServiceProvider);
  return service.getNotifications();
});

/// Unread notification count (for badge display).
final unreadNotificationCountProvider = FutureProvider<int>((ref) async {
  ref.watch(currentUserProvider);
  final service = ref.read(notificationsServiceProvider);
  return service.getUnreadCount();
});

/// Real-time notifications stream.
final notificationsStreamProvider =
    StreamProvider<List<AppNotification>>((ref) {
  ref.watch(currentUserProvider);
  final service = ref.read(notificationsServiceProvider);
  return service.watchNotifications();
});
