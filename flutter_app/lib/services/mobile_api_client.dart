import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../core/result.dart';
import 'supabase_service.dart';

/// HTTP client for the mobile API surface (`app/api/mobile/**`).
///
/// Authenticates every request with the current Supabase session's JWT as a
/// bearer token. Returns the server's `ActionResult` JSON as a `Result<T>`.
///
/// **Retry policy.** Reads (GET) retry on transient failures. Writes (POST) do
/// NOT retry, because a retried `initiateCashSale` or `makeOffer` would create
/// a second row. Requirement 4.4 calls this out explicitly.
class MobileApiClient {
  MobileApiClient(this._supabase);
  final SupabaseService _supabase;

  static const _maxReadRetries = 3;
  static const _baseDelay = Duration(milliseconds: 500);
  static const _timeout = Duration(seconds: 30);

  /// POST to a mobile API endpoint (write, no retry).
  Future<Result<T>> post<T>(
    String url, {
    Map<String, dynamic>? body,
    T Function(dynamic data)? transform,
  }) async {
    try {
      final response = await _send('POST', url, body: body);
      return _parseResponse<T>(response, transform);
    } on TimeoutException {
      return const Err('TIMEOUT', message: 'The request timed out. Please check your connection.');
    } on SocketException {
      return const Err('NETWORK_ERROR', message: 'Unable to reach the server. Check your connection.');
    } catch (e) {
      _log('Unexpected error: $e');
      return const Err('UNEXPECTED', message: 'Something went wrong. Please try again.');
    }
  }

  /// GET from a mobile API endpoint (read, retries on transient failures).
  Future<Result<T>> get<T>(
    String url, {
    Map<String, String>? queryParams,
    T Function(dynamic data)? transform,
  }) async {
    var attempt = 0;
    while (true) {
      try {
        final uri = queryParams != null && queryParams.isNotEmpty
            ? Uri.parse(url).replace(queryParameters: queryParams)
            : Uri.parse(url);
        final response = await http
            .get(uri, headers: _headers())
            .timeout(_timeout);
        if (_isRetryable(response.statusCode) && attempt < _maxReadRetries - 1) {
          attempt++;
          await _backoff(attempt);
          continue;
        }
        return _parseResponse<T>(response, transform);
      } on TimeoutException {
        attempt++;
        if (attempt >= _maxReadRetries) {
          return const Err('TIMEOUT', message: 'The request timed out. Please check your connection.');
        }
        await _backoff(attempt);
      } on SocketException {
        attempt++;
        if (attempt >= _maxReadRetries) {
          return const Err('NETWORK_ERROR', message: 'Unable to reach the server. Check your connection.');
        }
        await _backoff(attempt);
      } catch (e) {
        _log('Unexpected error: $e');
        return const Err('UNEXPECTED', message: 'Something went wrong. Please try again.');
      }
    }
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  Future<http.Response> _send(
    String method,
    String url, {
    Map<String, dynamic>? body,
  }) async {
    final uri = Uri.parse(url);
    final request = http.Request(method, uri)
      ..headers.addAll(_headers())
      ..body = body != null ? jsonEncode(body) : '';
    final streamed = await request.send().timeout(_timeout);
    return http.Response.fromStream(streamed);
  }

  Map<String, String> _headers() {
    final token = _supabase.client.auth.currentSession?.accessToken;
    return {
      'Content-Type': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
    };
  }

  Result<T> _parseResponse<T>(http.Response response, T Function(dynamic data)? transform) {
    if (response.statusCode == 401) {
      return const Err('NOT_AUTHENTICATED', message: 'Please sign in to continue.');
    }

    dynamic json;
    try {
      json = jsonDecode(response.body);
    } catch (_) {
      return Err('UNEXPECTED', message: 'Invalid response from server (${response.statusCode}).');
    }

    if (json is! Map<String, dynamic>) {
      return const Err('UNEXPECTED', message: 'Unexpected response format.');
    }

    if (json['ok'] == true) {
      final data = json['data'];
      if (transform != null) {
        return Ok(transform(data));
      }
      return Ok(data as T);
    }

    return Err(
      json['error'] as String? ?? 'UNKNOWN',
      message: json['message'] as String? ?? 'An error occurred.',
      field: json['field'] as String?,
    );
  }

  bool _isRetryable(int statusCode) =>
      statusCode == 429 || statusCode == 502 || statusCode == 503 || statusCode == 504;

  Future<void> _backoff(int attempt) async {
    final delay = _baseDelay * (1 << (attempt - 1));
    final capped = delay > const Duration(seconds: 10) ? const Duration(seconds: 10) : delay;
    await Future<void>.delayed(capped);
  }

  void _log(String message) {
    if (kDebugMode) {
      debugPrint('[MobileApiClient] $message');
    }
  }
}
