import 'package:supabase_flutter/supabase_flutter.dart';
import 'supabase_service.dart';

/// Authentication service wrapping Supabase Auth.
class AuthService {
  AuthService(this._supabase);

  final SupabaseService _supabase;

  /// Sign in with email and password.
  Future<AuthResponse> signInWithEmail({
    required String email,
    required String password,
  }) async {
    return _supabase.auth.signInWithPassword(
      email: email,
      password: password,
    );
  }

  /// Sign up with email, password, and display name.
  Future<AuthResponse> signUp({
    required String email,
    required String password,
    required String displayName,
  }) async {
    return _supabase.auth.signUp(
      email: email,
      password: password,
      data: {'display_name': displayName},
    );
  }

  /// Send a magic link for passwordless sign-in.
  Future<void> sendMagicLink(String email) async {
    await _supabase.auth.signInWithOtp(email: email);
  }

  /// Send a password reset email.
  Future<void> sendPasswordReset(String email) async {
    await _supabase.auth.resetPasswordForEmail(email);
  }

  /// Sign out the current user.
  Future<void> signOut() async {
    await _supabase.auth.signOut();
  }

  /// Get the current session, or null if not authenticated.
  Session? get currentSession => _supabase.auth.currentSession;

  /// Get the current user, or null.
  User? get currentUser => _supabase.currentUser;

  /// Whether the user is currently authenticated.
  bool get isAuthenticated => currentSession != null;

  /// Stream of auth state changes.
  Stream<AuthState> get authStateChanges => _supabase.authStateChanges;
}
