import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/cash_sale.dart';
import '../models/cash_sale_item.dart';
import '../models/contract_step.dart';
import '../services/sales_service.dart';
import 'auth_provider.dart';

/// Provides the SalesService.
final salesServiceProvider = Provider<SalesService>((ref) {
  return SalesService(
    ref.watch(supabaseServiceProvider),
    ref.watch(mobileApiClientProvider),
  );
});

/// The current user's cash sales.
final mySalesProvider = FutureProvider<List<CashSaleSummary>>((ref) async {
  ref.watch(currentUserProvider);
  final service = ref.read(salesServiceProvider);
  return service.getMySales();
});

/// A single cash sale by ID.
final saleDetailProvider =
    FutureProvider.family<CashSale?, String>((ref, saleId) async {
  final service = ref.read(salesServiceProvider);
  return service.getSale(saleId);
});

/// Real-time sale stream for the contract room.
final saleStreamProvider =
    StreamProvider.family<CashSale, String>((ref, saleId) {
  final service = ref.read(salesServiceProvider);
  return service.watchSale(saleId);
});

/// Line items for a cash sale (shopfront contracts).
final saleLineItemsProvider =
    FutureProvider.family<List<CashSaleItem>, String>((ref, saleId) async {
  final service = ref.read(salesServiceProvider);
  return service.getLineItems(saleId);
});

/// The contract step plan the server derived for a cash sale.
///
/// The room declares no step list, so this is the only source of one. It never
/// throws and never errors: an unavailable plan is an EMPTY list, which the rail
/// draws as nothing and the action card answers with no action (Req 11.5). Exposing
/// a failure here would invite a `when(error: …)` branch that guessed a rail.
///
/// It watches the sale stream so the plan is re-derived when the contract moves —
/// the plan is a function of the row, and a stale rail beside a fresh status badge
/// would be the two clients disagreeing inside one screen.
final saleStepPlanProvider =
    FutureProvider.family<List<ContractStep>, String>((ref, saleId) async {
  ref.watch(saleStreamProvider(saleId));
  final service = ref.read(salesServiceProvider);
  return service.getStepPlan(saleId);
});
