import 'package:flutter/material.dart';

import 'tokens.g.dart';
import 'type_scale.dart';

/// Semantic text roles composed exclusively from [AppType] levels.
/// Requirements 2.5–2.7 and 12.7.
abstract final class AppText {
  AppText._();

  static const _moneyFeatures = [FontFeature.tabularFigures(), FontFeature.liningFigures()];

  static const TextStyle priceHero = TextStyle(fontSize: 28, height: 1.1, letterSpacing: -0.28, fontWeight: FontWeight.w700, color: AppColors.irisInk, fontFeatures: _moneyFeatures);
  static const TextStyle priceCard = TextStyle(fontSize: 21, height: 1.25, letterSpacing: -0.21, fontWeight: FontWeight.w700, color: AppColors.irisInk, fontFeatures: _moneyFeatures);
  static const TextStyle priceInline = TextStyle(fontSize: 14, height: 1.6, letterSpacing: -0.14, fontWeight: FontWeight.w700, color: AppColors.irisInk, fontFeatures: _moneyFeatures);
  /// A non-total figure in a money table: `detailValue` with money figures.
  ///
  /// Req 7.4 asks every value in a contract money table to be drawn with tabular
  /// figures so the digits align down the column, and a subtotal is not the
  /// emphasised row — so it cannot borrow [priceInline], which is the total's
  /// weight and ink. Named `price…` deliberately: the agreement harness asserts
  /// the tabular/lining pair on every role with that prefix.
  static const TextStyle priceRow = TextStyle(fontSize: 14, height: 1.6, letterSpacing: -0.14, fontWeight: FontWeight.w500, color: AppColors.foreground, fontFeatures: _moneyFeatures);
  static const TextStyle cardTitle = TextStyle(fontSize: 14, height: 1.6, letterSpacing: -0.14, fontWeight: FontWeight.w500, color: AppColors.foreground);
  static const TextStyle rowName = TextStyle(fontSize: 14, height: 1.6, letterSpacing: -0.14, fontWeight: FontWeight.w600, color: AppColors.foreground);
  static const TextStyle bodyText = TextStyle(fontSize: 14, height: 1.6, letterSpacing: -0.14, fontWeight: FontWeight.w400, color: AppColors.foreground);
  static const TextStyle supportText = TextStyle(fontSize: 14, height: 1.6, letterSpacing: -0.14, fontWeight: FontWeight.w400, color: AppColors.mutedForeground);
  static const TextStyle metaText = TextStyle(fontSize: 12, height: 1.4, letterSpacing: -0.12, fontWeight: FontWeight.w400, color: AppColors.mutedForeground);
  static const TextStyle badgeText = TextStyle(fontSize: 12, height: 1.4, letterSpacing: -0.12, fontWeight: FontWeight.w600);
  static const TextStyle sectionLabel = TextStyle(fontSize: 12, height: 1.4, letterSpacing: 1.44, fontWeight: FontWeight.w600, color: AppColors.mutedForeground);
  static const TextStyle detailLabel = TextStyle(fontSize: 14, height: 1.6, letterSpacing: -0.14, fontWeight: FontWeight.w400, color: AppColors.mutedForeground);
  static const TextStyle detailValue = TextStyle(fontSize: 14, height: 1.6, letterSpacing: -0.14, fontWeight: FontWeight.w500, color: AppColors.foreground);
}
