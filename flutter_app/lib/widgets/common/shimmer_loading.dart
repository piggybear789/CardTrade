import 'package:flutter/material.dart';
import 'package:shimmer/shimmer.dart';

import '../../core/theme.dart';

/// A configurable shimmer placeholder box for loading states.
///
/// Wrap multiple [ShimmerBox] widgets in a [Shimmer.fromColors] parent,
/// or use the pre-built [ShimmerListingCard] and [ShimmerListTile] composites.
class ShimmerBox extends StatelessWidget {
  const ShimmerBox({
    required this.width,
    required this.height,
    this.borderRadius = AppTheme.radiusMd,
    super.key,
  });

  /// Width of the placeholder. Use [double.infinity] for full-width.
  final double width;

  /// Height of the placeholder.
  final double height;

  /// Corner radius of the placeholder shape.
  final double borderRadius;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(borderRadius),
      ),
    );
  }
}

/// A shimmer placeholder matching the listing card layout.
///
/// Use in grids and lists where listing cards would normally appear.
class ShimmerListingCard extends StatelessWidget {
  const ShimmerListingCard({super.key});

  @override
  Widget build(BuildContext context) {
    return Shimmer.fromColors(
      baseColor: AppTheme.border,
      highlightColor: AppTheme.surfaceVariant,
      child: Container(
        decoration: BoxDecoration(
          color: AppTheme.surface,
          borderRadius: BorderRadius.circular(AppTheme.radiusLg),
          border: Border.all(color: AppTheme.border),
        ),
        child: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Image placeholder
            ShimmerBox(
              width: double.infinity,
              height: 140,
              borderRadius: AppTheme.radiusLg,
            ),
            Padding(
              padding: EdgeInsets.all(AppTheme.spacingMd),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ShimmerBox(width: double.infinity, height: 14),
                  SizedBox(height: AppTheme.spacingSm),
                  ShimmerBox(width: 80, height: 12),
                  SizedBox(height: AppTheme.spacingMd),
                  ShimmerBox(width: 60, height: 18),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// A shimmer placeholder matching a standard list tile layout.
///
/// Use in lists where data rows would normally appear.
class ShimmerListTile extends StatelessWidget {
  const ShimmerListTile({super.key});

  @override
  Widget build(BuildContext context) {
    return Shimmer.fromColors(
      baseColor: AppTheme.border,
      highlightColor: AppTheme.surfaceVariant,
      child: const Padding(
        padding: EdgeInsets.symmetric(
          horizontal: AppTheme.spacingLg,
          vertical: AppTheme.spacingMd,
        ),
        child: Row(
          children: [
            ShimmerBox(
              width: 40,
              height: 40,
              borderRadius: AppTheme.radiusFull,
            ),
            SizedBox(width: AppTheme.spacingMd),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ShimmerBox(width: double.infinity, height: 14),
                  SizedBox(height: AppTheme.spacingSm),
                  ShimmerBox(width: 120, height: 12),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
