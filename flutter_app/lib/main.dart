/// CardTrade — Flutter client entry point.
///
/// Boots the app in a fixed order: Flutter binding, the Runtime_Config gate,
/// Supabase (which restores any persisted session), then Stripe. The gate runs
/// FIRST, before anything consumes the config, so a blank `SUPABASE_URL` or an
/// `sk_`-prefixed Stripe key is reported as a configuration failure rather than
/// as a Supabase or Stripe error thrown from inside a provider SDK (Req 6.1).
/// Every dependency is initialised before the widget tree is built so the
/// router's first redirect decision is made against a real auth state rather
/// than an empty one.
///
/// This file also owns the three error hooks (Req 8.1–8.3). The seam in
/// `core/observability/error_reporter.dart` decides WHICH reporter this build
/// uses; this file decides WHERE errors are caught. Nothing here constructs a
/// reporter — [errorReporter] is injected into [installErrorHooks], and
/// `test/core/error_reporter_test.dart` fails if a second construction site
/// appears anywhere in `lib/`.
library;

import 'dart:async' show runZonedGuarded;
import 'dart:ui' show PlatformDispatcher;

import 'package:flutter/foundation.dart' show kReleaseMode, visibleForTesting;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_stripe/flutter_stripe.dart';

import 'core/config_gate.dart';
import 'core/config_report_banner.dart';
import 'core/env.dart';
import 'core/observability/error_reporter.dart';
import 'core/theme.dart';
import 'router/router.dart';
import 'services/supabase_service.dart';

/// What [_bootstrap] managed to initialise, plus what it found wrong.
///
/// `problems` is always empty in a release build that got this far, because a
/// non-empty result is fatal there (Req 6.2). In debug it is the report the
/// [ConfigReportBanner] renders (Req 6.3).
typedef _Startup = ({List<MissingConfig> problems, bool supabaseReady});

/// Boots the app inside the zone that catches uncaught Dart errors (Req 8.1).
///
/// ORDERING IS LOAD-BEARING, and getting it wrong is not a silent failure:
/// `WidgetsFlutterBinding.ensureInitialized()` records the zone it was called
/// in, and Flutter asserts if `runApp` later runs in a different one ("Zone
/// mismatch"). So the binding is created INSIDE the [runZonedGuarded] callback,
/// not before it, which puts the binding, the hook installation, `_bootstrap`
/// and every `runApp` call in one zone.
void main() {
  runZonedGuarded<void>(
    () async {
      WidgetsFlutterBinding.ensureInitialized();
      installErrorHooks(errorReporter);
      await _run();
    },
    // An error that reached the zone was handled by nobody, but the widget tree
    // is untouched and the app keeps running — so it is recorded as non-fatal.
    // Only a startup failure that ends in [StartupErrorApp] is fatal.
    (Object error, StackTrace stack) =>
        errorReporter.recordError(error, stack, fatal: false),
  );
}

/// Installs the three top-level error hooks and, in release, the error surface
/// a member sees in place of a failed widget (Req 8.1–8.3, 8.6).
///
/// Takes the reporter rather than reading the binding, so a test can inject a
/// fake. Exposed for `test/core/error_hooks_test.dart`; nothing in `lib/` other
/// than [main] may call it.
@visibleForTesting
void installErrorHooks(ErrorReporter reporter) {
  // Req 8.2. `FlutterError.presentError` IS the default handler's whole body —
  // it is what prints the red-screen dump to the console — so it is called
  // first and the recording is added after it. Replacing it instead of adding to
  // it would make a framework error harder to debug than before this hook
  // existed, in exchange for nothing.
  FlutterError.onError = (FlutterErrorDetails details) {
    FlutterError.presentError(details);
    // Non-fatal: the framework caught this, and the app runs on with either the
    // widget rebuilt or the error surface below in its place (Req 8.6).
    reporter.recordError(details.exception, details.stack, fatal: false);
  };

  // Req 8.3. Returning true says the error is handled, which is what stops the
  // engine treating it as an unhandled exception (Req 8.6).
  PlatformDispatcher.instance.onError = (Object error, StackTrace stack) {
    reporter.recordError(error, stack, fatal: false);
    return true;
  };

  // Req 8.6. The framework's own `ErrorWidget` is a build-phase error surface:
  // a red box with an exception dump in debug, a plain grey box in release.
  // Neither is for a member, so release gets a plain sentence instead. Debug is
  // left alone deliberately — the red box is the fastest way a developer learns
  // which widget threw, and the message is already on the console anyway.
  if (kReleaseMode) {
    ErrorWidget.builder = (FlutterErrorDetails details) => const _ErrorSurface();
  }
}

/// The former body of [main]: bootstrap, then run whichever app the result asks
/// for. Split out only so [main] is the zone and nothing else.
Future<void> _run() async {
  final _Startup startup;
  try {
    startup = await _bootstrap();
  } catch (error, stackTrace) {
    debugPrint('CardTrade failed to start: $error\n$stackTrace');
    // A MissingConfigException is deliberately NOT reported. It is a
    // CONFIGURATION finding, not a crash: the build was assembled without a
    // Required_Config_Key, every install of that build fails identically, and
    // its message is a list of key names. In a real reporter that is noise that
    // arrives once per launch and tells the developer nothing the build command
    // did not already. Everything else here IS a crash — Supabase or Stripe
    // failing to initialise — and it is fatal, because the app never reaches a
    // member surface and shows [StartupErrorApp] instead.
    if (error is! MissingConfigException) {
      errorReporter.recordError(error, stackTrace, fatal: true);
    }
    runApp(StartupErrorApp(message: error.toString()));
    return;
  }

  if (!startup.supabaseReady) {
    // Debug only — a release build threw above. The router reads Supabase on
    // its first build, so with the project URL or anon key missing there is no
    // member surface to hang the banner over. Report on the same screen the
    // release path uses rather than adding a third surface.
    runApp(StartupErrorApp(message: describeMissingConfig(startup.problems)));
    return;
  }

  runApp(
    ProviderScope(child: CardTradeApp(configProblems: startup.problems)),
  );
}

