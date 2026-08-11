import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/trade.dart';
import '../models/pre_auth_hold.dart';
import '../services/trades_service.dart';
import 'auth_provider.dart';

/// Provides the TradesService.
final tradesServiceProvider = Provider<TradesService>((ref) {
  return TradesService(
    ref.watch(supabaseServiceProvider),
    ref.watch(mobileApiClientProvider),
  );
});

/// The current user's trade list.
final myTradesProvider = FutureProvider<List<TradeSummary>>((ref) async {
  ref.watch(currentUserProvider);
  final service = ref.read(tradesServiceProvider);
  return service.getMyTrades();
});

/// A single trade by ID (one-shot fetch).
final tradeDetailProvider =
    FutureProvider.family<Trade?, String>((ref, tradeId) async {
  final service = ref.read(tradesServiceProvider);
  return service.getTrade(tradeId);
});

/// Real-time trade stream for the trade room.
final tradeStreamProvider =
    StreamProvider.family<Trade, String>((ref, tradeId) {
  final service = ref.read(tradesServiceProvider);
  return service.watchTrade(tradeId);
});

/// Holds for a trade.
final tradeHoldsProvider =
    FutureProvider.family<List<PreAuthHold>, String>((ref, tradeId) async {
  final service = ref.read(tradesServiceProvider);
  return service.getTradeHolds(tradeId);
});
