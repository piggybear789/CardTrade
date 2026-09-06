import 'dart:math' as math;

import 'package:flutter/rendering.dart';
import 'package:flutter/widgets.dart';

import '../../core/theme.dart';

/// Expands a control's TOUCH rectangle without moving anything on screen.
///
/// The web draws its controls at 40 logical pixels (32 for the watch control on
/// a card), and the mobile guidance asks for 48 on both axes. Those are two
/// different numbers and this widget is the reason both can be true at once: the
/// child is laid out and painted exactly as it asked to be, and only the hit
/// rectangle is inflated about the child's centre to at least [minSize].
///
/// `SizedBox(width: 48, height: 48)` and `MaterialTapTargetSize.padded` were
/// both rejected for this: they inflate **layout**, which pushes the chrome row
/// past its `min-h-10` and moves the status-bar inset + 54 content height that
/// Req 4.2 fixes. Overriding `hitTest` inflates only the touch rectangle, which
/// is what Req 4.4, 5.5, 8.7 and 13.6 each ask for in the same words.
///
/// A touch that lands in the inflated margin is delivered to the child at the
/// child's CENTRE, so the child's existing `InkWell`/`GestureDetector` handles it
/// with no knowledge of the expansion and its press feedback stays inside the
/// drawn bounds. A touch already inside the drawn box is passed through
/// untouched, so behaviour there is exactly the child's own.
///
/// The centre, rather than the nearest point on the child's edge, because a
/// nearest-point clamp never reaches a SHAPE-CLIPPED child. `Material` with
/// `type: MaterialType.circle` clips hit testing to its disc, and a box edge
/// touches an inscribed circle at four points only — so every clamped margin
/// touch on the card's round watch control landed outside the disc and was
/// silently dropped, which is the whole 32-to-48 expansion failing to work at
/// all. Property 19's margin-delivery assertion is what found it.
///
/// CAVEAT worth knowing before placing one: a hit test only reaches this box if
/// an ancestor recursed into it, and most ancestors clip hit testing to their own
/// bounds. An expansion therefore only reaches outside the parent's box where the
/// parent is at least [minSize] itself, or where the control sits in a `Stack`
/// whose bounds are larger. Where two of these sit side by side, space them so
/// their [RenderTapTarget.targetRect]s do not intersect (Req 13.6).
///
/// Requirements 4.4, 5.5, 8.7, 13.6.
class TapTarget extends SingleChildRenderObjectWidget {
  const TapTarget({
    required Widget super.child,
    this.minSize = AppMetrics.minHitArea,
    super.key,
  });

  /// The smallest touch extent this control accepts on either axis.
  ///
  /// Defaults to [AppMetrics.minHitArea]. A call site should only raise it; a
  /// lower value defeats the point of the widget.
  final double minSize;

  @override
  RenderTapTarget createRenderObject(BuildContext context) =>
      RenderTapTarget(minSize: minSize);

  @override
  void updateRenderObject(BuildContext context, RenderTapTarget renderObject) {
    renderObject.minSize = minSize;
  }

  @override
  void debugFillProperties(DiagnosticPropertiesBuilder properties) {
    super.debugFillProperties(properties);
    properties.add(DoubleProperty('minSize', minSize));
  }
}

/// The render object behind [TapTarget]: a proxy box that lays out and paints
/// its child untouched and accepts touches in a larger rectangle than it draws.
///
/// [targetRect] and [globalTargetRect] are exposed deliberately, so a widget test
/// can measure the geometry rather than infer it from whether a synthetic tap
/// happened to land (Req 13.6, Property 19).
class RenderTapTarget extends RenderProxyBox {
  RenderTapTarget({this.minSize = AppMetrics.minHitArea, RenderBox? child})
      : super(child);

  /// The smallest touch extent accepted on either axis.
  ///
  /// A plain field rather than a marking setter, deliberately: nothing about
  /// layout, paint or semantics depends on it, because the hit rectangle is
  /// derived from `size` on demand. That is the whole point of the widget.
  double minSize;

  /// The rectangle this control actually draws, in local coordinates.
  Rect get drawnRect => Offset.zero & size;

  /// The rectangle this control accepts a touch inside, in local coordinates:
  /// [drawnRect] inflated about its centre to at least [minSize] on both axes.
  ///
  /// Never smaller than [drawnRect], so a control's visible bounds are always
  /// contained by its own target — a control drawn larger than [minSize] keeps
  /// the target it already had.
  Rect get targetRect {
    final Rect drawn = drawnRect;
    final double dx = math.max(0, (minSize - drawn.width) / 2);
    final double dy = math.max(0, (minSize - drawn.height) / 2);
    return Rect.fromLTRB(
      drawn.left - dx,
      drawn.top - dy,
      drawn.right + dx,
      drawn.bottom + dy,
    );
  }

  /// [targetRect] in global coordinates, for the non-intersection assertion.
  Rect get globalTargetRect =>
      MatrixUtils.transformRect(getTransformTo(null), targetRect);

  /// [drawnRect] in global coordinates, for the contains-its-control assertion.
  Rect get globalDrawnRect =>
      MatrixUtils.transformRect(getTransformTo(null), drawnRect);

  @override
  bool hitTest(BoxHitTestResult result, {required Offset position}) {
    if (!targetRect.contains(position)) return false;
    return super.hitTest(result, position: _deliverInsideChild(position));
  }

  Offset _deliverInsideChild(Offset position) {
    if (size.isEmpty) return position;
    if (drawnRect.contains(position)) return position;
    return drawnRect.center;
  }

  @override
  void debugFillProperties(DiagnosticPropertiesBuilder properties) {
    super.debugFillProperties(properties);
    properties.add(DoubleProperty('minSize', minSize));
    if (hasSize) {
      properties.add(DiagnosticsProperty<Rect>('drawnRect', drawnRect));
      properties.add(DiagnosticsProperty<Rect>('targetRect', targetRect));
    }
  }
}
