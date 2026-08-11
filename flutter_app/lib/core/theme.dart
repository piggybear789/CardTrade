import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// CardTrade design system — warm collector-ledger aesthetic.
///
/// Matches the web app's CSS variables exactly:
/// - Warm parchment background
/// - Dark warm foreground
/// - Gold accent (primary actions)
/// - Ditto purple (brand accent)
/// - Teal trust marks (verified badges)
abstract final class AppTheme {
  // ─── Colors (from globals.css HSL values) ──────────────────────────────

  // Core palette
  static const Color background = Color(0xFFF5F1EA);    // hsl(42, 31%, 96%)
  static const Color foreground = Color(0xFF1A1714);    // hsl(30, 10%, 9%)
  static const Color surface = Color(0xFFFDFCFA);       // hsl(40, 30%, 99%) — card
  static const Color surfaceVariant = Color(0xFFF0EADE); // hsl(40, 22%, 91%) — muted bg

  // Brand colors
  static const Color gold = Color(0xFFB8912E);          // hsl(41, 52%, 48%) — primary CTA
  static const Color goldLight = Color(0xFFF5E6C4);     // gold at 15% opacity on parchment
  static const Color ditto = Color(0xFFA855D6);         // hsl(282, 62%, 62%) — brand purple
  static const Color dittoLight = Color(0xFFF3E8FF);    // purple tint

  // Semantic colors
  static const Color trust = Color(0xFF0F8B6E);         // hsl(173, 80%, 30%) — verified
  static const Color trustLight = Color(0xFFD1FAE5);    // trust tint
  static const Color danger = Color(0xFFBF2D2D);        // hsl(2, 67%, 45%) — destructive
  static const Color dangerLight = Color(0xFFFEE2E2);   // danger tint
  static const Color warning = Color(0xFFD97706);       // amber for pending
  static const Color warningLight = Color(0xFFFEF3C7);  // amber tint

  // Neutrals
  static const Color primary = Color(0xFF151210);       // hsl(30, 9%, 7%) — text primary
  static const Color secondary = Color(0xFF6B5E52);     // hsl(32, 8%, 40%) — muted-foreground
  static const Color muted = Color(0xFF9C9080);         // lighter muted
  static const Color border = Color(0xFFCFC3B3);        // hsl(36, 18%, 78%)
  static const Color input = Color(0xFFC2B5A3);         // hsl(36, 18%, 72%)
  static const Color obsidian = Color(0xFF100E0B);      // hsl(30, 9%, 4%)
  static const Color charcoal = Color(0xFF272019);      // hsl(30, 8%, 14%)
  static const Color parchment = Color(0xFFEDE4D3);     // hsl(40, 45%, 90%)

  // ─── Spacing (compact for mobile) ───────────────────────────────────────

  static const double spacingXs = 2;
  static const double spacingSm = 4;
  static const double spacingMd = 8;
  static const double spacingLg = 12;
  static const double spacingXl = 16;
  static const double spacingXxl = 24;
  static const double spacingXxxl = 32;

  // ─── Radii (--radius: 0.625rem = 10px) ─────────────────────────────────

  static const double radiusSm = 6;
  static const double radiusMd = 8;
  static const double radiusLg = 10;
  static const double radiusXl = 14;
  static const double radiusFull = 999;

  // ─── Shadows (from box-shadow: market/auction) ─────────────────────────

  static List<BoxShadow> get shadowSm => [
        BoxShadow(
          color: obsidian.withValues(alpha: 0.06),
          blurRadius: 2,
          offset: const Offset(0, 1),
        ),
      ];

  static List<BoxShadow> get shadowMd => [
        BoxShadow(
          color: obsidian.withValues(alpha: 0.06),
          blurRadius: 30,
          offset: const Offset(0, 10),
        ),
        BoxShadow(
          color: obsidian.withValues(alpha: 0.08),
          blurRadius: 2,
          offset: const Offset(0, 1),
        ),
      ];

  static List<BoxShadow> get shadowLg => [
        BoxShadow(
          color: obsidian.withValues(alpha: 0.16),
          blurRadius: 44,
          offset: const Offset(0, 16),
        ),
      ];

  // ─── Theme Data ────────────────────────────────────────────────────────

