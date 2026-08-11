import 'package:flutter/material.dart';

import '../../core/theme.dart';

/// A compact pill badge displaying an item's physical condition.
///
/// Color-coded by condition level:
/// - Mint → green
/// - Near Mint → teal
/// - Good → blue
/// - Fair → amber
/// - Poor → gray
class ConditionBadge extends StatelessWidget {
  const ConditionBadge({
    required this.condition,
    super.key,
  });

  /// The condition label to display (e.g. 'Mint', 'Near Mint').
  final String condition;

  /// Resolves background and foreground colors from the condition string.
  (Color bg, Color fg) _colors() {
    final lower = condition.toLowerCase().trim();
    if (lower == 'mint') {
      return (const Color(0xFFdcfce7), const Color(0xFF16a34a));
    }
    if (lower == 'near mint' || lower == 'nm') {
      return (const Color(0xFFccfbf1), const Color(0xFF0d9488));
    }
    if (lower == 'good' || lower == 'excellent') {
      return (AppTheme.accentLight, AppTheme.accent);
    }
    if (lower == 'fair' || lower == 'played') {
      return (AppTheme.warningLight, AppTheme.warning);
    }
    // Poor or unknown
    return (AppTheme.surfaceVariant, AppTheme.secondary);
  }

  @override
  Widget build(BuildContext context) {
    final (bgColor, fgColor) = _colors();

    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppTheme.spacingSm,
        vertical: 3,
      ),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(AppTheme.radiusFull),
      ),
      child: Text(
        condition,
        style: AppTheme.badgeText.copyWith(color: fgColor),
      ),
    );
  }
}
