/// Shared layout metrics derived from the web design tokens.
/// Requirements 3.1, 3.6–3.7, 4.2, 4.8, and 12.8.
abstract final class AppSpacing {
  AppSpacing._();

  static const double tight = 4;
  static const double snug = 8;
  static const double cozy = 12;
  static const double group = 16;
  static const double section = 32;
  static const double region = 64;
}

/// Radius values derived from the web `--radius` token of 8 logical pixels.
abstract final class AppRadius {
  AppRadius._();

  static const double _base = 8;
  static const double sm = _base - 4;
  static const double md = _base - 2;
  static const double lg = _base;
  static const double xl = _base + 4;
  /// Tailwind's `2xl`; Dart identifiers cannot start with a digit.
  static const double xxl = _base + 8;
  static const double full = 999;
}

/// The five icon boxes the web renders across the mobile interface.
abstract final class AppIconSize {
  AppIconSize._();

  static const double micro = 12;
  static const double button = 14;
  static const double base = 16;
  static const double large = 20;
  static const double display = 24;
  static const double strokeWidth = 1.75;
}

/// Measurements that are intentionally not spacing-scale steps.
abstract final class AppMetrics {
  AppMetrics._();

  static const double minHitArea = 48;
  static const double controlHeight = 40;
  static const double chromeRow = 40;
  static const double chromeContent = 54;
  static const double navBar = 56;
  static const double watchControl = 32;
  static const double attachmentThumb = 224;

  /// A contract progress-rail marker, matching the web rail's `size-5` tick.
  ///
  /// Every state is drawn at this one diameter — a larger active marker would
  /// move the labels beside it as the contract advanced.
  static const double railMarker = 20;

  /// The rail's connector line, matching the web rail's `h-[3px]`.
  static const double railConnector = 3;

  static const double bubbleMaxWidthFraction = 0.82;
  static const double hairline = 1;
}
