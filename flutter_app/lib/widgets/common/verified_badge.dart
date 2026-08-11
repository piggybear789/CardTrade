import 'package:flutter/material.dart';

import '../../core/theme.dart';

/// A blue verification badge indicating a user has passed the Identity_Gate.
///
/// Available in two sizes:
/// - [VerifiedBadgeSize.small] (16px) — for use inside listing cards and lists.
/// - [VerifiedBadgeSize.normal] (20px) — for profile headers and detail views.
class VerifiedBadge extends StatelessWidget {
  const VerifiedBadge({
    this.size = VerifiedBadgeSize.normal,
    this.tooltip = 'Verified identity',
    super.key,
  });

  /// Controls the icon size.
  final VerifiedBadgeSize size;

  /// Tooltip text shown on long-press. Set to null to disable.
  final String? tooltip;

  @override
  Widget build(BuildContext context) {
    final iconSize = switch (size) {
      VerifiedBadgeSize.small => 16.0,
      VerifiedBadgeSize.normal => 20.0,
    };

    final badge = Icon(
      Icons.verified_rounded,
      size: iconSize,
      color: AppTheme.accent,
    );

    if (tooltip != null) {
      return Tooltip(
        message: tooltip!,
        child: badge,
      );
    }

    return badge;
  }
}

/// Size variants for [VerifiedBadge].
enum VerifiedBadgeSize { small, normal }
