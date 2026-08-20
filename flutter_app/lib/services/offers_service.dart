import '../core/api_routes.dart';
import '../core/result.dart';
import '../models/offer.dart';
import 'mobile_api_client.dart';
import 'supabase_service.dart';

/// Service for offer operations (single items only, never shopfronts).
///
/// Reads go through Supabase directly (RLS handles access control).
/// Writes go through the mobile API, which delegates to the same server
/// actions the web app uses.
class OffersService {
  OffersService(this._supabase, this._api);

  final SupabaseService _supabase;
  final MobileApiClient _api;

  // ─── Reads (direct Supabase, RLS-enforced) ──────────────────────────────────

  /// Fetch offers received by the current user.
  Future<List<Offer>> getReceivedOffers() async {
    final userId = _supabase.currentUserId;
    if (userId == null) return [];

    final response = await _supabase
        .from('offers')
        .select()
        .eq('seller_id', userId)
        .order('created_at', ascending: false);

    return (response as List).map((j) => Offer.fromJson(j)).toList();
  }

  /// Fetch offers sent by the current user.
  Future<List<Offer>> getSentOffers() async {
    final userId = _supabase.currentUserId;
    if (userId == null) return [];

    final response = await _supabase
        .from('offers')
        .select()
        .eq('buyer_id', userId)
        .order('created_at', ascending: false);

    return (response as List).map((j) => Offer.fromJson(j)).toList();
  }

  // ─── Writes (via mobile API endpoints) ──────────────────────────────────────

  /// Make an offer on a listing.
  Future<Result<dynamic>> makeOffer({
    required String itemId,
    required int amountCents,
    String? message,
  }) async {
    return _api.post(
      ApiRoutes.offersMake,
      body: {
        'itemId': itemId,
        'amountCents': amountCents,
        'message': ?message,
      },
    );
  }

  /// Counter an offer (seller action).
  Future<Result<dynamic>> counterOffer({
    required String offerId,
    required int amountCents,
    String? message,
  }) async {
    return _api.post(
      ApiRoutes.offersCounter,
      body: {
        'offerId': offerId,
        'amountCents': amountCents,
        'message': ?message,
      },
    );
  }

  /// Respond to an offer (accept, decline, withdraw).
  /// The server's `respondToOffer` collapses accept/decline/withdraw into one
  /// endpoint with an `action` discriminator.
  Future<Result<dynamic>> respondToOffer(String offerId, String action) async {
    return _api.post(
      ApiRoutes.offersRespond,
      body: {
        'offerId': offerId,
        'action': action,
      },
    );
  }

  /// Accept an offer (convenience wrapper around respondToOffer).
  Future<Result<dynamic>> acceptOffer(String offerId) =>
      respondToOffer(offerId, 'accept');

  /// Decline an offer (convenience wrapper around respondToOffer).
  Future<Result<dynamic>> declineOffer(String offerId) =>
      respondToOffer(offerId, 'decline');

  /// Withdraw an offer (convenience wrapper around respondToOffer).
  Future<Result<dynamic>> withdrawOffer(String offerId) =>
      respondToOffer(offerId, 'withdraw');

  /// List offers the current user has made.
  Future<Result<dynamic>> listMine() async {
    return _api.get(ApiRoutes.offersListMine);
  }

  /// List offers for a specific item.
  Future<Result<dynamic>> listForItem(String itemId) async {
    return _api.get(ApiRoutes.offersListForItem, queryParams: {'itemId': itemId});
  }
}
