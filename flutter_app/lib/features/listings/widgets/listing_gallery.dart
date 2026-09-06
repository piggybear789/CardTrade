// The listing detail photo gallery: one to ten photos, paged, with one dot per
// photo and a spoken position.
//
// The box is RESERVED before the bytes arrive, exactly as the catalog cover is
// (`listing_cover.dart`), so the regions below it do not walk down the screen as
// each photo lands. `Item` carries no `image_dims`, so the reserved shape is the
// square fallback rather than a guess at the photo's own.
//
// A photo that is absent or fails draws [ListingPhotoEmpty] and never a
// broken-image glyph, which reads as the client having failed rather than the
// listing having no photo.
//
// Requirements 6.1, 6.11, 13.6, 13.7, 13.11.

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import 'package:cardtrade/core/image_url.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/widgets/common/fullscreen_image_viewer.dart';

import 'listing_cover.dart';

/// The paged photo strip at the head of the listing detail scroll.
class ListingGallery extends StatefulWidget {
  const ListingGallery({
    required this.title,
    required this.imagePaths,
    super.key,
  });

  /// The listing's title, spoken in place of a photo that does not exist.
  final String title;

  /// Stored image paths, in the order the seller arranged them.
  final List<String> imagePaths;

  /// The most photos a listing admits (Req 6.11). A longer list is a server the
  /// client cannot correct, so the extras are not drawn rather than trusted.
  static const int maxPhotos = 10;

  /// One page dot, drawn at the `tight` step on both axes.
  static const double dotSize = AppSpacing.tight * 2;

  @override
  State<ListingGallery> createState() => _ListingGalleryState();
}

class _ListingGalleryState extends State<ListingGallery> {
  final PageController _controller = PageController();

  /// Which photo is in view. Held here rather than read from the controller so
  /// the dots and the spoken label agree with one another on every frame.
  int _page = 0;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  List<String> get _photos =>
      widget.imagePaths.take(ListingGallery.maxPhotos).toList();

  @override
  Widget build(BuildContext context) {
    final List<String> photos = _photos;

    if (photos.isEmpty) {
      return AspectRatio(
        aspectRatio: ListingCover.aspectFallback,
        child: ListingPhotoEmpty(title: widget.title),
      );
    }

    return Column(
      children: <Widget>[
        AspectRatio(
          aspectRatio: ListingCover.aspectFallback,
          child: PageView.builder(
            controller: _controller,
            itemCount: photos.length,
            onPageChanged: (int page) => setState(() => _page = page),
            itemBuilder: (BuildContext context, int index) => Semantics(
              button: true,
              label: 'View photo ${index + 1} of ${photos.length} full screen',
              child: GestureDetector(
                onTap: () => FullscreenImageViewer.show(
                  context,
                  photos,
                  initialIndex: index,
                ),
                child: CachedNetworkImage(
                  imageUrl:
                      ImageUrl.itemImage(photos[index], size: ImageSize.large),
                  fit: BoxFit.cover,
                  width: double.infinity,
                  placeholder: (_, _) =>
                      const ColoredBox(color: AppColors.muted),
                  errorWidget: (_, _, _) =>
                      ListingPhotoEmpty(title: widget.title),
                ),
              ),
            ),
          ),
        ),
        // Dots only while there is more than one photo: a single dot states
        // nothing and would still occupy a row (Req 6.11).
        if (photos.length > 1)
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.snug),
            child: _PageDots(count: photos.length, active: _page),
          ),
      ],
    );
  }
}

/// One dot per photo, the active one filled in `--iris-ink`.
///
/// The position is also SPOKEN, because a dot is a shape and a colour and a
/// member who cannot see either still needs to know which photo of how many is
/// in view (Req 6.11, 13.11).
class _PageDots extends StatelessWidget {
  const _PageDots({required this.count, required this.active});

  final int count;
  final int active;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Photo ${active + 1} of $count',
      child: ExcludeSemantics(
        child: Row(
          mainAxisAlignment: MainAxisAlignment.center,
          spacing: AppSpacing.tight,
          children: <Widget>[
            for (int index = 0; index < count; index++)
              DecoratedBox(
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color:
                      index == active ? AppColors.irisInk : AppColors.border,
                ),
                child: const SizedBox.square(
                  dimension: ListingGallery.dotSize,
                ),
              ),
          ],
        ),
      ),
    );
  }
}
