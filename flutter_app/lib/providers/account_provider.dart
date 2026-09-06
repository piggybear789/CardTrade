import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../services/account_service.dart';
import 'auth_provider.dart';

/// Provides the [AccountService] over the shared mobile API client.
final accountServiceProvider = Provider<AccountService>((ref) {
  return AccountService(ref.watch(mobileApiClientProvider));
});
