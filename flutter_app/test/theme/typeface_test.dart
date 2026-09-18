// Property P11 — the typeface is bundled, single, and complete.
// Requirements 12.5, 12.6, 12.7 and 12.10 of .kiro/specs/mobile-visual-parity.
//
// Flutter reports NEITHER of the two ways typeface delivery goes wrong. A
// `fontFamily` it cannot resolve falls back to the platform face, and a
// `FontWeight` with no bundled asset is SYNTHESISED from the nearest face that is
// bundled. Both render text that looks approximately right, on a device, after
// shipping — so these are asserted here rather than noticed later.
//
// The companion half of P11 lives in `tests/unit/mobileThemeAgreement.test.ts`,
// which reads the same `pubspec.yaml` against every `FontWeight.` in the Dart tree.
// This file asserts the RUNTIME half the source scan cannot see: what the assembled
// `ThemeData` actually resolves to.

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/core/theme/app_theme.dart';
import 'package:cardtrade/core/theme/text_roles.dart';
import 'package:cardtrade/core/theme/type_scale.dart';

/// The four weights Req 12.5 bundles, and the only weights P11 permits.
const Set<int> kBundledWeights = <int>{400, 500, 600, 700};

/// One declared face: the asset path and the weight it is declared at.
typedef FontFace = ({String asset, int? weight, String? style});

/// Reads the `flutter: fonts:` block of `pubspec.yaml` by indentation.
///
/// Deliberately strict: an unrecognised line inside the block throws rather than
/// being skipped, because a face this parser silently dropped is a face the
/// assertions below then cannot miss.
Map<String, List<FontFace>> readDeclaredFonts(File pubspec) {
  final List<String> lines = pubspec.readAsLinesSync();
  final int flutterAt = lines.indexWhere((String line) => RegExp(r'^flutter:\s*$').hasMatch(line));
  if (flutterAt == -1) throw StateError('pubspec.yaml declares no top-level `flutter:` section');

  int fontsAt = -1;
  for (int i = flutterAt + 1; i < lines.length; i += 1) {
    if (RegExp(r'^\S').hasMatch(lines[i])) break;
    if (RegExp(r'^\s{2}fonts:\s*$').hasMatch(lines[i])) {
      fontsAt = i;
      break;
    }
  }
  if (fontsAt == -1) throw StateError('pubspec.yaml declares no `flutter: fonts:` block');

  final Map<String, List<FontFace>> families = <String, List<FontFace>>{};
  String? current;
  for (int i = fontsAt + 1; i < lines.length; i += 1) {
    final String raw = lines[i];
    if (raw.trim().isEmpty || RegExp(r'^\s*#').hasMatch(raw)) continue;
    if (RegExp(r'^\S').hasMatch(raw)) break;
    final int indent = raw.length - raw.trimLeft().length;
    if (indent <= 2) break;

    final RegExpMatch? family = RegExp(r'^\s*-\s*family:\s*(.+?)\s*$').firstMatch(raw);
    if (family != null) {
      current = family.group(1)!.replaceAll(RegExp("^['\"]|['\"]\$"), '');
      families[current] = <FontFace>[];
      continue;
    }
    if (RegExp(r'^\s*fonts:\s*$').hasMatch(raw)) continue;
    final RegExpMatch? asset = RegExp(r'^\s*-\s*asset:\s*(.+?)\s*$').firstMatch(raw);
    if (asset != null) {
      if (current == null) throw StateError('a font asset appears before any `- family:`');
      families[current]!.add((
        asset: asset.group(1)!.replaceAll(RegExp("^['\"]|['\"]\$"), ''),
        weight: null,
        style: null,
      ));
      continue;
    }
    final RegExpMatch? weight = RegExp(r'^\s*weight:\s*(\d+)\s*$').firstMatch(raw);
    final RegExpMatch? style = RegExp(r'^\s*style:\s*(\w+)\s*$').firstMatch(raw);
    if (weight != null || style != null) {
      if (current == null || families[current]!.isEmpty) {
        throw StateError('a font face attribute appears before any `- asset:`');
      }
      final FontFace face = families[current]!.removeLast();
      families[current]!.add((
        asset: face.asset,
        weight: weight == null ? face.weight : int.parse(weight.group(1)!),
        style: style == null ? face.style : style.group(1),
      ));
      continue;
    }
    throw StateError('unrecognised line inside `flutter: fonts:`: ${raw.trim()}');
  }
  return families;
}

