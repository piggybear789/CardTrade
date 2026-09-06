import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:cardtrade/core/extensions.dart';
import 'package:cardtrade/core/result.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/models/item.dart';
import 'package:cardtrade/providers/listings_provider.dart';
import 'package:cardtrade/providers/trades_provider.dart';
import 'package:cardtrade/widgets/common/controls.dart';
import 'package:cardtrade/widgets/common/error_view.dart';
import 'package:cardtrade/widgets/common/loading_indicator.dart';

/// Opens a native trade negotiation by calling the server's openTradeNegotiation
/// action through the mobile API.
///
/// The server evaluates the Identity_Gate, region compatibility, item ownership
/// and availability, shopfront rules from 0081, and resolveTradeSideValues for
/// collateral sizing. This client defers to those guards and surfaces their
/// refusal messages directly.
/// Whether one of the member's OWN listings may be put up as the offering side
/// of a trade.
///
/// This is the client-side affordance only — `openTradeNegotiation` and
/// `open_trade_negotiation` re-evaluate ownership, availability and the 0081
/// shopfront rule regardless, and their refusal is what decides. It exists so the
/// selector offers the same set the website's own-item picker does
/// (`app/(workspace)/trades/new/page.tsx`: `status = 'AVAILABLE'` and
/// `listing_kind = 'SINGLE'`).
///
/// Two conditions, for two different reasons:
///
/// - **AVAILABLE.** A SINGLE listing is offerable while it is AVAILABLE; RESERVED
///   means a contract already holds it and SOLD means it is gone.
/// - **SINGLE.** A binder may be traded FOR but never offered (0081), because a
///   binder side is valued at whatever is offered AGAINST it — put one on the
///   offering side and both sides inherit from each other with nothing valued,
///   and `requiredBondCents` would then confirm escrow behind a zero side.
///   `closed_at` is deliberately not consulted: it is the only way a binder stops
///   trading, and a binder cannot get this far.
///
/// A hidden item is KEPT, matching the website: an item held privately for a
/// previous invite is still a legitimate thing to put up.
bool canOfferItemInTrade(Item item) =>
    item.status == ItemStatus.available &&
    item.listingKind == ListingKind.single;

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

  /// The item selector's own failure, presented with the selector rather than in
  /// a snack bar (Req 8.5, 8.6).
  String? _selectionError;

  /// The server's refusal. It names no field this form presents — every one of
  /// them is about identity, region or ownership — so it belongs in the
  /// form-level summary above the submit control (Req 8.11), with the selection
  /// and the description still in place.
  String? _formError;

  @override
  void dispose() {
    _descriptionController.dispose();
    super.dispose();
  }

  Future<void> _proposeTrade() async {
    if (_selectedItem == null) {
      setState(() => _selectionError = 'Select one of your items to offer.');
      return;
    }

    setState(() {
      _selectionError = null;
      _formError = null;
      _isSubmitting = true;
    });

    final service = ref.read(tradesServiceProvider);
    final description = _descriptionController.text.trim();

    final result = await service.openNegotiation(
      initiatorItemId: _selectedItem!.id,
      counterpartItemId: widget.itemId!,
      counterpartGoodsDescription: description.isNotEmpty ? description : null,
    );

    if (!mounted) return;
    setState(() => _isSubmitting = false);

    // The refusal codes and their words are unchanged: the server evaluates the
    // Identity_Gate, region compatibility and ownership, and this screen only
    // decides where its answer is drawn.
    switch (result) {
      case Ok():
        context.showSuccess('Trade negotiation opened');
        context.pop();
      case Err(:final error, :final message):
        final String summary = switch (error) {
          'not-verified' =>
            'Complete identity verification before proposing a trade.',
          'region-mismatch' => message ??
              'You and this seller are in different trading regions.',
          _ => message ?? error,
        };
        setState(() => _formError = ErrorView.sanitise(summary));
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
          padding: const EdgeInsets.all(AppSpacing.group),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const ExcludeSemantics(
                child: Icon(
                  Icons.swap_horiz_rounded,
                  size: AppIconSize.display,
                  color: AppColors.irisInk,
                ),
              ),
              const SizedBox(height: AppSpacing.cozy),

              const Text('Propose a trade', style: AppType.subhead),
              const SizedBox(height: AppSpacing.snug),

              const Text(
                'Select one of your items to offer. The server checks identity, '
                'region compatibility, and ownership before opening the negotiation.',
                style: AppText.bodyText,
              ),
              const SizedBox(height: AppSpacing.cozy),

              // Collateral is a card hold, never "escrow" — the platform holds
              // a claim, not funds. See product.md.
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(AppSpacing.cozy),
                decoration: BoxDecoration(
                  color: AppTint.eyebrow.fill,
                  borderRadius: BorderRadius.circular(AppRadius.md),
                  border: Border.all(
                    color: AppTint.eyebrow.edge!,
                    width: AppMetrics.hairline,
                  ),
                ),
                child: Text(
                  'Both traders place trade collateral — a temporary hold on '
                  'your card. No money is taken, and the hold is released when '
                  'you both accept the goods.',
                  style: AppText.bodyText.copyWith(color: AppTint.eyebrow.ink),
                ),
              ),
              const SizedBox(height: AppSpacing.group),

              // Item selection
              const Text('Your item to offer', style: AppText.bodyText),
              const SizedBox(height: AppSpacing.snug),

              myListingsAsync.when(
                loading: () => const LoadingIndicator(),
                error: (e, _) => Text(
                  ErrorView.sanitise(e.toString()),
                  style: AppText.supportText,
                ),
                data: (items) {
                  final available =
                      items.where(canOfferItemInTrade).toList(growable: false);
                  if (available.isEmpty) {
                    return const Text(
                      'You have no available items to trade.',
                      style: AppText.supportText,
                    );
                  }
                  return _ItemSelector(
                    items: available,
                    selected: _selectedItem,
                    onSelected: (item) => setState(() {
                      _selectedItem = item;
                      _selectionError = null;
                    }),
                  );
                },
              ),
              if (_selectionError != null) ...[
                const SizedBox(height: AppSpacing.tight),
                Text(
                  _selectionError!,
                  softWrap: true,
                  style:
                      AppText.bodyText.copyWith(color: AppColors.destructive),
                ),
              ],
              const SizedBox(height: AppSpacing.group),

              // Optional description for binder or bulk trades
              AppTextField(
                controller: _descriptionController,
                label: 'What you want from this listing (optional)',
                helperText:
                    'If trading for specific cards from a binder, describe them here.',
                hint: 'e.g. "PSA 10 Charizard 1st edition"',
                maxLines: 3,
                minLines: 2,
              ),
              const SizedBox(height: AppSpacing.group),

              // Submit
              if (_formError != null) ...[
                AppFormSummary(message: _formError!),
                const SizedBox(height: AppSpacing.cozy),
              ],
              AppButton(
                label: 'Propose trade',
                variant: AppButtonVariant.action,
                fillWidth: true,
                busy: _isSubmitting,
                onPressed: hasTarget ? _proposeTrade : null,
              ),
              const SizedBox(height: AppSpacing.snug),

              if (!hasTarget)
                const Center(
                  child: Text(
                    'Open a listing to propose a trade against it',
                    style: AppText.metaText,
                  ),
                ),

              Center(
                child: AppButton(
                  label: 'Cancel',
                  variant: AppButtonVariant.outline,
                  onPressed: () => context.pop(),
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
      // Two lines of `meta` copy plus a `display` glyph and the tile's own
      // padding, and it must not clip at a 2.0 text scale (Req 13.10).
      height: AppMetrics.minHitArea * 2.5,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: items.length,
        separatorBuilder: (_, _) => const SizedBox(width: AppSpacing.snug),
        itemBuilder: (context, index) {
          final item = items[index];
          final isSelected = selected?.id == item.id;
          // Selection is a fill, an edge AND a check glyph, so which tile is
          // chosen survives greyscale (Req 13.11). The edge keeps its width
          // across states: thickening it on selection would move the tiles
          // beside it every time the choice changed.
          return Semantics(
            button: true,
            selected: isSelected,
            label: item.title,
            child: InkWell(
              onTap: () => onSelected(item),
              borderRadius: BorderRadius.circular(AppRadius.md),
              child: ExcludeSemantics(
                child: Container(
                  width: AppMetrics.minHitArea * 2,
                  padding: const EdgeInsets.all(AppSpacing.snug),
                  decoration: BoxDecoration(
                    color: isSelected ? AppColors.accent : AppColors.card,
                    borderRadius: BorderRadius.circular(AppRadius.md),
                    border: Border.all(
                      color: isSelected
                          ? AppColors.accentForeground
                          : AppColors.border,
                      width: AppMetrics.hairline,
                    ),
                  ),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Icon(
                        isSelected
                            ? Icons.check_circle_rounded
                            : Icons.image_rounded,
                        color: isSelected
                            ? AppColors.accentForeground
                            : AppColors.mutedForeground,
                        size: AppIconSize.display,
                      ),
                      const SizedBox(height: AppSpacing.tight),
                      Flexible(
                        child: Text(
                          item.title,
                          maxLines: 2,
                          textAlign: TextAlign.center,
                          style: AppText.metaText.copyWith(
                            color: isSelected
                                ? AppColors.accentForeground
                                : AppColors.mutedForeground,
                            fontWeight:
                                isSelected ? FontWeight.w600 : FontWeight.w400,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}
