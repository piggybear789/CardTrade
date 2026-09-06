// Feature: mobile-release-readiness — task 3.3 (Req 3.2, 3.3).
//
// The permission request is faked, not performed: the gate takes a
// `NotificationPermissionRequester`, so both branches are exercised without a
// platform channel and without a device.
//
// The assertion that matters most is the last one in each group — the REQUEST
// COUNT. "Granted" and "denied" are easy to get right; asking a second time
// after a denial is the regression this file exists to catch (Req 3.3).

import 'package:cardtrade/core/notification_permission.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

/// Counts calls and answers with a fixed result. Also the demonstration that the
/// seam needs nothing beyond one function to be faked.
final class _FakeRequester {
  _FakeRequester(this._answer);

  final bool? _answer;
  int calls = 0;

  Future<bool?> call() async {
    calls += 1;
    return _answer;
  }
}

NotificationPermissionGate _gate(
  _FakeRequester requester, {
  TargetPlatform platform = TargetPlatform.android,
}) => NotificationPermissionGate(
  requestPermission: requester.call,
  platform: platform,
);

void main() {
  group('granted', () {
    test('a grant settles as granted and permits posting (Req 3.2)', () async {
      final _FakeRequester requester = _FakeRequester(true);
      final NotificationPermissionGate gate = _gate(requester);

      expect(gate.hasRequested, isFalse);
      expect(gate.outcome, isNull);
      expect(
        gate.canPostNotification,
        isFalse,
        reason: 'nothing may be posted before the member has been asked',
      );

      expect(
        await gate.ensureRequested(),
        NotificationPermissionOutcome.granted,
      );

      expect(gate.hasRequested, isTrue);
      expect(gate.canPostNotification, isTrue);
      expect(requester.calls, 1);
    });

    test('a second need reuses the grant and does not re-prompt', () async {
      final _FakeRequester requester = _FakeRequester(true);
      final NotificationPermissionGate gate = _gate(requester);

      await gate.ensureRequested();
      await gate.ensureRequested();
      await gate.ensureRequested();

      expect(gate.outcome, NotificationPermissionOutcome.granted);
      expect(requester.calls, 1);
    });
  });

  group('denied', () {
    test('a denial settles as denied and the app carries on (Req 3.3)', () async {
      final _FakeRequester requester = _FakeRequester(false);
      final NotificationPermissionGate gate = _gate(requester);

      expect(
        await gate.ensureRequested(),
        NotificationPermissionOutcome.denied,
      );

      expect(gate.hasRequested, isTrue);
      expect(gate.canPostNotification, isFalse);
      expect(requester.calls, 1);
    });

    test('a denial is never re-prompted in the same session (Req 3.3)', () async {
      final _FakeRequester requester = _FakeRequester(false);
      final NotificationPermissionGate gate = _gate(requester);

      for (int need = 0; need < 5; need += 1) {
        expect(
          await gate.ensureRequested(),
          NotificationPermissionOutcome.denied,
        );
      }

      expect(
        requester.calls,
        1,
        reason:
            'the platform must be asked once per session, however many times a '
            'notification is needed after the member said no',
      );
    });

    test('a null answer is a denial, not a grant', () async {
      // The plugin returns null when the platform side gives nothing back.
      // Reading absence as consent would post a notification the member never
      // allowed.
      final _FakeRequester requester = _FakeRequester(null);
      final NotificationPermissionGate gate = _gate(requester);

      expect(
        await gate.ensureRequested(),
        NotificationPermissionOutcome.denied,
      );
      expect(gate.canPostNotification, isFalse);
      expect(requester.calls, 1);
    });
  });

  group('nothing to ask', () {
    test('a non-Android target is unavailable and asks nothing', () async {
      final _FakeRequester requester = _FakeRequester(true);
      final NotificationPermissionGate gate = _gate(
        requester,
        platform: TargetPlatform.iOS,
      );

      expect(
        await gate.ensureRequested(),
        NotificationPermissionOutcome.unavailable,
      );
      expect(gate.canPostNotification, isFalse);
      expect(
        requester.calls,
        0,
        reason: 'there is no Android runtime permission to request off Android',
      );
    });

    test('a failing platform channel is survived, cached and not re-tried', () async {
      int calls = 0;
      final NotificationPermissionGate gate = NotificationPermissionGate(
        requestPermission: () async {
          calls += 1;
          throw StateError('no plugin implementation');
        },
        platform: TargetPlatform.android,
      );

      expect(
        await gate.ensureRequested(),
        NotificationPermissionOutcome.unavailable,
      );
      expect(await gate.ensureRequested(), gate.outcome);
      expect(calls, 1);
    });
  });

  group('the session-wide gate', () {
    test('exists, is unasked at startup, and prompts nothing by itself', () {
      // Guards the lazy policy rather than a behaviour: constructing the gate
      // must not ask for anything. If a cold-start request is ever added, this
      // fails, which is the point — see the header of
      // `lib/core/notification_permission.dart` and the manifest comment beside
      // POST_NOTIFICATIONS.
      expect(appNotificationPermissionGate.hasRequested, isFalse);
      expect(appNotificationPermissionGate.outcome, isNull);
      expect(appNotificationPermissionGate.canPostNotification, isFalse);
    });
  });
}
