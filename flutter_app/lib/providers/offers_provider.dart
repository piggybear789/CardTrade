import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/offer.dart';
import '../services/offers_service.dart';
import 'auth_provider.dart';

/// Provides the OffersService.
final offersServiceProvider = Provider<OffersService>((ref) {
  return OffersService(
    ref.watch(supabaseServiceProvider),
    ref.watch(mobileApiClientProvider),
  );
});

/// Offers received by the current user.
final receivedOffersProvider = FutureProvider<List<Offer>>((ref) async {
  ref.watch(currentUserProvider);
  final service = ref.read(offersServiceProvider);
  return service.getReceivedOffers();
});

/// Offers sent by the current user.
final sentOffersProvider = FutureProvider<List<Offer>>((ref) async {
  ref.watch(currentUserProvider);
  final service = ref.read(offersServiceProvider);
  return service.getSentOffers();
});
