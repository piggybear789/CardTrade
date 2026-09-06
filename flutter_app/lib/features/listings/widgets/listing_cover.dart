// The cover box of a catalog tile: its shape, its reserved space, its empty
// treatment and the three states that scrim it.
//
// Split out of `listing_card.dart` because the cover carries all of the geometry
// the mosaic depends on. The tile's height IS its cover's height plus a fixed
// text block, so the shape has to be decided before the bytes arrive or the two
// columns reflow on every image that loads (Req 5.1, 5.2).
//
// Requirements 5.1, 5.2, 5.7, 5.11, 5.12.

import 'dart:math' as math;

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import 'package:cardtrade/core/theme.dart';

/// Cover geometry, ported from `lib/images/dimensions.ts`.
///
/// Presentation only: none of it decides eligibility, a price or a contract
/// state, and none of it belongs in `lib/domain/`, which holds the advisory
/// ports of server RULES. This is the shape of a box.
abstract final class ListingCover {
  ListingCover._();

  /// Narrowest cover drawn, as width over height.
  ///
  /// 0.7 rather than the more obvious 3:4, because a trading card is 63×88mm —
  /// 0.716 — and clamping the single most common shape in the catalog would
  /// flatten the mosaic back into the uniform grid it replaces.
  static const double aspectMin = 0.7;

  /// Widest cover drawn. One panorama would otherwise dominate a column and
  /// leave the other stranded.
  static const double aspectMax = 1.4;

  /// The shape used when nothing is known about a photo.
  static const double aspectFallback = 1;

  /// Implausibly narrow shapes are refused rather than clamped, so the tile
  /// falls back to square instead of pretending to a shape the image lacks.
  static const double _maxPlausibleRatio = 20;

  /// Cover aspect ratio for a tile, clamped to the mosaic range.
  ///
  /// Unknown, zero, non-finite or absurd dimensions in, square out.
  static double aspectRatio(int? widthPx, int? heightPx) {
    if (widthPx == null || heightPx == null) return aspectFallback;
    if (widthPx < 1 || heightPx < 1) return aspectFallback;
    final ratio = widthPx / heightPx;
    if (!ratio.isFinite || ratio <= 0) return aspectFallback;
    final longOverShort = widthPx > heightPx ? ratio : 1 / ratio;
    if (longOverShort > _maxPlausibleRatio) return aspectFallback;
    return math.min(aspectMax, math.max(aspectMin, ratio));
  }
}

/// Which of the three unavailable states scrims a cover, if any.
///
/// A binder or bulk listing is never reserved and never sold — it holds nothing
/// — so it can only ever be [closed] (Req 5.11). The caller decides; this enum
/// only names the outcomes.
enum ListingCoverState {
  /// Open for business. No scrim, no desaturation, full opacity.
  open('', ''),

  /// A single listing with a live contract against it.
  reserved('RESERVED', 'Under contract'),

  /// A single listing that has sold.
  sold('SOLD', 'Sold'),

  /// A binder or bulk listing its owner has retired.
  closed('CLOSED', 'Closed by the seller');

  const ListingCoverState(this.label, this.spokenLabel);

  /// The centred marker drawn over the cover.
  final String label;

  /// The same fact in member-facing words, for the tile's accessible label.
  final String spokenLabel;

  bool get isUnavailable => this != ListingCoverState.open;
}

/// The cover box: reserved to its own shape, filled while it loads, scrimmed
/// when the listing is unavailable, marked when it is a binder.
class ListingCoverBox extends StatelessWidget {
  const ListingCoverBox({
    required this.title,
    required this.imageUrl,
    required this.state,
    this.coverWidthPx,
    this.coverHeightPx,
    this.isBinder = false,
    this.topRightControl,
    super.key,
  });

  /// The listing's title, read out in place of a photo that does not exist.
  final String title;

  /// Resolved cover URL, or null where the listing carries no photo.
  final String? imageUrl;

  /// Whether the listing is reserved, sold, closed, or none of those.
  final ListingCoverState state;

  /// Intrinsic cover size, or null for the square fallback.
  final int? coverWidthPx;
  final int? coverHeightPx;

  /// Draws the binder marker on the cover.
  final bool isBinder;

  /// The watchlist control, placed over the top-right corner.
  final Widget? topRightControl;

  /// How much colour a scrimmed cover keeps, the web's `grayscale-[35%]`.
  static const double _saturationKept = 0.65;

  /// Radius of the cover's top corners, matching the tile it caps.
  static const BorderRadius _topCorners =
      BorderRadius.vertical(top: Radius.circular(AppRadius.lg));

