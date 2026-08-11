import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:cardtrade/core/extensions.dart';
import 'package:cardtrade/core/result.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/models/item.dart';
import 'package:cardtrade/providers/listings_provider.dart';
import 'package:cardtrade/providers/trades_provider.dart';
import 'package:cardtrade/widgets/common/loading_indicator.dart';

/// Opens a native trade negotiation by calling the server's openTradeNegotiation
/// action through the mobile API.
///
/// The server evaluates the Identity_Gate, region compatibility, item ownership
/// and availability, shopfront rules from 0081, and resolveTradeSideValues for
/// collateral sizing. This client defers to those guards and surfaces their
/// refusal messages directly.
class ProposeTradeScreen extends ConsumerStatefulWidget {
  const ProposeTradeScreen({
    this.itemId,
    this.counterpartId,
    super.key,
  });

  /// The listing being traded FOR. This is the counterpart's item.
  final String? itemId;

  /// The owner of [itemId]. Not needed for the trade open, kept for the route.
  final String? counterpartId;

  @override
  ConsumerState<ProposeTradeScreen> createState() => _ProposeTradeScreenState();
}

class _ProposeTradeScreenState extends ConsumerState<ProposeTradeScreen> {
  Item? _selectedItem;
  final _descriptionController = TextEditingController();
  bool _isSubmitting = false;

  @override
  void dispose() {
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _proposeTrade() async {
    if (_selectedItem == null) {
      context.showError('Select one of your items to offer.');
      return;
    }

    setState(() => _isSubmitting = true);

    final service = ref.read(tradesServiceProvider);
    final description = _descriptionController.text.trim();

    final result = await service.openNegotiation(
      initiatorItemId: _selectedItem!.id,
      counterpartItemId: widget.itemId!,
      counterpartGoodsDescription: description.isNotEmpty ? description : null,
    );

    if (!mounted) return;
    setState(() => _isSubmitting = false);

    switch (result) {
      case Ok():
        context.showSuccess('Trade negotiation opened');
        context.pop();
      case Err(:final error, :final message):
        if (error == 'not-verified') {
          context.showError(
            'Complete identity verification before proposing a trade.',
          );
        } else if (error == 'region-mismatch') {
          context.showError(
            message ?? 'You and this seller are in different trading regions.',
          );
        } else {
          context.showError(message ?? error);
        }
    }
  }

  @override
  Widget build(BuildContext context) {
    final hasTarget = widget.itemId != null && widget.itemId!.isNotEmpty;
    final myListingsAsync = ref.watch(myListingsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Propose a trade')),
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppTheme.spacingXl),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Icon(
                Icons.swap_horiz_rounded,
                size: 40,
                color: AppTheme.gold,
              ),
              const SizedBox(height: AppTheme.spacingLg),

              Text(
                'Propose a trade',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: AppTheme.spacingMd),

              Text(
                'Select one of your items to offer. The server checks identity, '
                'region compatibility, and ownership before opening the negotiation.',
                style: AppTheme.bodyText,
              ),
              const SizedBox(height: AppTheme.spacingLg),

              // Collateral is a card hold, never "escrow" — the platform holds
              // a claim, not funds. See product.md.
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(AppTheme.spacingLg),
                decoration: BoxDecoration(
                  color: AppTheme.goldLight,
                  borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                  border: Border.all(
                    color: AppTheme.gold.withValues(alpha: 0.3),
                  ),
                ),
                child: Text(
                  'Both traders place trade collateral — a temporary hold on '
                  'your card. No money is taken, and the hold is released when '
                  'you both accept the goods.',
                  style: AppTheme.supportText.copyWith(
                    color: AppTheme.accentDark,
                  ),
                ),
              ),
              const SizedBox(height: AppTheme.spacingXl),

              // Item selection
              Text('Your item to offer', style: AppTheme.sectionLabel),
              const SizedBox(height: AppTheme.spacingMd),

              myListingsAsync.when(
                loading: () => const LoadingIndicator(),
                error: (e, _) => Text('Could not load your items: $e'),
                data: (items) {
                  final available = items
                      .where((item) => item.status == 'AVAILABLE')
                      .toList();
                  if (available.isEmpty) {
                    return const Text(
                      'You have no available items to trade.',
                      style: AppTheme.supportText,
                    );
                  }
                  return _ItemSelector(
                    items: available,
                    selected: _selectedItem,
                    onSelected: (item) => setState(() => _selectedItem = item),
                  );
                },
              ),
              const SizedBox(height: AppTheme.spacingLg),

              // Optional description for binder trades
              Text(
                'What you want from this listing (optional)',
                style: AppTheme.sectionLabel,
              ),
              const SizedBox(height: AppTheme.spacingSm),
              Text(
                'If trading for specific cards from a binder, describe them here.',
                style: AppTheme.metaText,
              ),
              const SizedBox(height: AppTheme.spacingMd),
              TextField(
                controller: _descriptionController,
                maxLines: 3,
                decoration: const InputDecoration(
                  hintText: 'e.g. "PSA 10 Charizard 1st edition"',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: AppTheme.spacingXl),

              // Submit
              SizedBox(
                width: double.infinity,
                child: FilledButton(
                  onPressed: hasTarget && _selectedItem != null && !_isSubmitting
                      ? _proposeTrade
                      : null,
                  child: _isSubmitting
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Propose Trade'),
                ),
              ),
              const SizedBox(height: AppTheme.spacingMd),

              if (!hasTarget)
                Center(
                  child: Text(
                    'Open a listing to propose a trade against it',
                    style: AppTheme.metaText,
                  ),
                ),

              Center(
                child: TextButton(
                  onPressed: () => context.pop(),
                  child: const Text('Cancel'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _ItemSelector extends StatelessWidget {
  const _ItemSelector({
    required this.items,
    this.selected,
    required this.onSelected,
  });

  final List<Item> items;
  final Item? selected;
  final ValueChanged<Item> onSelected;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      height: 100,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: items.length,
        separatorBuilder: (_, __) => const SizedBox(width: AppTheme.spacingMd),
        itemBuilder: (context, index) {
          final item = items[index];
          final isSelected = selected?.id == item.id;
          return GestureDetector(
            onTap: () => onSelected(item),
            child: Container(
              width: 100,
              padding: const EdgeInsets.all(AppTheme.spacingSm),
              decoration: BoxDecoration(
                color: isSelected ? AppTheme.goldLight : AppTheme.surface,
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                border: Border.all(
                  color: isSelected ? AppTheme.gold : AppTheme.border,
                  width: isSelected ? 2 : 1,
                ),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(
                    Icons.image_rounded,
                    color: isSelected ? AppTheme.gold : AppTheme.muted,
                    size: 32,
                  ),
                  const SizedBox(height: 4),
                  Text(
                    item.title,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      fontSize: 11,
                      color: isSelected ? AppTheme.primary : AppTheme.muted,
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
