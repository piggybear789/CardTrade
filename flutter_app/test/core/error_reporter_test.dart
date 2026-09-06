// Feature: mobile-release-readiness — task 11.1 (Req 8.4, 8.5).
//
// Three things are under test, and the last two are the ones that matter:
//
//   1. A reporter receives exactly what it was given.
//   2. The debug binding is the no-op and records nothing (Req 8.5).
//   3. The binding is chosen in exactly ONE place, and the interface carries no
//      user context (Req 8.4).
//
// (3) is a source-reading test, in the style of `tests/unit/mobileDomainAgreement.test.ts`
// on the TypeScript side. That is deliberate: the redaction guarantee and the
// single-binding rule are properties of the SHAPE of the code, so a test that
// only exercised behaviour would pass happily on the day someone added a
// `setUser` stub or constructed a second reporter in a widget.

import 'dart:io';

import 'package:cardtrade/core/observability/error_reporter.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';

/// A recording double. Also the demonstration that a fake needs nothing beyond
/// the interface — no context setter to stub out, because there is none.
final class _FakeErrorReporter implements ErrorReporter {
  final List<({Object error, StackTrace? stack, bool fatal})> recorded =
      <({Object error, StackTrace? stack, bool fatal})>[];

  @override
  void recordError(Object error, StackTrace? stack, {bool fatal = false}) {
    recorded.add((error: error, stack: stack, fatal: fatal));
  }
}

/// The seam's own file, relative to the package root (`flutter_app/`), which is
/// the working directory `flutter test` runs in.
const String _seamPath = 'lib/core/observability/error_reporter.dart';

