import 'package:flutter/material.dart';

import 'elevation.dart';
import 'metrics.dart';
import 'text_roles.dart';
import 'tokens.g.dart';
import 'type_scale.dart';

/// The application's single, web-aligned light Material theme.
/// Requirements 1.9, 2.11, 2.15, 3.10, and 8.1–8.4.
abstract final class AppTheme {
  AppTheme._();

  /// The sole ThemeData instance; the app intentionally has no dark theme.
  static final ThemeData lightTheme = ThemeData(
    useMaterial3: true,
    brightness: Brightness.light,
    // Req 8.7: a control is DRAWN at its web height and given its 48-pixel touch
    // rectangle by `TapTarget`, which expands the hit test only. Material's
    // default `padded` would inflate the LAYOUT box to 48 instead, moving the
    // chrome row past `min-h-10` and the content height past inset + 54.
    materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
    // Req 12.5–12.6: ONE bundled family, named once in [AppType.family]. Setting it
    // here is what carries it onto `textTheme` — ThemeData applies `fontFamily` to
    // the TextTheme it is given — and from there onto every `AppText` role, which
    // merges with the inherited DefaultTextStyle rather than declaring a family of
    // its own. That is deliberate: a family repeated on 14 roles is 14 chances to
    // spell it differently, and a misspelt family falls back silently.
    fontFamily: AppType.family,
    scaffoldBackgroundColor: AppColors.background,
    colorScheme: const ColorScheme(
      brightness: Brightness.light,
      primary: AppColors.primary,
      onPrimary: AppColors.primaryForeground,
      primaryContainer: AppColors.accent,
      onPrimaryContainer: AppColors.accentForeground,
      secondary: AppColors.secondary,
      onSecondary: AppColors.secondaryForeground,
      secondaryContainer: AppColors.secondary,
      onSecondaryContainer: AppColors.secondaryForeground,
      tertiary: AppColors.trust,
      onTertiary: AppColors.background,
      tertiaryContainer: AppColors.muted,
      onTertiaryContainer: AppColors.foreground,
      error: AppColors.destructive,
      onError: AppColors.destructiveForeground,
      errorContainer: AppColors.accent,
      onErrorContainer: AppColors.destructive,
      surface: AppColors.card,
      onSurface: AppColors.cardForeground,
      surfaceContainerHighest: AppColors.muted,
      onSurfaceVariant: AppColors.mutedForeground,
      outline: AppColors.border,
      outlineVariant: AppColors.border,
      shadow: AppColors.obsidian,
      scrim: AppColors.obsidian,
      inverseSurface: AppColors.obsidian,
      onInverseSurface: AppColors.mist,
      inversePrimary: AppColors.iris,
    ),
    textTheme: const TextTheme(
      displayLarge: AppType.display,
      displayMedium: AppType.display,
      displaySmall: AppType.head,
      headlineLarge: AppType.head,
      headlineMedium: AppType.subhead,
      headlineSmall: AppType.lead,
      titleLarge: AppType.head,
      titleMedium: AppType.body,
      titleSmall: AppType.meta,
      bodyLarge: AppType.lead,
      bodyMedium: AppType.body,
      bodySmall: AppType.meta,
      labelLarge: AppType.body,
      labelMedium: AppType.meta,
      labelSmall: AppType.meta,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: AppColors.background,
      foregroundColor: AppColors.foreground,
      elevation: 0,
      scrolledUnderElevation: 0,
      toolbarHeight: AppMetrics.chromeContent,
      titleTextStyle: AppText.rowName,
    ),
    cardTheme: CardThemeData(
      color: AppColors.card,
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(AppRadius.lg),
        side: const BorderSide(color: AppColors.border, width: AppMetrics.hairline),
      ),
    ),
    elevatedButtonTheme: ElevatedButtonThemeData(
      style: ElevatedButton.styleFrom(
        backgroundColor: AppColors.action,
        foregroundColor: AppColors.actionForeground,
        disabledBackgroundColor: AppColors.muted,
        disabledForegroundColor: AppColors.mutedForeground,
        minimumSize: const Size(0, AppMetrics.controlHeight),
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.group),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.md)),
        textStyle: AppText.bodyText.copyWith(fontWeight: FontWeight.w600),
      ).copyWith(side: _controlEdge(AppColors.actionBorder)),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: AppColors.foreground,
        disabledForegroundColor: AppColors.mutedForeground,
        minimumSize: const Size(0, AppMetrics.controlHeight),
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.group),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.md)),
        textStyle: AppText.bodyText.copyWith(fontWeight: FontWeight.w500),
      ).copyWith(
        side: _controlEdge(AppColors.border),
        // Req 8.9: an unavailable control presents NO press feedback, and an
        // outlined button is the one variant with no fill to say so by itself.
        backgroundColor: WidgetStateProperty.resolveWith(
          (Set<WidgetState> states) =>
              states.contains(WidgetState.disabled) ? AppColors.muted : null,
        ),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: AppColors.primary,
        foregroundColor: AppColors.primaryForeground,
        disabledBackgroundColor: AppColors.muted,
        disabledForegroundColor: AppColors.mutedForeground,
        minimumSize: const Size(0, AppMetrics.controlHeight),
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.group),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.md)),
        textStyle: AppText.bodyText.copyWith(fontWeight: FontWeight.w600),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: AppColors.card,
      isDense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: AppSpacing.cozy),
      hintStyle: AppText.supportText,
      labelStyle: AppText.bodyText.copyWith(color: AppColors.mutedForeground),
      helperStyle: AppText.supportText,
      errorStyle: AppText.bodyText.copyWith(color: AppColors.destructive),
      border: _inputBorder(AppColors.input),
      enabledBorder: _inputBorder(AppColors.input),
      // Req 8.2: focus changes the border's COLOUR and nothing else. Same width,
      // same drawn bounds, so taking focus does not reflow the fields around it.
      focusedBorder: _inputBorder(AppColors.ring),
      errorBorder: _inputBorder(AppColors.destructive),
      focusedErrorBorder: _inputBorder(AppColors.destructive),
      disabledBorder: _inputBorder(AppColors.muted),
    ),
    bottomNavigationBarTheme: const BottomNavigationBarThemeData(
      backgroundColor: AppColors.background,
      selectedItemColor: AppColors.irisInk,
      unselectedItemColor: AppColors.mutedForeground,
      type: BottomNavigationBarType.fixed,
      elevation: 0,
      showUnselectedLabels: true,
      selectedLabelStyle: AppText.metaText,
      unselectedLabelStyle: AppText.metaText,
    ),
    chipTheme: const ChipThemeData(
      backgroundColor: AppColors.muted,
      selectedColor: AppColors.accent,
      disabledColor: AppColors.muted,
      labelStyle: AppText.bodyText,
      secondaryLabelStyle: AppText.bodyText,
      checkmarkColor: AppColors.accentForeground,
      side: BorderSide(color: AppColors.border, width: AppMetrics.hairline),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.all(Radius.circular(AppRadius.full)),
      ),
    ),
    // Req 8.8: the choice controls share ONE selected pair — `--accent` fill with
    // an `--accent-foreground` label — so a segmented button and a chip group in
    // the same form do not disagree about what "chosen" looks like.
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        backgroundColor: WidgetStateProperty.resolveWith((Set<WidgetState> states) {
          if (states.contains(WidgetState.disabled)) return AppColors.muted;
          if (states.contains(WidgetState.selected)) return AppColors.accent;
          return AppColors.card;
        }),
        foregroundColor: WidgetStateProperty.resolveWith((Set<WidgetState> states) {
          if (states.contains(WidgetState.disabled)) return AppColors.mutedForeground;
          if (states.contains(WidgetState.selected)) return AppColors.accentForeground;
          return AppColors.foreground;
        }),
        iconColor: WidgetStateProperty.resolveWith((Set<WidgetState> states) {
          if (states.contains(WidgetState.disabled)) return AppColors.mutedForeground;
          if (states.contains(WidgetState.selected)) return AppColors.accentForeground;
          return AppColors.foreground;
        }),
        iconSize: const WidgetStatePropertyAll<double>(AppIconSize.base),
        side: _controlEdge(AppColors.border),
        // Req 8.7: a button label is at the `body` level whatever the variant.
        textStyle: WidgetStatePropertyAll<TextStyle>(
          AppText.bodyText.copyWith(fontWeight: FontWeight.w500),
        ),
        minimumSize: const WidgetStatePropertyAll<Size>(
          Size(0, AppMetrics.controlHeight),
        ),
        shape: WidgetStatePropertyAll<OutlinedBorder>(
          RoundedRectangleBorder(borderRadius: BorderRadius.circular(AppRadius.md)),
        ),
      ),
    ),
    radioTheme: RadioThemeData(
      fillColor: WidgetStateProperty.resolveWith((Set<WidgetState> states) {
        if (states.contains(WidgetState.disabled)) return AppColors.mutedForeground;
        if (states.contains(WidgetState.selected)) return AppColors.accentForeground;
        return AppColors.input;
      }),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: AppColors.primary,
      circularTrackColor: AppColors.muted,
    ),
    dividerTheme: const DividerThemeData(color: AppColors.border, thickness: AppMetrics.hairline, space: 0),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: AppColors.card,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(AppRadius.lg),
          topRight: Radius.circular(AppRadius.lg),
        ),
      ),
      dragHandleColor: AppColors.mutedForeground,
      dragHandleSize: Size(AppSpacing.section, AppSpacing.tight),
      showDragHandle: true,
    ),
    dialogTheme: const DialogThemeData(
      backgroundColor: AppColors.card,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.all(Radius.circular(AppRadius.lg)),
        side: BorderSide(color: AppColors.border, width: AppMetrics.hairline),
      ),
    ),
  );

  // ── Compatibility forwards ────────────────────────────────────────────────
  //
  // These are NOT migration aliases: every name here still means what it always
  // meant and forwards to the split theme class that now owns it. They exist so
  // that Stage 1 can land the split layer without rewriting all 46 Mobile_Screens
  // in the same change, and each one disappears as its call sites move to the
  // owning class. They carry no ratchet marker precisely because they are not
  // retired vocabulary, and no `@Deprecated`, which would break the analyzer
  // ceiling Req 14.7 fixes.
  //
  // Every forward is `const` where its target is, so a `const` call site keeps
  // compiling. `shadowSm`/`shadowMd` cannot be: AppElevation converts CSS blur at
  // runtime, so those two are `final` and their call sites are not const.

  /// Page background — forwards to [AppColors.background].
  static const Color background = AppColors.background;

  /// Hairline separator colour — forwards to [AppColors.border].
  static const Color border = AppColors.border;

  /// The dark region colour — forwards to [AppColors.obsidian].
  static const Color obsidian = AppColors.obsidian;

  static const double radiusSm = AppRadius.sm;
  static const double radiusMd = AppRadius.md;
  static const double radiusLg = AppRadius.lg;
  static const double radiusFull = AppRadius.full;

  static const TextStyle priceHero = AppText.priceHero;
  static const TextStyle priceCard = AppText.priceCard;
  static const TextStyle priceInline = AppText.priceInline;
  static const TextStyle cardTitle = AppText.cardTitle;
  static const TextStyle rowName = AppText.rowName;
  static const TextStyle bodyText = AppText.bodyText;
  static const TextStyle supportText = AppText.supportText;
  static const TextStyle metaText = AppText.metaText;
  static const TextStyle badgeText = AppText.badgeText;
  static const TextStyle sectionLabel = AppText.sectionLabel;
  static const TextStyle detailLabel = AppText.detailLabel;
  static const TextStyle detailValue = AppText.detailValue;

  /// Resting card elevation — forwards to [AppElevation.market].
  static final List<BoxShadow> shadowSm = AppElevation.market;

  /// Raised surface elevation — forwards to [AppElevation.auction].
  static final List<BoxShadow> shadowMd = AppElevation.auction;

  // The transitional colour and spacing aliases that stood here are gone with
  // `migration_aliases.dart` (Req 1.11, 3.3, 14.9). Every Mobile_Screen now names
  // the palette token or the spacing step directly, so the last forwards had no
  // callers and an alias nobody references must be deleted rather than kept.

  /// A control's edge: [color] normally, `--muted` while it cannot be activated.
  ///
  /// Req 8.9 asks an unavailable control for a muted FILL and a muted BORDER, and
  /// `styleFrom`'s `side` is one static value, so the state has to be resolved.
  static WidgetStateProperty<BorderSide> _controlEdge(Color color) =>
      WidgetStateProperty.resolveWith(
        (Set<WidgetState> states) => BorderSide(
          color: states.contains(WidgetState.disabled) ? AppColors.muted : color,
          width: AppMetrics.hairline,
        ),
      );

  static OutlineInputBorder _inputBorder(Color color) => OutlineInputBorder(
    borderRadius: BorderRadius.circular(AppRadius.md),
    borderSide: BorderSide(color: color, width: AppMetrics.hairline),
  );
}

/// An explicit dark region, not a second application theme.
class ObsidianRegion extends StatelessWidget {
  const ObsidianRegion({required this.child, super.key});

  final Widget child;

  @override
  Widget build(BuildContext context) => DefaultTextStyle.merge(
    style: const TextStyle(color: AppColors.mist),
    child: ColoredBox(color: AppColors.obsidian, child: child),
  );
}
