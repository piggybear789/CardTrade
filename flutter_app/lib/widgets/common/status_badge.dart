import 'package:flutter/material.dart';

import '../../core/theme.dart';

/// A small colored pill badge displaying a status label.
///
/// Color is determined by [StatusBadgeVariant]:
/// - [completed] — green
/// - [active] — blue
/// - [pending] — amber
/// - [error] — red
/// - [neutral] — slate/gray
class StatusBadge extends StatelessWidget {
  const StatusBadge({
    required this.label,
    this.variant = StatusBadgeVariant.neutral,
    super.key,
  });

  /// The status text displayed inside the badge.
  final String label;

  /// Color variant of the badge.
  final StatusBadgeVariant variant;

  /// Convenience constructors for common states.
  const StatusBadge.completed(this.label, {super.key})
      : variant = StatusBadgeVariant.completed;

  const StatusBadge.active(this.label, {super.key})
      : variant = StatusBadgeVariant.active;

  const StatusBadge.pending(this.label, {super.key})
      : variant = StatusBadgeVariant.pending;

  const StatusBadge.error(this.label, {super.key})
      : variant = StatusBadgeVariant.error;

  @override
  Widget build(BuildContext context) {
    final (bgColor, fgColor) = switch (variant) {
      StatusBadgeVariant.completed => (AppTheme.successLight, AppTheme.success),
      StatusBadgeVariant.active => (AppTheme.accentLight, AppTheme.accent),
      StatusBadgeVariant.pending => (AppTheme.warningLight, AppTheme.warning),
      StatusBadgeVariant.error => (AppTheme.dangerLight, AppTheme.danger),
      StatusBadgeVariant.neutral => (AppTheme.surfaceVariant, AppTheme.secondary),
    };

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppTheme.spacingSm,
        vertical: AppTheme.spacingXs,
      ),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(AppTheme.radiusFull),
      ),
      child: Text(
        label,
        style: AppTheme.badgeText.copyWith(color: fgColor),
      ),
    );
  }
}

/// Semantic color variants for [StatusBadge].
enum StatusBadgeVariant {
  completed,
  active,
  pending,
  error,
  neutral,
}
