import 'package:flutter/material.dart';
import 'package:photo_view/photo_view.dart';
import 'package:photo_view/photo_view_gallery.dart';

import 'package:cardtrade/core/image_url.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/widgets/common/controls.dart';

/// Fullscreen image gallery with pinch-zoom and swipe between images.
///
/// The dark surround is `--obsidian` and its ink is `--mist`: the theme's one
/// declared dark region, not `Colors.black` and `Colors.white` (Req 1.9). Its
/// controls are drawn on an obsidian scrim at the same alpha the listing card
/// uses for a cover marker, so the two read as the same product.
///
/// - `PhotoViewGallery` for horizontal swiping between images
/// - Pinch-to-zoom on each image
/// - Page counter overlay when more than one image is present
/// - Close control drawn at 40dp with a 48dp hit area (Req 13.6)
/// - Swipe down to dismiss
class FullscreenImageViewer extends StatefulWidget {
  const FullscreenImageViewer({
    required this.imagePaths,
    this.initialIndex = 0,
    super.key,
  });

  final List<String> imagePaths;
  final int initialIndex;

  /// Convenience: push the viewer as a fullscreen route.
  static void show(BuildContext context, List<String> imagePaths,
      {int initialIndex = 0}) {
    if (imagePaths.isEmpty) return;
    Navigator.of(context).push(
      MaterialPageRoute(
        fullscreenDialog: true,
        builder: (_) => FullscreenImageViewer(
          imagePaths: imagePaths,
          initialIndex: initialIndex,
        ),
      ),
    );
  }

  @override
  State<FullscreenImageViewer> createState() => _FullscreenImageViewerState();
}

class _FullscreenImageViewerState extends State<FullscreenImageViewer> {
  late PageController _pageController;
  late int _currentIndex;

  /// Tracks cumulative vertical drag distance for swipe-to-dismiss.
  double _verticalDragOffset = 0;

  /// Drag distance and fling speed that dismiss the viewer. Gesture thresholds,
  /// not spacing.
  static const double _dismissDragDistance = 100;
  static const double _dismissFlingVelocity = 500;

  @override
  void initState() {
    super.initState();
    _currentIndex = widget.initialIndex;
    _pageController = PageController(initialPage: widget.initialIndex);
  }

  @override
  void dispose() {
    _pageController.dispose();
    super.dispose();
  }

  void _onPageChanged(int index) {
    setState(() => _currentIndex = index);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.obsidian,
      body: GestureDetector(
        onVerticalDragUpdate: (details) {
          _verticalDragOffset += details.delta.dy;
        },
        onVerticalDragEnd: (details) {
          if (_verticalDragOffset > _dismissDragDistance ||
              details.primaryVelocity != null &&
                  details.primaryVelocity! > _dismissFlingVelocity) {
            Navigator.of(context).pop();
          }
          _verticalDragOffset = 0;
        },
        child: Stack(
          children: [
            // ─── Photo gallery ─────────────────────────────────────
            PhotoViewGallery.builder(
              pageController: _pageController,
              itemCount: widget.imagePaths.length,
              onPageChanged: _onPageChanged,
              backgroundDecoration: const BoxDecoration(color: AppColors.obsidian),
              loadingBuilder: (context, event) => const Center(
                child: CircularProgressIndicator(
                  color: AppColors.mist,
                  strokeWidth: 2,
                ),
              ),
              builder: (context, index) {
                final url = ImageUrl.itemImage(
                  widget.imagePaths[index],
                  size: ImageSize.full,
                );
                return PhotoViewGalleryPageOptions(
                  imageProvider: NetworkImage(url),
                  minScale: PhotoViewComputedScale.contained,
                  maxScale: PhotoViewComputedScale.covered * 3,
                  heroAttributes: PhotoViewHeroAttributes(
                    tag: 'image_${widget.imagePaths[index]}',
                  ),
                );
              },
            ),

            // ─── Close control (top-left) ──────────────────────────
            Positioned(
              top: MediaQuery.of(context).padding.top + AppSpacing.snug,
              left: AppSpacing.cozy,
              child: AppIconButton(
                icon: Icons.close_rounded,
                semanticLabel: 'Close image viewer',
                onPressed: () => Navigator.of(context).pop(),
                background: AppTint.binderMarker.fill,
                foreground: AppColors.mist,
                iconSize: AppIconSize.display,
              ),
            ),

            // ─── Page counter (top-centre) ─────────────────────────
            if (widget.imagePaths.length > 1)
              Positioned(
                top: MediaQuery.of(context).padding.top + AppSpacing.group,
                left: 0,
                right: 0,
                child: Center(
                  child: Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: AppSpacing.cozy,
                      vertical: AppSpacing.tight,
                    ),
                    decoration: BoxDecoration(
                      color: AppTint.binderMarker.fill,
                      borderRadius: BorderRadius.circular(AppRadius.full),
                    ),
                    child: Text(
                      '${_currentIndex + 1} / ${widget.imagePaths.length}',
                      style: AppText.metaText.copyWith(
                        color: AppColors.mist,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
