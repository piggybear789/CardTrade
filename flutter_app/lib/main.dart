/// CardTrade — Flutter client entry point.
///
/// Boots the app in a fixed order: Flutter binding, Supabase (which restores
/// any persisted session), then Stripe. Every dependency is initialised before
/// the widget tree is built so the router's first redirect decision is made
/// against a real auth state rather than an empty one.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_stripe/flutter_stripe.dart';

import 'core/env.dart';
import 'core/theme.dart';
import 'router/router.dart';
import 'services/supabase_service.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();

  try {
    await _bootstrap();
  } catch (error, stackTrace) {
    debugPrint('CardTrade failed to start: $error\n$stackTrace');
    runApp(StartupErrorApp(message: error.toString()));
    return;
  }

  runApp(const ProviderScope(child: CardTradeApp()));
}

/// Initialises external services.
///
/// Supabase comes first because [SupabaseService.initialize] restores the
/// persisted session, and the router reads that session on its first build.
Future<void> _bootstrap() async {
  if (Env.supabaseUrl.isEmpty || Env.supabaseAnonKey.isEmpty) {
    throw StateError(
      'Supabase is not configured. Launch with '
      '--dart-define-from-file=config/dev.env so that SUPABASE_URL and '
      'SUPABASE_ANON_KEY are compiled in.',
    );
  }

  await SupabaseService.instance.initialize();

  // Stripe is deliberately non-fatal. Browsing, messaging and negotiation all
  // work without it, and only the payment surfaces need a key — so a missing
  // key degrades those screens rather than blacking out the whole app.
  if (Env.stripePublishableKey.isEmpty) {
    debugPrint(
      'STRIPE_PUBLISHABLE_KEY is unset — payment surfaces will not work.',
    );
    return;
  }

  Stripe.publishableKey = Env.stripePublishableKey;
  await Stripe.instance.applySettings();
}

/// The application shell: theme plus the go_router configuration.
class CardTradeApp extends ConsumerWidget {
  const CardTradeApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'CardTrade',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.lightTheme,
      routerConfig: ref.watch(routerProvider),
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
            padding: const EdgeInsets.all(AppTheme.spacingXl),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(
                  Icons.error_outline,
                  size: 48,
                  color: AppTheme.danger,
                ),
                const SizedBox(height: AppTheme.spacingLg),
                Text(
                  'CardTrade could not start',
                  style: Theme.of(context).textTheme.headlineMedium,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: AppTheme.spacingSm),
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
