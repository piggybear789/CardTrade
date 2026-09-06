import 'package:flutter/material.dart';

import '../../core/money.dart';
import '../../core/theme.dart';

/// Displays a formatted price from integer minor units.
///
/// [Money.format] stays the ONLY money formatter in the client; this widget
/// chooses a [AppText] money role and nothing else. Each role is one Type_Scale
/// level with tabular, lining figures so digits align down a column, matching
/// the web's `.display-value` treatment.
///
/// Supporting parts — the superseded price and the indicative `From` marker on a
/// binder or bulk listing — are de-emphasised by COLOUR at a scale level, never
/// by scaling a fraction off the price's own size (Subtext_Rule, Req 2.13).
class PriceDisplay extends StatelessWidget {
  const PriceDisplay({
    required this.minorUnits,
    required this.currency,
    this.originalMinorUnits,
    this.showFromPrefix = false,
    this.isStrikethrough = false,
    this.size = PriceSize.medium,
    super.key,
  });

  /// Price in the currency's smallest unit (for example cents for AUD).
  final int minorUnits;

  /// ISO 4217 currency code (for example 'aud', 'jpy').
  final String currency;

  /// If set, displayed as strikethrough above the current price.
  final int? originalMinorUnits;

  /// Whether to prefix the price with 'From' (binder or bulk listings).
  final bool showFromPrefix;

  /// Whether this specific price should render with a line-through.
  final bool isStrikethrough;

  /// Which money role to draw the price with.
  final PriceSize size;

  @override
  Widget build(BuildContext context) {
    final formattedPrice = Money.format(minorUnits, currency);

    final priceStyle = switch (size) {
      PriceSize.small => AppText.priceInline,
      PriceSize.medium => AppText.priceCard,
      PriceSize.large => AppText.priceHero,
    };

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        // The superseded price: same reading level, muted, struck through.
        if (originalMinorUnits != null)
          Text(
            Money.format(originalMinorUnits!, currency),
            style: AppText.supportText.copyWith(
              decoration: TextDecoration.lineThrough,
            ),
          ),
        // A Wrap rather than a Row: at a 2.0 text scale a hero price plus its
        // `From` marker is wider than a phone, and a Row overflows there rather
        // than reflowing, which Req 13.10 forbids. The marker drops onto its own
        // line instead and the figure keeps the full width.
        Wrap(
          spacing: AppSpacing.tight,
          crossAxisAlignment: WrapCrossAlignment.end,
          children: [
            if (showFromPrefix) const Text('From', style: AppText.metaText),
            Text(
              formattedPrice,
              style: isStrikethrough
                  ? priceStyle.copyWith(
                      color: AppColors.mutedForeground,
                      decoration: TextDecoration.lineThrough,
                    )
                  : priceStyle,
            ),
          ],
        ),
      ],
    );
  }
}

/// Money role variants for [PriceDisplay].
enum PriceSize { small, medium, large }
