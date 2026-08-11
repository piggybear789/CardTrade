import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Provider for real-time network connectivity status.
///
/// Emits `true` when at least one non-none connectivity result is available
/// (wifi, mobile, ethernet), `false` when disconnected.
///
/// Usage:
/// ```dart
/// final connectivity = ref.watch(connectivityProvider);
/// connectivity.when(
///   data: (isConnected) => isConnected ? normalUI() : offlineBanner(),
///   loading: () => normalUI(),
///   error: (_, __) => normalUI(),
/// );
/// ```
final connectivityProvider = StreamProvider<bool>((ref) {
  final connectivity = Connectivity();
  final controller = StreamController<bool>();

  // Emit current status immediately so we don't wait for the first change.
  connectivity.checkConnectivity().then((results) {
    final connected = results.any((r) => r != ConnectivityResult.none);
    if (!controller.isClosed) controller.add(connected);
  }).catchError((_) {
    // If initial check fails, assume connected (optimistic).
    if (!controller.isClosed) controller.add(true);
  });

  // Forward all subsequent connectivity changes.
  final subscription = connectivity.onConnectivityChanged.listen(
    (results) {
      final connected = results.any((r) => r != ConnectivityResult.none);
      if (!controller.isClosed) controller.add(connected);
    },
    onError: (Object error) {
      if (!controller.isClosed) controller.addError(error);
    },
  );

  ref.onDispose(() {
    subscription.cancel();
    controller.close();
  });

  return controller.stream;
});

/// Synchronous check: is the device currently online?
/// Returns true if connectivity state hasn't loaded yet (optimistic).
///
/// Usage:
/// ```dart
/// final isOnline = ref.watch(isOnlineProvider);
/// if (!isOnline) showOfflineBanner();
/// ```
final isOnlineProvider = Provider<bool>((ref) {
  final connectivity = ref.watch(connectivityProvider);
  return connectivity.when(
    data: (isConnected) => isConnected,
    loading: () => true,
    error: (_, __) => true,
  );
});
