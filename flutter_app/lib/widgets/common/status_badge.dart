import 'package:flutter/material.dart';

import '../../core/theme.dart';

/// A small pill badge stating a contract or listing status.
///
/// Every variant is a named [AppTint] — a palette token at the alpha the web
/// applies to the same wash — rather than a colour of its own (Req 1.7, 1.8):
/// - [completed] → the trust chip, matching the web's verified/settled treatment
/// - [active] → the iris eyebrow wash
/// - [pending] → the `.cardtrade-warning` caution wash
/// - [error] → the `border-destructive/40 bg-destructive/10` alert wash
/// - [neutral] → the flat `--muted` surface
///
/// The label is always rendered as text, so colour is never the only signal.
class StatusBadge extends StatelessWidget {
  const StatusBadge({
    required this.label,
    this.variant = StatusBadgeVariant.neutral,
    super.key,
  });

  /// The status text displayed inside the badge.
  final String label;

  /// Semantic variant of the badge.
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
    final tint = switch (variant) {
      StatusBadgeVariant.completed => AppTint.successChip,
      StatusBadgeVariant.active => AppTint.eyebrow,
      StatusBadgeVariant.pending => AppTint.caution,
      StatusBadgeVariant.error => AppTint.alert,
      StatusBadgeVariant.neutral => const Tint(fill: AppColors.muted, ink: AppColors.mutedForeground),
    };

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.snug,
        vertical: AppSpacing.tight,
      ),
      decoration: BoxDecoration(
        color: tint.fill,
        borderRadius: BorderRadius.circular(AppRadius.full),
        border: tint.edge == null
            ? null
            : Border.all(color: tint.edge!, width: AppMetrics.hairline),
      ),
      child: Text(
        label,
        style: AppText.badgeText.copyWith(color: tint.ink),
      ),
    );
  }
}

/// Semantic variants for [StatusBadge].
enum StatusBadgeVariant {
  completed,
  active,
  pending,
  error,
  neutral,
}
