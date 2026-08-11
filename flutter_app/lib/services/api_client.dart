import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

import '../core/result.dart';
import 'supabase_service.dart';

/// Production HTTP wrapper around [SupabaseService].
///
/// - Catches PostgrestException and network errors, returns Result<T>.
/// - Retries transient failures (429, 503, network) with exponential backoff.
/// - Logs errors in debug mode.
/// - Provides a clean interface for queries and RPC calls.
class ApiClient {
  ApiClient(this._supabase);
  final SupabaseService _supabase;

  static const _maxRetries = 3;
  static const _baseDelay = Duration(milliseconds: 500);
  static const _timeout = Duration(seconds: 30);

  /// Execute a Supabase query with error handling and retry.
  ///
  /// Example:
  /// ```dart
  /// final result = await apiClient.query(() =>
  ///   _supabase.from('items').select().eq('id', itemId).single()
  /// );
  /// ```
  Future<Result<T>> query<T>(Future<T> Function() operation) async {
    var attempt = 0;

    while (true) {
      try {
        final result = await operation().timeout(_timeout);
        return Ok(result);
      } on TimeoutException {
        attempt++;
        if (attempt >= _maxRetries) {
          _log('Query timed out after $_maxRetries attempts');
          return const Err(
            'TIMEOUT',
            message: 'The request timed out. Please check your connection.',
          );
        }
        await _backoff(attempt);
      } on SocketException catch (e) {
        attempt++;
        if (attempt >= _maxRetries) {
          _log('Network error after $_maxRetries attempts: $e');
          return const Err(
            'NETWORK_ERROR',
            message: 'Unable to reach the server. Check your connection.',
          );
        }
        await _backoff(attempt);
      } on PostgrestException catch (e) {
        if (_isRetryablePostgrest(e) && attempt < _maxRetries - 1) {
          attempt++;
          await _backoff(attempt);
          continue;
        }
        _log('Postgrest error: ${e.code} ${e.message}');
        return Err(_mapPostgrestCode(e), message: _humanMessage(e));
      } on AuthException catch (e) {
        _log('Auth error: ${e.statusCode} ${e.message}');
        return Err('AUTH_ERROR', message: e.message);
      } catch (e) {
        if (_isRetryableGeneric(e) && attempt < _maxRetries - 1) {
          attempt++;
          await _backoff(attempt);
          continue;
        }
        _log('Unexpected error: $e');
        return const Err(
          'UNEXPECTED',
          message: 'Something went wrong. Please try again.',
        );
      }
    }
  }

  /// Execute an RPC function with error handling.
  Future<Result<T>> rpc<T>(
    String name, {
    Map<String, dynamic>? params,
    T Function(dynamic)? transform,
  }) async {
    return query<T>(() async {
      final response = await _supabase.rpc(name, params: params);
      if (transform != null) return transform(response);
      return response as T;
    });
  }

  /// Insert a row and return it.
  Future<Result<Map<String, dynamic>>> insert(
    String table,
    Map<String, dynamic> data,
  ) {
    return query(() async {
      return await _supabase.from(table).insert(data).select().single();
    });
  }

  /// Update a row and return it.
  Future<Result<Map<String, dynamic>>> update(
    String table,
    Map<String, dynamic> data, {
    required String column,
    required String value,
  }) {
    return query(() async {
      return await _supabase
          .from(table)
          .update(data)
          .eq(column, value)
          .select()
          .single();
    });
  }

  /// Delete a row.
  Future<Result<void>> delete(
    String table, {
    required String column,
    required String value,
  }) {
    return query(() async {
      await _supabase.from(table).delete().eq(column, value);
    });
  }

  // ─── Retry helpers ───────────────────────────────────────────────────────

  bool _isRetryablePostgrest(PostgrestException e) {
    final code = e.code;
    if (code == '429' || code == '503' || code == '502' || code == '504') {
      return true;
    }
    if (code == 'PGRST000') return true; // connection pool exhausted
    return false;
  }

  bool _isRetryableGeneric(Object error) {
    final msg = error.toString().toLowerCase();
    return msg.contains('connection') ||
        msg.contains('reset by peer') ||
        msg.contains('broken pipe');
  }

  Future<void> _backoff(int attempt) async {
    final delay = _baseDelay * (1 << (attempt - 1));
    final capped =
        delay > const Duration(seconds: 10) ? const Duration(seconds: 10) : delay;
    await Future<void>.delayed(capped);
  }

  // ─── Error mapping ───────────────────────────────────────────────────────

  String _mapPostgrestCode(PostgrestException e) {
    return switch (e.code) {
      '23505' => 'DUPLICATE',
      '23503' => 'REFERENCE_ERROR',
      '23502' => 'REQUIRED_FIELD',
      '23514' => 'VALIDATION',
      '42501' => 'FORBIDDEN',
      'PGRST116' => 'NOT_FOUND',
      '404' => 'NOT_FOUND',
      '401' => 'UNAUTHORIZED',
      '403' => 'FORBIDDEN',
      '409' => 'CONFLICT',
      '422' => 'VALIDATION',
      _ => 'DATABASE_ERROR',
    };
  }

  String _humanMessage(PostgrestException e) {
    return switch (e.code) {
      '23505' => 'This record already exists.',
      '23503' => 'A referenced record was not found.',
      '23502' => 'A required field is missing.',
      '23514' => 'The data did not pass validation.',
      '42501' => 'You do not have permission for this action.',
      'PGRST116' => 'The requested record was not found.',
      '401' => 'Please sign in to continue.',
      '403' => 'You do not have permission for this action.',
      _ => e.message,
    };
  }

  void _log(String message) {
    if (kDebugMode) {
      debugPrint('[ApiClient] $message');
    }
  }
}
