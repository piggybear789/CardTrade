// The golden suite's typeface loader.
//
// WITHOUT THIS, A GOLDEN IS A PICTURE OF THE WRONG FONT. `flutter test` renders
// text in a stand-in test face whose every glyph is a square of the font size, so
// a reference captured without loading the real faces measures the stand-in and
// pins nothing about the product typeface. Task 10.3 bundled the four static Plus
// Jakarta Sans instances under `flutter: fonts:`; this reads them off disk and
// registers them under the family the theme names.
//
// READ FROM THE FILE SYSTEM, NOT THROUGH `rootBundle`. The asset manifest a test
// process is handed has changed format between Flutter releases (JSON, then a
// binary blob), and a loader that parses it fails on an upgrade for a reason that
// has nothing to do with the fonts. `assets/fonts/*.ttf` is the same set the
// pubspec declares — `test/theme/typeface_test.dart` (Property P11) is what pins
// the two together, asserting every declared face is a file that exists — so this
// file globs the directory and refuses to run on an empty one.
//
// ONE FAMILY, FOUR FACES, WEIGHT CHOSEN FROM THE FONT'S OWN METADATA. All four
// files are registered under the single family name; Flutter then resolves a
// `FontWeight` against each face's `usWeightClass`. That is why the faces must be
// STATIC instances and not the variable font, which Req 12.5 already requires.
//
// Requirements 12.5, 12.10, 15.11.

import 'dart:io';

import 'package:flutter/services.dart';

import 'package:cardtrade/core/theme/type_scale.dart';

/// Where the bundled faces live, relative to the package root.
///
/// `flutter test` runs with the package root as its working directory, which is
/// how `test/theme/typeface_test.dart` reads `pubspec.yaml` too.
const String kFontAssetDirectory = 'assets/fonts';

/// How many faces Req 12.5 bundles. A smaller number means a weight is being
/// synthesised from a neighbour, which renders the right text in the wrong weight.
const int kExpectedFaceCount = 4;

bool _loaded = false;

/// Registers every bundled face of [AppType.family] with the test font system.
///
/// Idempotent: calling it from each golden file's `setUpAll` loads the faces once
/// per test process.
///
/// Throws rather than returning quietly when the directory is missing or holds
/// fewer faces than Req 12.5 bundles. A loader that shrugged would hand the suite
/// the stand-in face and every reference image would be captured from it — which
/// is the vacuous pass this repo treats as worse than no check at all.
Future<void> loadAppFonts() async {
  if (_loaded) return;

  final Directory directory = Directory(kFontAssetDirectory);
  if (!directory.existsSync()) {
    throw StateError(
      'no $kFontAssetDirectory directory: the golden suite cannot load the '
      'product typeface, and a reference captured now would measure the '
      "test runner's stand-in face instead (Req 12.5).",
    );
  }

  final List<File> faces = directory
      .listSync()
      .whereType<File>()
      .where((File file) => file.path.toLowerCase().endsWith('.ttf'))
      .toList()
    // Sorted so the registration order is the same on every host and every run.
    ..sort((File a, File b) => a.path.compareTo(b.path));

  if (faces.length != kExpectedFaceCount) {
    throw StateError(
      'expected $kExpectedFaceCount faces in $kFontAssetDirectory, found '
      '${faces.length}: ${faces.map((File file) => file.path).join(', ')}. '
      'A missing weight is SYNTHESISED from the nearest bundled face rather '
      'than reported (Req 12.10).',
    );
  }

  final FontLoader loader = FontLoader(AppType.family);
  for (final File face in faces) {
    loader.addFont(
      face.readAsBytes().then((List<int> bytes) => ByteData.sublistView(
            Uint8List.fromList(bytes),
          )),
    );
  }
  await loader.load();
  _loaded = true;
}

/// Whether [loadAppFonts] has run in this process.
///
/// Read by `pumpGolden`, which refuses to pump without it: the failure mode it
/// guards against is a capture that succeeds and is simply wrong.
bool get appFontsLoaded => _loaded;
