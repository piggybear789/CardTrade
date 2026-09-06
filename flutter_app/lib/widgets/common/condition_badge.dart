import 'package:flutter/material.dart';

import '../../core/theme.dart';

/// A compact pill stating an item's physical condition.
///
/// Deliberately NEUTRAL, and one treatment for every grade. The web renders the
/// condition as `bg-mist px-2 py-0.5 text-meta font-semibold text-muted-foreground`
/// on the listing detail and as plain muted text on the card — it has never
/// colour-coded a grade. The five-colour ramp this widget carried before mapped
/// grades that are not the product's grades ("Good", "Fair", "Poor" against the
/// real Graded / Unopened / Mint / Near Mint / Lightly Played / Heavily Played /
/// Damaged), and it did so with four hex literals owned by nothing (Req 1.7).
/// Colour-coding a grade also implies a judgement the marketplace does not make:
/// a Damaged card at the right price is a good listing.
class ConditionBadge extends StatelessWidget {
  const ConditionBadge({
    required this.condition,
    super.key,
  });

  /// The condition label to display (for example 'Mint', 'Near Mint').
  final String condition;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppSpacing.snug,
        vertical: AppSpacing.tight,
      ),
      decoration: BoxDecoration(
        color: AppColors.mist,
        borderRadius: BorderRadius.circular(AppRadius.full),
      ),
      child: Text(
        condition,
        style: AppText.badgeText.copyWith(color: AppColors.mutedForeground),
      ),
    );
  }
}
