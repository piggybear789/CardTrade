// The catalog filter surface.
//
// IT PRESENTS EXACTLY THE DIMENSIONS THE CLIENT APPLIES, and no more. Free-text
// search lives on the catalog screen itself; category, condition, sort order and
// region live here. Price bounds, include-sold, pagination, multi-select category,
// multi-select condition and the rating sort option are ABSENT rather than present
// and inert — they belong to `.kiro/specs/mobile-parity/` (Req 5.9).
//
// The price-range slider this sheet used to draw was read by nothing on apply:
// `_apply` never carried it into `CatalogFilter`, `CatalogFilter` has no price
// bounds, and `getCatalog` takes none. A control that changes what a member sees
// and nothing about what they get is worse than an absent one, so it is removed
// rather than restyled.
//
// AND THE SHEET NO LONGER CLEARS WHAT IT DOES NOT OWN. `_apply` used to write
// `category: null` unconditionally, so opening the sheet and pressing Apply
// silently discarded a category the member had chosen elsewhere. Every dimension
// this sheet does not present is carried through untouched (Req 5.9).
//
// Requirements 5.9, 5.13, 8.8, 13.6, 13.7.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:cardtrade/core/constants.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/models/region.dart';
import 'package:cardtrade/providers/listings_provider.dart';
import 'package:cardtrade/providers/region_provider.dart';
import 'package:cardtrade/services/listings_service.dart';
import 'package:cardtrade/widgets/common/controls.dart';

/// Bottom sheet for the catalog's category, condition, sort and region filters.
class FilterSheet extends ConsumerStatefulWidget {
  const FilterSheet({super.key});

  @override
  ConsumerState<FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends ConsumerState<FilterSheet> {
  String? _category;
  String? _condition;
  String? _regionCode;
  ListingSortOrder _sort = ListingSortOrder.newest;

  @override
  void initState() {
    super.initState();
    final filter = ref.read(catalogFilterProvider);
    _category = filter.category;
    _condition = filter.condition;
    _regionCode = filter.regionCode;
    _sort = filter.sort;
  }

  void _reset() {
    setState(() {
      _category = null;
      _condition = null;
      _regionCode = null;
      _sort = ListingSortOrder.newest;
    });
  }

  void _apply() {
    final CatalogFilter current = ref.read(catalogFilterProvider);
    ref.read(catalogFilterProvider.notifier).update(
          (_) => CatalogFilter(
            category: _category,
            condition: _condition,
            regionCode: _regionCode,
            // Search is the catalog screen's control, not this sheet's, so it is
            // carried through rather than reset.
            searchQuery: current.searchQuery,
            sort: _sort,
          ),
        );
    Navigator.of(context).pop();
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<Region>> regions = ref.watch(regionsProvider);

    return DraggableScrollableSheet(
      initialChildSize: 0.75,
      maxChildSize: 0.9,
      minChildSize: 0.5,
      expand: false,
      builder: (context, scrollController) {
        return Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.group),
          child: ListView(
            controller: scrollController,
            children: <Widget>[
              const SizedBox(height: AppSpacing.snug),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: <Widget>[
                  const Text('Filters', style: AppType.subhead),
                  AppButton(
                    label: 'Reset',
                    variant: AppButtonVariant.outline,
                    onPressed: _reset,
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.group),

              _FilterGroup(
                label: 'Game',
                child: _ChoiceChips(
                  options: AppConstants.games,
                  selected: _category,
                  onSelected: (value) => setState(() => _category = value),
                ),
              ),

              _FilterGroup(
                label: 'Condition',
                child: _ChoiceChips(
                  options: AppConstants.conditions,
                  selected: _condition,
                  onSelected: (value) => setState(() => _condition = value),
                ),
              ),

              _FilterGroup(
                label: 'Region',
                child: regions.when(
                  loading: () => const Text(
                    'Loading regions',
                    style: AppText.supportText,
                  ),
                  error: (_, _) => const Text(
                    'Regions could not be loaded. Every region is shown.',
                    style: AppText.supportText,
                  ),
                  data: (list) => _ChoiceChips(
                    options: <String>[for (final r in list) r.code],
                    labelFor: (code) => _regionLabel(list, code),
                    selected: _regionCode,
                    onSelected: (value) => setState(() => _regionCode = value),
                  ),
                ),
              ),

              // ONE sort order at a time, so a radio group and not chips. The
              // group ancestor owns the value, which is what replaced the
              // per-tile `groupValue`/`onChanged` pair those two were deprecated
              // in favour of (Req 5.13).
              _FilterGroup(
                label: 'Sort by',
                child: RadioGroup<ListingSortOrder>(
                  groupValue: _sort,
                  onChanged: (value) {
                    if (value != null) setState(() => _sort = value);
                  },
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: <Widget>[
                      for (final ListingSortOrder sort
                          in ListingSortOrder.values)
                        RadioListTile<ListingSortOrder>(
                          value: sort,
                          title: Text(_sortLabel(sort), style: AppText.bodyText),
                          contentPadding: EdgeInsets.zero,
                          // Not `dense`: the row keeps the reading level its
                          // non-dense form uses, and only its padding tightens
                          // (Compact_Row_Rule, Req 2.14).
                          visualDensity: VisualDensity.standard,
                        ),
                    ],
                  ),
                ),
              ),

              Row(
                spacing: AppSpacing.snug,
                children: <Widget>[
                  Expanded(
                    child: AppButton(
                      label: 'Cancel',
                      variant: AppButtonVariant.outline,
                      fillWidth: true,
                      onPressed: () => Navigator.of(context).pop(),
                    ),
                  ),
                  Expanded(
                    child: AppButton(
                      label: 'Apply',
                      fillWidth: true,
                      onPressed: _apply,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: AppSpacing.group),
            ],
          ),
        );
      },
    );
  }

  static String _regionLabel(List<Region> regions, String code) {
    for (final Region region in regions) {
      if (region.code == code) return region.label;
    }
    return code;
  }

  static String _sortLabel(ListingSortOrder sort) {
    return switch (sort) {
      ListingSortOrder.newest => 'Newest first',
      ListingSortOrder.priceLowHigh => 'Price: low to high',
      ListingSortOrder.priceHighLow => 'Price: high to low',
    };
  }
}

/// One labelled block in the sheet: a section label and its control.
class _FilterGroup extends StatelessWidget {
  const _FilterGroup({required this.label, required this.child});

  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.group),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: AppSpacing.snug,
        children: <Widget>[
          Text(label, style: AppText.sectionLabel),
          child,
        ],
      ),
    );
  }
}

/// A single-select chip row. Choosing the selected option clears it, so a member
/// can drop a dimension without a second control for doing so.
///
/// Single-select and not multi: the client applies one category and one condition
/// per query, and a multi-select chip row that the query flattens to its first
/// entry would be a control that lies (Req 5.9).
class _ChoiceChips extends StatelessWidget {
  const _ChoiceChips({
    required this.options,
    required this.selected,
    required this.onSelected,
    this.labelFor,
  });

  final List<String> options;
  final String? selected;
  final ValueChanged<String?> onSelected;

  /// Presented label for an option whose value is not its own label.
  final String Function(String value)? labelFor;

  @override
  Widget build(BuildContext context) {
    return Wrap(
      spacing: AppSpacing.snug,
      runSpacing: AppSpacing.snug,
      children: <Widget>[
        for (final String option in options)
          FilterChip(
            label: Text(labelFor == null ? option : labelFor!(option)),
            selected: selected == option,
            onSelected: (isSelected) =>
                onSelected(isSelected ? option : null),
          ),
      ],
    );
  }
}
