# Brand assets — PROVISIONAL

The launcher mark in this directory is a generated NoDitto monogram, not final artwork.
It exists because decision **D11** of `.kiro/specs/mobile-release-readiness` resolved a
gap with no designer in it: stock Flutter artwork cannot ship (Req 5.1), so a mark built
from the product's own colour tokens ships instead. It satisfies every mechanical
criterion in Requirement 5 and nothing more. **Replace it.**

## What is here

| File | What it is |
| --- | --- |
| `icon_foreground.png` | 432×432 adaptive-icon foreground layer. The monogram in `AppColors.primaryForeground`, transparent elsewhere. |
| `icon_monochrome.png` | 432×432 themed-icon layer. The same silhouette, opaque black — Android keeps the alpha and applies its own tint. |
| `icon_background_color.txt` | The adaptive-icon background as a **value**, not a raster. Mirrors `AppColors.primary`. |

Colours are read from `lib/core/theme/tokens.g.dart` at generation time, never typed in.
Where a literal has to be embedded in an Android resource — `values/ic_launcher_background.xml`
is the only place — a comment names the token it came from, so drift is visible.

The mark is bounded to a 60dp box centred on the 108dp adaptive canvas, inside the inner
66dp safe zone, so no launcher mask clips it.

## Regenerating from replacement artwork

Two routes. The first is the one this repo uses today.

### 1. Regenerate the monogram (no new artwork)

Only needed after a theme token change:

```cmd
cd flutter_app
node tool/generate_brand_icons.mjs
```

Zero dependencies — plain Node, `zlib` only. `flutter_launcher_icons` was the design's
suggested route and is **not** used: it is absent from the pinned pub cache and cannot be
resolved offline, and a dev dependency that cannot install is not worth blocking on.

### 2. Drop in final artwork

Replace `icon_foreground.png` and `icon_monochrome.png` with the designer's layers at
432×432 (transparent outside the mark, mark inside the inner 66dp), set the background in
`icon_background_color.txt`, then run `flutter_launcher_icons` — which by then can be
installed:

```cmd
cd flutter_app
flutter pub add --dev flutter_launcher_icons
dart run flutter_launcher_icons
```

with this block in `pubspec.yaml`:

```yaml
flutter_launcher_icons:
  android: ic_launcher
  ios: false
  image_path: assets/brand/icon_foreground.png
  adaptive_icon_background: "#77469B" # AppColors.primary
  adaptive_icon_foreground: assets/brand/icon_foreground.png
  adaptive_icon_monochrome: assets/brand/icon_monochrome.png
```

Delete `tool/generate_brand_icons.mjs` if you take this route, so there is one generator
rather than two. Either way the output is **checked-in resources**, never a build step.

## Files a regeneration overwrites

```
assets/brand/icon_foreground.png
assets/brand/icon_monochrome.png
assets/brand/icon_background_color.txt
android/app/src/main/res/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher.png
android/app/src/main/res/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher_foreground.png
android/app/src/main/res/mipmap-{mdpi,hdpi,xhdpi,xxhdpi,xxxhdpi}/ic_launcher_monochrome.png
android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml
android/app/src/main/res/values/ic_launcher_background.xml
```

Legacy rasters are 48dp per bucket (48/72/96/144/192 px); adaptive layers are the full
108dp canvas (108/162/216/324/432 px).

It touches **no theme token and no bundled font** (Req 5.7): 156 golden references were
baselined on Windows and either change re-baselines all of them. It does not touch
`drawable/launch_background.xml` either — the splash is task 6.2.
