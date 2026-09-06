// Feature: mobile-release-readiness — task 11.3 (Req 8.1, 8.2, 8.3, 8.5).
//
// Task 11.1's test covers the SEAM: the interface, the redaction guarantee and
// the binding rule. This file covers the HOOKS: that `installErrorHooks` puts a
// recording call behind each of the three top-level error paths, that it leaves
// the framework's own presentation in place, and that with the app's own binding
// (a no-op under test) firing a hook reports nothing and throws nothing.
//
// WHAT CANNOT BE EXERCISED HERE, STATED PLAINLY RATHER THAN CLAIMED:
//
//   * The `runZonedGuarded` wrapper in `main()` is not exercised behaviourally.
//     Calling `main()` from a test would create a second binding inside the test
//     zone and boot Supabase and Stripe against no platform. What IS asserted is
//     the SHAPE of that wrapper, by reading `lib/main.dart`: that `runApp` is
//     reached inside `runZonedGuarded`, that `ensureInitialized()` is called
//     inside the SAME callback (the zone-mismatch constraint), and that the zone
//     handler records. That is a real check of the thing that can be got wrong;
//     it is not a claim that the zone was observed catching an error.
//   * `ErrorWidget.builder` is only replaced under `kReleaseMode`, and
//     `flutter test` is a debug build. So the release surface itself is not
//     rendered here — what is asserted is that debug's builder is left ALONE,
//     which is the half of Req 8.6 this build mode can answer.
//   * Manual check M14 (a deliberately thrown release-mode error appears in the
//     reporter with a symbolicated stack and carries no legal name, address or
//     token) stays BLOCKED until design decision D13's vendor binding is chosen.
//     With the no-op bound there is no reporter for a report to arrive in, so
//     the check cannot pass or fail — see the manual review register.

import 'dart:io';

import 'package:cardtrade/core/observability/error_reporter.dart';
import 'package:cardtrade/main.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// A recording double. Needs nothing beyond the interface, because there is
/// nothing beyond the interface.
final class _FakeErrorReporter implements ErrorReporter {
  final List<({Object error, StackTrace? stack, bool fatal})> recorded =
      <({Object error, StackTrace? stack, bool fatal})>[];

  @override
  void recordError(Object error, StackTrace? stack, {bool fatal = false}) {
    recorded.add((error: error, stack: stack, fatal: fatal));
  }
}

