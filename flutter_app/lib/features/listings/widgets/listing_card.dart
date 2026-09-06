// One tile in the browse mosaic, ported from `CatalogItemCard` in
// `components/listings/ItemCard.tsx`.
//
// The tile is bounded by a one-pixel `--border` edge and not by its shadow: the
// card and the page are both white now, so the edge is the only thing separating
// them (Req 3.10).
//
// WHAT IS DELIBERATELY ABSENT. Location, which the web keeps off the phone tile
// because the tile has three facts' worth of room and where the parcel ships from
// is not one of the three (Req 5.3). And a condition on a binder, which holds
// mixed stock and therefore states no single one.
//
// Requirements 5.1–5.8, 5.11, 5.12, 13.6, 13.7, 13.11, 13.12, 14.5.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:cardtrade/core/image_url.dart';
import 'package:cardtrade/core/money.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/models/item.dart';
import 'package:cardtrade/widgets/common/avatar.dart';
import 'package:cardtrade/widgets/common/verified_badge.dart';

import 'listing_cover.dart';
import 'watch_control.dart';

/// A browse tile: cover, title, category and condition, price, seller.
class ListingCard extends ConsumerStatefulWidget {
  const ListingCard({
    required this.item,
    this.showWatchControl = true,
    super.key,
  });

  final ItemSummary item;

  /// Whether the watchlist control sits on the cover. The web hides it for a
  /// listing's own owner and for a signed-out reader.
  final bool showWatchControl;

  @override
  ConsumerState<ListingCard> createState() => _ListingCardState();
}

class _ListingCardState extends ConsumerState<ListingCard>
    with SingleTickerProviderStateMixin {
  /// The web's `active:scale-[0.97]` press feedback.
  static const double _pressedScale = 0.97;
  static const Duration _pressDuration = Duration(milliseconds: 100);

  late final AnimationController _scaleController = AnimationController(
    vsync: this,
    duration: _pressDuration,
  );

  late final Animation<double> _scale = Tween<double>(
    begin: 1.0,
    end: _pressedScale,
  ).animate(CurvedAnimation(parent: _scaleController, curve: Curves.easeInOut));

  @override
  void dispose() {
    _scaleController.dispose();
    super.dispose();
  }

  /// Req 13.12: under reduce-motion the end state is applied rather than
  /// animated to, which is the transition collapsing to zero and not the state
  /// change being dropped.
  void _press(bool down) {
    if (MediaQuery.disableAnimationsOf(context)) {
      _scaleController.value = down ? 1 : 0;
      return;
    }
    if (down) {
      _scaleController.forward();
    } else {
      _scaleController.reverse();
    }
  }

  /// Which of the three unavailable states scrims this tile.
  ///
  /// Reads only facts the server already reported. A binder is never RESERVED
  /// and never SOLD — it holds nothing — so it can only be CLOSED (Req 5.11).
  ListingCoverState get _coverState {
    final ItemSummary item = widget.item;
    if (item.listingKind == ListingKind.shopfront) {
      return item.closedAt == null
          ? ListingCoverState.open
          : ListingCoverState.closed;
    }
    return switch (item.status) {
      ItemStatus.sold => ListingCoverState.sold,
      ItemStatus.reserved => ListingCoverState.reserved,
      ItemStatus.available => ListingCoverState.open,
    };
  }

  /// Everything the tile says, in one sentence, for a reader who cannot see it.
  ///
  /// A binder's line states that NOTHING IS HELD, here as well as on the tile,
  /// because on every other listing opening a contract reserves the goods and
  /// leaving that implicit is the difference between a disappointed buyer and a
  /// misled one (Req 5.7).
  String get _spokenLabel {
    final ItemSummary item = widget.item;
    final bool isBinder = item.listingKind == ListingKind.shopfront;
    final String price = Money.format(item.fmvCents, item.currency);
    final List<String> parts = <String>[
      item.title,
      isBinder ? 'Binder or bulk listing, from $price' : price,
      if (isBinder)
        'Nothing is held until you and the seller agree terms'
      else if (item.condition.isNotEmpty)
        item.condition,
      if (_coverState.isUnavailable) _coverState.spokenLabel,
    ];
    return parts.join('. ');
  }

  @override
  Widget build(BuildContext context) {
    final ItemSummary item = widget.item;
    final bool isBinder = item.listingKind == ListingKind.shopfront;
    final ListingCoverState state = _coverState;

    final Widget tile = DecoratedBox(
      decoration: BoxDecoration(
        color: AppColors.card,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: AppColors.border, width: AppMetrics.hairline),
        boxShadow: AppElevation.market,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          ListingCoverBox(
            title: item.title,
            imageUrl: item.imagePaths.isEmpty
                ? null
                : ImageUrl.itemImage(item.imagePaths.first,
                    size: ImageSize.small),
            state: state,
            coverWidthPx: item.coverWidthPx,
            coverHeightPx: item.coverHeightPx,
            isBinder: isBinder,
            topRightControl:
                widget.showWatchControl ? WatchControl(itemId: item.id) : null,
          ),
          Padding(
            padding: const EdgeInsets.all(AppSpacing.snug),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              spacing: AppSpacing.tight,
              children: <Widget>[
                Text(
                  item.title,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.cardTitle,
                ),
                _CategoryAndCondition(
                  category: item.category,
                  // A binder holds mixed stock, so it states no condition.
                  condition: isBinder ? null : item.condition,
                ),
                _CardPrice(
                  minorUnits: item.fmvCents,
                  currency: item.currency,
                  indicative: isBinder,
                ),
                _SellerRow(item: item),
              ],
            ),
          ),
        ],
      ),
    );

    return Semantics(
      button: true,
      label: _spokenLabel,
      child: AnimatedBuilder(
        animation: _scale,
        builder: (context, child) =>
            Transform.scale(scale: _scale.value, child: child),
        child: GestureDetector(
          onTapDown: (_) => _press(true),
          onTapUp: (_) {
            _press(false);
            context.push('/listings/${widget.item.id}');
          },
          onTapCancel: () => _press(false),
          // The whole tile is drawn at 70 percent while it is unavailable, as
          // the web's `opacity-70` does (Req 5.11).
          child: state.isUnavailable
              ? Opacity(opacity: 0.7, child: tile)
              : tile,
        ),
      ),
    );
  }
}

