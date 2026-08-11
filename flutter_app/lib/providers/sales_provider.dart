import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/cash_sale.dart';
import '../models/cash_sale_item.dart';
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
