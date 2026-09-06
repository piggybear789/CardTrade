/// Environment configuration for CardTrade Flutter app.
///
/// Every value comes from `--dart-define` (in practice a `--dart-define-from-file`
/// pointing at `config/dev.env` or `config/prod.env`). There are deliberately NO
/// baked-in project defaults: a default is what made the fail-closed gate in
/// `core/config_gate.dart` unreachable, because "missing Supabase config" could
/// never occur and `config/prod.env` was decorative. See design decision D5.
///
/// Nothing here may be a service-role key or a Stripe secret key (Req 6.4).
/// This class ships inside an app bundle, so anything it can read is disclosed.
abstract final class Env {
  /// Supabase project URL.
  static const supabaseUrl = String.fromEnvironment('SUPABASE_URL');

  /// Supabase anonymous (publishable) key.
  static const supabaseAnonKey = String.fromEnvironment('SUPABASE_ANON_KEY');

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

  /// Optional DSN for the error reporter (Req 8.5).
  ///
  /// Empty is the normal state: no provider has been chosen, so the seam in
  /// `core/observability/error_reporter.dart` binds a reporter that sends
  /// nothing. See design decision D13. This is not a secret — a DSN is an
  /// ingestion endpoint that ships inside client bundles by design — but it is
  /// still optional rather than a Required_Config_Key, because a build with no
  /// reporter configured must run.
  static const errorReporterDsn = String.fromEnvironment(
    'ERROR_REPORTER_DSN',
    defaultValue: '',
  );

  /// Base URL of the deployed web app.
  ///
  /// Used for the flows that must hand off to the server — identity
  /// verification, payout setup, and opening a trade negotiation (see
  /// `core/web_handoff.dart`) — and, less obviously, for EVERY mobile API call:
  /// `ApiRoutes.base` is `'$webAppUrl/api/mobile'`.
  ///
  /// KEEPS its default, unlike the Supabase values (D5). That looks
  /// inconsistent, so the reasoning is recorded here.
  ///
  /// D5's defect was not "a Required_Config_Key has a default" in the abstract.
  /// It was that an ABSENT `SUPABASE_URL` resolved to a WRONG-but-working
  /// answer: a release with no config connected to a developer's live project
  /// and looked healthy. Absence here resolves to the CORRECT answer — this
  /// default is the production origin — so the failure D5 removes does not
  /// exist for this key.
  ///
  /// The gate's rule on it is not dead either. It cannot fire on absence, but it
  /// fires on every malformed OVERRIDE (`noditto.app` with no scheme, a plain
  /// `http` origin, a pasted value with a space in it), which is the realistic
  /// way this key goes wrong in a `.env` file.
  ///
  /// Stripping it also costs something concrete: `WebHandoff.pageLabel` renders
  /// `uri.host`, so with no default every handoff affordance in a widget test
  /// reads `/profile/identity` instead of `noditto.app/profile/identity`, and
  /// six profile goldens would be re-baselined to capture a misconfigured app.
  /// Member copy that names where a handoff goes should not depend on a
  /// build-time define being present in the test harness.
  ///
  /// The residual risk is a stale host: if the production origin changes, a
  /// build that omits the key uses the old one silently. That is why
  /// `config/prod.env.example` lists this key as REQUIRED.
  static const webAppUrl = String.fromEnvironment(
    'WEB_APP_URL',
    defaultValue: 'https://noditto.app',
  );
}
