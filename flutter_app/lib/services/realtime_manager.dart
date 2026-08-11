import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import 'supabase_service.dart';

/// Manages Realtime subscriptions with proper lifecycle:
/// - Subscription deduplication (one channel per resource)
/// - Channel cleanup on dispose
/// - Error handling that doesn't crash the app
/// - Stream-based API for Riverpod integration
///
/// Usage:
/// ```dart
/// final manager = RealtimeManager(supabaseService);
/// final stream = manager.subscribe(
///   table: 'cash_sales',
///   filterColumn: 'id',
///   filterValue: saleId,
/// );
/// stream.listen((record) => updateState(record));
/// ```
class RealtimeManager {
  RealtimeManager(this._supabase);
  final SupabaseService _supabase;

  final Map<String, _ChannelEntry> _channels = {};

  /// Subscribe to changes on a table row (or rows matching a filter).
  ///
  /// Returns a broadcast stream of the new record data on each change.
  /// Deduplicates: calling with the same parameters returns a new listener
  /// on the existing channel rather than opening a second one.
  Stream<Map<String, dynamic>> subscribe({
    required String table,
    required String filterColumn,
    required String filterValue,
    String schema = 'cardtrade',
  }) {
    final key = '$schema.$table.$filterColumn=$filterValue';

    // Deduplicate: reuse existing channel's broadcast stream.
    if (_channels.containsKey(key)) {
      return _channels[key]!.controller.stream;
    }

    final controller = StreamController<Map<String, dynamic>>.broadcast(
      onCancel: () {
        // When ALL listeners are gone, clean up the channel.
        // Use a microtask delay so a quick re-subscribe doesn't thrash.
        Future.delayed(const Duration(seconds: 2), () {
          if (_channels.containsKey(key) &&
              !_channels[key]!.controller.hasListener) {
            _unsubscribe(key);
          }
        });
      },
    );

    final channel = _supabase.client
        .channel(key)
        .onPostgresChanges(
          event: PostgresChangeEvent.all,
          schema: schema,
          table: table,
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: filterColumn,
            value: filterValue,
          ),
          callback: (payload) {
            final newRecord = payload.newRecord;
            if (newRecord.isNotEmpty && !controller.isClosed) {
              controller.add(newRecord);
            }
          },
        )
        .subscribe((status, [error]) {
      if (kDebugMode) {
        debugPrint('[RealtimeManager] $key → $status'
            '${error != null ? ' ($error)' : ''}');
      }
      if (status == RealtimeSubscribeStatus.closed) {
        if (!controller.isClosed) controller.close();
        _channels.remove(key);
      }
    });

    _channels[key] = _ChannelEntry(channel: channel, controller: controller);
    return controller.stream;
  }

  /// Subscribe to INSERT events only (e.g. new messages in a conversation).
  Stream<Map<String, dynamic>> subscribeInserts({
    required String table,
    required String filterColumn,
    required String filterValue,
    String schema = 'cardtrade',
  }) {
    final key = '$schema.$table.$filterColumn=$filterValue:inserts';

    if (_channels.containsKey(key)) {
      return _channels[key]!.controller.stream;
    }

    final controller = StreamController<Map<String, dynamic>>.broadcast(
      onCancel: () {
        Future.delayed(const Duration(seconds: 2), () {
          if (_channels.containsKey(key) &&
              !_channels[key]!.controller.hasListener) {
            _unsubscribe(key);
          }
        });
      },
    );

    final channel = _supabase.client
        .channel(key)
        .onPostgresChanges(
          event: PostgresChangeEvent.insert,
          schema: schema,
          table: table,
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: filterColumn,
            value: filterValue,
          ),
          callback: (payload) {
            final newRecord = payload.newRecord;
            if (newRecord.isNotEmpty && !controller.isClosed) {
              controller.add(newRecord);
            }
          },
        )
        .subscribe((status, [error]) {
      if (status == RealtimeSubscribeStatus.closed) {
        if (!controller.isClosed) controller.close();
        _channels.remove(key);
      }
    });

    _channels[key] = _ChannelEntry(channel: channel, controller: controller);
    return controller.stream;
  }

  /// Unsubscribe a specific channel by key.
  void _unsubscribe(String key) {
    final entry = _channels.remove(key);
    if (entry != null) {
      entry.channel.unsubscribe();
      if (!entry.controller.isClosed) entry.controller.close();
    }
  }

  /// Unsubscribe from all channels. Call on app dispose or sign-out.
  Future<void> disposeAll() async {
    for (final entry in _channels.values) {
      await entry.channel.unsubscribe();
      if (!entry.controller.isClosed) await entry.controller.close();
    }
    _channels.clear();
  }

  /// Number of active subscriptions (for diagnostics).
  int get activeCount => _channels.length;
}

/// Internal bookkeeping for a single channel subscription.
class _ChannelEntry {
  _ChannelEntry({required this.channel, required this.controller});
  final RealtimeChannel channel;
  final StreamController<Map<String, dynamic>> controller;
}
