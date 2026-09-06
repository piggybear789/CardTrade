import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import 'env.dart';

/// Handoffs to the web app for operations this client cannot perform.
///
/// These flows require server authority the mobile client does not have:
///
/// - **Identity verification** needs a Stripe Identity session, which is
///   created with the secret key server-side.
/// - **Payout setup** needs a Stripe Connect onboarding link, also server-side.
/// - **Payout reporting** reads a model with no mobile equivalent.
/// - **Starting a Cash_Sale** goes through RPCs granted to `service_role` alone.
/// - **Claiming a private invite** applies the same guards, with no endpoint in
///   front of them.
/// - **Reporting** a listing writes the moderation queue through a Server Action.
/// - **A profile picture** needs the crop-and-upload path the website owns.
/// - **A message attachment** sits in a private bucket that only the website can
///   sign a path out of.
/// - **Terms and privacy** are website pages.
///
/// Opening a trade negotiation was previously here but is now native — the
/// mobile API endpoint evaluates the same guards the web app does.
///
/// In each remaining case the honest move is to hand off rather than to
/// reimplement business rules that must have exactly one definition.
///
/// EVERY AFFORDANCE THAT REACHES ONE OF THESE ANNOUNCES THE DEPARTURE FIRST
/// (Req 12.2). A member cannot read the address bar of a browser that has not
/// opened yet, so the control names the page and says the app is being left.
/// [pageLabel] is how it names it.
abstract final class WebHandoff {
  /// Base URL of the deployed web app.
  static String get baseUrl => Env.webAppUrl;

  /// Identity verification (Stripe Identity, document + selfie).
  static Uri get identityVerification => Uri.parse('$baseUrl/profile/identity');

  /// Payout setup (Stripe Connect onboarding).
  static Uri get payoutSetup => Uri.parse('$baseUrl/profile/payouts');

  /// A listing, for sharing or for flows not yet native.
  static Uri listing(String itemId) => Uri.parse('$baseUrl/listings/$itemId');

  /// Payout reporting: what a member is owed and what has landed.
  ///
  /// The same page as [payoutSetup], because the web tab is both. The read model
  /// behind it (`domain/payouts/payoutReadModel.ts`) has no mobile equivalent and
  /// is not getting one here, so the phone links to it rather than approximating
  /// it — a payout figure that disagrees with the website would be worse than no
  /// figure at all.
  static Uri get payoutReport => payoutSetup;

  /// A private invite, by the token the link carried.
  ///
  /// Claiming one opens a Cash_Sale or a Trade, which means the Identity_Gate,
  /// the region check and the seller-identity snapshot all have to be applied —
  /// and there is no mobile endpoint in front of any of it (`ApiRoutes` names
  /// none). So the invite is claimed where those guards live. The token is
  /// re-encoded because it is a path segment supplied by whoever sent the link.
  static Uri invite(String token) =>
      Uri.parse('$baseUrl/t/${Uri.encodeComponent(token)}');

  /// The member's own profile, where the website sets a profile picture.
  ///
  /// Uploading an avatar needs the crop-and-upload path the website already owns;
  /// the app has no avatar picker (Req 12.5). A caption saying so with no way to
  /// get there is not a smaller version of that gap, it is the same gap with the
  /// member given nothing to do about it — so the caption is an announced handoff
  /// instead.
  static Uri get profile => Uri.parse('$baseUrl/profile');

  /// Reporting a listing or a member.
  ///
  /// `lib/actions/reports.ts` is a Server Action with no mobile endpoint in front
  /// of it, so the report is filed where the moderation queue is written. The
  /// listing page is the surface that carries the control on the web.
  static Uri reportListing(String itemId) => listing(itemId);

  /// A conversation on the web, where its message attachments can be opened.
  ///
  /// Attachments (migration 0100) live in the PRIVATE `message-attachments`
  /// bucket. Turning a stored path into something a phone can draw needs the
  /// participation-checked signing the website performs server-side, and the
  /// mobile API exposes no such call. The only ways to close that here would be a
  /// public bucket or a service-role credential inside an app bundle, and Req 12.7
  /// rules out both — a bucket holding what members photograph for a dispute is
  /// not going public to save a screen. So the bubble says the attachment is
  /// there, names it, and opens the thread where it can be read (Req 12.6).
  static Uri conversation(String conversationId) =>
      Uri.parse('$baseUrl/messages/${Uri.encodeComponent(conversationId)}');

  /// The terms of service.
  static Uri get terms => Uri.parse('$baseUrl/terms');

  /// The privacy policy.
  static Uri get privacy => Uri.parse('$baseUrl/privacy');

  /// The page [uri] opens, as a member would read it out: `noditto.app/terms`.
  ///
  /// An outbound affordance has to NAME where it goes (Req 10.6), and a member
  /// cannot see the address bar of a browser that has not opened yet.
  static String pageLabel(Uri uri) => '${uri.host}${uri.path}';

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
