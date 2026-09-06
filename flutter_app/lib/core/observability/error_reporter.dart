/// The error reporting seam (Req 8.4, 8.5).
///
/// Mirrors the payment seam in `domain/services/index.ts` for the same reason:
/// callers depend on an INTERFACE, and the concrete binding is chosen in exactly
/// ONE place ([errorReporter], via [resolveErrorReporter]). A second place that
/// decided which reporter to use would be a second answer to "does this build
/// report errors", and the payment seam exists because that shape has already
/// cost this codebase money.
///
/// WHAT SHIPS TODAY, AND WHY IT IS NOT A VENDOR SDK (design decision D13). The
/// seam, the no-op binding and the hooks in `main.dart` are the deliverable. No
/// Sentry, no Crashlytics, no new package: a vendor binding needs an account, a
/// DSN, keep rules verified against a shrunk release build and a Play Data
/// safety declaration for data leaving the device, none of which can be settled
/// here. Adding the binding later is one branch in [resolveErrorReporter] — that
/// is what the seam buys.
///
/// ── THE REDACTION GUARANTEE IS STRUCTURAL (Req 8.4) ───────────────────────
///
/// [ErrorReporter.recordError] takes an error, a stack trace and a fatality
/// flag. It takes NOTHING ELSE: no user parameter, no breadcrumb map, no
/// context object, no tags. That is not an omission to be tidied up later — it
/// is the whole mechanism by which a call site is unable to attach a legal
/// name, a postal address, an Identity_Gate document field, a card detail or a
/// session token. There is no code review to remember, no allow-list to keep in
/// step, and no way to regress it by accident, because the parameter does not
/// exist.
///
/// So do NOT add `setUser`, `setContext`, `addBreadcrumb`, a `Map<String,
/// Object?> extra`, or a "just the user id" field, even as a stub. Adding one
/// would not extend the feature; it would REMOVE the guarantee and replace it
/// with a promise. If a future report genuinely needs correlation, the thing to
/// add is a value the platform generated and can resolve on its own side, and
/// that is a decision to take deliberately rather than a parameter to widen.
///
/// ── HAZARD: AN ERROR'S OWN `toString()` (Req 8.4) ─────────────────────────
///
/// The guarantee above is about what the SEAM carries. It cannot be about what
/// an exception's message contains. An exception thrown out of a payment or
/// identity path can embed a value in its own message — a provider error quoting
/// a token, a parse failure quoting the payload it choked on — and that message
/// travels inside `error`, which the reporter must receive to be useful at all.
///
/// This seam deliberately does NOT truncate or scrub the message. A message is
/// opaque text: a scrubber would catch the patterns someone thought of, miss the
/// rest, and leave behind the impression that reports are clean. False comfort
/// about redaction is worse than a stated constraint, so the constraint is
/// stated instead:
///
///   * CALL SITES MUST NEVER THROW AN EXCEPTION WHOSE MESSAGE EMBEDS A SECRET
///     OR A MEMBER'S PERSONAL DATA. Name the operation that failed, not the
///     value it failed on. `core/config_gate.dart` already holds this line for
///     its own reasons and its PRIVACY note is the model to follow.
///
/// Today the risk is latent rather than live: every binding this file can return
/// sends nothing off the device. It becomes real the moment a vendor binding is
/// added, so whoever adds it must re-examine this note as part of that change —
/// together with the Data safety declaration, which is the same question asked
/// by the store.
///
/// This file wires no hooks. `FlutterError.onError`,
/// `PlatformDispatcher.instance.onError` and `runZonedGuarded` are `main.dart`'s
/// business (Req 8.1–8.3).
library;

import 'dart:developer' as developer;

import 'package:flutter/foundation.dart';

import '../env.dart';

/// Receives errors that escaped to the top of the app.
///
/// The only surface any call site sees. Implementations must be total: a
/// reporter is invoked from an error handler, so throwing from here would
/// replace a handled error with an unhandled one.
abstract interface class ErrorReporter {
  /// Record [error] with [stack].
  ///
  /// [fatal] distinguishes an error the app did not survive from one it ran
  /// through. It is a severity hint and nothing more — it changes no behaviour
  /// in this file's bindings.
  ///
  /// There is no user, context or breadcrumb parameter, and there must never be
  /// one. See the redaction note at the top of this file.
  void recordError(Object error, StackTrace? stack, {bool fatal});
}

/// Does nothing, on purpose.
///
/// The binding for debug builds and for tests (Req 8.5): under debug the
/// framework has already printed the error to the console, so a reporter that
/// printed again would duplicate it, and one that sent it would contradict the
/// requirement.
///
/// It is also the binding for a release build with no DSN. That case gets a
/// reporter that does nothing rather than a `null` reporter, so no caller
/// anywhere needs a null check around an error handler — the least appealing
/// place in a codebase to discover a missing one.
final class NoopErrorReporter implements ErrorReporter {
  const NoopErrorReporter();

  @override
  void recordError(Object error, StackTrace? stack, {bool fatal = false}) {
    // Intentionally empty. Not a TODO.
  }
}

/// Writes the error to the platform log and sends nothing.
///
/// What "the reporter is active" means while D13 stands: a release build with a
/// DSN configured records errors locally, off no network. BUILD.md and STORE.md
/// say the same thing, and the Data safety declaration is unaffected precisely
/// because nothing leaves the device.
///
/// The device log is not a substitute for a reporter — it is only readable with
/// the handset in hand. It exists so that configuring the key does something
/// observable instead of silently nothing.
final class LocalLogErrorReporter implements ErrorReporter {
  const LocalLogErrorReporter();

  @override
  void recordError(Object error, StackTrace? stack, {bool fatal = false}) {
    // Carries the error and the stack and no assembled context of its own. The
    // `toString()` hazard at the top of this file applies to `error`.
    developer.log(
      fatal ? 'fatal error' : 'error',
      name: 'noditto.error',
      error: error,
      stackTrace: stack,
    );
  }
}

/// The binding rule, pure and total.
///
/// Kept separate from [errorReporter] only so it is testable without a build
/// mode or a `--dart-define`: it is still the ONE rule, and [errorReporter] is
/// its ONE application.
///
/// * Debug — always [NoopErrorReporter], whatever the DSN says. Errors stay on
///   the console and nothing is reported (Req 8.5). A DSN left in a dev config
///   therefore cannot turn reporting on in debug.
/// * Release without a DSN — [NoopErrorReporter]. A valid reporter that does
///   nothing, never `null`.
/// * Release with a DSN — active. Today that is [LocalLogErrorReporter]; a
///   vendor binding replaces this one branch and nothing else.
ErrorReporter resolveErrorReporter({
  required bool isDebugBuild,
  required String dsn,
}) {
  if (isDebugBuild) return const NoopErrorReporter();
  if (dsn.trim().isEmpty) return const NoopErrorReporter();
  return const LocalLogErrorReporter();
}

/// The reporter this build uses. The single binding decision.
///
/// Nothing else in the app may construct a reporter — inject this, or in a test
/// inject a fake. `test/core/error_reporter_test.dart` fails if a second
/// construction site appears in `lib/`.
///
/// Strictness is keyed off the BUILD MODE (`kDebugMode`), never off
/// `Env.isProduction`, for the reason `core/config_gate.dart` records:
/// `isProduction` is itself a config value, so a `prod.env` typo would decide
/// it. Design decision D4.
final ErrorReporter errorReporter = resolveErrorReporter(
  isDebugBuild: kDebugMode,
  dsn: Env.errorReporterDsn,
);
