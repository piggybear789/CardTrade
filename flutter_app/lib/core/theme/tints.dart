import 'package:flutter/material.dart';

import 'tokens.g.dart';

/// A named semantic wash assembled from a generated token and explicit alpha.
class Tint {
  const Tint({this.fill, this.edge, this.ink});

  final Color? fill;
  final Color? edge;
  final Color? ink;
}

/// Semantic tint recipes matching the web component rules.
/// Requirement 1.8.
abstract final class AppTint {
  AppTint._();

  static final Tint caution = Tint(fill: AppColors.action.withValues(alpha: 0.22), edge: AppColors.actionBorder.withValues(alpha: 0.5), ink: AppColors.foreground);
  /// The web's `border-destructive/40 bg-destructive/10 text-destructive` alert wash.
  static final Tint alert = Tint(fill: AppColors.destructive.withValues(alpha: 0.10), edge: AppColors.destructive.withValues(alpha: 0.4), ink: AppColors.destructive);
  static final Tint successChip = Tint(fill: AppColors.trust.withValues(alpha: 0.12), edge: AppColors.trust.withValues(alpha: 0.4), ink: AppColors.trust);
  static final Tint successFill = Tint(fill: AppColors.trust.withValues(alpha: 0.5));
  static final Tint eyebrow = Tint(fill: AppColors.iris.withValues(alpha: 0.08), edge: AppColors.iris.withValues(alpha: 0.4), ink: AppColors.irisInk);
  static final Tint selection = Tint(fill: AppColors.iris.withValues(alpha: 0.3));
  static final Tint skeleton = Tint(fill: AppColors.muted.withValues(alpha: 0.70));
  static final Tint coverScrim = Tint(fill: AppColors.obsidian.withValues(alpha: 0.45));
  static final Tint binderMarker = Tint(fill: AppColors.obsidian.withValues(alpha: 0.75), ink: AppColors.mist);
  static final Tint pressOverlay = Tint(fill: AppColors.foreground.withValues(alpha: 0.05));
}