  @override
  Widget build(BuildContext context) {
    Widget cover = ClipRRect(
      borderRadius: _topCorners,
      child: _photo(),
    );

    if (state.isUnavailable) {
      cover = ColorFiltered(
        colorFilter: _desaturate(_saturationKept),
        child: cover,
      );
    }

    return AspectRatio(
      aspectRatio: ListingCover.aspectRatio(coverWidthPx, coverHeightPx),
      child: Stack(
        fit: StackFit.expand,
        children: <Widget>[
          cover,
          if (state.isUnavailable)
            ClipRRect(
              borderRadius: _topCorners,
              child: ColoredBox(
                color: AppTint.coverScrim.fill!,
                child: Center(
                  child: Text(
                    state.label,
                    style: AppText.badgeText.copyWith(color: AppColors.mist),
                  ),
                ),
              ),
            ),
          if (isBinder)
            const Positioned(
              top: AppSpacing.tight,
              left: AppSpacing.tight,
              child: _BinderMarker(),
            ),
          if (topRightControl != null)
            Positioned(
              top: AppSpacing.tight,
              right: AppSpacing.tight,
              child: topRightControl!,
            ),
        ],
      ),
    );
  }

  /// The photo, its reserved fill, and its absence.
  ///
  /// A cover that has not arrived is the `--muted` token and nothing else, so
  /// the box is already the right size and colour when the bytes land. A cover
  /// that does not EXIST, or fails, is the web's `ListingPhotoEmpty` treatment
  /// instead — never a broken-image glyph, which reads as the client having
  /// failed rather than the listing having no photo (Req 5.2, 5.12).
  Widget _photo() {
    if (imageUrl == null || imageUrl!.isEmpty) {
      return ListingPhotoEmpty(title: title);
    }
    return CachedNetworkImage(
      imageUrl: imageUrl!,
      fit: BoxFit.cover,
      placeholder: (_, _) => const ColoredBox(color: AppColors.muted),
      errorWidget: (_, _, _) => ListingPhotoEmpty(title: title),
    );
  }

  /// A saturation matrix keeping [kept] of the original colour.
  ///
  /// The luminance coefficients are the sRGB ones, so a desaturated cover keeps
  /// the brightness it had rather than darkening as it drains.
  static ColorFilter _desaturate(double kept) {
    const double lumR = 0.2126;
    const double lumG = 0.7152;
    const double lumB = 0.0722;
    final double drained = 1 - kept;
    return ColorFilter.matrix(<double>[
      lumR * drained + kept, lumG * drained, lumB * drained, 0, 0,
      lumR * drained, lumG * drained + kept, lumB * drained, 0, 0,
      lumR * drained, lumG * drained, lumB * drained + kept, 0, 0,
      0, 0, 0, 1, 0,
    ]);
  }
}

/// The binder marker: the `--mist` token on `--obsidian` at 75 percent alpha.
///
/// Says "Binder" and never "shopfront", which is the internal name for the
/// listing kind and not a word a member has ever seen (Req 5.8).
class _BinderMarker extends StatelessWidget {
  const _BinderMarker();

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: AppTint.binderMarker.fill,
        borderRadius: BorderRadius.circular(AppRadius.sm),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: AppSpacing.tight),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          spacing: AppSpacing.tight,
          children: <Widget>[
            const Icon(
              Icons.collections_bookmark_outlined,
              size: AppIconSize.micro,
              color: AppColors.mist,
            ),
            Text('Binder', style: markerStyle),
          ],
        ),
      ),
    );
  }

  /// The `meta` level at medium weight in the `--mist` token (Req 5.7).
  static final TextStyle markerStyle = AppType.meta.copyWith(
    fontWeight: FontWeight.w500,
    color: AppColors.mist,
  );
}

/// A card-shaped absence, ported from `components/listings/ListingPhotoEmpty.tsx`.
///
/// The compact form the mosaic uses: the glyph alone on the `--mist` token, with
/// the listing named for assistive technology only.
///
/// Public because the listing DETAIL gallery draws the same absence (Req 6.11,
/// 5.12). A second treatment for "this listing has no photo" would be the same
/// fact stated two ways, and a broken-image glyph is what one of them would
/// eventually become.
class ListingPhotoEmpty extends StatelessWidget {
  const ListingPhotoEmpty({required this.title, super.key});

  final String title;

  @override
  Widget build(BuildContext context) {
    return ColoredBox(
      color: AppColors.mist,
      child: Center(
        child: Semantics(
          label: 'No photo available for $title',
          child: const Icon(
            Icons.layers_outlined,
            size: AppIconSize.display,
            color: AppColors.mutedForeground,
          ),
        ),
      ),
    );
  }
}
