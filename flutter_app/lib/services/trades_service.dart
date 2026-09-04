import '../core/api_routes.dart';
import '../core/result.dart';
import '../models/pre_auth_hold.dart';
import '../models/trade.dart';
import 'mobile_api_client.dart';
import 'supabase_service.dart';

/// Service for trade operations.
///
/// Reads go through Supabase directly (RLS handles access control).
/// All writes go through the mobile API surface, which delegates to the same
/// server actions and orchestrators the web app uses — no new business logic.
class TradesService {
  TradesService(this._supabase, this._api);

  final SupabaseService _supabase;
  final MobileApiClient _api;

  // ─── Reads (direct Supabase, RLS-enforced) ──────────────────────────────────

  /// Fetch the current user's trades (as initiator or counterpart).
  Future<List<TradeSummary>> getMyTrades() async {
    final userId = _supabase.currentUserId;
    if (userId == null) return [];

    final response = await _supabase
        .from('trades')
        .select('''
          id, state, initiator_item_id, counterpart_item_id, updated_at,
          initiator_item:items!trades_initiator_item_id_fkey(title, image_paths),
          counterpart_item:items!trades_counterpart_item_id_fkey(title, image_paths),
          counterpart:profiles!trades_counterpart_id_fkey(display_name, avatar_path)
        ''')
        .or('initiator_id.eq.$userId,counterpart_id.eq.$userId')
        .order('updated_at', ascending: false);

    return (response as List).map((json) {
      final initiatorItem = json['initiator_item'] as Map<String, dynamic>?;
      final counterpartItem = json['counterpart_item'] as Map<String, dynamic>?;
      final counterpart = json['counterpart'] as Map<String, dynamic>?;
      final images1 = (initiatorItem?['image_paths'] as List?)?.cast<String>() ?? [];
      final images2 = (counterpartItem?['image_paths'] as List?)?.cast<String>() ?? [];

      return TradeSummary.fromJson({
        'id': json['id'],
        'state': json['state'],
        'initiator_item_id': json['initiator_item_id'],
        'counterpart_item_id': json['counterpart_item_id'],
        'updated_at': json['updated_at'],
        'initiator_item_title': initiatorItem?['title'],
        'initiator_item_image': images1.isNotEmpty ? images1.first : null,
        'counterpart_item_title': counterpartItem?['title'],
        'counterpart_item_image': images2.isNotEmpty ? images2.first : null,
        'counterpart_display_name': counterpart?['display_name'],
        'counterpart_avatar_path': counterpart?['avatar_path'],
      });
    }).toList();
  }

  /// Fetch a single trade by ID.
  Future<Trade?> getTrade(String id) async {
    final response = await _supabase
        .from('trades')
        .select()
        .eq('id', id)
        .maybeSingle();

    if (response == null) return null;
    return Trade.fromJson(response);
  }

  /// Fetch holds for a trade.
  Future<List<PreAuthHold>> getTradeHolds(String tradeId) async {
    final response = await _supabase
        .from('pre_auth_holds')
        .select()
        .eq('trade_id', tradeId)
        .order('created_at');

    return (response as List).map((j) => PreAuthHold.fromJson(j)).toList();
  }

  /// Subscribe to real-time trade changes.
  Stream<Trade> watchTrade(String tradeId) {
    return _supabase
        .client
        .schema('cardtrade')
        .from('trades')
        .stream(primaryKey: ['id'])
        .eq('id', tradeId)
        .map((rows) => Trade.fromJson(rows.first));
  }

  // ─── Negotiation (via mobile API endpoints) ─────────────────────────────────

  /// Open a new trade negotiation.
  ///
  /// Now native — delegates to the server's openTradeNegotiation action which
  /// evaluates the Identity_Gate, region compatibility, item ownership, and
  /// the shopfront/binder rules.
  Future<Result<dynamic>> openNegotiation({
    required String initiatorItemId,
    required String counterpartItemId,
    String? counterpartGoodsDescription,
    String? message,
  }) async {
    return _api.post(
      ApiRoutes.tradeOpen,
      body: {
        'initiatorItemId': initiatorItemId,
        'counterpartItemId': counterpartItemId,
        'counterpartGoodsDescription': ?counterpartGoodsDescription,
        'message': ?message,
      },
    );
  }

  /// Propose revised trade terms (fulfilment method, shipping cost, etc.).
  Future<Result<dynamic>> proposeTerms(
    String tradeId,
    int expectedTermsVersion,
    Map<String, dynamic> terms,
  ) async {
    return _api.post(
      ApiRoutes.tradeProposeTerms,
      body: {
        'tradeId': tradeId,
        'expectedTermsVersion': expectedTermsVersion,
        'terms': terms,
      },
    );
  }

