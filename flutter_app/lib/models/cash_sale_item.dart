import 'package:freezed_annotation/freezed_annotation.dart';

part 'cash_sale_item.freezed.dart';
part 'cash_sale_item.g.dart';

/// A line item in a cash sale contract (for shopfront/binder purchases).
///
/// These describe WHAT is being bought. For shopfronts, the listing is the
/// whole binder and cannot say what one contract covers, so the contract says it.
@freezed
abstract class CashSaleItem with _$CashSaleItem {
  const factory CashSaleItem({
    required String id,
    required String cashSaleId,
    required String description,
    String? condition,
    required int quantity,
    required int unitPriceCents,
    String? imagePath,
    @Default(0) int sortOrder,
    required DateTime createdAt,
  }) = _CashSaleItem;

  const CashSaleItem._();

  factory CashSaleItem.fromJson(Map<String, dynamic> json) =>
      _$CashSaleItemFromJson(json);

  /// Line total: quantity × unit price.
  int get totalCents => quantity * unitPriceCents;
}
