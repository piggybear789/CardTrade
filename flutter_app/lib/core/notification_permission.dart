/// The Android 13+ notification permission request, asked once per session
/// (Req 3.2, 3.3).
///
/// ── THIS CODE IS CURRENTLY UNREACHED, AND THAT IS THE HONEST SHAPE ────────
///
/// Nothing in `flutter_app/lib/` posts a local notification today.
/// `flutter_local_notifications` ^22.3.0 is a pubspec dependency with zero Dart
/// call sites: a grep for `zonedSchedule`, `periodicallyShow`,
/// `NotificationDetails` and the package name itself finds only `pubspec.yaml`,
/// `pubspec.lock` and the ProGuard notes. `services/notifications_service.dart`
/// is the in-app notification CENTRE — Supabase reads and a Realtime stream on
/// `cardtrade.notifications` — and it posts nothing to the system tray, so it
/// needs no permission and must keep working whatever the member answers here.
///
/// Req 3.2 says the request happens "when the app first needs to show a local
/// notification". That moment does not exist yet. Inventing a notification so
/// that a permission dialog had something to justify it would be worse than not
/// prompting: the member would be asked for a capability the app does not use.
/// So the deliverable is the MECHANISM and the once-per-session rule, wired to
/// one call site — [NotificationPermissionGate.ensureRequested] — and left
/// unreached.
///
/// WHAT WILL REACH IT. The first code that calls
/// `FlutterLocalNotificationsPlugin.show` / `zonedSchedule` must await
/// [NotificationPermissionGate.ensureRequested] immediately before that call
/// and post only on [NotificationPermissionOutcome.granted]. The plausible
/// first caller is a local mirror of the in-app notification centre — a new
/// `OFFER` / `MESSAGE` / `TRADE` / `SALE` row arriving on
/// `NotificationsService.watchNotifications` while the app is foregrounded —
/// which is exactly the contextual moment the lazy policy is for.
///
/// DO NOT MOVE THIS TO COLD START to make it observable. A permission dialog
/// with no context is the one members deny, and the manifest comment beside
/// `POST_NOTIFICATIONS` records the same policy. Manual check M9 (the prompt
/// appears at first notification need, denial leaves the app usable) therefore
/// cannot be performed until a real caller exists.
///
/// ── NO NEW PACKAGE ────────────────────────────────────────────────────────
///
/// The request goes through the platform channel
/// `flutter_local_notifications` already exposes —
/// `AndroidFlutterLocalNotificationsPlugin.requestNotificationsPermission()`,
/// which returns `Future<bool?>` — rather than adding `permission_handler`.
/// A second package asking the same OS for the same permission is a second
/// answer to one question, and the plugin that posts the notification is the
/// right one to ask for the right to post it.
library;

import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// What the one request in a session resolved to.
enum NotificationPermissionOutcome {
  /// The member allowed notifications. A local notification may be posted.
  granted,

  /// The member declined, or the platform declined to answer. Post nothing, and
  /// ask nothing further this session (Req 3.3).
  denied,

  /// There is no Android runtime notification permission to request here —
  /// a non-Android target, or a platform channel the host does not implement.
  /// Treated as "do not prompt" and never as permission.
  unavailable,
}

/// Asks the platform for the notification permission. Returns `true` when
/// granted, `false` when denied, `null` when the platform gave no answer.
typedef NotificationPermissionRequester = Future<bool?> Function();

/// Requests the notification permission at most once per session.
///
/// Session-scoped means process-scoped: [appNotificationPermissionGate] lives
/// for the lifetime of the app, so a denial suppresses every later prompt until
/// the member relaunches. That is precisely Req 3.3 — nagging a member who has
/// already said no is how an app gets its notifications turned off in system
/// settings as well.
///
/// Total by construction: [ensureRequested] never throws, so a caller in a
/// notification path never has to guard the permission check itself.
final class NotificationPermissionGate {
  NotificationPermissionGate({
    NotificationPermissionRequester? requestPermission,
    TargetPlatform? platform,
  }) : _requestPermission = requestPermission ?? _requestViaPluginChannel,
       _platform = platform ?? defaultTargetPlatform;

  final NotificationPermissionRequester _requestPermission;
  final TargetPlatform _platform;

  NotificationPermissionOutcome? _outcome;

  /// Whether the one request for this session has already happened.
  ///
  /// True after any resolution, including [NotificationPermissionOutcome.denied]
  /// and [NotificationPermissionOutcome.unavailable]: the flag records that the
  /// question is settled, not that it was answered favourably.
  bool get hasRequested => _outcome != null;

  /// The settled outcome, or `null` before the first [ensureRequested].
  NotificationPermissionOutcome? get outcome => _outcome;

  /// Whether a local notification may be posted right now, without asking.
  ///
  /// `false` before the first request — a caller must go through
  /// [ensureRequested] rather than reading this and assuming.
  bool get canPostNotification =>
      _outcome == NotificationPermissionOutcome.granted;

  /// Requests the permission if this session has not already done so, and
  /// returns the settled outcome.
  ///
  /// Call this immediately before posting a local notification, never at cold
  /// start. On a second call the cached outcome comes back and the platform is
  /// NOT asked again (Req 3.3).
  Future<NotificationPermissionOutcome> ensureRequested() async {
    final NotificationPermissionOutcome? settled = _outcome;
    if (settled != null) return settled;

    if (_platform != TargetPlatform.android) {
      // iOS asks at plugin initialisation and the desktop hosts have no runtime
      // permission of this kind. Android is the shipped target of this release.
      return _outcome = NotificationPermissionOutcome.unavailable;
    }

    try {
      final bool? granted = await _requestPermission();
      // A null answer is NOT a grant. The plugin returns null when the platform
      // side gives nothing back, and reading absence as consent would post a
      // notification the member never allowed.
      return _outcome = granted == true
          ? NotificationPermissionOutcome.granted
          : NotificationPermissionOutcome.denied;
    } catch (_) {
      // A missing plugin implementation or a channel failure must not take down
      // the caller: Req 3.3 says the app carries on either way, and the in-app
      // notification centre is a server read that owes nothing to this result.
      // Cached like any other outcome, so a broken channel is not re-tried on
      // every notification.
      return _outcome = NotificationPermissionOutcome.unavailable;
    }
  }
}

/// The real request, through the plugin that would post the notification.
///
/// Constructed lazily inside the function so that a build which never posts a
/// notification never touches the plugin, and so that a test injecting a fake
/// requester never reaches a platform channel.
Future<bool?> _requestViaPluginChannel() async {
  final AndroidFlutterLocalNotificationsPlugin? android =
      FlutterLocalNotificationsPlugin()
          .resolvePlatformSpecificImplementation<
            AndroidFlutterLocalNotificationsPlugin
          >();
  if (android == null) return null;
  return android.requestNotificationsPermission();
}

/// The gate for this session. One instance, so "asked already" means the same
/// thing everywhere.
///
/// Nothing else may construct a gate in `lib/`; inject this, or inject a fresh
/// [NotificationPermissionGate] with a fake requester in a test.
final NotificationPermissionGate appNotificationPermissionGate =
    NotificationPermissionGate();
