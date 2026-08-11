import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:cardtrade/core/money.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/core/web_handoff.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/models/item.dart';
import 'package:cardtrade/providers/listings_provider.dart';
import 'package:cardtrade/widgets/common/error_view.dart';
import 'package:cardtrade/widgets/common/loading_indicator.dart';

/// Purchase flow screen — initiates a cash sale on an item.
///
/// For shopfront/binder listings: includes a line item editor so the buyer
/// can specify which cards they want. For single listings, shows a simpler
/// confirmation flow.
class PurchaseFlowScreen extends ConsumerStatefulWidget {
  const PurchaseFlowScreen({required this.itemId, super.key});

  final String itemId;

  @override
  ConsumerState<PurchaseFlowScreen> createState() => _PurchaseFlowScreenState();
}

class _PurchaseFlowScreenState extends ConsumerState<PurchaseFlowScreen> {
  HandoverMethod _fulfilmentMethod = HandoverMethod.delivery;
  final _messageController = TextEditingController();

  /// The written request for a binder purchase, and the one price it carries.
  /// Mirrors `RequestDraft` on the web: `{ description, priceDollars }`.
  final _requestController = TextEditingController();
  final _priceController = TextEditingController();

  bool _isSubmitting = false;

  /// What the buyer is offering, in integer cents. Unparseable reads as 0,
  /// matching `requestTotalCents` on the web.
  int get _requestCents => _parseCents(_priceController.text);

  /// Dollars string to integer cents using integer arithmetic only.
  /// `19.99` must be 1999, and `double * 100` gives 1998.
  static int _parseCents(String value) {
    final trimmed = value.trim();
    if (trimmed.isEmpty) return 0;
    final parts = trimmed.split('.');
    final whole = int.tryParse(parts[0]) ?? 0;
    if (parts.length == 1) return whole * 100;
    final fraction = parts[1].padRight(2, '0').substring(0, 2);
    return whole * 100 + (int.tryParse(fraction) ?? 0);
  }

  @override
  void dispose() {
    _messageController.dispose();
    _requestController.dispose();
    _priceController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final itemAsync = ref.watch(itemDetailProvider(widget.itemId));

    return Scaffold(
      appBar: AppBar(title: const Text('Purchase')),
      body: itemAsync.when(
        loading: () => const LoadingIndicator(),
        error: (e, _) => ErrorView(
          message: 'Failed to load item',
          onRetry: () => ref.invalidate(itemDetailProvider(widget.itemId)),
        ),
        data: (item) {
          if (item == null) {
            return const ErrorView(message: 'Item not found');
          }
          return _buildContent(context, item);
        },
      ),
    );
  }

  Widget _buildContent(BuildContext context, Item item) {
    final theme = Theme.of(context);
    final isShopfront = item.isShopfront;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(AppTheme.spacingLg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ─── Item summary card ─────────────────────────────────
          _ItemSummaryCard(item: item),
          const SizedBox(height: AppTheme.spacingXl),

          // ─── Written request for a binder ──────────────────────
          //
          // Free text plus ONE price, mirroring `RequestDraft` in
          // `components/sales/ContractLineItems.tsx`. It becomes a single
          // contract line with quantity 1 and no condition, because the prose
          // already carries both — someone writing "two NM Blastoise" has said
          // it, and a second field to say it again is a second thing that can
          // disagree with the first.
          if (isShopfront) ...[
            Text('What you want', style: theme.textTheme.labelLarge),
            const SizedBox(height: AppTheme.spacingSm),
            TextField(
              controller: _requestController,
              decoration: const InputDecoration(
                hintText:
                    'The three Charizards on page 2, both Blastoise, and any '
                    'NM Pikachu you have.',
              ),
              maxLines: 4,
              minLines: 4,
              maxLength: 1000,
              textCapitalization: TextCapitalization.sentences,
              onChanged: (_) => setState(() {}),
            ),
            Text(
              'Describe the cards in your own words. You can both change this '
              'in the contract before either of you accepts.',
              style: AppTheme.metaText,
            ),
            const SizedBox(height: AppTheme.spacingLg),

            Text('Your offer', style: theme.textTheme.labelLarge),
            const SizedBox(height: AppTheme.spacingSm),
            TextField(
              controller: _priceController,
              decoration: InputDecoration(
                prefixText: '\$ ',
                prefixStyle: AppTheme.priceCard.copyWith(fontSize: 16),
                hintText: '120.00',
              ),
              style: AppTheme.priceCard.copyWith(fontSize: 16),
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              onChanged: (_) => setState(() {}),
            ),
            Text('The price for the lot', style: AppTheme.metaText),
            const SizedBox(height: AppTheme.spacingSm),

            // Nothing is reserved on a binder — say so plainly rather than
            // leaving it implicit. That is the difference between a
            // disappointed buyer and a misled one.
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(AppTheme.spacingMd),
              decoration: BoxDecoration(
                color: AppTheme.warningLight,
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
              ),
              child: Text(
                'Nothing is held. Other buyers may be shopping from this '
                'binder at the same time.',
                style: AppTheme.supportText.copyWith(color: AppTheme.warning),
              ),
            ),
            const SizedBox(height: AppTheme.spacingXl),
          ],

          // ─── Fulfilment method ─────────────────────────────────
          Text('Fulfilment method', style: theme.textTheme.labelLarge),
          const SizedBox(height: AppTheme.spacingSm),
          SizedBox(
            width: double.infinity,
            child: SegmentedButton<HandoverMethod>(
              segments: const [
                ButtonSegment(
                  value: HandoverMethod.inPerson,
                  label: Text('In Person'),
                  icon: Icon(Icons.handshake_outlined),
                ),
                ButtonSegment(
                  value: HandoverMethod.delivery,
                  label: Text('Delivery'),
                  icon: Icon(Icons.local_shipping_outlined),
                ),
              ],
              selected: {_fulfilmentMethod},
              onSelectionChanged: (s) => setState(() => _fulfilmentMethod = s.first),
            ),
          ),
          const SizedBox(height: AppTheme.spacingXl),

          // ─── Price breakdown ───────────────────────────────────
          //
          // On a binder the price IS what the buyer offered — `fmv_cents` is
          // the whole inventory's indicative "from" figure and must never be
          // charged. On a single listing it is the listing price.
          _PricePreview(
            item: item,
            requestCents: isShopfront ? _requestCents : null,
          ),
          const SizedBox(height: AppTheme.spacingXl),

          // ─── Message ───────────────────────────────────────────
          Text('Message to seller (optional)', style: theme.textTheme.labelLarge),
          const SizedBox(height: AppTheme.spacingSm),
          TextField(
            controller: _messageController,
            decoration: const InputDecoration(
              hintText: 'Any notes for the seller...',
            ),
            maxLines: 3,
            textCapitalization: TextCapitalization.sentences,
          ),
          const SizedBox(height: AppTheme.spacingXxl),

          // ─── Submit ────────────────────────────────────────────
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: _isSubmitting ? null : () => _submit(item),
              icon: _isSubmitting
                  ? const SizedBox(
                      width: 18, height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Icon(Icons.shopping_cart_checkout),
              label: const Text('Confirm Purchase'),
            ),
          ),
          const SizedBox(height: AppTheme.spacingXl),
        ],
      ),
    );
  }

  /// Hands the purchase off to the web app.
  ///
  /// Every cash-sale RPC is `grant execute ... to service_role` and revoked
  /// from `authenticated` — `create_cash_sale_agreement` says so in its own
  /// comment ("Only trusted server code may call this RPC"), and for good
  /// reason: it takes the seller identity disclosure snapshot as arguments, so
  /// a client that could call it could forge the disclosure the buy path
  /// depends on (migration 0041).
  ///
  /// The request the member composed above is carried in the URL so they do not
  /// retype it.
  Future<void> _submit(Item item) async {
    setState(() => _isSubmitting = true);
    try {
      final uri = WebHandoff.buyListing(
        item.id,
        request: item.isShopfront ? _requestController.text.trim() : null,
        offerCents: item.isShopfront ? _requestCents : null,
      );
      await WebHandoff.openOrWarn(context, uri);
      if (mounted) context.pop();
    } finally {
      if (mounted) setState(() => _isSubmitting = false);
    }
  }
}


