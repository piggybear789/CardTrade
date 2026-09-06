import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/contract_step.dart';
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

/// The contract step plan the server derived for a trade.
///
/// The room declares no step list, so this is the only source of one. It never
/// throws and never errors: an unavailable plan is an EMPTY list, which the rail
/// draws as nothing and the action card answers with no action (Req 11.5).
///
/// It watches the trade stream so the plan is re-derived when the trade moves, and
/// the holds too — `collateralSeekFailed` and the release step both read them, so a
/// declined card must change the rail without a manual refresh.
final tradeStepPlanProvider =
    FutureProvider.family<List<ContractStep>, String>((ref, tradeId) async {
  ref.watch(tradeStreamProvider(tradeId));
  ref.watch(tradeHoldsProvider(tradeId));
  final service = ref.read(tradesServiceProvider);
  return service.getStepPlan(tradeId);
});
