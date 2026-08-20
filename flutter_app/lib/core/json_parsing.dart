/// Safe JSON parsing helpers for Supabase responses.
///
/// Supabase returns nullable fields, joined rows that might be null, and
/// Postgres types that arrive as different Dart runtime types (num for int,
/// String for timestamptz). These extensions handle all of that without
/// throwing, so a single malformed field doesn't crash the whole list.
///
/// Usage:
/// ```dart
/// final item = Item(
///   id: json.reqString('id'),
///   title: json.reqString('title'),
///   fmvCents: json.reqInt('fmv_cents'),
///   createdAt: json.reqDateTime('created_at'),
///   status: json.reqEnum('status', ItemStatus.values, ItemStatus.available),
/// );
/// ```
library;

import '../models/enums.dart';

/// Extension on JSON maps for safe field access.
extension SafeJson on Map<String, dynamic> {
  // ─── Strings ─────────────────────────────────────────────────────────────

  /// Optional string. Returns null if key is missing or value is null.
  String? optString(String key) {
    final val = this[key];
    if (val == null) return null;
    return val.toString();
  }

  /// Required string. Returns empty string if missing/null.
  String reqString(String key) => optString(key) ?? '';

  // ─── Numbers ─────────────────────────────────────────────────────────────

  /// Optional int. Handles Postgres returning num (int or double).
  int? optInt(String key) {
    final val = this[key];
    if (val == null) return null;
    if (val is num) return val.toInt();
    return int.tryParse(val.toString());
  }

  /// Required int. Returns 0 if missing/null/unparseable.
  int reqInt(String key) => optInt(key) ?? 0;

  /// Optional double.
  double? optDouble(String key) {
    final val = this[key];
    if (val == null) return null;
    if (val is num) return val.toDouble();
    return double.tryParse(val.toString());
  }

  /// Required double. Returns 0.0 if missing/null/unparseable.
  double reqDouble(String key) => optDouble(key) ?? 0.0;

  // ─── Booleans ────────────────────────────────────────────────────────────

  /// Optional bool (nullable). Returns null if key is missing.
  bool? optBoolNullable(String key) {
    final val = this[key];
    if (val == null) return null;
    if (val is bool) return val;
    if (val is String) return val == 'true' || val == 't';
    return null;
  }

  /// Required bool. Returns false if missing/null.
  bool optBool(String key) => optBoolNullable(key) ?? false;

  // ─── DateTime ────────────────────────────────────────────────────────────

  /// Optional DateTime. Handles ISO 8601 strings from Postgres timestamptz.
  DateTime? optDateTime(String key) {
    final val = this[key];
    if (val == null) return null;
    if (val is DateTime) return val;
    return DateTime.tryParse(val.toString());
  }

  /// Required DateTime. Returns Unix epoch if missing/null/unparseable.
  DateTime reqDateTime(String key) =>
      optDateTime(key) ?? DateTime.fromMillisecondsSinceEpoch(0);

  // ─── Lists ───────────────────────────────────────────────────────────────

  /// Optional list of strings. Returns empty list if missing/null.
  List<String> optStringList(String key) {
    final val = this[key];
    if (val == null) return [];
    if (val is List) return val.whereType<String>().toList();
    return [];
  }

  /// Optional list of maps (for nested joined arrays).
  List<Map<String, dynamic>> optMapList(String key) {
    final val = this[key];
    if (val == null) return [];
    if (val is List) return val.whereType<Map<String, dynamic>>().toList();
    return [];
  }

  // ─── Nested Objects ──────────────────────────────────────────────────────

  /// Optional nested map (for joined single rows).
  Map<String, dynamic>? optMap(String key) {
    final val = this[key];
    if (val is Map<String, dynamic>) return val;
    return null;
  }

  // ─── Enums ───────────────────────────────────────────────────────────────

  /// Optional enum. Uses [parseEnum] which handles SNAKE_CASE to camelCase.
  T? optEnum<T extends Enum>(String key, List<T> values) {
    final val = this[key];
    if (val == null) return null;
    return parseEnum(val.toString(), values);
  }

  /// Required enum. Returns [defaultValue] if missing/null/unrecognised.
  T reqEnum<T extends Enum>(String key, List<T> values, T defaultValue) {
    return optEnum(key, values) ?? defaultValue;
  }

  // ─── Money (integer cents) ───────────────────────────────────────────────

  /// Read a money field as integer cents. Alias for [reqInt] for clarity.
  int moneyCents(String key) => reqInt(key);

  /// Read an optional money field.
  int? optMoneyCents(String key) => optInt(key);
}
