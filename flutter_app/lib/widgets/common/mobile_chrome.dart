// The phone top strip, ported from `components/layout/mobile-chrome/primitives.tsx`.
//
// GEOMETRY IS THE POINT OF THIS FILE. From the top edge of the display to the top
// edge of the screen content below it, the default form measures the status-bar
// inset plus [AppMetrics.chromeContent] (54), and the compact form measures the
// inset alone — the web's `pt-[calc(env(safe-area-inset-top)+0.5rem)]`, its
// `min-h-10` row and its `pb-1.5` add to exactly that 54, and the content edge
// must not move as a member walks between routes (Req 4.2).
//
// The bottom gutter is DERIVED from the three metrics rather than written as 6,
// so the sum cannot drift and no call site states a spacing value that is not a
// step of the Spacing_Scale.
//
// Controls are drawn at 40 and touched at 48 through [AppIconButton], which wraps
// them in a [TapTarget]. Inflating the drawn size to 48 instead would push the row
// past `min-h-10` and move the 54 (Req 4.4, 13.6).
//
// The strip is BORDERLESS and FLAT at every scroll offset: no bottom border, no
// elevation, no scrolled-under tint, `--background` throughout, because the web
// strip gains none of those when the page scrolls (Req 4.1, 4.3). It is a plain
// widget rather than an `AppBar` for that reason — `AppBar` owns a
// `scrolledUnderElevation` and a surface tint that would have to be switched off
// in two places.
//
// Requirements 4.1–4.4, 13.6, 13.7.

import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../core/theme.dart';
import 'controls.dart';

/// One trailing control in the top strip.
@immutable
class ChromeAction {
  const ChromeAction({
    required this.icon,
    required this.semanticLabel,
    required this.onPressed,
  });

  /// The glyph to draw. Decorative: [semanticLabel] names the action.
  final IconData icon;

  /// What this control does, in member-facing words. Required, because a
  /// glyph-only control with no label is unreachable by a screen reader
  /// (Req 13.7).
  final String semanticLabel;

  /// Activation callback. A null callback presents the control as unavailable.
  final VoidCallback? onPressed;
}

/// The borderless phone strip above a screen's content.
class MobileChrome extends StatelessWidget {
  const MobileChrome({
    this.title,
    this.onBack,
    this.backSemanticLabel = 'Go back',
    this.actions = const <ChromeAction>[],
    this.compact = false,
    super.key,
  });

  /// The web strip presents no more than two controls beside the back
  /// affordance, and a third would either crowd the row or overflow it at a
  /// large text scale (Req 4.4).
  static const int maxActions = 2;

  /// Optional screen title, at the `rowName` role.
  final String? title;

  /// Back affordance callback. Absent when a screen cannot be left backwards.
  final VoidCallback? onBack;

  /// What the back affordance does, in member-facing words.
  final String backSemanticLabel;

  /// At most [maxActions] trailing controls.
  final List<ChromeAction> actions;

  /// The compact form: the status-bar inset alone, no control row. Hubs and
  /// threads that title themselves need no strip above them.
  final bool compact;

  /// The row's bottom gutter, derived so that the inset-plus-54 content edge is
  /// arithmetic rather than a remembered literal.
  static const double _rowGutter =
      AppMetrics.chromeContent - AppMetrics.chromeRow - AppSpacing.snug;

  @override
  Widget build(BuildContext context) {
    // Asserted here rather than in the constructor: a `const MobileChrome(...)`
    // cannot read `actions.length` during constant evaluation, and a const
    // constructor is worth more than an earlier failure for a bound that only a
    // developer can breach.
    assert(
      actions.length <= maxActions,
      'the strip presents at most $maxActions action controls beside the back '
      'affordance (Req 4.4)',
    );

    final EdgeInsets viewPadding = MediaQuery.viewPaddingOf(context);

    if (compact) {
      return ColoredBox(
        color: AppColors.background,
        child: SizedBox(height: viewPadding.top, width: double.infinity),
      );
    }

    return ColoredBox(
      color: AppColors.background,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          SizedBox(height: viewPadding.top),
          Padding(
            padding: EdgeInsets.only(
              top: AppSpacing.snug,
              bottom: _rowGutter,
              left: math.max(AppSpacing.cozy, viewPadding.left),
              right: math.max(AppSpacing.cozy, viewPadding.right),
            ),
            child: ConstrainedBox(
              constraints: const BoxConstraints(
                minHeight: AppMetrics.chromeRow,
              ),
              child: Row(
                // `snug`, not the web's 6 logical pixels: two 40-pixel controls
                // 6 apart sit 46 centre to centre, so their 48-pixel touch
                // rectangles would overlap by 2, which Req 13.6 forbids. At 8
                // the centres are exactly 48 apart and the rectangles touch
                // without intersecting. The row height, and therefore the 54,
                // is unchanged.
                spacing: AppSpacing.snug,
                children: <Widget>[
                  if (onBack != null)
                    AppIconButton(
                      icon: Icons.chevron_left,
                      iconSize: AppIconSize.display,
                      semanticLabel: backSemanticLabel,
                      onPressed: onBack,
                    ),
                  Expanded(
                    child: title == null
                        ? const SizedBox.shrink()
                        : Text(
                            title!,
                            style: AppText.rowName,
                            // No line cap: a title clipped at a 2.0 text scale
                            // is a screen a member cannot name, so the row
                            // grows past 40 and the strip past 54 rather than
                            // cutting it (Req 13.10). At a scale of 1.0 one line
                            // fits and neither number moves.
                          ),
                  ),
                  for (final ChromeAction action in actions)
                    AppIconButton(
                      icon: action.icon,
                      semanticLabel: action.semanticLabel,
                      onPressed: action.onPressed,
                    ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
