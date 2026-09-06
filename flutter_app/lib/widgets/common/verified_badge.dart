import 'package:flutter/material.dart';

import '../../core/theme.dart';

/// The mark shown beside a member who has passed the Identity_Gate.
///
/// Drawn in the `--trust` token, matching the web's verified treatment. It is
/// never the only signal: every surface that shows it also states the member's
/// status in text.
///
/// Two sizes, both Icon_Set boxes: [VerifiedBadgeSize.small] is the 16-pixel box
/// used inside cards and rows, [VerifiedBadgeSize.normal] the 20-pixel box used
/// in profile headers and detail views.
class VerifiedBadge extends StatelessWidget {
  const VerifiedBadge({
    this.size = VerifiedBadgeSize.normal,
    this.tooltip = 'Verified identity',
    super.key,
  });

  /// Controls the glyph box.
  final VerifiedBadgeSize size;

  /// Tooltip text shown on long-press. Set to null to disable.
  final String? tooltip;

  @override
  Widget build(BuildContext context) {
    final iconSize = switch (size) {
      VerifiedBadgeSize.small => AppIconSize.base,
      VerifiedBadgeSize.normal => AppIconSize.large,
    };

    final badge = Icon(
      Icons.verified_rounded,
      size: iconSize,
      color: AppColors.trust,
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
