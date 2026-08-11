/// Mobile API endpoint paths.
///
/// GENERATED: no. But kept in one file so `scripts/lib/mobileContract.ts` can parse
/// them statically and assert they resolve to a route handler. Adding a path here
/// without a handler makes the contract guard fail.
///
/// Every entry matches `app/api/mobile/<area>/<action>/route.ts` on the server.
library;

import 'env.dart';

abstract final class ApiRoutes {
  /// Base URL for all mobile API calls.
  static String get base => '${Env.webAppUrl}/api/mobile';

  // ─── Listings ─────────────────────────────────────────────────────────────
  static String get listingsCreate => '$base/listings/create';
  static String get listingsUpdate => '$base/listings/update';
  static String get listingsDelete => '$base/listings/delete';
  static String get listingsClose => '$base/listings/close';

  // ─── Cash Sale ────────────────────────────────────────────────────────────
  static String get cashSaleInitiate => '$base/cash-sale/initiate';
  static String get cashSaleAcceptTerms => '$base/cash-sale/accept-terms';
  static String get cashSaleUpdateTerms => '$base/cash-sale/update-terms';
  static String get cashSaleUpdateItems => '$base/cash-sale/update-items';
  static String get cashSaleListItems => '$base/cash-sale/list-items';
  static String get cashSaleProposePrice => '$base/cash-sale/propose-price';
  static String get cashSaleRecordShipment => '$base/cash-sale/record-shipment';
  static String get cashSaleRecordReceipt => '$base/cash-sale/record-receipt';
  static String get cashSaleAcceptInspection => '$base/cash-sale/accept-inspection';
  static String get cashSaleConfirmHandover => '$base/cash-sale/confirm-handover';
  static String get cashSaleCancel => '$base/cash-sale/cancel';
  static String get cashSaleSyncTracking => '$base/cash-sale/sync-tracking';
  static String get cashSaleRaiseDispute => '$base/cash-sale/raise-dispute';

  // ─── Trade Negotiation ────────────────────────────────────────────────────
  static String get tradeOpen => '$base/trades/open';
  static String get tradeProposeTerms => '$base/trades/propose-terms';
  static String get tradeAcceptTerms => '$base/trades/accept-terms';
  static String get tradeDecline => '$base/trades/decline';

  // ─── Trade Lifecycle ──────────────────────────────────────────────────────
  static String get tradeRecordShipment => '$base/trades/record-shipment';
  static String get tradeRecordReceipt => '$base/trades/record-receipt';
  static String get tradeRecordAcceptance => '$base/trades/record-acceptance';
  static String get tradeConfirmHandover => '$base/trades/confirm-handover';
  static String get tradeReportHandoverFailed => '$base/trades/report-handover-failed';
  static String get tradeRaiseDispute => '$base/trades/raise-dispute';
  static String get tradeReportFraud => '$base/trades/report-fraud';
  static String get tradeUpdateHandoverTerms => '$base/trades/update-handover-terms';
  static String get tradeSaveDeliveryAddress => '$base/trades/save-delivery-address';
  static String get tradeGetDeliveryAddresses => '$base/trades/get-delivery-addresses';
  static String get tradeSyncTracking => '$base/trades/sync-tracking';

  // ─── Offers ───────────────────────────────────────────────────────────────
  static String get offersMake => '$base/offers/make';
  static String get offersCounter => '$base/offers/counter';
  static String get offersRespond => '$base/offers/respond';
  static String get offersListMine => '$base/offers/list-mine';
  static String get offersListForItem => '$base/offers/list-for-item';

  // ─── Messages ─────────────────────────────────────────────────────────────
  static String get messagesGetOrCreate => '$base/messages/get-or-create';
  static String get messagesSend => '$base/messages/send';
  static String get messagesMarkRead => '$base/messages/mark-read';
  static String get messagesListConversations => '$base/messages/list-conversations';
  static String get messagesGetConversation => '$base/messages/get-conversation';

  // ─── Payments ─────────────────────────────────────────────────────────────
  static String get paymentsBeginCardSetup => '$base/payments/begin-card-setup';
  static String get paymentsCompleteCardSetup => '$base/payments/complete-card-setup';
  static String get paymentsGetStatus => '$base/payments/get-status';
}
