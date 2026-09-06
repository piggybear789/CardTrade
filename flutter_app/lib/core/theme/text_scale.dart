import 'dart:math' as math;

import 'package:flutter/widgets.dart';

/// The ONE place the text-scale cap lives.
///
/// Req 13.10 asks the client to honour the system text scale factor up to a
/// maximum of 2.0, so a reported 2.5 renders as 2.0. Two things follow from
/// putting that in one place rather than at each call site: a screen never
/// re-derives the ceiling, and a widget test can assert the applied factor is
/// exactly `min(f, 2.0)` (Property 24) rather than inferring it from whether
/// something happened to overflow.
///
/// The floor is deliberately NOT clamped. A member who has asked for smaller
/// text has asked for it; only the upper end is a layout risk.
///
/// Requirements 13.10.
abstract final class AppTextScale {
  AppTextScale._();

  /// The largest factor the client applies, whatever the platform reports.
  static const double maxFactor = 2.0;

  /// The factor actually applied for a reported [factor]: `min(factor, 2.0)`.
  static double capFactor(double factor) => math.min(factor, maxFactor);

  /// [scaler] with its upper end held at [maxFactor].
  static TextScaler cap(TextScaler scaler) =>
      scaler.clamp(maxScaleFactor: maxFactor);
}

/// Applies [AppTextScale.cap] to everything below it.
///
/// Wrap the application once, at the root, rather than per screen: a screen that
/// forgets is a screen that overflows at 2.5, and the forgetting is invisible
/// until someone runs the app with a large system font.
class CappedTextScale extends StatelessWidget {
  const CappedTextScale({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final MediaQueryData media = MediaQuery.of(context);
    return MediaQuery(
      data: media.copyWith(textScaler: AppTextScale.cap(media.textScaler)),
      child: child,
    );
  }
}