// ─── Item Summary Card ─────────────────────────────────────────────────────

class _ItemSummaryCard extends StatelessWidget {
  const _ItemSummaryCard({required this.item});

  final Item item;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final hasImage = item.imagePaths.isNotEmpty;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppTheme.spacingLg),
        child: Row(
          children: [
            Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(
                color: AppTheme.surfaceVariant,
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                border: Border.all(color: AppTheme.border),
              ),
              clipBehavior: Clip.antiAlias,
              child: hasImage
                  ? Image.network(item.imagePaths.first, fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => const Icon(Icons.image_outlined, color: AppTheme.muted))
                  : const Icon(Icons.image_outlined, color: AppTheme.muted, size: 28),
            ),
            const SizedBox(width: AppTheme.spacingMd),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item.title, style: theme.textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w600), maxLines: 2, overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 4),
                  Text(Money.format(item.fmvCents, item.currency), style: theme.textTheme.bodyMedium?.copyWith(color: AppTheme.accent, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 4),
                  if (item.isShopfront)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppTheme.warningLight,
                        borderRadius: BorderRadius.circular(AppTheme.radiusFull),
                      ),
                      child: Text('Binder / Bulk Listing', style: AppTheme.badgeText.copyWith(color: AppTheme.warning)),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Line Item Editor ──────────────────────────────────────────────────────

class _PricePreview extends StatelessWidget {
  const _PricePreview({required this.item, this.requestCents});

  final Item item;

  /// What the buyer offered for a binder lot, or null for a single listing.
  final int? requestCents;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final currency = item.currency;

    // A binder is priced at what the buyer offered. Its `fmv_cents` is the
    // whole inventory's indicative "from" figure and is never the charge.
    final priceCents = requestCents ?? item.fmvCents;

    final feeCents = Money.platformFee(priceCents);
    final totalCents = priceCents + feeCents; // Shipping agreed during negotiation.

    return Container(
      padding: const EdgeInsets.all(AppTheme.spacingLg),
      decoration: BoxDecoration(
        color: AppTheme.surfaceVariant,
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Price preview', style: theme.textTheme.titleMedium),
          const SizedBox(height: AppTheme.spacingMd),
          _row(
            requestCents != null ? 'Your offer' : 'Item price',
            Money.format(priceCents, currency),
          ),
          _row('Platform fee (5%)', Money.format(feeCents, currency)),
          _row('Shipping', 'Agreed with the seller'),
          const Divider(height: AppTheme.spacingLg),
          _row('Estimated total', Money.format(totalCents, currency), bold: true),
        ],
      ),
    );
  }

  Widget _row(String label, String value, {bool bold = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: bold ? AppTheme.detailValue.copyWith(fontWeight: FontWeight.w700) : AppTheme.detailLabel),
          Text(value, style: bold ? AppTheme.priceInline : AppTheme.detailValue),
        ],
      ),
    );
  }
}