void main() {
  group('ErrorReporter contract', () {
    test('a reporter receives the error, the stack and the fatal flag', () {
      final _FakeErrorReporter fake = _FakeErrorReporter();
      final StackTrace stack = StackTrace.current;
      final Object error = StateError('boom');

      fake.recordError(error, stack, fatal: true);

      expect(fake.recorded, hasLength(1));
      expect(fake.recorded.single.error, same(error));
      expect(fake.recorded.single.stack, same(stack));
      expect(fake.recorded.single.fatal, isTrue);
    });

    test('a null stack trace is accepted, and fatal defaults to false', () {
      final _FakeErrorReporter fake = _FakeErrorReporter();

      fake.recordError('plain string error', null);

      expect(fake.recorded.single.stack, isNull);
      expect(fake.recorded.single.fatal, isFalse);
    });

    test('the no-op records nothing and never throws', () {
      const ErrorReporter reporter = NoopErrorReporter();

      expect(
        () => reporter.recordError(
          StateError('boom'),
          StackTrace.current,
          fatal: true,
        ),
        returnsNormally,
      );
    });
  });

  group('the binding rule', () {
    test('debug binds the no-op even when a DSN is configured (Req 8.5)', () {
      expect(
        resolveErrorReporter(isDebugBuild: true, dsn: 'https://example/dsn'),
        isA<NoopErrorReporter>(),
      );
      expect(
        resolveErrorReporter(isDebugBuild: true, dsn: ''),
        isA<NoopErrorReporter>(),
      );
    });

    test('release without a DSN binds a reporter that does nothing, not null', () {
      for (final String dsn in <String>['', '   ', '\n']) {
        final ErrorReporter reporter = resolveErrorReporter(
          isDebugBuild: false,
          dsn: dsn,
        );
        expect(reporter, isNotNull);
        expect(reporter, isA<NoopErrorReporter>());
        expect(
          () => reporter.recordError(StateError('boom'), null),
          returnsNormally,
        );
      }
    });

    test('release with a DSN binds an active reporter', () {
      expect(
        resolveErrorReporter(isDebugBuild: false, dsn: 'https://example/dsn'),
        isNot(isA<NoopErrorReporter>()),
      );
    });

    test('the app-wide binding is the no-op under test (a debug build)', () {
      // Guards the premise rather than the conclusion: if `flutter test` ever
      // stopped being a debug build, the assertion below would be vacuous.
      expect(kDebugMode, isTrue);
      expect(errorReporter, isA<NoopErrorReporter>());
      expect(
        () => errorReporter.recordError(StateError('boom'), StackTrace.current),
        returnsNormally,
      );
    });
  });

  group('structural guarantees', () {
    late String seamSource;

    setUpAll(() {
      final File seam = File(_seamPath);
      expect(
        seam.existsSync(),
        isTrue,
        reason:
            'expected the seam at $_seamPath, relative to the package root. '
            'If this file moved, move the constant with it rather than '
            'deleting the check.',
      );
      seamSource = seam.readAsStringSync();
    });

    test('the interface carries no user context (Req 8.4)', () {
      // The guarantee is that a call site CANNOT attach personal data, which is
      // true only while these members are absent. A stub would be enough to
      // remove it, so a stub fails here.
      for (final String forbidden in <String>[
        'setUser',
        'setContext',
        'addBreadcrumb',
        'breadcrumb',
        'setTag',
        'setExtra',
      ]) {
        expect(
          seamSource.contains(RegExp('\\b$forbidden\\s*\\(')),
          isFalse,
          reason:
              'the reporter must take an error and a stack trace and nothing '
              'else. `$forbidden` would give a call site somewhere to put a '
              'legal name, an address, a document field, a card detail or a '
              'session token. See Req 8.4.',
        );
      }
    });

    test('recordError is the interface\'s only method', () {
      final RegExpMatch? interfaceBody = RegExp(
        r'abstract interface class ErrorReporter\s*\{(.*?)\n\}',
        dotAll: true,
      ).firstMatch(seamSource);

      expect(
        interfaceBody,
        isNotNull,
        reason: 'could not find `abstract interface class ErrorReporter` in '
            '$_seamPath — if its declaration changed, this check must be '
            'rewritten, not dropped.',
      );

      // Every member declaration inside the interface body: `void name(`,
      // `Future<x> name(`, and so on.
      final Iterable<String> members = RegExp(
        r'^\s*(?:[\w<>?, ]+\s+)?(\w+)\s*\(',
        multiLine: true,
      )
          .allMatches(interfaceBody!.group(1)!)
          .map((RegExpMatch m) => m.group(1)!);

      expect(members.toSet(), <String>{'recordError'});
    });

    test('the binding is chosen in exactly one place', () {
      final List<String> offenders = <String>[];

      for (final FileSystemEntity entity
          in Directory('lib').listSync(recursive: true)) {
        if (entity is! File || !entity.path.endsWith('.dart')) continue;
        final String path = entity.path.replaceAll(r'\', '/');
        if (path.endsWith(_seamPath)) continue;

        final String source = entity.readAsStringSync();
        for (final String construction in <String>[
          'NoopErrorReporter(',
          'LocalLogErrorReporter(',
          'resolveErrorReporter(',
        ]) {
          if (source.contains(construction)) {
            offenders.add('$path constructs $construction');
          }
        }
      }

      expect(
        offenders,
        isEmpty,
        reason:
            'only $_seamPath may decide which reporter this build uses. '
            'Everywhere else injects `errorReporter`, or in a test a fake. Two '
            'places deciding is two answers to "does this build report '
            'errors".\n  ${offenders.join('\n  ')}',
      );
    });

    test('the DSN is the only key this task added to Env', () {
      final String env = File('lib/core/env.dart').readAsStringSync();
      expect(
        env.contains(
          RegExp(r"String\.fromEnvironment\(\s*'ERROR_REPORTER_DSN'"),
        ),
        isTrue,
      );
      // The seam reads the DSN through `Env` rather than calling
      // `String.fromEnvironment` itself, so there is one place a config key is
      // named.
      expect(seamSource.contains('fromEnvironment'), isFalse);
    });
  });
}
