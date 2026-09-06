// The listing description and its clamp, ported from
// `components/listings/ExpandableDescription.tsx`.
//
// The boundary is 200 CHARACTERS, and it is the web's own constant: a description
// of 200 or fewer is drawn in full with neither fade nor control, and one of 201
// is clamped to four lines. Measuring the clamp in lines and the threshold in
// characters is deliberate — the threshold decides whether a buyer is asked to
// tap, and it must not depend on the viewport, the text scale or the font.
//
// Requirements 6.6, 13.6, 13.7, 13.12.

import 'package:flutter/material.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/widgets/common/controls.dart';

/// A listing description: in full, or clamped with a fade and an expand control.
class ListingDescription extends StatefulWidget {
  const ListingDescription({required this.description, super.key});

  /// The seller's own copy. Whitespace-only is treated as absent.
  final String description;

  /// The length above which the description is clamped (Req 6.6). Mirrors
  /// `COLLAPSE_AT` in `ExpandableDescription.tsx`.
  static const int clampThreshold = 200;

  /// How much of a clamped description is shown before the fade.
  static const int clampLines = 4;

  /// How long the expansion takes when motion is allowed.
  static const Duration expandDuration = Duration(milliseconds: 200);

  /// Whether [description] is long enough to be clamped.
  ///
  /// Exposed so a test can assert the boundary at 200 and 201 without reaching
  /// into the widget's state.
  static bool needsExpand(String description) =>
      description.trim().length > clampThreshold;

  @override
  State<ListingDescription> createState() => _ListingDescriptionState();
}

class _ListingDescriptionState extends State<ListingDescription> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final String body = widget.description.trim();
    if (body.isEmpty) return const SizedBox.shrink();

    final bool clamps = ListingDescription.needsExpand(body);
    if (!clamps) {
      return Text(body, style: AppText.bodyText);
    }

    final Widget clamped = _Faded(
      child: Text(
        body,
        maxLines: ListingDescription.clampLines,
        // No ellipsis: the fade is what says the copy continues, and a clamped
        // line ending in three dots under a gradient reads as two truncations of
        // the same sentence.
        style: AppText.bodyText,
      ),
    );
    final Widget full = Text(body, style: AppText.bodyText);

    // Req 13.12: under reduce-motion the end state is APPLIED rather than
    // animated to — and it is applied by swapping the child, not by running
    // `AnimatedCrossFade` at a zero duration. A zero-duration cross-fade re-dirties
    // its own `RenderAnimatedSize` inside that object's `performLayout`, which the
    // framework asserts on: the expansion would throw for exactly the members who
    // asked for less motion.
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: AppSpacing.tight,
      children: <Widget>[
        if (MediaQuery.disableAnimationsOf(context))
          _expanded ? full : clamped
        else
          AnimatedCrossFade(
            duration: ListingDescription.expandDuration,
            crossFadeState: _expanded
                ? CrossFadeState.showSecond
                : CrossFadeState.showFirst,
            firstChild: clamped,
            secondChild: full,
          ),
        // A label AND a chevron, drawn at 40 and touched at 48 by AppButton
        // (Req 6.6). The label is what a screen reader reads; the chevron is
        // what says which way the control goes.
        AppButton(
          label: _expanded ? 'Show less' : 'Read more',
          icon: _expanded
              ? Icons.keyboard_arrow_up_rounded
              : Icons.keyboard_arrow_down_rounded,
          variant: AppButtonVariant.outline,
          onPressed: () => setState(() => _expanded = !_expanded),
        ),
      ],
    );
  }
}

/// The last visible line of a clamped description, faded out rather than cut.
///
/// `BlendMode.dstIn` reads only the ALPHA of the gradient, so the two opaque
/// stops may be any token — they are `--foreground` here so that no colour in
/// this file is invented (Req 1.7). The web draws the same impression with a CSS
/// mask; the renderers differ and the design records that as a manual-review
/// item rather than a pixel comparison.
class _Faded extends StatelessWidget {
  const _Faded({required this.child});

  final Widget child;

  /// Where the fade begins, as a fraction of the clamped block's height.
  static const double _fadeStart = 0.7;

  @override
  Widget build(BuildContext context) {
    return ShaderMask(
      blendMode: BlendMode.dstIn,
      shaderCallback: (Rect bounds) => const LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: <Color>[
          AppColors.foreground,
          AppColors.foreground,
          Colors.transparent,
        ],
        stops: <double>[0, _fadeStart, 1],
      ).createShader(bounds),
      child: child,
    );
  }
}
