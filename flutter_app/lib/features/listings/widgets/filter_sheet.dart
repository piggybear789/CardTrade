import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:cardtrade/core/constants.dart';
import 'package:cardtrade/core/money.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/providers/listings_provider.dart';
import 'package:cardtrade/services/listings_service.dart';

/// Bottom sheet for catalog filters.
///
/// Condition chips, a price range slider, and sort options. Uses
/// [catalogFilterProvider] to read/write filter state.
class FilterSheet extends ConsumerStatefulWidget {
  const FilterSheet({super.key});

  @override
  ConsumerState<FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends ConsumerState<FilterSheet> {
  String? _selectedCondition;
  RangeValues _priceRange = const RangeValues(0, 10000);
  ListingSortOrder _sortOrder = ListingSortOrder.newest;

  static const double _maxPriceCents = 1000000; // $10,000

  @override
  void initState() {
    super.initState();
    final filter = ref.read(catalogFilterProvider);
    _selectedCondition = filter.condition;
    _sortOrder = filter.sort;
  }

  void _reset() {
    setState(() {
      _selectedCondition = null;
      _priceRange = const RangeValues(0, _maxPriceCents);
      _sortOrder = ListingSortOrder.newest;
    });
  }

  void _apply() {
    final current = ref.read(catalogFilterProvider);
    ref.read(catalogFilterProvider.notifier).update((_) => CatalogFilter(
          category: null,
          condition: _selectedCondition,
          regionCode: current.regionCode,
          searchQuery: current.searchQuery,
          sort: _sortOrder,
        ));
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return DraggableScrollableSheet(
      initialChildSize: 0.75,
      maxChildSize: 0.9,
      minChildSize: 0.5,
      expand: false,
      builder: (context, scrollController) {
        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppTheme.spacingLg),
          child: ListView(
            controller: scrollController,
            children: [
              const SizedBox(height: AppTheme.spacingMd),

              // ─── Header ──────────────────────────────────────────
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('Filters', style: theme.textTheme.headlineMedium),
                  TextButton(
                    onPressed: _reset,
                    child: const Text('Reset'),
                  ),
                ],
              ),
              const SizedBox(height: AppTheme.spacingXl),

              // ─── Condition ───────────────────────────────────────
              Text('Condition', style: theme.textTheme.labelLarge),
              const SizedBox(height: AppTheme.spacingSm),
              Wrap(
                spacing: AppTheme.spacingSm,
                runSpacing: AppTheme.spacingSm,
                children: AppConstants.conditions.map((cond) {
                  final selected = _selectedCondition == cond;
                  return FilterChip(
                    label: Text(cond),
                    selected: selected,
                    onSelected: (val) {
                      setState(() {
                        _selectedCondition = val ? cond : null;
                      });
                    },
                  );
                }).toList(),
              ),
              const SizedBox(height: AppTheme.spacingXl),

              // ─── Price Range ─────────────────────────────────────
              Text('Price range', style: theme.textTheme.labelLarge),
              const SizedBox(height: AppTheme.spacingSm),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    Money.format(_priceRange.start.round(), 'aud'),
                    style: theme.textTheme.bodySmall,
                  ),
                  Text(
                    _priceRange.end >= _maxPriceCents
                        ? '${Money.format(_maxPriceCents.round(), 'aud')}+'
                        : Money.format(_priceRange.end.round(), 'aud'),
                    style: theme.textTheme.bodySmall,
                  ),
                ],
              ),
              RangeSlider(
                values: _priceRange,
                min: 0,
                max: _maxPriceCents,
                divisions: 100,
                labels: RangeLabels(
                  Money.format(_priceRange.start.round(), 'aud'),
                  Money.format(_priceRange.end.round(), 'aud'),
                ),
                onChanged: (values) {
                  setState(() => _priceRange = values);
                },
              ),
              const SizedBox(height: AppTheme.spacingXl),

              // ─── Sort ────────────────────────────────────────────
              Text('Sort by', style: theme.textTheme.labelLarge),
              const SizedBox(height: AppTheme.spacingSm),
              ...ListingSortOrder.values.map((sort) {
                return RadioListTile<ListingSortOrder>(
                  value: sort,
                  groupValue: _sortOrder,
                  onChanged: (val) {
                    if (val != null) setState(() => _sortOrder = val);
                  },
                  title: Text(
                    _sortLabel(sort),
                    style: theme.textTheme.bodyMedium,
                  ),
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                );
              }),
              const SizedBox(height: AppTheme.spacingXl),

              // ─── Actions ─────────────────────────────────────────
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      onPressed: () => Navigator.of(context).pop(),
                      child: const Text('Cancel'),
                    ),
                  ),
                  const SizedBox(width: AppTheme.spacingMd),
                  Expanded(
                    child: FilledButton(
                      onPressed: _apply,
                      child: const Text('Apply'),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppTheme.spacingXl),
            ],
          ),
        );
      },
    );
  }

  String _sortLabel(ListingSortOrder sort) {
    return switch (sort) {
      ListingSortOrder.newest => 'Newest first',
      ListingSortOrder.priceLowHigh => 'Price: low to high',
      ListingSortOrder.priceHighLow => 'Price: high to low',
    };
  }
}
