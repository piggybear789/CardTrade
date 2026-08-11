import 'package:flutter/material.dart';
import 'package:photo_view/photo_view.dart';
import 'package:photo_view/photo_view_gallery.dart';

import 'package:cardtrade/core/image_url.dart';

/// Fullscreen image gallery with pinch-zoom and swipe between images.
///
/// Features:
/// - PhotoViewGallery for smooth horizontal swiping between images
/// - Pinch-to-zoom on each image
/// - Page counter overlay when multiple images
/// - Close button (top-left) with 44x44 touch target
/// - Swipe down to dismiss
/// - Loading indicator while images load
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
      backgroundColor: Colors.black,
      body: GestureDetector(
        onVerticalDragUpdate: (details) {
          _verticalDragOffset += details.delta.dy;
        },
        onVerticalDragEnd: (details) {
          // Dismiss if dragged down more than 100px or with high velocity
          if (_verticalDragOffset > 100 ||
              details.primaryVelocity != null && details.primaryVelocity! > 500) {
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
              backgroundDecoration: const BoxDecoration(color: Colors.black),
              loadingBuilder: (context, event) => const Center(
                child: CircularProgressIndicator(
                  color: Colors.white70,
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

            // ─── Close button (top-left) ───────────────────────────
            Positioned(
              top: MediaQuery.of(context).padding.top + 8,
              left: 12,
              child: Semantics(
                button: true,
                label: 'Close image viewer',
                child: Material(
                  type: MaterialType.circle,
                  color: Colors.black.withValues(alpha: 0.5),
                  child: InkWell(
                    customBorder: const CircleBorder(),
                    onTap: () => Navigator.of(context).pop(),
                    child: const SizedBox(
                      width: 44,
                      height: 44,
                      child: Icon(
                        Icons.close_rounded,
                        color: Colors.white,
                        size: 22,
                      ),
                    ),
                  ),
                ),
              ),
            ),

            // ─── Page counter (top-center) ─────────────────────────
            if (widget.imagePaths.length > 1)
              Positioned(
                top: MediaQuery.of(context).padding.top + 16,
                left: 0,
                right: 0,
                child: Center(
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                    decoration: BoxDecoration(
                      color: Colors.black.withValues(alpha: 0.5),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Text(
                      '${_currentIndex + 1} / ${widget.imagePaths.length}',
                      style: const TextStyle(
                        color: Colors.white,
                        fontSize: 14,
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
