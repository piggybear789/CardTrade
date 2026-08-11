import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../services/supabase_service.dart';
import '../services/auth_service.dart';
import '../services/mobile_api_client.dart';

/// Provides the SupabaseService singleton.
final supabaseServiceProvider = Provider<SupabaseService>((ref) {
  return SupabaseService.instance;
});

/// Provides the MobileApiClient for HTTP calls to the mobile API surface.
final mobileApiClientProvider = Provider<MobileApiClient>((ref) {
  return MobileApiClient(ref.watch(supabaseServiceProvider));
});

/// Provides the AuthService.
final authServiceProvider = Provider<AuthService>((ref) {
  return AuthService(ref.watch(supabaseServiceProvider));
});

/// Watches the current auth state (signed in / signed out).
final authStateProvider = StreamProvider<AuthState>((ref) {
  final authService = ref.watch(authServiceProvider);
  return authService.authStateChanges;
});

/// The currently authenticated user, or null.
///
/// Falls back to the session Supabase restored during startup. [authStateProvider]
/// is a stream that has not emitted yet on the first build, so reading it alone
/// reports an already-signed-in member as signed out and the router bounces them
/// to the sign-in screen until the first event arrives.
final currentUserProvider = Provider<User?>((ref) {
  final authState = ref.watch(authStateProvider);
  return authState.whenData((state) => state.session?.user).value ??
      ref.watch(supabaseServiceProvider).currentUser;
});

/// Whether the user is currently authenticated.
final isAuthenticatedProvider = Provider<bool>((ref) {
  return ref.watch(currentUserProvider) != null;
});

/// Auth actions notifier for sign-in/sign-up flows.
final authActionsProvider =
    AsyncNotifierProvider<AuthActionsNotifier, void>(AuthActionsNotifier.new);

class AuthActionsNotifier extends AsyncNotifier<void> {
  @override
  FutureOr<void> build() {}

  AuthService get _authService => ref.read(authServiceProvider);

  /// Sign in with email and password.
  Future<void> signIn({
    required String email,
    required String password,
  }) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      await _authService.signInWithEmail(email: email, password: password);
    });
  }

  /// Sign up with email, password, and display name.
  Future<void> signUp({
    required String email,
    required String password,
    required String displayName,
  }) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      await _authService.signUp(
        email: email,
        password: password,
        displayName: displayName,
      );
    });
  }

  /// Send a magic link.
  Future<void> sendMagicLink(String email) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      await _authService.sendMagicLink(email);
    });
  }

  /// Send password reset email.
  Future<void> sendPasswordReset(String email) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      await _authService.sendPasswordReset(email);
    });
  }

  /// Sign out.
  Future<void> signOut() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      await _authService.signOut();
    });
  }
}