  static ThemeData get lightTheme {
    final textTheme = GoogleFonts.plusJakartaSansTextTheme();

    return ThemeData(
      useMaterial3: true,
      brightness: Brightness.light,
      visualDensity: VisualDensity.compact,
      scaffoldBackgroundColor: background,
      colorScheme: const ColorScheme.light(
        primary: gold,
        onPrimary: Color(0xFFFFFDF7),
        secondary: parchment,
        onSecondary: primary,
        surface: surface,
        onSurface: primary,
        error: danger,
        onError: Colors.white,
        outline: border,
        tertiary: trust,
        onTertiary: Colors.white,
      ),
      // ─── TYPE SCALE ────────────────────────────────────────────────────
      // Hierarchy comes from CONTRAST, not many small steps. Two clusters:
      // a dense small tier (10-14) differentiated by weight and colour, and
      // a large tier (15/19/26) that jumps decisively away from it.
      //
      // Line height is inversely proportional to size: big text sits tight,
      // small text needs air to stay readable.
      textTheme: textTheme.copyWith(
        // HERO — the price on a listing detail. Nothing else uses this.
        displayLarge: textTheme.displayLarge?.copyWith(
          fontSize: 26,
          fontWeight: FontWeight.w700,
          height: 1.1,
          letterSpacing: -0.5,
          color: primary,
        ),
        displayMedium: textTheme.displayMedium?.copyWith(
          fontSize: 22,
          fontWeight: FontWeight.w700,
          height: 1.15,
          letterSpacing: -0.4,
          color: primary,
        ),
        displaySmall: textTheme.displaySmall?.copyWith(
          fontSize: 19,
          fontWeight: FontWeight.w700,
          height: 1.2,
          letterSpacing: -0.3,
          color: primary,
        ),

        // HEADLINE — page titles and prominent headings.
        headlineLarge: textTheme.headlineLarge?.copyWith(
          fontSize: 19,
          fontWeight: FontWeight.w700,
          height: 1.2,
          letterSpacing: -0.3,
          color: primary,
        ),
        headlineMedium: textTheme.headlineMedium?.copyWith(
          fontSize: 15,
          fontWeight: FontWeight.w600,
          height: 1.3,
          letterSpacing: -0.1,
          color: primary,
        ),
        headlineSmall: textTheme.headlineSmall?.copyWith(
          fontSize: 14,
          fontWeight: FontWeight.w600,
          height: 1.3,
          color: primary,
        ),

        // TITLE — card titles, list item names, section heads.
        titleLarge: textTheme.titleLarge?.copyWith(
          fontSize: 15,
          fontWeight: FontWeight.w600,
          height: 1.3,
          letterSpacing: -0.1,
          color: primary,
        ),
        titleMedium: textTheme.titleMedium?.copyWith(
          fontSize: 13,
          fontWeight: FontWeight.w600,
          height: 1.35,
          color: primary,
        ),
        titleSmall: textTheme.titleSmall?.copyWith(
          fontSize: 12,
          fontWeight: FontWeight.w600,
          height: 1.35,
          color: primary,
        ),

        // BODY — reading text. Generous line height; this is prose.
        bodyLarge: textTheme.bodyLarge?.copyWith(
          fontSize: 14,
          fontWeight: FontWeight.w400,
          height: 1.55,
          color: primary,
        ),
        bodyMedium: textTheme.bodyMedium?.copyWith(
          fontSize: 13,
          fontWeight: FontWeight.w400,
          height: 1.5,
          color: primary,
        ),
        bodySmall: textTheme.bodySmall?.copyWith(
          fontSize: 11,
          fontWeight: FontWeight.w400,
          height: 1.4,
          color: secondary,
        ),

        // LABEL — buttons, form labels, badges. Tighter, slightly tracked.
        labelLarge: textTheme.labelLarge?.copyWith(
          fontSize: 12,
          fontWeight: FontWeight.w500,
          height: 1.35,
          color: primary,
        ),
        labelMedium: textTheme.labelMedium?.copyWith(
          fontSize: 11,
          fontWeight: FontWeight.w500,
          height: 1.35,
          letterSpacing: 0.1,
          color: secondary,
        ),
        labelSmall: textTheme.labelSmall?.copyWith(
          fontSize: 10,
          fontWeight: FontWeight.w500,
          height: 1.3,
          letterSpacing: 0.2,
          color: muted,
        ),
      ),
      appBarTheme: AppBarTheme(
        backgroundColor: surface,
        foregroundColor: primary,
        elevation: 0,
        scrolledUnderElevation: 0.5,
        centerTitle: false,
        toolbarHeight: 50,
        titleTextStyle: textTheme.headlineSmall?.copyWith(
          fontSize: 16,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.2,
          color: primary,
        ),
      ),
      cardTheme: CardThemeData(
        color: surface,
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusLg),
          side: const BorderSide(color: border, width: 0.5),
        ),
        margin: EdgeInsets.zero,
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: gold,
          foregroundColor: const Color(0xFFFFFDF7),
          elevation: 0,
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          minimumSize: const Size(0, 40),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(radiusMd),
          ),
          textStyle: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.1,
          ),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: primary,
          side: const BorderSide(color: border, width: 0.5),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          minimumSize: const Size(0, 40),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(radiusMd),
          ),
          textStyle: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w500,
            letterSpacing: 0.1,
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: gold,
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          minimumSize: const Size(0, 36),
          textStyle: const TextStyle(
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: gold,
          foregroundColor: const Color(0xFFFFFDF7),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          minimumSize: const Size(0, 40),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(radiusMd),
          ),
          textStyle: const TextStyle(
            fontSize: 13,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.1,
          ),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: surface,
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 12,
          vertical: 10,
        ),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          borderSide: const BorderSide(color: border, width: 0.5),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          borderSide: const BorderSide(color: border, width: 0.5),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          borderSide: const BorderSide(color: gold, width: 1.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(radiusMd),
          borderSide: const BorderSide(color: danger),
        ),
        hintStyle: const TextStyle(color: muted, fontSize: 13),
        labelStyle: const TextStyle(color: secondary, fontSize: 12),
        errorStyle: const TextStyle(color: danger, fontSize: 11, height: 1.3),
      ),
      bottomNavigationBarTheme: const BottomNavigationBarThemeData(
        backgroundColor: surface,
        selectedItemColor: gold,
        unselectedItemColor: muted,
        type: BottomNavigationBarType.fixed,
        elevation: 8,
        showUnselectedLabels: true,
        selectedLabelStyle: TextStyle(fontSize: 10, fontWeight: FontWeight.w600),
        unselectedLabelStyle: TextStyle(fontSize: 10, fontWeight: FontWeight.w400),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: parchment,
        selectedColor: goldLight,
        labelStyle: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusFull),
        ),
        side: BorderSide.none,
      ),
      dividerTheme: const DividerThemeData(
        color: border,
        thickness: 0.5,
        space: 0,
      ),
      bottomSheetTheme: const BottomSheetThemeData(
        backgroundColor: surface,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.vertical(top: Radius.circular(radiusXl)),
        ),
        dragHandleColor: muted,
        dragHandleSize: Size(32, 4),
        showDragHandle: true,
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusMd),
        ),
      ),
      dialogTheme: DialogThemeData(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(radiusLg),
        ),
      ),
    );
  }

  // ─── Semantic Text Styles ──────────────────────────────────────────────
  //
  // Reach for these instead of writing `fontSize:` inline. A component picks
  // a role; it does not invent a size. This is what keeps hierarchy consistent
  // across screens — the previous flat scale had bodyLarge and headlineSmall
  // at the same size, so nothing stood out anywhere.

  /// The price on a listing detail page. The loudest thing on the screen.
  static const TextStyle priceHero = TextStyle(
    fontSize: 26,
    fontWeight: FontWeight.w700,
    height: 1.1,
    letterSpacing: -0.5,
    color: gold,
  );

  /// The price on a grid/list card. Prominent but subordinate to the image.
  static const TextStyle priceCard = TextStyle(
    fontSize: 15,
    fontWeight: FontWeight.w700,
    height: 1.2,
    letterSpacing: -0.2,
    color: gold,
  );

  /// A price shown inline in a row (trades list, contract rows).
  static const TextStyle priceInline = TextStyle(
    fontSize: 13,
    fontWeight: FontWeight.w700,
    height: 1.3,
    color: gold,
  );

  /// Title of a card in a grid or list.
  static const TextStyle cardTitle = TextStyle(
    fontSize: 13,
    fontWeight: FontWeight.w500,
    height: 1.35,
    color: primary,
  );

  /// Name of a person or entity in a list row.
  static const TextStyle rowName = TextStyle(
    fontSize: 13,
    fontWeight: FontWeight.w600,
    height: 1.3,
    color: primary,
  );

  /// Reading text — descriptions, message bodies, prose.
  static const TextStyle bodyText = TextStyle(
    fontSize: 13,
    fontWeight: FontWeight.w400,
    height: 1.55,
    color: primary,
  );

  /// Secondary supporting text under a title.
  static const TextStyle supportText = TextStyle(
    fontSize: 11,
    fontWeight: FontWeight.w400,
    height: 1.4,
    color: secondary,
  );

  /// Metadata — timestamps, counts, locations. The quietest text.
  static const TextStyle metaText = TextStyle(
    fontSize: 11,
    fontWeight: FontWeight.w400,
    height: 1.3,
    letterSpacing: 0.1,
    color: muted,
  );

  /// Text inside a status badge or pill.
  static const TextStyle badgeText = TextStyle(
    fontSize: 10,
    fontWeight: FontWeight.w600,
    height: 1.2,
    letterSpacing: 0.2,
  );

  /// A small uppercase-ish section label above a group of content.
  static const TextStyle sectionLabel = TextStyle(
    fontSize: 11,
    fontWeight: FontWeight.w600,
    height: 1.3,
    letterSpacing: 0.4,
    color: secondary,
  );

  /// Label in a label/value detail row.
  static const TextStyle detailLabel = TextStyle(
    fontSize: 11,
    fontWeight: FontWeight.w400,
    height: 1.4,
    color: muted,
  );

  /// Value in a label/value detail row.
  static const TextStyle detailValue = TextStyle(
    fontSize: 11,
    fontWeight: FontWeight.w500,
    height: 1.4,
    color: primary,
  );

  // ─── Convenience: accent color (gold is the primary action color) ──────
  static const Color accent = gold;
  static const Color accentLight = goldLight;
  static const Color accentDark = Color(0xFF8B6E1F);
  static const Color success = trust;
  static const Color successLight = trustLight;
}
