import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';

import '../../core/theme.dart';
import 'controls.dart';

/// A list or screen with nothing in it, ported from `components/ui/empty-state.tsx`.
///
/// Region order and treatment, matching the web page variant: an illustration
/// excluded from the accessibility tree, a heading at the `subhead` level, an
/// explanation at the `body` level in the muted foreground, and AT MOST ONE
/// primary action (Req 11.3). The illustration sits in a `--muted` disc with a
/// `--border` edge because a bare glyph on white reads as a missing asset.
///
/// The heading and explanation are announced together when this replaces a
/// loading state; the announcement is assertive because it reports the arrival of
/// a settled answer.
class EmptyState extends StatefulWidget {
  const EmptyState({
    required this.icon,
    required this.title,
    this.subtitle,
    this.actionLabel,
    this.onAction,
    super.key,
  });

  /// Glyph displayed above the heading. Decorative.
  final IconData icon;

  /// Heading for the empty state.
  final String title;

  /// Optional supporting explanation.
  final String? subtitle;

  /// Label for the optional action.
  final String? actionLabel;

  /// Callback for the action. The action is hidden when null.
  final VoidCallback? onAction;

  /// Diameter of the illustration disc, the web's `md:size-12`.
  static const double _discDiameter = 48;

  @override
  State<EmptyState> createState() => _EmptyStateState();
}

class _EmptyStateState extends State<EmptyState> {
  bool _announced = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_announced) return;
    _announced = true;
    final view = View.maybeOf(context);
    if (view == null) return;
    final String subtitle = widget.subtitle == null ? '' : ' ${widget.subtitle}';
    SemanticsService.sendAnnouncement(
      view,
      '${widget.title}.$subtitle',
      Directionality.maybeOf(context) ?? TextDirection.ltr,
      assertiveness: Assertiveness.assertive,
    );
  }

  @override
  Widget build(BuildContext context) {
    final IconData icon = widget.icon;
    final String title = widget.title;
    final String? subtitle = widget.subtitle;
    final String? actionLabel = widget.actionLabel;
    final VoidCallback? onAction = widget.onAction;

    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.group,
          vertical: AppSpacing.section,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ExcludeSemantics(
              child: Container(
                width: EmptyState._discDiameter,
                height: EmptyState._discDiameter,
                alignment: Alignment.center,
                decoration: BoxDecoration(
                  color: AppColors.muted,
                  shape: BoxShape.circle,
                  border: Border.all(color: AppColors.border, width: AppMetrics.hairline),
                ),
                child: Icon(
                  icon,
                  size: AppIconSize.display,
                  color: AppColors.mutedForeground,
                ),
              ),
            ),
            const SizedBox(height: AppSpacing.snug),
            Text(
              title,
              style: AppType.subhead.copyWith(
                fontWeight: FontWeight.w600,
                color: AppColors.foreground,
              ),
              textAlign: TextAlign.center,
            ),
            if (subtitle != null) ...[
              const SizedBox(height: AppSpacing.tight),
              Text(
                subtitle,
                style: AppText.supportText,
                textAlign: TextAlign.center,
              ),
            ],
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: AppSpacing.snug),
              // The web's pastel primary action, drawn at 40 and touched at 48.
              AppButton(label: actionLabel, onPressed: onAction),
            ],
          ],
        ),
      ),
    );
  }
}
