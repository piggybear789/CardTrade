// The seller region of the listing detail: who the buyer would be contracting
// with, and what the platform can actually vouch for about them.
//
// THE DISCLOSURE IS THE PROVIDER-VERIFIED LEGAL NAME AND NOTHING ELSE. It is
// never anything the seller typed, it is drawn in `--trust` and it is LABELLED IN
// TEXT, because colour alone is not a signal (Req 6.3, 13.11). Where no such name
// exists the row states the display name and the seller's trading history in its
// place, and never an empty or placeholder name row — a blank where a legal name
// belongs reads as a name being withheld (Req 6.4).
//
// The region navigates: to the seller's public profile, or to the viewing
// member's own profile where they own the listing, so its chevron is not a false
// affordance (Req 6.5).
//
// Requirements 6.3, 6.4, 6.5, 13.6, 13.7, 13.11.

import 'package:flutter/material.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/widgets/common/avatar.dart';
import 'package:cardtrade/widgets/common/tap_target.dart';
import 'package:cardtrade/widgets/common/verified_badge.dart';

/// The seller row and, below it, either the identity disclosure or the trading
/// history that stands in for one.
class ListingSeller extends StatelessWidget {
  const ListingSeller({
    required this.displayName,
    required this.avatarUrl,
    required this.identityVerified,
    required this.disclosedName,
    required this.rating,
    required this.ratingCount,
    required this.isOwner,
    required this.onOpenProfile,
    super.key,
  });

  /// The seller's chosen public name, or null while the profile has not loaded.
  final String? displayName;

  /// Resolved avatar URL, or null.
  final String? avatarUrl;

  /// Whether the seller has passed the Identity_Gate, as the server reported it.
  final bool identityVerified;

  /// The provider-verified legal name the server discloses, or null where the
  /// seller has none on file.
  ///
  /// Never derived here and never assembled from parts a member typed: a
  /// disclosure the client composed is not a disclosure.
  final String? disclosedName;

  /// The seller's rating on the 1-to-5 scale, or null where they have none.
  final double? rating;

  /// How many reviews that rating is drawn from.
  final int ratingCount;

  /// Whether the viewing member owns this listing.
  final bool isOwner;

  /// Opens the profile this region points at.
  final VoidCallback onOpenProfile;

  /// Whether a disclosure exists to present.
  bool get hasDisclosure =>
      disclosedName != null && disclosedName!.trim().isNotEmpty;

  /// The seller's trading history in one line, or that they have none yet.
  ///
  /// Presented in place of a legal name rather than beside it: a buy-only member
  /// holds no verified identity by design, and their display name plus their
  /// history is what the marketplace actually knows about them (Req 6.4).
  String get _tradingHistory {
    if (rating == null || ratingCount <= 0) return 'No reviews yet';
    final String reviews = ratingCount == 1 ? '1 review' : '$ratingCount reviews';
    return '${rating!.toStringAsFixed(1)} out of 5 from $reviews';
  }

  @override
  Widget build(BuildContext context) {
    final String name = isOwner ? 'You' : (displayName ?? 'Seller');

    return Semantics(
      button: true,
      label: isOwner
          ? 'View your profile'
          : 'View $name’s profile'
              '${hasDisclosure ? '. Verified name ${disclosedName!.trim()}' : '. $_tradingHistory'}',
      child: TapTarget(
        child: Material(
          type: MaterialType.transparency,
          child: InkWell(
            borderRadius: BorderRadius.circular(AppRadius.md),
            onTap: onOpenProfile,
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: AppSpacing.snug),
              child: ExcludeSemantics(
                child: Row(
                  spacing: AppSpacing.snug,
                  children: <Widget>[
                    Avatar(
                      imageUrl: avatarUrl,
                      displayName: name,
                      size: AvatarSize.sm,
                    ),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        spacing: AppSpacing.tight,
                        children: <Widget>[
                          Row(
                            spacing: AppSpacing.tight,
                            children: <Widget>[
                              Flexible(
                                child: Text(
                                  name,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: AppText.rowName,
                                ),
                              ),
                              if (identityVerified)
                                const VerifiedBadge(
                                  size: VerifiedBadgeSize.small,
                                  tooltip: null,
                                ),
                            ],
                          ),
                          if (hasDisclosure)
                            _Disclosure(name: disclosedName!.trim())
                          else
                            Text(_tradingHistory, style: AppText.metaText),
                        ],
                      ),
                    ),
                    const Icon(
                      Icons.chevron_right_rounded,
                      size: AppIconSize.large,
                      color: AppColors.mutedForeground,
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// The legal name, labelled in words and drawn in `--trust`.
class _Disclosure extends StatelessWidget {
  const _Disclosure({required this.name});

  final String name;

  @override
  Widget build(BuildContext context) {
    return Text.rich(
      TextSpan(
        children: <InlineSpan>[
          // The label carries the meaning; the colour only reinforces it.
          const TextSpan(text: 'Verified name ', style: AppText.metaText),
          TextSpan(
            text: name,
            style: AppText.metaText.copyWith(
              fontWeight: FontWeight.w600,
              color: AppColors.trust,
            ),
          ),
        ],
      ),
    );
  }
}
