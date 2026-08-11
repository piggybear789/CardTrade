import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../../core/theme.dart';
import 'verified_badge.dart';

/// A circular user avatar with network image support and initials fallback.
///
/// Sizes: [AvatarSize.xs] (24), [AvatarSize.sm] (32), [AvatarSize.md] (40),
/// [AvatarSize.lg] (56), [AvatarSize.xl] (80).
///
/// When [imageUrl] is null or fails to load, displays initials derived from
/// [displayName] on a deterministic colored background.
class Avatar extends StatelessWidget {
  const Avatar({
    this.imageUrl,
    this.displayName,
    this.size = AvatarSize.md,
    this.showVerifiedBadge = false,
    super.key,
  });

  /// URL to the profile image. Falls back to initials if null or on error.
  final String? imageUrl;

  /// User's display name used to derive initials and background color.
  final String? displayName;

  /// Avatar diameter.
  final AvatarSize size;

  /// Whether to overlay a verified badge in the bottom-right corner.
  final bool showVerifiedBadge;

  /// Radius in logical pixels for each size variant.
  double get _diameter => switch (size) {
        AvatarSize.xs => 24,
        AvatarSize.sm => 32,
        AvatarSize.md => 40,
        AvatarSize.lg => 56,
        AvatarSize.xl => 80,
      };

  /// Extracts up to two initials from a display name.
  String _initials(String? name) {
    if (name == null || name.trim().isEmpty) return '?';
    final parts = name.trim().split(RegExp(r'\s+'));
    if (parts.length == 1) return parts[0][0].toUpperCase();
    return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
  }

  /// Deterministic background color from the display name.
  Color _backgroundColor(String? name) {
    const palette = [
      Color(0xFF6366f1), // Indigo
      Color(0xFF8b5cf6), // Violet
      Color(0xFF06b6d4), // Cyan
      Color(0xFF14b8a6), // Teal
      Color(0xFFf59e0b), // Amber
      Color(0xFFef4444), // Red
      Color(0xFF3b82f6), // Blue
      Color(0xFF10b981), // Emerald
    ];
    if (name == null || name.isEmpty) return palette[0];
    final hash = name.codeUnits.fold<int>(0, (sum, c) => sum + c);
    return palette[hash % palette.length];
  }

  @override
  Widget build(BuildContext context) {
    final diameter = _diameter;
    final fontSize = (diameter * 0.4).clamp(10.0, double.infinity);

    Widget avatar;

    if (imageUrl != null && imageUrl!.isNotEmpty) {
      avatar = CachedNetworkImage(
        imageUrl: imageUrl!,
        imageBuilder: (context, imageProvider) => Container(
          width: diameter,
          height: diameter,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            image: DecorationImage(image: imageProvider, fit: BoxFit.cover),
          ),
        ),
        placeholder: (context, url) => _initialsAvatar(diameter, fontSize),
        errorWidget: (context, url, error) =>
            _initialsAvatar(diameter, fontSize),
      );
    } else {
      avatar = _initialsAvatar(diameter, fontSize);
    }

    if (!showVerifiedBadge) return avatar;

    final badgeSize = diameter <= 32
        ? VerifiedBadgeSize.small
        : VerifiedBadgeSize.normal;

    return SizedBox(
      width: diameter + 4,
      height: diameter + 4,
      child: Stack(
        children: [
          Positioned.fill(
            child: Align(alignment: Alignment.topLeft, child: avatar),
          ),
          Positioned(
            right: 0,
            bottom: 0,
            child: Container(
              padding: const EdgeInsets.all(1),
              decoration: const BoxDecoration(
                color: AppTheme.surface,
                shape: BoxShape.circle,
              ),
              child: VerifiedBadge(size: badgeSize, tooltip: null),
            ),
          ),
        ],
      ),
    );
  }

  Widget _initialsAvatar(double diameter, double fontSize) {
    return Container(
      width: diameter,
      height: diameter,
      decoration: BoxDecoration(
        color: _backgroundColor(displayName),
        shape: BoxShape.circle,
      ),
      alignment: Alignment.center,
      child: Text(
        _initials(displayName),
        style: TextStyle(
          color: Colors.white,
          fontSize: fontSize,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

/// Avatar size variants.
enum AvatarSize { xs, sm, md, lg, xl }
