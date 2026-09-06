// A bordered wash carrying one thing a member needs to know before they commit.
//
// The caution treatment is the web's `.cardtrade-warning` rule: the
// `--action-border` edge and the `--action` wash at the alphas that rule sets,
// which `AppTint.caution` already holds. It is used for the binder explanation
// (Req 6.7) and for the advisory region notice (Req 6.12), because both are
// DISCLOSURE — neither disables anything, and the orchestrator refuses regardless.
//
// Requirements 6.7, 6.12, 13.11.

import 'package:flutter/material.dart';

import 'package:cardtrade/core/theme.dart';

/// One notice: a glyph, and body copy that wraps rather than truncates.
class ListingNotice extends StatelessWidget {
  const ListingNotice({
    required this.message,
    this.icon = Icons.info_outline_rounded,
    super.key,
  });

  /// What the member is being told, in their own words.
  final String message;

  /// A decorative glyph. The copy carries the meaning; this only points at it,
  /// which is why the notice never relies on the wash alone (Req 13.11).
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final Tint tint = AppTint.caution;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.snug),
      decoration: BoxDecoration(
        color: tint.fill,
        borderRadius: BorderRadius.circular(AppRadius.md),
        border: Border.all(color: tint.edge!, width: AppMetrics.hairline),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: AppSpacing.snug,
        children: <Widget>[
          ExcludeSemantics(
            child: Icon(icon, size: AppIconSize.base, color: tint.ink),
          ),
          Expanded(
            child: Text(
              message,
              // No line cap: a notice clipped at a 2.0 text scale is a warning a
              // member cannot read (Req 13.10).
              style: AppText.bodyText,
            ),
          ),
        ],
      ),
    );
  }
}
