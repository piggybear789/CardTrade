import 'package:flutter/material.dart';

import '../../core/money.dart';
import '../../core/theme.dart';

/// Displays a formatted price from integer minor units.
///
/// Supports an optional strikethrough for original/was prices and
/// a 'From' prefix for shopfront (binder) listings where the price
/// is indicative rather than fixed.
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

  /// Price in the currency's smallest unit (e.g. cents for AUD).
  final int minorUnits;

  /// ISO 4217 currency code (e.g. 'aud', 'jpy').
  final String currency;

  /// If set, displayed as strikethrough above the current price.
  final int? originalMinorUnits;

  /// Whether to prefix the price with 'From' (shopfront listings).
  final bool showFromPrefix;

  /// Whether this specific price should render with a line-through.
  final bool isStrikethrough;

  /// Controls the text size.
  final PriceSize size;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final formattedPrice = Money.format(minorUnits, currency);

    final priceStyle = switch (size) {
      PriceSize.small => AppTheme.priceInline,
      PriceSize.medium => AppTheme.priceCard,
      PriceSize.large => AppTheme.priceHero,
    };

    final fontSize = priceStyle.fontSize!;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        // Original price (strikethrough)
        if (originalMinorUnits != null)
          Text(
            Money.format(originalMinorUnits!, currency),
            style: theme.textTheme.bodySmall?.copyWith(
              decoration: TextDecoration.lineThrough,
              color: AppTheme.muted,
              fontSize: fontSize * 0.7,
            ),
          ),
        // Current price
        Row(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.baseline,
          textBaseline: TextBaseline.alphabetic,
          children: [
            if (showFromPrefix)
              Padding(
                padding: const EdgeInsets.only(right: 4),
                child: Text(
                  'From',
                  style: AppTheme.supportText.copyWith(
                    fontSize: fontSize * 0.65,
                  ),
                ),
              ),
            Text(
              formattedPrice,
              style: isStrikethrough
                  ? priceStyle.copyWith(
                      color: AppTheme.muted,
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

/// Price text size variants.
enum PriceSize { small, medium, large }