/// Game and condition as plain muted reading text with a hairline between them.
///
/// Both at the `body` level and de-emphasised by COLOUR, never by dropping a
/// step (Subtext_Rule, Req 5.3, 2.13).
class _CategoryAndCondition extends StatelessWidget {
  const _CategoryAndCondition({required this.category, this.condition});

  final String category;
  final String? condition;

  /// Height of the hairline between the two facts, the web's `h-3`.
  static const double _dividerHeight = 12;

  @override
  Widget build(BuildContext context) {
    final String? stated =
        (condition == null || condition!.isEmpty) ? null : condition;

    // A Wrap rather than a Row: at a 2.0 text scale the game and the condition
    // together are wider than a mosaic column, and a Row overflows there. These
    // two facts are READING TEXT, so Req 13.10 says they reflow onto another line
    // — unlike the title, the price and the seller's name, which the web clamps
    // on purpose.
    return Wrap(
      spacing: AppSpacing.tight,
      runSpacing: AppSpacing.tight,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: <Widget>[
        Text(category, style: AppText.supportText),
        if (stated != null) ...<Widget>[
          const SizedBox(
            width: AppMetrics.hairline,
            height: _dividerHeight,
            child: ColoredBox(color: AppColors.border),
          ),
          Text(stated, style: AppText.supportText),
        ],
      ],
    );
  }
}

/// The card price: symbol at `body`, the digits that decide the purchase at
/// `head`, the minor units at `body`, all bold in `--iris-ink` with tabular,
/// lining figures (Req 5.3, 5.4).
///
/// Every part is one Type_Scale level of the `priceCard` role, so nothing here
/// introduces a size — it selects between two that already exist.
class _CardPrice extends StatelessWidget {
  const _CardPrice({
    required this.minorUnits,
    required this.currency,
    required this.indicative,
  });

  final int minorUnits;
  final String currency;

  /// A binder's price is an indicative "from", not an asking price.
  final bool indicative;

  /// Splits a FORMATTED amount into symbol, major units and minor units.
  ///
  /// Operates on the formatted output rather than the raw minor units because
  /// both the symbol and the decimal separator are locale-dependent: `Money`
  /// has already decided them and re-deciding here would drift from it. The same
  /// regex the web's `splitMoney` uses. Nothing in it is a currency symbol or a
  /// minor-unit divisor — `Money.format` remains the only money formatter in the
  /// client (Req 14.5).
  static ({String symbol, String major, String minor}) split(
      String formatted) {
    final RegExpMatch? match =
        RegExp(r'^(\D*)(.*?)([.,]\d{2})?$').firstMatch(formatted);
    if (match == null) {
      return (symbol: '', major: formatted, minor: '');
    }
    return (
      symbol: match.group(1) ?? '',
      major: match.group(2) ?? '',
      minor: match.group(3) ?? '',
    );
  }

  /// The `priceCard` role stepped down to the `body` level for the parts that
  /// recede. Weight, colour and figure treatment come from the role.
  static TextStyle get _atBody => AppText.priceCard.copyWith(
        fontSize: AppType.body.fontSize,
        height: AppType.body.height,
        letterSpacing: AppType.body.letterSpacing,
      );

  @override
  Widget build(BuildContext context) {
    final parts = split(Money.format(minorUnits, currency));

    return Text.rich(
      TextSpan(
        children: <InlineSpan>[
          if (indicative)
            TextSpan(
              text: 'From ',
              style: AppText.metaText.copyWith(fontWeight: FontWeight.w600),
            ),
          TextSpan(text: parts.symbol, style: _atBody),
          TextSpan(text: parts.major, style: AppText.priceCard),
          if (parts.minor.isNotEmpty)
            TextSpan(text: parts.minor, style: _atBody),
        ],
      ),
      maxLines: 1,
    );
  }
}

/// The seller line: a small avatar, the display name, and the identity marker.
class _SellerRow extends StatelessWidget {
  const _SellerRow({required this.item});

  final ItemSummary item;

  @override
  Widget build(BuildContext context) {
    return Row(
      spacing: AppSpacing.tight,
      children: <Widget>[
        Avatar(
          imageUrl: item.ownerAvatarPath == null
              ? null
              : ImageUrl.avatar(item.ownerAvatarPath),
          displayName: item.ownerDisplayName,
          size: AvatarSize.xs,
        ),
        Flexible(
          child: Text(
            item.ownerDisplayName ?? 'Seller',
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: AppText.supportText,
          ),
        ),
        if (item.sellerIdentityVerified)
          const VerifiedBadge(size: VerifiedBadgeSize.small),
      ],
    );
  }
}