void main() {
  // The hooks are global state. Every test here installs over them, so the
  // originals are captured once and restored after each test — otherwise a
  // failure in this file would silently change how the rest of the suite
  // reports errors.
  final FlutterExceptionHandler? originalOnError = FlutterError.onError;
  final FlutterExceptionHandler originalPresentError = FlutterError.presentError;
  final bool Function(Object, StackTrace)? originalPlatformOnError =
      PlatformDispatcher.instance.onError;
  final ErrorWidgetBuilder originalErrorWidgetBuilder = ErrorWidget.builder;

  tearDown(() {
    FlutterError.onError = originalOnError;
    FlutterError.presentError = originalPresentError;
    PlatformDispatcher.instance.onError = originalPlatformOnError;
    ErrorWidget.builder = originalErrorWidgetBuilder;
  });

  group('the framework hook (Req 8.2)', () {
    test('records the framework error with its stack', () {
      final _FakeErrorReporter fake = _FakeErrorReporter();
      installErrorHooks(fake);

      // Silence the console dump for this test only. The next test asserts that
      // the dump is still called, which is what makes this substitution safe.
      FlutterError.presentError = (FlutterErrorDetails _) {};

      final Object exception = StateError('framework boom');
      final StackTrace stack = StackTrace.current;
      FlutterError.onError!(
        FlutterErrorDetails(exception: exception, stack: stack),
      );

      expect(fake.recorded, hasLength(1));
      expect(fake.recorded.single.error, same(exception));
      expect(fake.recorded.single.stack, same(stack));
      // The framework caught it and the app runs on, so it is not fatal.
      expect(fake.recorded.single.fatal, isFalse);
    });

    test('still presents the error, so debug output is not lost', () {
      final _FakeErrorReporter fake = _FakeErrorReporter();
      installErrorHooks(fake);

      final List<Object> presented = <Object>[];
      FlutterError.presentError =
          (FlutterErrorDetails details) => presented.add(details.exception);

      final Object exception = StateError('framework boom');
      FlutterError.onError!(FlutterErrorDetails(exception: exception));

      // Replacing `presentError` rather than adding to it would remove the red
      // screen and the console dump, which is the developer's fastest signal.
      expect(presented, <Object>[exception]);
      expect(fake.recorded, hasLength(1));
    });

    test('a framework error with no stack is still recorded', () {
      final _FakeErrorReporter fake = _FakeErrorReporter();
      installErrorHooks(fake);
      FlutterError.presentError = (FlutterErrorDetails _) {};

      FlutterError.onError!(
        FlutterErrorDetails(exception: StateError('no stack')),
      );

      expect(fake.recorded, hasLength(1));
      expect(fake.recorded.single.stack, isNull);
    });
  });

  group('the platform hook (Req 8.3)', () {
    test('records the error and reports it handled', () {
      final _FakeErrorReporter fake = _FakeErrorReporter();
      installErrorHooks(fake);

      final Object error = StateError('platform boom');
      final StackTrace stack = StackTrace.current;

      final bool handled = PlatformDispatcher.instance.onError!(error, stack);

      // Returning true is what stops the engine treating this as an unhandled
      // exception, which is the Req 8.6 half of this hook.
      expect(handled, isTrue);
      expect(fake.recorded.single.error, same(error));
      expect(fake.recorded.single.stack, same(stack));
      expect(fake.recorded.single.fatal, isFalse);
    });
  });

  group('the member-facing error surface (Req 8.6)', () {
    test('leaves the framework builder alone in a debug build', () {
      // Guards the premise: if `flutter test` stopped being a debug build the
      // assertion below would be testing the opposite of what it says.
      expect(kDebugMode, isTrue);

      final ErrorWidgetBuilder before = ErrorWidget.builder;
      installErrorHooks(_FakeErrorReporter());

      expect(
        ErrorWidget.builder,
        same(before),
        reason:
            'the red box names the widget that threw, which is useful to a '
            'developer and is why debug keeps it. Only a release build swaps in '
            'the plain surface.',
      );
    });
  });

  group('the app-wide binding under test (Req 8.5)', () {
    test('firing each hook through the no-op records nothing and throws nothing', () {
      installErrorHooks(errorReporter);
      FlutterError.presentError = (FlutterErrorDetails _) {};

      expect(errorReporter, isA<NoopErrorReporter>());
      expect(
        () => FlutterError.onError!(
          FlutterErrorDetails(exception: StateError('boom')),
        ),
        returnsNormally,
      );
      expect(
        () => PlatformDispatcher.instance.onError!(
          StateError('boom'),
          StackTrace.current,
        ),
        returnsNormally,
      );
    });
  });

  group('the zone wrapper (Req 8.1)', () {
    // A source-reading check, for the reason stated at the top of this file: the
    // zone cannot be entered from a widget test, and the thing that can actually
    // be got wrong here is the ORDER of two calls.
    late String source;

    setUpAll(() {
      final File main = File('lib/main.dart');
      expect(
        main.existsSync(),
        isTrue,
        reason: 'expected lib/main.dart relative to the package root',
      );
      source = main.readAsStringSync();
    });

    test('runApp is only reached from inside runZonedGuarded', () {
      final RegExpMatch? guarded = RegExp(
        r'runZonedGuarded<void>\(\s*\(\)\s*async\s*\{(.*?)\n    \},',
        dotAll: true,
      ).firstMatch(source);

      expect(
        guarded,
        isNotNull,
        reason: 'could not find the runZonedGuarded callback in lib/main.dart — '
            'if its shape changed, rewrite this check rather than dropping it. '
            'Without the zone an uncaught async error is invisible (Req 8.1).',
      );
      // `runApp` is called from `_run`, which the callback awaits. What matters
      // is that nothing calls it outside the zone.
      expect(guarded!.group(1), contains('_run()'));
    });

    test('the binding is created inside the same callback as the app', () {
      final String callback = RegExp(
        r'runZonedGuarded<void>\(\s*\(\)\s*async\s*\{(.*?)\n    \},',
        dotAll: true,
      ).firstMatch(source)!.group(1)!;

      final int binding = callback.indexOf(
        'WidgetsFlutterBinding.ensureInitialized()',
      );
      final int run = callback.indexOf('_run()');

      expect(
        binding,
        greaterThanOrEqualTo(0),
        reason: 'the binding must be created INSIDE the guarded callback. '
            'Created outside, Flutter asserts a zone mismatch when runApp '
            'later runs in the guarded zone.',
      );
      expect(binding, lessThan(run));
      expect(
        callback.contains('installErrorHooks(errorReporter)'),
        isTrue,
        reason: 'the hooks are installed with the app-wide binding, not a '
            'locally constructed reporter (Req 8.4, task 11.1).',
      );
    });

    test('the zone handler records the error it caught', () {
      final RegExpMatch? handler = RegExp(
        r'\(Object error, StackTrace stack\) =>\s*errorReporter\.recordError\(\s*error,\s*stack,\s*fatal:\s*(\w+),?\s*\)',
        dotAll: true,
      ).firstMatch(source);

      expect(
        handler,
        isNotNull,
        reason: 'the runZonedGuarded handler must record the error it caught '
            '(Req 8.1). A handler that swallowed it would satisfy the compiler '
            'and lose every uncaught async error in a release build.',
      );
      // Fatality is marked honestly: the tree is untouched and the app runs on.
      expect(handler!.group(1), 'false');
    });

    test('the startup failure is recorded as fatal, and a config finding is not', () {
      expect(
        source.contains(RegExp(r'error is!\s*MissingConfigException')),
        isTrue,
        reason: 'a MissingConfigException is a configuration finding whose '
            'message is a list of key names, not a crash. Reporting it would '
            'be per-launch noise in a real reporter.',
      );
      expect(
        source.contains(
          RegExp(r'errorReporter\.recordError\(error, stackTrace, fatal: true\)'),
        ),
        isTrue,
        reason: 'a startup failure ends in StartupErrorApp — the app never '
            'reaches a member surface, so it is the one fatal case.',
      );
    });
  });
}
