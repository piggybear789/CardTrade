import 'package:flutter/material.dart';

/// The seven web-owned type levels, ported without implicit colour or weight.
/// Requirements 2.1–2.4 and 2.16.
abstract final class AppType {
  AppType._();

  /// The application's ONE font family, and the one place its name is written.
  ///
  /// Req 12.5–12.6: exactly one family, bundled at exactly the four weights the web
  /// uses (400/500/600/700), and no monospace second family — the web dropped Geist
  /// Mono for the same reason, because column alignment for money is a font FEATURE
  /// (`FontFeature.tabularFigures`, Req 12.7) and not a typeface.
  ///
  /// This string must equal the `family:` declared under `flutter: fonts:` in
  /// `pubspec.yaml`. A family Flutter cannot resolve does not throw: it silently
  /// falls back to the platform face, so the agreement harness pins the two together
  /// rather than trusting them to match.
  static const String family = 'Plus Jakarta Sans';

  /// Converts the web root tracking of -0.01em to Flutter logical pixels.
  static double tracking(double sizePx) => -0.01 * sizePx;

  static const TextStyle meta = TextStyle(fontSize: 12, height: 1.4, letterSpacing: -0.12);
  static const TextStyle body = TextStyle(fontSize: 13, height: 1.6, letterSpacing: -0.13);
  static const TextStyle nav = TextStyle(fontSize: 15, height: 1.4, letterSpacing: -0.15);
  static const TextStyle lead = TextStyle(fontSize: 16, height: 1.5, letterSpacing: -0.16);
  static const TextStyle subhead = TextStyle(fontSize: 17, height: 1.4, letterSpacing: -0.17);
  static const TextStyle head = TextStyle(fontSize: 21, height: 1.25, letterSpacing: -0.21);
  static const TextStyle display = TextStyle(fontSize: 28, height: 1.1, letterSpacing: -0.28);
}
