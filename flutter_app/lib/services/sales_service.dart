import '../core/api_routes.dart';
import '../core/result.dart';
import '../models/cash_sale.dart';
import '../models/cash_sale_item.dart';
import 'mobile_api_client.dart';
import 'supabase_service.dart';

/// Service for cash sale operations.
///
/// Reads go through Supabase directly (RLS handles access control).
/// All writes go through the mobile API surface, which delegates to the same
/// server actions and orchestrators the web app uses — no new business logic.
class SalesService {
  SalesService(this._supabase, this._api);

  final SupabaseService _supabase;
  final MobileApiClient _api;

  // ─── Reads (direct Supabase, RLS-enforced) ──────────────────────────────────

  /// Fetch the current user's sales (as buyer or seller).
  Future<List<CashSaleSummary>> getMySales() async {
    final userId = _supabase.currentUserId;
    if (userId == null) return [];

    final response = await _supabase
        .from('cash_sales')
        .select('''
          id, status, item_title, agreed_price_cents, item_image_paths,
          currency, buyer_id, seller_id, updated_at
        ''')
        .or('buyer_id.eq.$userId,seller_id.eq.$userId')
        .order('updated_at', ascending: false);

    return (response as List)
        .map((json) => CashSaleSummary.fromJson(json))
        .toList();
  }

  /// Fetch a single cash sale by ID.
  Future<CashSale?> getSale(String id) async {
    final response = await _supabase
        .from('cash_sales')
        .select()
        .eq('id', id)
        .maybeSingle();

    if (response == null) return null;
    return CashSale.fromJson(response);
  }

  /// Fetch contract line items for a cash sale.
  Future<List<CashSaleItem>> getLineItems(String cashSaleId) async {
    final response = await _supabase
        .from('cash_sale_items')
        .select()
        .eq('cash_sale_id', cashSaleId)
        .order('sort_order');

    return (response as List)
        .map((json) => CashSaleItem.fromJson(json))
        .toList();
  }

  /// Subscribe to real-time sale changes.
  Stream<CashSale> watchSale(String saleId) {
    return _supabase
        .client
        .schema('cardtrade')
        .from('cash_sales')
        .stream(primaryKey: ['id'])
        .eq('id', saleId)
        .map((rows) => CashSale.fromJson(rows.first));
  }

  // ─── Writes (via mobile API endpoints) ──────────────────────────────────────

  /// Initiate a cash sale (buyer action).
  Future<Result<dynamic>> initiatePurchase({
    required String itemId,
    required String sellerIdentityVersion,
    required bool buyerConfirmedSellerIdentity,
    int? agreedPriceCents,
    List<Map<String, dynamic>>? lineItems,
  }) async {
    return _api.post(
      ApiRoutes.cashSaleInitiate,
      body: {
        'itemId': itemId,
        'sellerIdentityVersion': sellerIdentityVersion,
        'buyerConfirmedSellerIdentity': buyerConfirmedSellerIdentity,
        'agreedPriceCents': ?agreedPriceCents,
        'lineItems': ?lineItems,
      },
    );
  }

  /// Accept terms (buyer or seller). Requires current terms_version.
  Future<Result<dynamic>> acceptTerms(String saleId, int termsVersion) async {
    return _api.post(
      ApiRoutes.cashSaleAcceptTerms,
      body: {
        'cashSaleId': saleId,
        'termsVersion': termsVersion,
      },
    );
  }

  /// Update terms (fulfilment method, shipping cost, meeting details).
  Future<Result<dynamic>> updateTerms(
    String saleId,
    int expectedTermsVersion,
    Map<String, dynamic> terms,
  ) async {
    return _api.post(
      ApiRoutes.cashSaleUpdateTerms,
      body: {
        'cashSaleId': saleId,
        'expectedTermsVersion': expectedTermsVersion,
        'terms': terms,
      },
    );
  }

  /// Update contract line items (for binder/shopfront sales).
  Future<Result<dynamic>> updateItems(
    String saleId,
    int expectedTermsVersion,
    List<Map<String, dynamic>> lineItems,
  ) async {
    return _api.post(
      ApiRoutes.cashSaleUpdateItems,
      body: {
        'cashSaleId': saleId,
        'expectedTermsVersion': expectedTermsVersion,
        'lineItems': lineItems,
      },
    );
  }

  /// List current line items for a cash sale (server-authoritative).
  Future<Result<dynamic>> listItems(String saleId) async {
    return _api.post(
      ApiRoutes.cashSaleListItems,
      body: {'cashSaleId': saleId},
    );
  }

  /// Propose a price for a single-item contract.
  /// Refused on shopfront contracts — use updateItems instead.
  Future<Result<dynamic>> proposePrice(
    String saleId,
    int expectedTermsVersion,
    int priceCents,
  ) async {
    return _api.post(
      ApiRoutes.cashSaleProposePrice,
      body: {
        'cashSaleId': saleId,
        'expectedTermsVersion': expectedTermsVersion,
        'priceCents': priceCents,
      },
    );
  }

  /// Record shipment (seller action).
  Future<Result<dynamic>> recordShipment(
    String saleId, {
    required String carrier,
    required String trackingNumber,
  }) async {
    return _api.post(
      ApiRoutes.cashSaleRecordShipment,
      body: {
        'cashSaleId': saleId,
        'carrier': carrier,
        'trackingNumber': trackingNumber,
      },
    );
  }

  /// Record receipt of goods (buyer action).
  Future<Result<dynamic>> recordReceipt(String saleId) async {
    return _api.post(
      ApiRoutes.cashSaleRecordReceipt,
      body: {'cashSaleId': saleId},
    );
  }

  /// Accept goods after inspection (buyer action).
  Future<Result<dynamic>> acceptInspection(String saleId) async {
    return _api.post(
      ApiRoutes.cashSaleAcceptInspection,
      body: {'cashSaleId': saleId},
    );
  }

  /// Confirm in-person handover.
  Future<Result<dynamic>> confirmHandover(String saleId) async {
    return _api.post(
      ApiRoutes.cashSaleConfirmHandover,
      body: {'cashSaleId': saleId},
    );
  }

  /// Cancel a cash sale.
  Future<Result<dynamic>> cancelSale(String saleId, {String? reason}) async {
    return _api.post(
      ApiRoutes.cashSaleCancel,
      body: {
        'cashSaleId': saleId,
        'reason': ?reason,
      },
    );
  }

  /// Sync shipment tracking info.
  Future<Result<dynamic>> syncTracking(String saleId) async {
    return _api.post(
      ApiRoutes.cashSaleSyncTracking,
      body: {'cashSaleId': saleId},
    );
  }

  /// Raise a dispute on a cash sale.
  Future<Result<dynamic>> raiseDispute(String saleId, String reason) async {
    return _api.post(
      ApiRoutes.cashSaleRaiseDispute,
      body: {
        'cashSaleId': saleId,
        'reason': reason,
      },
    );
  }
}
