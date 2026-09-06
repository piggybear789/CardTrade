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

/// Purchase flow screen — composes a cash sale request on an item.
///
/// For binder or bulk listings: includes a written request and one price so the
/// buyer can say which cards they want. For single listings, shows a simpler
/// confirmation flow.
///
/// THE SUBMIT CONTROL IS A HANDOFF AND SAYS SO BEFORE IT OPENS (Req 12.2). The
/// contract is opened on the website — see [_submit] for why — and it previously
/// read "Confirm Purchase" beside a shopping-cart glyph, which describes an
/// in-app purchase this screen does not perform. A member cannot read the address
/// bar of a browser that has not opened yet, so the page is named and the
/// departure is stated on the affordance itself.
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
      padding: const EdgeInsets.all(AppSpacing.cozy),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ─── Item summary card ─────────────────────────────────
          _ItemSummaryCard(item: item),
          const SizedBox(height: AppSpacing.group),

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
            const SizedBox(height: AppSpacing.tight),
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
            const Text(
              'Describe the cards in your own words. You can both change this '
              'in the contract before either of you accepts.',
              style: AppTheme.metaText,
            ),
            const SizedBox(height: AppSpacing.cozy),

            Text('Your offer', style: theme.textTheme.labelLarge),
            const SizedBox(height: AppSpacing.tight),
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
            const Text('The price for the lot', style: AppTheme.metaText),
            const SizedBox(height: AppSpacing.tight),

            // Nothing is reserved on a binder — say so plainly rather than
            // leaving it implicit. That is the difference between a
            // disappointed buyer and a misled one.
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(AppSpacing.snug),
              decoration: BoxDecoration(
                color: AppTint.caution.fill!,
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
              ),
              child: Text(
                'Nothing is held. Other buyers may be shopping from this '
                'binder at the same time.',
                style: AppTheme.supportText.copyWith(color: AppColors.actionBorder),
              ),
            ),
            const SizedBox(height: AppSpacing.group),
          ],

          // ─── Fulfilment method ─────────────────────────────────
          Text('Fulfilment method', style: theme.textTheme.labelLarge),
          const SizedBox(height: AppSpacing.tight),
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
          const SizedBox(height: AppSpacing.group),

          // ─── Price breakdown ───────────────────────────────────
          //
          // On a binder the price IS what the buyer offered — `fmv_cents` is
          // the whole inventory's indicative "from" figure and must never be
          // charged. On a single listing it is the listing price.
          _PricePreview(
            item: item,
            requestCents: isShopfront ? _requestCents : null,
          ),
          const SizedBox(height: AppSpacing.group),

          // ─── Message ───────────────────────────────────────────
          Text('Message to seller (optional)', style: theme.textTheme.labelLarge),
          const SizedBox(height: AppSpacing.tight),
          TextField(
            controller: _messageController,
            decoration: const InputDecoration(
              hintText: 'Any notes for the seller...',
            ),
            maxLines: 3,
            textCapitalization: TextCapitalization.sentences,
          ),
          const SizedBox(height: AppSpacing.section),

          // ─── Submit ────────────────────────────────────────────
          //
          // The announcement sits ABOVE the control, so it is read before the
          // control is reached rather than after the browser has taken the
          // screen (Req 12.2).
          Text(
            'Opens ${WebHandoff.pageLabel(WebHandoff.listing(item.id))} in your '
            'browser. You will leave the app to agree terms and pay, and what '
            'you have written here comes with you.',
            style: AppTheme.metaText,
            softWrap: true,
          ),
          const SizedBox(height: AppSpacing.snug),
          SizedBox(
            width: double.infinity,
            child: FilledButton.icon(
              onPressed: _isSubmitting ? null : () => _submit(item),
              icon: _isSubmitting
                  ? const SizedBox(
                      width: 18, height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : const Icon(Icons.open_in_new_rounded),
              label: const Text('Open this purchase on the website'),
            ),
          ),
          const SizedBox(height: AppSpacing.group),
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
        padding: const EdgeInsets.all(AppSpacing.cozy),
        child: Row(
          children: [
            Container(
              width: 72,
              height: 72,
              decoration: BoxDecoration(
                color: AppColors.muted,
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                border: Border.all(color: AppTheme.border),
              ),
              clipBehavior: Clip.antiAlias,
              child: hasImage
                  ? Image.network(item.imagePaths.first, fit: BoxFit.cover,
                      errorBuilder: (_, _, _) => const Icon(Icons.image_outlined, color: AppColors.mutedForeground))
                  : const Icon(Icons.image_outlined, color: AppColors.mutedForeground, size: 28),
            ),
            const SizedBox(width: AppSpacing.snug),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(item.title, style: theme.textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w600), maxLines: 2, overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 4),
                  Text(Money.format(item.fmvCents, item.currency), style: theme.textTheme.bodyMedium?.copyWith(color: AppColors.irisInk, fontWeight: FontWeight.w600)),
                  const SizedBox(height: 4),
                  if (item.isShopfront)
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppTint.caution.fill!,
                        borderRadius: BorderRadius.circular(AppTheme.radiusFull),
                      ),
                      child: Text('Binder / Bulk Listing', style: AppTheme.badgeText.copyWith(color: AppColors.actionBorder)),
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
      padding: const EdgeInsets.all(AppSpacing.cozy),
      decoration: BoxDecoration(
        color: AppColors.muted,
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Price preview', style: theme.textTheme.titleMedium),
          const SizedBox(height: AppSpacing.snug),
          _row(
            requestCents != null ? 'Your offer' : 'Item price',
            Money.format(priceCents, currency),
          ),
          _row('Platform fee (5%)', Money.format(feeCents, currency)),
          // The one row whose right-hand side is a sentence rather than an amount,
          // so it is the one row allowed to wrap there.
          _row('Shipping', 'Agreed with the seller', figure: false),
          const Divider(height: AppSpacing.cozy),
          _row('Estimated total', Money.format(totalCents, currency), bold: true),
        ],
      ),
    );
  }

  /// One label/value line of the breakdown.
  ///
  /// THE LABEL IS THE SIDE THAT GIVES. Neither side was flexible, so a
  /// `spaceBetween` row was as wide as its two children wanted to be and the
  /// viewport had no say: on a 390-wide phone the fixture item overflowed by 46
  /// pixels — a black-and-yellow stripe in debug and clipped digits in release, on
  /// the one part of the buy flow that has to stay readable. The label wraps
  /// instead, which is the same shape `widgets/contract/contract_money_table.dart`
  /// already uses for the rooms' money tables.
  ///
  /// A [figure] KEEPS ITS INTRINSIC WIDTH AND IS MEASURED FIRST. Making the amount
  /// flexible too was tried and is wrong: at a 2.0 text scale `$99,999.99` broke
  /// after the comma and read as two numbers, because a digit-group comma IS a
  /// line-break opportunity. So the amount takes what it needs and the label takes
  /// the remainder. `softWrap: false` would have clipped the number instead, which
  /// is the defect rather than the fix.
  ///
  /// Pass `figure: false` where the right-hand side is a sentence — that side is
  /// then flexible and wraps, because prose has no reason not to.
  ///
  /// Holds at the 2.0 text scale `CappedTextScale` allows, which is the widest any
  /// member can actually ask for.
  Widget _row(String label, String value, {bool bold = false, bool figure = true}) {
    final Widget valueText = Text(
      value,
      style: bold ? AppTheme.priceInline : AppTheme.detailValue,
      textAlign: TextAlign.right,
    );

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.tight),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: AppSpacing.snug,
        children: [
          Expanded(
            child: Text(
              label,
              style: bold
                  ? AppTheme.detailValue.copyWith(fontWeight: FontWeight.w700)
                  : AppTheme.detailLabel,
            ),
          ),
          if (figure) valueText else Flexible(child: valueText),
        ],
      ),
    );
  }
}