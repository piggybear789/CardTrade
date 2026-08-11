/// Route guards for the CardTrade app.
///
/// These evaluate client-side business rules to determine whether
/// a user should be redirected away from certain routes. The server
/// is still authoritative — these are UX guards, not security gates.
import '../domain/identity/identity_gate.dart';
import '../models/profile.dart';

/// Routes that require authentication.
const List<String> protectedPrefixes = [
  '/listings/new',
  '/listings/edit',
  '/listings/mine',
  '/trades',
  '/sales',
  '/messages',
  '/profile',
  '/offers',
  '/saved',
  '/notifications',
];

/// Routes that require passing the Identity Gate (verified identity).
/// These are actions where money is at stake.
const List<String> identityGatedPrefixes = [
  '/listings/new', // Publishing a listing
  '/listings/edit', // Editing (implies ownership)
  '/trades/new', // Proposing a trade
  '/sales/buy', // Initiating a purchase (as seller context)
];

/// Whether the given path requires authentication.
bool requiresAuth(String path) {
  return protectedPrefixes.any((prefix) => path.startsWith(prefix));
}

/// Whether the given path requires the Identity Gate.
bool requiresIdentityGate(String path) {
  return identityGatedPrefixes.any((prefix) => path.startsWith(prefix));
}

/// Evaluates whether the user should be redirected given their profile.
///
/// Returns a redirect path, or null if navigation should proceed.
String? evaluateRouteGuard({
  required String targetPath,
  required bool isAuthenticated,
  required Profile? profile,
}) {
  // Auth guard
  if (!isAuthenticated && requiresAuth(targetPath)) {
    return '/auth/sign-in';
  }

  // Authenticated users shouldn't see auth screens
  if (isAuthenticated && targetPath.startsWith('/auth')) {
    return '/home';
  }

  // Identity gate guard
  if (profile != null && requiresIdentityGate(targetPath)) {
    if (!satisfiesIdentityGate(profile.identityCheckStatus)) {
      // Redirect to verification with a return path
      return '/profile/identity';
    }
  }

  // Fraud ban check
  if (profile != null && profile.isFraudBanned) {
    // Banned users can only view their profile
    if (!targetPath.startsWith('/profile') && !targetPath.startsWith('/auth')) {
      return '/profile';
    }
  }

  return null; // Proceed normally
}

/// Deep link patterns that the app can handle.
///
/// These correspond to web app routes that should open the mobile app:
/// - noditto://listings/:id
/// - noditto://trades/:id
/// - noditto://sales/:id
/// - noditto://messages/:id
/// - https://noditto.app/listings/:id (universal links)
const String appScheme = 'noditto';
const String webDomain = 'noditto.app';

/// Parses a deep link URI into a go_router-compatible path.
String? parseDeepLink(Uri uri) {
  // Custom scheme: cardtrade://listings/abc-123
  if (uri.scheme == appScheme) {
    return '/${uri.host}${uri.path}';
  }

  // Universal link: https://cardtrade.app/listings/abc-123
  if (uri.host == webDomain) {
    return uri.path;
  }

  return null;
}
