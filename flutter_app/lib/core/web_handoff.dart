import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import 'env.dart';

/// Handoffs to the web app for operations this client cannot perform.
///
/// Two flows require server authority the mobile client does not have:
///
/// - **Identity verification** needs a Stripe Identity session, which is
///   created with the secret key server-side.
/// - **Payout setup** needs a Stripe Connect onboarding link, also server-side.
///
/// Opening a trade negotiation was previously here but is now native — the
/// mobile API endpoint evaluates the same guards the web app does.
///
/// In each remaining case the honest move is to hand off rather than to
/// reimplement business rules that must have exactly one definition.
abstract final class WebHandoff {
  /// Base URL of the deployed web app.
  static String get baseUrl => Env.webAppUrl;

  /// Identity verification (Stripe Identity, document + selfie).
  static Uri get identityVerification => Uri.parse('$baseUrl/profile/identity');

  /// Payout setup (Stripe Connect onboarding).
  static Uri get payoutSetup => Uri.parse('$baseUrl/profile/payouts');

  /// A listing, for sharing or for flows not yet native.
  static Uri listing(String itemId) => Uri.parse('$baseUrl/listings/$itemId');

  /// Buy a listing, carrying a binder request through so it is not retyped.
  ///
  /// Every cash-sale RPC is service-role only, so the contract is opened on the
  /// web where the Identity_Gate, region check and seller disclosure snapshot
  /// are applied. [request] and [offerCents] are the written request and its
  /// single price for a binder — see `RequestDraft` in
  /// `components/sales/ContractLineItems.tsx`.
  static Uri buyListing(
    String itemId, {
    String? request,
    int? offerCents,
  }) {
    final params = <String, String>{'buy': '1'};
    if (request != null && request.isNotEmpty) params['request'] = request;
    if (offerCents != null && offerCents > 0) {
      params['offer'] = (offerCents / 100).toStringAsFixed(2);
    }
    return Uri.parse('$baseUrl/listings/$itemId')
        .replace(queryParameters: params);
  }

  /// Opens [uri] in the device browser.
  ///
  /// Returns false if no browser could handle it, so callers can surface an
  /// error instead of appearing to succeed. Never throws.
  static Future<bool> open(Uri uri) async {
    try {
      if (!await canLaunchUrl(uri)) return false;
      return launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      return false;
    }
  }

  /// Opens [uri], showing an error SnackBar on [context] if it could not open.
  static Future<void> openOrWarn(BuildContext context, Uri uri) async {
    final opened = await open(uri);
    if (!opened && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Could not open your browser.')),
      );
    }
  }
}
