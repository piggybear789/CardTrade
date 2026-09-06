import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';

import '../../core/theme.dart';

/// Shared loading placeholders, ported from the web's `components/ui/skeleton.tsx`.
///
/// The web draws `bg-muted/70 animate-pulse`: the `--muted` token at 0.70 alpha,
/// its OPACITY pulsing between 1.0 and 0.5 and back on a 2000 ms loop, held
/// static under `prefers-reduced-motion`. That is what [SkeletonPulse] does. The
/// `shimmer` package this file used before swept a gradient across a `Colors.white`
/// block instead — a different animation, a different fill, and a colour with no
/// web counterpart (Req 11.2, Req 1.7).
///
/// A text placeholder is `0.9` times the font size of the level it stands in for,
/// laid out inside that level's own line box, so replacing the placeholder with
/// the resolved copy moves nothing (Req 11.1).
///
/// Requirements 1.7–1.8, 3.4, 3.10, 11.1–11.2.

/// One placeholder block: the skeleton wash at the `md` radius.
class SkeletonBox extends StatelessWidget {
  const SkeletonBox({
    required this.height,
    this.width,
    this.borderRadius = AppRadius.md,
    this.circle = false,
    super.key,
  });

  /// Height of the block in logical pixels.
  final double height;

  /// Width of the block, or null to fill the available width.
  final double? width;

  /// Corner radius. Ignored when [circle] is set.
  final double borderRadius;

  /// Draws the block as a circle, for an avatar or a marker placeholder.
  final bool circle;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width ?? double.infinity,
      height: height,
      decoration: BoxDecoration(
        color: AppTint.skeleton.fill,
        shape: circle ? BoxShape.circle : BoxShape.rectangle,
        borderRadius: circle ? null : BorderRadius.circular(borderRadius),
      ),
    );
  }
}

/// Placeholder bars standing in for lines of reading text at one type level.
///
/// [widths] holds one fraction of the available width per line, so a stack reads
/// as wrapped copy rather than as one slab.
class SkeletonTextLines extends StatelessWidget {
  const SkeletonTextLines({
    required this.level,
    this.widths = const [1.0],
    super.key,
  });

  /// The Type_Scale level, or the [AppText] role, the copy will be drawn at.
  final TextStyle level;

  /// One width fraction in (0, 1] per line.
  final List<double> widths;

  /// The fraction of a level's font size a placeholder bar occupies, matching the
  /// web's `h-[0.9em]`, so the usual half-leading survives above and below it.
  static const double barFraction = 0.9;

  /// The height a single line of [level] actually lays out to, at the ambient
  /// text scale.
  ///
  /// MEASURED rather than computed as `fontSize * height`. Those two numbers
  /// differ: the text engine rounds a line box up, so `13 × 1.6` reserves 20.8
  /// where the resolved copy occupies 21.0. Per line that is inside Property
  /// 14's one-pixel tolerance, but over a list it accumulates — a 24-row
  /// placeholder list came out 9.6 pixels shorter than the same list resolved,
  /// which is a visible jump on load and a changed scroll extent (Req 11.1).
  ///
  /// Measuring also makes the placeholder honour the text scale, which the
  /// arithmetic did not: at a 2.0 factor the computed box under-reserved by half.
  static double measureLineBox(TextStyle level, TextScaler scaler) {
    final painter = TextPainter(
      // A zero-width space: it occupies a line without contributing a glyph, so
      // the measurement is the line box and nothing else.
      text: TextSpan(text: '\u200b', style: level),
      textDirection: TextDirection.ltr,
      textScaler: scaler,
      maxLines: 1,
    )..layout();
    final height = painter.height;
    painter.dispose();
    return height;
  }

  @override
  Widget build(BuildContext context) {
    final scaler = MediaQuery.textScalerOf(context);
    final fontSize = level.fontSize ?? AppType.body.fontSize!;
    final lineBox = measureLineBox(level, scaler);
    final barHeight = scaler.scale(fontSize) * barFraction;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        for (final width in widths)
          SizedBox(
            height: lineBox,
            child: Align(
              alignment: Alignment.centerLeft,
              child: FractionallySizedBox(
                widthFactor: width,
                child: SkeletonBox(height: barHeight),
              ),
            ),
          ),
      ],
    );
  }
}

/// Marks a subtree as already pulsing, so a nested [SkeletonPulse] stands down.
///
/// Without this, wrapping a [SkeletonListTile] — which brings its own pulse — in a
/// [SkeletonRegion] multiplies the two opacities and troughs at 0.25 rather than
/// the 0.5 Req 11.2 fixes. Resolved here rather than by a flag on the region,
/// because a flag is something a call site can get wrong.
class _PulseScope extends InheritedWidget {
  const _PulseScope({required super.child});

  static bool isInside(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<_PulseScope>() != null;

  @override
  bool updateShouldNotify(_PulseScope oldWidget) => false;
}

/// Pulses its subtree's opacity and keeps it out of the accessibility tree.
///
/// Holds static at full opacity while the platform reduce-motion setting is on,
/// which is also what makes a golden of a loading state capturable at all: an
/// unbounded repeat never settles.
///
/// Nesting is safe: the inner one becomes a pass-through rather than a second
/// animation over the same blocks.
class SkeletonPulse extends StatefulWidget {
  const SkeletonPulse({required this.child, super.key});