/// Every semantic role, so a weight cannot enter through one this file forgot.
const Map<String, TextStyle> kRoles = <String, TextStyle>{
  'priceHero': AppText.priceHero,
  'priceCard': AppText.priceCard,
  'priceInline': AppText.priceInline,
  'priceRow': AppText.priceRow,
  'cardTitle': AppText.cardTitle,
  'rowName': AppText.rowName,
  'bodyText': AppText.bodyText,
  'supportText': AppText.supportText,
  'metaText': AppText.metaText,
  'badgeText': AppText.badgeText,
  'sectionLabel': AppText.sectionLabel,
  'detailLabel': AppText.detailLabel,
  'detailValue': AppText.detailValue,
};

void main() {
  final File pubspec = File('pubspec.yaml');
  final Map<String, List<FontFace>> declared = readDeclaredFonts(pubspec);

  group('the bundled typeface', () {
    test('P11: declares exactly one family, at exactly the four web weights', () {
      expect(declared.keys, <String>[AppType.family]);
      final List<int?> weights = declared[AppType.family]!.map((FontFace face) => face.weight).toList()
        ..sort((int? a, int? b) => a!.compareTo(b!));
      expect(weights, kBundledWeights.toList()..sort());
    });

    test('P11: every declared face is a file that exists in the bundle', () {
      for (final FontFace face in declared[AppType.family]!) {
        expect(
          File(face.asset).existsSync(),
          isTrue,
          reason: '${face.asset} is declared but absent, so weight ${face.weight} '
              'resolves to the platform default on a device',
        );
      }
    });

    test('P11: declares no styled face, which the web does not use', () {
      for (final FontFace face in declared[AppType.family]!) {
        expect(face.style, isNull, reason: '${face.asset} declares style ${face.style}');
      }
    });
  });

  group('the theme applies the bundled family', () {
    test('P11: names the bundled family on the theme itself', () {
      expect(AppTheme.lightTheme.textTheme.bodyMedium?.fontFamily, AppType.family);
    });

    test('P11: carries the family onto every populated TextTheme slot', () {
      final TextTheme text = AppTheme.lightTheme.textTheme;
      final List<TextStyle?> slots = <TextStyle?>[
        text.displayLarge, text.displayMedium, text.displaySmall,
        text.headlineLarge, text.headlineMedium, text.headlineSmall,
        text.titleLarge, text.titleMedium, text.titleSmall,
        text.bodyLarge, text.bodyMedium, text.bodySmall,
        text.labelLarge, text.labelMedium, text.labelSmall,
      ];
      for (final TextStyle? slot in slots) {
        if (slot == null) continue;
        expect(slot.fontFamily, AppType.family);
        // A fallback list is a second family by another name — it is what renders
        // when the first does not — and Req 12.6 permits exactly one.
        expect(slot.fontFamilyFallback ?? const <String>[], isEmpty);
      }
    });

    test('P11: applies no weight the four faces do not bundle', () {
      kRoles.forEach((String name, TextStyle style) {
        final FontWeight? weight = style.fontWeight;
        if (weight == null) return;
        expect(
          kBundledWeights.contains(FontWeight.values.indexOf(weight) * 100 + 100),
          isTrue,
          reason: 'AppText.$name applies $weight, which no bundled face supplies',
        );
      });
    });

    test('P11: keeps weight off the Type_Scale levels, so a level cannot smuggle one in', () {
      for (final TextStyle level in <TextStyle>[
        AppType.meta, AppType.body, AppType.lead,
        AppType.subhead, AppType.head, AppType.display,
      ]) {
        expect(level.fontWeight, isNull);
      }
    });

    test('P11: money roles get column alignment from a FEATURE, not a second family', () {
      for (final MapEntry<String, TextStyle> role in kRoles.entries) {
        if (!role.key.startsWith('price')) continue;
        final List<FontFeature> features = role.value.fontFeatures ?? const <FontFeature>[];
        expect(
          features.map((FontFeature feature) => feature.feature),
          containsAll(<String>['tnum', 'lnum']),
          reason: 'AppText.${role.key} must carry tabular and lining figures',
        );
        expect(role.value.fontFamily, isNull, reason: 'a money role must not name its own family');
      }
    });
  });
}
