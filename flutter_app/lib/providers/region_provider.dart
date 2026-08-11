import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/env.dart';
import '../models/region.dart';
import 'auth_provider.dart';

/// All available regions (fetched once).
final regionsProvider = FutureProvider<List<Region>>((ref) async {
  final supabase = ref.read(supabaseServiceProvider);
  final response = await supabase
      .from('regions')
      .select()
      .order('label');

  return (response as List).map((j) => Region.fromJson(j)).toList();
});

/// The current browse region (display preference).
final browseRegionProvider =
    NotifierProvider<BrowseRegionNotifier, String>(BrowseRegionNotifier.new);

class BrowseRegionNotifier extends Notifier<String> {
  @override
  String build() => Env.defaultRegion;

  void set(String region) {
    state = region;
  }
}

/// Regions where trading is enabled.
final tradingRegionsProvider = FutureProvider<List<Region>>((ref) async {
  final regions = await ref.watch(regionsProvider.future);
  return regions.where((r) => r.tradingEnabled).toList();
});