  final Widget child;

  /// One full 1.0 → 0.5 → 1.0 cycle.
  static const Duration period = Duration(milliseconds: 2000);

  /// The trough of the pulse.
  static const double minOpacity = 0.5;

  @override
  State<SkeletonPulse> createState() => _SkeletonPulseState();
}

class _SkeletonPulseState extends State<SkeletonPulse>
    with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    // `reverse: true` halves the wall clock, so the controller runs one half-cycle.
    duration: SkeletonPulse.period ~/ 2,
  );

  late final Animation<double> _opacity = Tween<double>(
    begin: 1.0,
    end: SkeletonPulse.minOpacity,
  ).animate(CurvedAnimation(parent: _controller, curve: Curves.easeInOut));

  bool _nested = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _nested = _PulseScope.isInside(context);
    if (_nested || MediaQuery.disableAnimationsOf(context)) {
      _controller.stop();
      _controller.value = 0;
    } else if (!_controller.isAnimating) {
      _controller.repeat(reverse: true);
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_nested) return ExcludeSemantics(child: widget.child);
    return _PulseScope(
      child: ExcludeSemantics(
        child: FadeTransition(opacity: _opacity, child: widget.child),
      ),
    );
  }
}

/// Announces once that content is loading, and changes nothing about its child.
///
/// Separate from [SkeletonRegion] because a screen whose placeholder is a SLIVER
/// cannot be wrapped in a box: this adds no layout of its own, so [child] may be
/// either. The announcement is polite, so it never interrupts one already in
/// progress (Req 11.1).
class LoadingAnnouncement extends StatefulWidget {
  const LoadingAnnouncement({
    required this.child,
    this.announcement = 'Loading content',
    super.key,
  });

  /// The placeholder. A box or a sliver — this passes it through untouched.
  final Widget child;

  /// What assistive technology hears once, when the region first appears.
  final String announcement;

  @override
  State<LoadingAnnouncement> createState() => _LoadingAnnouncementState();
}

class _LoadingAnnouncementState extends State<LoadingAnnouncement> {
  bool _announced = false;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    // Once per load, not once per rebuild — and here rather than in `initState`,
    // where reading `Directionality` is not yet legal.
    if (_announced) return;
    _announced = true;
    final view = View.maybeOf(context);
    if (view == null) return;
    SemanticsService.sendAnnouncement(
      view,
      widget.announcement,
      Directionality.maybeOf(context) ?? TextDirection.ltr,
      assertiveness: Assertiveness.polite,
    );
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

/// A whole loading region: the pulse, the accessibility exclusion, and one polite
/// announcement per load.
///
/// Wrap a screen's loading branch in exactly one of these. Nesting a placeholder
/// that carries its own [SkeletonPulse] is safe — the inner pulse stands down.
class SkeletonRegion extends StatelessWidget {
  const SkeletonRegion({
    required this.child,
    this.announcement = 'Loading content',
    super.key,
  });

  final Widget child;

  /// What assistive technology hears once, when the region first appears.
  final String announcement;

  @override
  Widget build(BuildContext context) => LoadingAnnouncement(
        announcement: announcement,
        child: SkeletonPulse(child: child),
      );
}

/// A placeholder occupying a listing tile: reserved square cover, two title
/// lines, one meta line, one price line.
class SkeletonListingCard extends StatelessWidget {
  const SkeletonListingCard({super.key});

  @override
  Widget build(BuildContext context) {
    return SkeletonPulse(
      child: DecoratedBox(
        decoration: BoxDecoration(
          color: AppColors.card,
          borderRadius: BorderRadius.circular(AppRadius.lg),
          border: Border.all(color: AppColors.border, width: AppMetrics.hairline),
        ),
        child: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // A square, matching the cover box the card reserves when a listing
            // carries no image dimensions, so the tile does not resize on load.
            AspectRatio(
              aspectRatio: 1,
              child: SkeletonBox(
                height: double.infinity,
                borderRadius: AppRadius.lg,
              ),
            ),
            Padding(
              padding: EdgeInsets.all(AppSpacing.snug),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SkeletonTextLines(level: AppText.cardTitle, widths: [1.0, 0.6]),
                  SkeletonTextLines(level: AppText.supportText, widths: [0.45]),
                  SkeletonTextLines(level: AppText.priceCard, widths: [0.5]),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A placeholder occupying a standard list row: leading avatar, name, subtitle.
class SkeletonListTile extends StatelessWidget {
  const SkeletonListTile({super.key});

  /// The row's leading disc, standing in for a medium `Avatar` (40dp).
  static const double _avatarDiameter = 40;

  @override
  Widget build(BuildContext context) {
    return const SkeletonPulse(
      child: Padding(
        padding: EdgeInsets.symmetric(
          horizontal: AppSpacing.cozy,
          vertical: AppSpacing.snug,
        ),
        child: Row(
          children: [
            SkeletonBox(
              width: _avatarDiameter,
              height: _avatarDiameter,
              circle: true,
            ),
            SizedBox(width: AppSpacing.snug),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  SkeletonTextLines(level: AppText.rowName, widths: [1.0]),
                  SkeletonTextLines(level: AppText.supportText, widths: [0.55]),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
