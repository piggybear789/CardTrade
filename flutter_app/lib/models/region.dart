import 'package:freezed_annotation/freezed_annotation.dart';

part 'region.freezed.dart';
part 'region.g.dart';

/// A trading region definition.
@freezed
abstract class Region with _$Region {
  const factory Region({
    required String code,
    required String label,
    required String currency,
    required int minorUnitDigits,
    @Default(false) bool tradingEnabled,
  }) = _Region;

  factory Region.fromJson(Map<String, dynamic> json) => _$RegionFromJson(json);
}
