import 'dart:math' as math;

import 'package:flutter/material.dart';

import 'tokens.g.dart';

/// Web-aligned elevation layers. CSS blur values are converted in one place only.
/// Requirements 3.8–3.12.
abstract final class AppElevation {
  AppElevation._();

  /// Converts a CSS box-shadow blur diameter to Flutter's [BoxShadow.blurRadius].
  static double blurFromCss(double cssBlur) =>
      math.max(0, (cssBlur / 2 - 0.5) * math.sqrt(3));

  static final List<BoxShadow> market = [
    BoxShadow(color: AppColors.obsidian.withValues(alpha: 0.04), offset: const Offset(0, 1), blurRadius: blurFromCss(2)),
    BoxShadow(color: AppColors.obsidian.withValues(alpha: 0.05), offset: const Offset(0, 4), blurRadius: blurFromCss(10)),
  ];

  static final List<BoxShadow> auction = [
    BoxShadow(color: AppColors.obsidian.withValues(alpha: 0.10), offset: const Offset(0, 6), blurRadius: blurFromCss(16)),
  ];

  static final List<BoxShadow> lift = [
    BoxShadow(color: AppColors.obsidian.withValues(alpha: 0.07), offset: const Offset(0, 2), blurRadius: blurFromCss(6)),
    BoxShadow(color: AppColors.obsidian.withValues(alpha: 0.10), offset: const Offset(0, 8), blurRadius: blurFromCss(14)),
  ];
}
