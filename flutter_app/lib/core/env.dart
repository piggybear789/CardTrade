/// Environment configuration for CardTrade Flutter app.
///
/// For production, these should come from --dart-define.
/// For debug builds, the defaults below connect to the real project.
abstract final class Env {
  /// Supabase project URL.
  static const supabaseUrl = String.fromEnvironment(
    'SUPABASE_URL',
    defaultValue: 'https://emojqulpbiyqoyggespp.supabase.co',
  );

  /// Supabase anonymous (publishable) key.
  static const supabaseAnonKey = String.fromEnvironment(
    'SUPABASE_ANON_KEY',
    defaultValue: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVtb2pxdWxwYml5cW95Z2dlc3BwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5MDM4MjAsImV4cCI6MjA5NjQ3OTgyMH0.L5dLIZ3b6rKGpHwn9nsX5xpf-waFvcCQ-HZGdzH0478',
  );

  /// Stripe publishable key (browser-safe).
  static const stripePublishableKey = String.fromEnvironment(
    'STRIPE_PUBLISHABLE_KEY',
    defaultValue: '',
  );

  /// Whether the app is running in production mode.
  static const isProduction = bool.fromEnvironment('PRODUCTION');

  /// Default browse region when nothing else resolves.
  static const defaultRegion = String.fromEnvironment(
    'DEFAULT_REGION',
    defaultValue: 'AU',
  );

  /// Base URL of the deployed web app.
  ///
  /// Used for the flows that must hand off to the server — identity
  /// verification, payout setup, and opening a trade negotiation. See
  /// `core/web_handoff.dart` for why each one cannot run on the client.
  static const webAppUrl = String.fromEnvironment(
    'WEB_APP_URL',
    defaultValue: 'https://noditto.app',
  );
}