  /// Accept trade terms. Requires current terms_version.
  Future<Result<dynamic>> acceptTerms(String tradeId, int termsVersion) async {
    return _api.post(
      ApiRoutes.tradeAcceptTerms,
      body: {
        'tradeId': tradeId,
        'termsVersion': termsVersion,
      },
    );
  }

  /// Re-seek collateral after a declined card hold.
  Future<Result<dynamic>> retryCollateral(String tradeId) async {
    return _api.post(
      ApiRoutes.tradeRetryCollateral,
      body: {
        'tradeId': tradeId,
      },
    );
  }

  /// Decline a trade offer.
  Future<Result<dynamic>> declineOffer(String tradeId, {String? reason}) async {
    return _api.post(
      ApiRoutes.tradeDecline,
      body: {
        'tradeId': tradeId,
        'reason': ?reason,
      },
    );
  }

  // ─── Lifecycle (via mobile API endpoints) ───────────────────────────────────

  /// Record shipment for the current user's side.
  Future<Result<dynamic>> recordShipment(
    String tradeId, {
    String? carrier,
    String? trackingNumber,
    String? trackingUrl,
  }) async {
    return _api.post(
      ApiRoutes.tradeRecordShipment,
      body: {
        'tradeId': tradeId,
        if (carrier != null || trackingNumber != null || trackingUrl != null)
          'shipment': {
            'carrier': ?carrier,
            'trackingNumber': ?trackingNumber,
            'trackingUrl': ?trackingUrl,
          },
      },
    );
  }

  /// Record receipt of goods from the other party.
  Future<Result<dynamic>> recordReceipt(String tradeId) async {
    return _api.post(
      ApiRoutes.tradeRecordReceipt,
      body: {'tradeId': tradeId},
    );
  }

  /// Accept goods after inspection (finalise the trade from this side).
  Future<Result<dynamic>> recordAcceptance(String tradeId) async {
    return _api.post(
      ApiRoutes.tradeRecordAcceptance,
      body: {'tradeId': tradeId},
    );
  }

  /// Confirm in-person handover.
  /// This means "we met and swapped", NOT "I am satisfied" — the trade
  /// lands on INSPECTION, never COMPLETED, because a trader who has just been
  /// handed a convincing fake needs a remedy afterwards.
  Future<Result<dynamic>> confirmHandover(String tradeId) async {
    return _api.post(
      ApiRoutes.tradeConfirmHandover,
      body: {'tradeId': tradeId},
    );
  }

  /// Report that the in-person handover failed (no-show, wrong meeting, etc.).
  Future<Result<dynamic>> reportHandoverFailed(String tradeId, String reason) async {
    return _api.post(
      ApiRoutes.tradeReportHandoverFailed,
      body: {
        'tradeId': tradeId,
        'reason': reason,
      },
    );
  }

  /// Raise a condition dispute.
  Future<Result<dynamic>> raiseDispute(String tradeId, String reason) async {
    return _api.post(
      ApiRoutes.tradeRaiseDispute,
      body: {
        'tradeId': tradeId,
        'reason': reason,
      },
    );
  }

  /// Report objective fraud.
  Future<Result<dynamic>> reportFraud(String tradeId, String reason) async {
    return _api.post(
      ApiRoutes.tradeReportFraud,
      body: {
        'tradeId': tradeId,
        'reason': reason,
      },
    );
  }

  /// Update handover/fulfilment terms (method, meeting time, shipping cost).
  Future<Result<dynamic>> updateHandoverTerms(
    String tradeId,
    Map<String, dynamic> input,
  ) async {
    return _api.post(
      ApiRoutes.tradeUpdateHandoverTerms,
      body: {
        'tradeId': tradeId,
        'input': input,
      },
    );
  }

  /// Save a delivery address for this trade.
  Future<Result<dynamic>> saveDeliveryAddress(
    String tradeId,
    Map<String, dynamic> address,
  ) async {
    return _api.post(
      ApiRoutes.tradeSaveDeliveryAddress,
      body: {
        'tradeId': tradeId,
        'address': address,
      },
    );
  }

  /// Get delivery addresses for a trade.
  Future<Result<dynamic>> getDeliveryAddresses(String tradeId) async {
    return _api.post(
      ApiRoutes.tradeGetDeliveryAddresses,
      body: {'tradeId': tradeId},
    );
  }

  /// Sync shipment tracking status.
  Future<Result<dynamic>> syncTracking(String tradeId) async {
    return _api.post(
      ApiRoutes.tradeSyncTracking,
      body: {'tradeId': tradeId},
    );
  }
}
