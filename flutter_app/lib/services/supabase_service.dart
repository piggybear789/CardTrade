import 'package:supabase_flutter/supabase_flutter.dart';
import '../core/env.dart';
import '../core/constants.dart';

/// Singleton Supabase service providing the configured client.
///
/// All queries target the 'cardtrade' schema, matching the web app.
class SupabaseService {
  SupabaseService._();
  static final instance = SupabaseService._();

  late final SupabaseClient _client;

  /// Initialize Supabase. Call once at app startup.
  Future<void> initialize() async {
    await Supabase.initialize(
      url: Env.supabaseUrl,
      anonKey: Env.supabaseAnonKey,
    );
    _client = Supabase.instance.client;
  }

  /// The configured Supabase client.
  SupabaseClient get client => _client;

  /// Auth instance for sign-in/sign-up/session management.
  GoTrueClient get auth => _client.auth;

  /// Returns a query builder for the given table in the cardtrade schema.
  SupabaseQueryBuilder from(String table) =>
      _client.schema(AppConstants.dbSchema).from(table);

  /// Calls an RPC function in the cardtrade schema.
  PostgrestFilterBuilder<dynamic> rpc(
    String functionName, {
    Map<String, dynamic>? params,
  }) =>
      _client.schema(AppConstants.dbSchema).rpc(functionName, params: params ?? {});

  /// Realtime channel for subscribing to table changes.
  RealtimeChannel channel(String name) => _client.channel(name);

  /// Storage bucket access.
  StorageFileApi storage(String bucket) => _client.storage.from(bucket);

  /// Current authenticated user, or null.
  User? get currentUser => _client.auth.currentUser;

  /// Current user ID, or null.
  String? get currentUserId => _client.auth.currentUser?.id;

  /// Stream of auth state changes.
  Stream<AuthState> get authStateChanges => _client.auth.onAuthStateChange;
}
