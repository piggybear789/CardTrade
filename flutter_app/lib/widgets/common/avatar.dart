import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../../core/theme.dart';
import 'verified_badge.dart';

/// A circular member avatar with network image support and an initials fallback.
///
/// Ported from the web `components/ui/avatar.tsx`, whose five sizes are
/// `size-6`, `size-8`, `size-10`, `size-14` and `size-20` — 24, 32, 40, 56 and
/// 80 logical pixels.
///
/// THE FALLBACK IS THE NORMAL RENDERING, not a degraded one: avatars arrived
/// late and most members will never set one. The web draws that fallback on the
/// `--muted` token with a `--border` edge and `--muted-foreground` semibold
/// uppercase initials, and deliberately does NOT tint it per member. The eight
/// hand-picked hex backgrounds this widget carried before were the only place in
/// the client that invented a colour with no web counterpart (Req 1.7).
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

  /// User's display name used to derive initials.
  final String? displayName;

  /// Avatar diameter.
  final AvatarSize size;

  /// Whether to overlay a verified badge in the bottom-right corner.
  final bool showVerifiedBadge;

  /// Extracts initials the way the web's `initialsFor` does: the first letter of
  /// the first and last whitespace-separated words, punctuation and emoji
  /// stripped, `?` where nothing alphanumeric survives.
  static String initialsFor(String? name) {
    final words = (name ?? '')
        .trim()
        .split(RegExp(r'\s+'))
        .map((word) => word.replaceAll(RegExp(r'[^\p{L}\p{N}]', unicode: true), ''))
        .where((word) => word.isNotEmpty)
        .toList();
    if (words.isEmpty) return '?';
    final first = words.first[0];
    final last = words.length > 1 ? words.last[0] : '';
    return '$first$last'.toUpperCase();
  }

  @override
  Widget build(BuildContext context) {
    final diameter = size.diameter;

    Widget avatar;
    if (imageUrl != null && imageUrl!.isNotEmpty) {
      avatar = CachedNetworkImage(
        imageUrl: imageUrl!,
        imageBuilder: (context, imageProvider) => Container(
          width: diameter,
          height: diameter,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            border: Border.all(color: AppColors.border, width: AppMetrics.hairline),
            image: DecorationImage(image: imageProvider, fit: BoxFit.cover),
          ),
        ),
        // Both states are the initials rather than a spinner or a blank circle:
        // a flash of empty reads as the client having failed.
        placeholder: (context, url) => _initialsAvatar(diameter),
        errorWidget: (context, url, error) => _initialsAvatar(diameter),
      );
    } else {
      avatar = _initialsAvatar(diameter);
    }

    if (!showVerifiedBadge) return avatar;

    final badgeSize = diameter <= AvatarSize.sm.diameter
        ? VerifiedBadgeSize.small
        : VerifiedBadgeSize.normal;

    return SizedBox(
      width: diameter + AppSpacing.tight,
      height: diameter + AppSpacing.tight,
      child: Stack(
        children: [
          Positioned.fill(
            child: Align(alignment: Alignment.topLeft, child: avatar),
          ),
          Positioned(
            right: 0,
            bottom: 0,
            child: Container(
              padding: const EdgeInsets.all(AppMetrics.hairline),
              decoration: const BoxDecoration(
                color: AppColors.card,
                shape: BoxShape.circle,
              ),
              child: VerifiedBadge(size: badgeSize, tooltip: null),
            ),
          ),
        ],
      ),
    );
  }

  Widget _initialsAvatar(double diameter) {
    return Container(
      width: diameter,
      height: diameter,
      decoration: BoxDecoration(
        color: AppColors.muted,
        shape: BoxShape.circle,
        border: Border.all(color: AppColors.border, width: AppMetrics.hairline),
      ),
      alignment: Alignment.center,
      child: Text(
        initialsFor(displayName),
        style: size.initialsStyle,
      ),
    );
  }
}

/// Avatar size variants, each pairing the web diameter with the type level the
/// web pairs it with (`text-meta`, `text-body`, `text-lead`, `text-subhead`).
enum AvatarSize {
  xs(24, AppType.meta),
  sm(32, AppType.meta),
  md(40, AppType.body),
  lg(56, AppType.lead),
  xl(80, AppType.subhead);

  const AvatarSize(this.diameter, this._level);

  /// Visible diameter in logical pixels.
  final double diameter;

  final TextStyle _level;

  /// The initials treatment: the size's own level, semibold, muted foreground.
  TextStyle get initialsStyle => _level.copyWith(
        fontWeight: FontWeight.w600,
        color: AppColors.mutedForeground,
      );
}
