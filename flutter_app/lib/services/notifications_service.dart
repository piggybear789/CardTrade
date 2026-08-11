import '../models/notification.dart';
import 'supabase_service.dart';

/// Service for user notifications.
class NotificationsService {
  NotificationsService(this._supabase);

  final SupabaseService _supabase;

  /// Fetch notifications for the current user.
  Future<List<AppNotification>> getNotifications({
    int limit = 50,
    int offset = 0,
  }) async {
    final userId = _supabase.currentUserId;
    if (userId == null) return [];

    final response = await _supabase
        .from('notifications')
        .select()
        .eq('user_id', userId)
        .order('created_at', ascending: false)
        .range(offset, offset + limit - 1);

    return (response as List)
        .map((json) => AppNotification.fromJson(json))
        .toList();
  }

  /// Get unread notification count.
  Future<int> getUnreadCount() async {
    final userId = _supabase.currentUserId;
    if (userId == null) return 0;

    final response = await _supabase
        .from('notifications')
        .select()
        .eq('user_id', userId)
        .isFilter('read_at', null)
        .count();

    return response.count;
  }

  /// Mark a notification as read.
  Future<void> markAsRead(String notificationId) async {
    await _supabase
        .from('notifications')
        .update({'read_at': DateTime.now().toIso8601String()})
        .eq('id', notificationId);
  }

  /// Mark all notifications as read.
  Future<void> markAllAsRead() async {
    final userId = _supabase.currentUserId;
    if (userId == null) return;

    await _supabase
        .from('notifications')
        .update({'read_at': DateTime.now().toIso8601String()})
        .eq('user_id', userId)
        .isFilter('read_at', null);
  }

  /// Subscribe to new notifications (real-time).
  Stream<List<AppNotification>> watchNotifications() {
    final userId = _supabase.currentUserId;
    if (userId == null) return Stream.value([]);

    return _supabase
        .client
        .schema('cardtrade')
        .from('notifications')
        .stream(primaryKey: ['id'])
        .eq('user_id', userId)
        .order('created_at', ascending: false)
        .map((rows) => rows.map((j) => AppNotification.fromJson(j)).toList());
  }
}
