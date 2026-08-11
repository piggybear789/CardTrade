import 'package:freezed_annotation/freezed_annotation.dart';

part 'watchlist_entry.freezed.dart';
part 'watchlist_entry.g.dart';

/// A watchlist/saved entry linking a user to a listing.
@freezed
abstract class WatchlistEntry with _$WatchlistEntry {
  const factory WatchlistEntry({
    required String userId,
    required String itemId,
    required DateTime createdAt,
  }) = _WatchlistEntry;

  factory WatchlistEntry.fromJson(Map<String, dynamic> json) =>
      _$WatchlistEntryFromJson(json);
}