/// Validates the Runtime_Config, then initialises external services.
///
/// Order is deliberate. The gate runs before `Supabase.initialize` and before
/// `Stripe.publishableKey`, both of which fail on their own terms given an empty
/// value and would report a config problem as a provider problem. Supabase then
/// comes before the widget tree because [SupabaseService.initialize] restores
/// the persisted session, and the router reads that session on its first build.
///
/// Strictness keys off `kReleaseMode` and NEVER off `Env.isProduction`, which is
/// itself a config value — a `prod.env` typo would otherwise ship a permissive
/// release. See design decision D4.
Future<_Startup> _bootstrap() async {
  final List<MissingConfig> problems = validateConfig(
    supabaseUrl: Env.supabaseUrl,
    supabaseAnonKey: Env.supabaseAnonKey,
    stripePublishableKey: Env.stripePublishableKey,
    webAppUrl: Env.webAppUrl,
  );

  if (problems.isNotEmpty && kReleaseMode) {
    throw MissingConfigException(problems);
  }

  bool broken(String key) => problems.any((p) => p.key == key);

  // Debug from here down. Each consumer is initialised only if its own keys
  // passed, so the gate's finding stays the reported failure.
  final bool supabaseReady =
      !broken(ConfigKeys.supabaseUrl) && !broken(ConfigKeys.supabaseAnonKey);
  if (supabaseReady) {
    await SupabaseService.instance.initialize();
  }

  // Stripe is deliberately non-fatal in debug. Browsing, messaging and
  // negotiation all work without it, and only the payment surfaces need a key —
  // so a missing key degrades those screens rather than blocking local work.
  if (!broken(ConfigKeys.stripePublishableKey)) {
    Stripe.publishableKey = Env.stripePublishableKey.trim();
    await Stripe.instance.applySettings();
  }

  return (problems: problems, supabaseReady: supabaseReady);
}

/// Thrown when a Release_Build starts on an incomplete Runtime_Config (Req 6.2).
///
/// Carries the keys and nothing else, because its message is what
/// [StartupErrorApp] shows on screen.
class MissingConfigException implements Exception {
  const MissingConfigException(this.problems);

  final List<MissingConfig> problems;

  @override
  String toString() => describeMissingConfig(problems);
}

/// Renders [problems] for a human, naming each key and no value.
///
/// Every line is `KEY: reason` from [MissingConfig.toString], which is
/// value-free by construction — see the PRIVACY note in `core/config_gate.dart`.
String describeMissingConfig(List<MissingConfig> problems) {
  final String lines = problems.map((p) => '• $p').join('\n');
  return 'The app is not configured to run.\n\n$lines';
}

/// What a member sees in a release build where a widget failed to build
/// (Req 8.6), in place of the framework's `ErrorWidget`.
///
/// Deliberately built from `Directionality`, `ColoredBox`, `Center` and `Text`
/// and nothing else: an `ErrorWidget` replaces the widget that threw, so it can
/// land anywhere in the tree — including above `MaterialApp`, where there is no
/// `Theme`, no `Directionality` and no `Material` to inherit from. It therefore
/// supplies its own text direction and reads its ink straight off the tokens
/// rather than off an ancestor that may not exist.
///
/// It names no exception, because the message is for a member and the details
/// are already with the reporter.
class _ErrorSurface extends StatelessWidget {
  const _ErrorSurface();

  @override
  Widget build(BuildContext context) {
    return const Directionality(
      textDirection: TextDirection.ltr,
      child: ColoredBox(
        color: AppColors.background,
        child: Center(
          child: Padding(
            padding: EdgeInsets.all(AppSpacing.group),
            child: Text(
              'Something went wrong on this screen. Go back and try again.',
              textAlign: TextAlign.center,
              style: AppText.supportText,
            ),
          ),
        ),
      ),
    );
  }
}

/// The application shell: theme plus the go_router configuration.
class CardTradeApp extends ConsumerWidget {
  const CardTradeApp({this.configProblems = const <MissingConfig>[], super.key});

  /// Debug-only Runtime_Config report (Req 6.3). Empty in a release build, and
  /// then [ConfigReportBanner] renders nothing.
  final List<MissingConfig> configProblems;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'CardTrade',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      routerConfig: ref.watch(routerProvider),
      // Req 13.10: the system factor is honoured up to 2.0. Applied once here so
      // no screen can forget it, and so the ceiling has exactly one definition.
      builder: (context, child) => CappedTextScale(
        child: ConfigReportBanner(
          problems: configProblems,
          child: child ?? const SizedBox.shrink(),
        ),
      ),
    );
  }
}

/// Shown when [_bootstrap] fails.
///
/// Exists because a configuration error would otherwise render as a blank
/// window that gives no indication of what went wrong.
class StartupErrorApp extends StatelessWidget {
  const StartupErrorApp({required this.message, super.key});

  final String message;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      home: Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(AppSpacing.group),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(
                  Icons.error_outline,
                  size: 48,
                  color: AppColors.destructive,
                ),
                const SizedBox(height: AppSpacing.cozy),
                Text(
                  'CardTrade could not start',
                  style: Theme.of(context).textTheme.headlineMedium,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: AppSpacing.tight),
                Text(
                  message,
                  style: Theme.of(context).textTheme.bodySmall,
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
