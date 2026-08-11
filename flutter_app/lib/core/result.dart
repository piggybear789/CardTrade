/// Errors are values, not exceptions.
/// Matches the web app's ActionResult pattern from lib/actions/result.ts.
///
/// Usage:
///   final result = await apiClient.query(() => supabase.from('items').select());
///   switch (result) {
///     case Ok(:final data): handleData(data);
///     case Err(:final error, :final message): showError(message ?? error);
///   }
sealed class Result<T> {
  const Result();
}

/// Successful result carrying typed data.
class Ok<T> extends Result<T> {
  const Ok(this.data);
  final T data;

  @override
  bool operator ==(Object other) =>
      identical(this, other) || (other is Ok<T> && other.data == data);

  @override
  int get hashCode => data.hashCode;

  @override
  String toString() => 'Ok($data)';
}

/// Failed result carrying an error code, optional human message, and optional field.
class Err<T> extends Result<T> {
  const Err(this.error, {this.message, this.field});

  /// Machine-readable error code (e.g. 'REGION_MISMATCH', 'NOT_FOUND').
  final String error;

  /// Human-readable explanation. Falls back to [error] when absent.
  final String? message;

  /// The specific form field that failed validation, if applicable.
  final String? field;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is Err<T> &&
          other.error == error &&
          other.message == message &&
          other.field == field);

  @override
  int get hashCode => Object.hash(error, message, field);

  @override
  String toString() => 'Err($error${message != null ? ', $message' : ''})';
}

// ─── Convenience Constructors ────────────────────────────────────────────────

/// Create a successful result.
Result<T> ok<T>(T data) => Ok(data);

/// Create a failed result.
Result<T> fail<T>(String error, {String? message, String? field}) =>
    Err(error, message: message, field: field);

// ─── Extension for Ergonomics ────────────────────────────────────────────────

extension ResultX<T> on Result<T> {
  /// Whether this is a successful result.
  bool get isOk => this is Ok<T>;

  /// Whether this is a failed result.
  bool get isErr => this is Err<T>;

  /// The data if successful, null otherwise.
  T? get dataOrNull => switch (this) {
        Ok(:final data) => data,
        Err() => null,
      };

  /// The error code if failed, null otherwise.
  String? get errorOrNull => switch (this) {
        Ok() => null,
        Err(:final error) => error,
      };

  /// The human-readable error message, falling back to the error code.
  /// Returns empty string for Ok results.
  String get errorMessage => switch (this) {
        Ok() => '',
        Err(:final error, :final message) => message ?? error,
      };

  /// Transform the data inside a successful result.
  Result<U> map<U>(U Function(T data) transform) => switch (this) {
        Ok(:final data) => Ok(transform(data)),
        Err(:final error, :final message, :final field) =>
          Err(error, message: message, field: field),
      };

  /// Chain an operation that itself returns a Result.
  Future<Result<U>> flatMap<U>(
    Future<Result<U>> Function(T data) transform,
  ) =>
      switch (this) {
        Ok(:final data) => transform(data),
        Err(:final error, :final message, :final field) =>
          Future.value(Err(error, message: message, field: field)),
      };

  /// Execute a callback on success, returning this result unchanged.
  Result<T> onOk(void Function(T data) action) {
    if (this case Ok(:final data)) {
      action(data);
    }
    return this;
  }

  /// Execute a callback on failure, returning this result unchanged.
  Result<T> onErr(void Function(String error, String? message) action) {
    if (this case Err(:final error, :final message)) {
      action(error, message);
    }
    return this;
  }

  /// Unwrap the data or throw. Only use in tests or where failure is unexpected.
  T unwrap() => switch (this) {
        Ok(:final data) => data,
        Err(:final error, :final message) =>
          throw StateError('Unwrap called on Err: ${message ?? error}'),
      };

  /// Unwrap the data or return a default value.
  T unwrapOr(T defaultValue) => switch (this) {
        Ok(:final data) => data,
        Err() => defaultValue,
      };
}
