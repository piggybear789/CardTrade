/// Fail-closed validation of the Runtime_Config (Req 6.1, 6.4, 6.5, 6.8).
///
/// A misconfigured release must fail at startup rather than in a member's
/// payment flow. This module is the pure half of that: it takes the config
/// VALUES rather than reading `Env`, so it is testable without a build-time
/// `--dart-define`. `main.dart` supplies `Env`'s values and decides what to do
/// with the result — under `kReleaseMode` a non-empty result is fatal, under
/// debug it is reported and the app continues.
///
/// Strictness is keyed off the BUILD MODE by the caller, never off
/// `Env.isProduction`: `isProduction` is itself a config value, so a `prod.env`
/// typo would ship a permissive release. See design decision D4.
///
/// PRIVACY: a `reason` names the key and what is wrong with it, and NEVER
/// echoes the value. These reasons reach a startup error screen, a debug log
/// and therefore a screenshot or a crash report, so a malformed secret pasted
/// into the wrong slot must not travel with them. Do not add the value to a
/// reason, a `toString`, or an "expected/actual" message.
library;

/// The dart-define name of a Required_Config_Key.
///
/// Every entry here is public by design — a project URL, a publishable
/// (anon) key, a publishable Stripe key and a public web origin. No
/// service-role key and no Stripe secret key is a Required_Config_Key, and
/// none may ever be added to this list (Req 6.4): the app bundle ships to
/// devices, so anything it can read is disclosed.
abstract final class ConfigKeys {
  static const String supabaseUrl = 'SUPABASE_URL';
  static const String supabaseAnonKey = 'SUPABASE_ANON_KEY';
  static const String stripePublishableKey = 'STRIPE_PUBLISHABLE_KEY';
  static const String webAppUrl = 'WEB_APP_URL';

  /// Every Required_Config_Key, in reporting order.
  static const List<String> required = <String>[
    supabaseUrl,
    supabaseAnonKey,
    stripePublishableKey,
    webAppUrl,
  ];
}

/// The prefix a Stripe publishable key carries.
///
/// A secret (`sk_`), restricted (`rk_`) or webhook-signing (`whsec_`) value in
/// this slot fails the prefix test and is therefore reported as MISSING rather
/// than accepted as configured (Req 6.5). That is the point of the check: a
/// secret in a shipped bundle should be loud, not silently functional.
const String kStripePublishablePrefix = 'pk_';

/// One Required_Config_Key that is absent or unusable.
class MissingConfig {
  const MissingConfig(this.key, this.reason);

  /// The dart-define name, e.g. `STRIPE_PUBLISHABLE_KEY`.
  final String key;

  /// Developer-useful, member-useless, and value-free. See the PRIVACY note at
  /// the top of this file.
  final String reason;

  @override
  bool operator ==(Object other) =>
      other is MissingConfig && other.key == key && other.reason == reason;

  @override
  int get hashCode => Object.hash(key, reason);

  /// Deliberately carries the key and the reason and nothing else.
  @override
  String toString() => '$key: $reason';
}

/// Reasons, named so the tests assert on the same strings the screen shows.
const String _reasonEmpty = 'is not set';
// Deliberately carries no example URL and no host name. An example is one more
// string a value could accidentally be a substring of, and the key name in
// [MissingConfig.key] already says which slot is wrong.
const String _reasonNotAbsoluteHttps = 'must be an absolute https URL';
const String _reasonNotPublishable =
    'must be a Stripe publishable key beginning with "pk_" — a secret or '
    'restricted key does not belong in a mobile build';

/// Validates the Runtime_Config. Pure and total: it never throws and never
/// performs I/O.
///
/// Returns one [MissingConfig] per offending key, in [ConfigKeys.required]
/// order. An empty result means every Required_Config_Key satisfies its rule.
///
/// Values are trimmed before being judged, so a key that is three spaces is
/// empty and a value carrying the trailing newline a `.env` file leaves behind
/// is still valid.
List<MissingConfig> validateConfig({
  required String supabaseUrl,
  required String supabaseAnonKey,
  required String stripePublishableKey,
  required String webAppUrl,
}) {
  final List<MissingConfig> problems = <MissingConfig>[];

  void checkPresent(String key, String value) {
    if (value.trim().isEmpty) problems.add(MissingConfig(key, _reasonEmpty));
  }

  void checkHttpsUrl(String key, String value) {
    final String trimmed = value.trim();
    if (trimmed.isEmpty) {
      problems.add(MissingConfig(key, _reasonEmpty));
      return;
    }
    if (!_isAbsoluteHttpsUrl(trimmed)) {
      problems.add(MissingConfig(key, _reasonNotAbsoluteHttps));
    }
  }

  checkHttpsUrl(ConfigKeys.supabaseUrl, supabaseUrl);
  checkPresent(ConfigKeys.supabaseAnonKey, supabaseAnonKey);

  final String stripe = stripePublishableKey.trim();
  if (stripe.isEmpty) {
    problems.add(
      const MissingConfig(ConfigKeys.stripePublishableKey, _reasonEmpty),
    );
  } else if (!stripe.startsWith(kStripePublishablePrefix)) {
    problems.add(
      const MissingConfig(
        ConfigKeys.stripePublishableKey,
        _reasonNotPublishable,
      ),
    );
  }

  checkHttpsUrl(ConfigKeys.webAppUrl, webAppUrl);

  return problems;
}

/// Whether [value] is an absolute `https` URL with a host.
///
/// `Uri.tryParse` accepts a great deal that is not a URL — a bare host
/// (`noditto.app`) parses as a relative path, and a scheme-relative `//host`
/// parses with no scheme at all. Both are rejected here, as is plain `http`:
/// a member's session token and every API call ride this origin.
/// Interior whitespace is rejected before parsing, because `Uri.tryParse`
/// happily accepts `https://exa mple.com` and hands back a host with a space in
/// it. That is a plausible `.env` typo, and left alone it would fail at the
/// first request rather than at startup — exactly the failure this gate exists
/// to move earlier.
bool _isAbsoluteHttpsUrl(String value) {
  if (value.contains(RegExp(r'\s'))) return false;
  final Uri? uri = Uri.tryParse(value);
  if (uri == null) return false;
  if (!uri.hasScheme) return false;
  // `Uri` lower-cases the scheme, so `HTTPS://` is accepted.
  if (uri.scheme != 'https') return false;
  if (!uri.hasAuthority) return false;
  if (uri.host.isEmpty) return false;
  return true;
}
