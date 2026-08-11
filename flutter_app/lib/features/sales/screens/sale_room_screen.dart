import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:cardtrade/core/extensions.dart';
import 'package:cardtrade/core/money.dart';
import 'package:cardtrade/core/result.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/models/cash_sale.dart';
import 'package:cardtrade/models/cash_sale_item.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/providers/auth_provider.dart';
import 'package:cardtrade/providers/sales_provider.dart';
import 'package:cardtrade/services/sales_service.dart';
import 'package:cardtrade/widgets/common/confirmation_dialog.dart';
import 'package:cardtrade/widgets/common/conversation_panel.dart';
import 'package:cardtrade/widgets/common/error_view.dart';
import 'package:cardtrade/widgets/common/loading_indicator.dart';
import 'package:cardtrade/widgets/common/status_badge.dart';

/// The cash sale contract room — real-time view of a single sale.
///
/// Displays status header, progress rail, item snapshot, price breakdown,
/// contract line items (shopfront), fulfilment section, inspection countdown,
/// action card, and conversation panel.
class SaleRoomScreen extends ConsumerStatefulWidget {
  const SaleRoomScreen({required this.saleId, super.key});

  final String saleId;

  @override
  ConsumerState<SaleRoomScreen> createState() => _SaleRoomScreenState();
}

class _SaleRoomScreenState extends ConsumerState<SaleRoomScreen> {
  bool _isSubmitting = false;

  Future<void> _onRefresh() async {
    ref.invalidate(saleStreamProvider(widget.saleId));
    ref.invalidate(saleLineItemsProvider(widget.saleId));
    await ref.read(saleStreamProvider(widget.saleId).future);
  }

  @override
  Widget build(BuildContext context) {
    final saleAsync = ref.watch(saleStreamProvider(widget.saleId));
    final currentUser = ref.watch(currentUserProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Contract Room')),
      body: saleAsync.when(
        loading: () => const LoadingIndicator(),
        error: (error, _) => ErrorView(
          message: 'Failed to load sale',
          onRetry: () => ref.invalidate(saleStreamProvider(widget.saleId)),
        ),
        data: (sale) {
          final userId = currentUser?.id ?? '';
          final role = sale.roleFor(userId);

          return RefreshIndicator(
            onRefresh: _onRefresh,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(AppTheme.spacingLg),
              children: [
                _SaleStatusHeader(status: sale.status),
                const SizedBox(height: AppTheme.spacingLg),
                _SaleProgressRail(status: sale.status),
                const SizedBox(height: AppTheme.spacingXl),
                _ItemSnapshot(sale: sale),
                const SizedBox(height: AppTheme.spacingLg),
                _PriceBreakdown(sale: sale),
                if (sale.fromShopfront) ...[
                  const SizedBox(height: AppTheme.spacingLg),
                  _ContractLineItems(saleId: widget.saleId),
                ],
                const SizedBox(height: AppTheme.spacingLg),
                _FulfilmentSection(sale: sale),
                if (sale.status == CashSaleStatus.inspection) ...[
                  const SizedBox(height: AppTheme.spacingLg),
                  _InspectionCountdown(deadline: sale.inspectionDeadlineAt),
                ],
                if (!isTerminalCashSaleStatus(sale.status)) ...[
                  const SizedBox(height: AppTheme.spacingLg),
                  _SaleActionCard(
                    sale: sale,
                    role: role,
                    isSubmitting: _isSubmitting,
                    onAction: (action) => _handleAction(action, sale),
                  ),
                ],
                if (sale.conversationId != null) ...[
                  const SizedBox(height: AppTheme.spacingXl),
                  ConversationPanel(
                    conversationId: sale.conversationId!,
                  ),
                ],
                const SizedBox(height: AppTheme.spacingXl),
              ],
            ),
          );
        },
      ),
    );
  }

  Future<void> _handleAction(String action, CashSale sale) async {
    final service = ref.read(salesServiceProvider);

    if (action == 'cancel') {
      final confirmed = await ConfirmationDialog.danger(
        context: context,
        title: 'Cancel sale?',
        message: 'This will cancel the transaction. Any held funds will be released.',
        confirmLabel: 'Cancel Sale',
      );
      if (!confirmed) return;
    }

    setState(() => _isSubmitting = true);

    final result = await switch (action) {
      'accept_terms' => service.acceptTerms(widget.saleId, sale.termsVersion),
      'record_shipment' => _showShipmentDialog(service, sale),
      'record_receipt' => service.recordReceipt(widget.saleId),
      'accept_inspection' => service.acceptInspection(widget.saleId),
      'confirm_handover' => service.confirmHandover(widget.saleId),
      'raise_dispute' => service.raiseDispute(widget.saleId, 'Condition issue'),
      'cancel' => service.cancelSale(widget.saleId, reason: 'Cancelled by user'),
      _ => Future.value(null),
    };

    if (!mounted) return;
    setState(() => _isSubmitting = false);

    if (result == null) return;
    if (result.isOk) {
      context.showSuccess('Action completed');
    } else {
      final msg = result.errorMessage;
      if (msg.contains('stale') || msg.contains('terms changed')) {
        context.showError('Terms have changed — please review before accepting.');
        ref.invalidate(saleStreamProvider(widget.saleId));
      } else {
        context.showError(msg);
      }
    }
  }

  Future<Result<dynamic>?> _showShipmentDialog(SalesService service, CashSale sale) async {
    final carrierController = TextEditingController();
    final trackingController = TextEditingController();

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Record Shipment'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: carrierController,
              decoration: const InputDecoration(labelText: 'Carrier'),
            ),
            const SizedBox(height: 8),
            TextField(
              controller: trackingController,
              decoration: const InputDecoration(labelText: 'Tracking Number'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(ctx).pop(true),
            child: const Text('Confirm'),
          ),
        ],
      ),
    );

    if (confirmed != true) return null;

    return service.recordShipment(
      widget.saleId,
      carrier: carrierController.text.trim(),
      trackingNumber: trackingController.text.trim(),
    );
  }
}

// ─── Status Header ─────────────────────────────────────────────────────────

class _SaleStatusHeader extends StatelessWidget {
  const _SaleStatusHeader({required this.status});

  final CashSaleStatus status;

  @override
  Widget build(BuildContext context) {
    final (color, bgColor, label) = switch (status) {
      CashSaleStatus.completed => (Colors.white, AppTheme.success, 'Sale Complete'),
      CashSaleStatus.escrowHeld ||
      CashSaleStatus.inTransit ||
      CashSaleStatus.handover ||
      CashSaleStatus.inspection =>
        (Colors.white, AppTheme.accent, 'Sale Active'),
      CashSaleStatus.agreement || CashSaleStatus.paymentPending =>
        (AppTheme.primary, AppTheme.warningLight, 'Awaiting Agreement'),
      CashSaleStatus.disputed ||
      CashSaleStatus.cancelled ||
      CashSaleStatus.failed ||
      CashSaleStatus.refunded =>
        (Colors.white, AppTheme.danger, enumToString(status).enumLabel),
    };

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(
        horizontal: AppTheme.spacingLg,
        vertical: AppTheme.spacingMd,
      ),
      decoration: BoxDecoration(
        color: bgColor,
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
      ),
      child: Text(
        label,
        style: Theme.of(context).textTheme.titleMedium?.copyWith(color: color),
        textAlign: TextAlign.center,
      ),
    );
  }
}

// ─── Progress Rail ─────────────────────────────────────────────────────────

class _SaleProgressRail extends StatelessWidget {
  const _SaleProgressRail({required this.status});

  final CashSaleStatus status;

  static const _steps = ['Agreement', 'Payment', 'Escrow', 'Delivery', 'Inspection', 'Complete'];

  int get _currentIndex => switch (status) {
    CashSaleStatus.agreement => 0,
    CashSaleStatus.paymentPending => 1,
    CashSaleStatus.escrowHeld => 2,
    CashSaleStatus.inTransit || CashSaleStatus.handover => 3,
    CashSaleStatus.inspection => 4,
    CashSaleStatus.completed => 5,
    _ => 0,
  };

  @override
  Widget build(BuildContext context) {
    final current = _currentIndex;

    return SizedBox(
      height: 54,
      child: Row(
        children: List.generate(_steps.length, (i) {
          final done = i < current;
          final active = i == current;
          return Expanded(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    Expanded(child: i == 0 ? const SizedBox.shrink() : Container(height: 2, color: done ? AppTheme.success : AppTheme.border)),
                    Container(
                      width: active ? 20 : 16,
                      height: active ? 20 : 16,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: done ? AppTheme.success : active ? AppTheme.accent : AppTheme.border,
                      ),
                      child: done ? const Icon(Icons.check, size: 10, color: Colors.white) : null,
                    ),
                    Expanded(child: i == _steps.length - 1 ? const SizedBox.shrink() : Container(height: 2, color: done ? AppTheme.success : AppTheme.border)),
                  ],
                ),
                const SizedBox(height: 4),
                Text(
                  _steps[i],
                  style: AppTheme.metaText.copyWith(
                    fontWeight: active ? FontWeight.w600 : FontWeight.w400,
                    color: active ? AppTheme.accent : done ? AppTheme.primary : AppTheme.muted,
                  ),
                  textAlign: TextAlign.center,
                ),
              ],
            ),
          );
        }),
      ),
    );
  }
}

// ─── Item Snapshot ─────────────────────────────────────────────────────────

class _ItemSnapshot extends StatelessWidget {
  const _ItemSnapshot({required this.sale});

  final CashSale sale;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final hasImage = sale.itemImagePaths.isNotEmpty;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppTheme.spacingLg),
        child: Row(
          children: [
            Container(
              width: 64,
              height: 64,
              decoration: BoxDecoration(
                color: AppTheme.surfaceVariant,
                borderRadius: BorderRadius.circular(AppTheme.radiusMd),
                border: Border.all(color: AppTheme.border),
              ),
              clipBehavior: Clip.antiAlias,
              child: hasImage
                  ? Image.network(sale.itemImagePaths.first, fit: BoxFit.cover,
                      errorBuilder: (_, __, ___) => const Icon(Icons.image_outlined, color: AppTheme.muted))
                  : const Icon(Icons.image_outlined, color: AppTheme.muted),
            ),
            const SizedBox(width: AppTheme.spacingMd),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(sale.itemTitle, style: theme.textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w600), maxLines: 2, overflow: TextOverflow.ellipsis),
                  if (sale.itemDescription != null) ...[
                    const SizedBox(height: 4),
                    Text(sale.itemDescription!, style: theme.textTheme.bodySmall, maxLines: 2, overflow: TextOverflow.ellipsis),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}


// ─── Price Breakdown ───────────────────────────────────────────────────────

class _PriceBreakdown extends StatelessWidget {
  const _PriceBreakdown({required this.sale});

  final CashSale sale;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final currency = sale.currency;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppTheme.spacingLg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Price Breakdown', style: theme.textTheme.headlineSmall),
            const SizedBox(height: AppTheme.spacingMd),
            _PriceRow(label: 'Item price', amount: Money.format(sale.agreedPriceCents, currency)),
            _PriceRow(label: 'Shipping', amount: Money.format(sale.shippingCostCents, currency)),
            _PriceRow(label: 'Platform fee (5%)', amount: Money.format(sale.platformFeeCents, currency)),
            const Divider(height: AppTheme.spacingLg),
            _PriceRow(
              label: 'Total',
              amount: Money.format(sale.totalCents, currency),
              isTotal: true,
            ),
          ],
        ),
      ),
    );
  }
}

class _PriceRow extends StatelessWidget {
  const _PriceRow({
    required this.label,
    required this.amount,
    this.isTotal = false,
  });

  final String label;
  final String amount;
  final bool isTotal;

  @override
  Widget build(BuildContext context) {
    final TextStyle labelStyle;
    final TextStyle amountStyle;

    if (isTotal) {
      labelStyle = AppTheme.detailValue.copyWith(fontWeight: FontWeight.w700);
      amountStyle = AppTheme.priceInline;
    } else {
      labelStyle = AppTheme.detailLabel;
      amountStyle = AppTheme.detailValue;
    }

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: labelStyle),
          Text(amount, style: amountStyle),
        ],
      ),
    );
  }
}

// ─── Contract Line Items ───────────────────────────────────────────────────

class _ContractLineItems extends ConsumerWidget {
  const _ContractLineItems({required this.saleId});

  final String saleId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final lineItemsAsync = ref.watch(saleLineItemsProvider(saleId));
    final theme = Theme.of(context);

    return lineItemsAsync.when(
      loading: () => const SizedBox.shrink(),
      error: (_, __) => const SizedBox.shrink(),
      data: (items) {
        if (items.isEmpty) return const SizedBox.shrink();

        return Card(
          child: Padding(
            padding: const EdgeInsets.all(AppTheme.spacingLg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Contract Items', style: theme.textTheme.headlineSmall),
                const SizedBox(height: AppTheme.spacingMd),
                ...items.map((item) => _LineItemRow(item: item)),
              ],
            ),
          ),
        );
      },
    );
  }
}

class _LineItemRow extends StatelessWidget {
  const _LineItemRow({required this.item});

  final CashSaleItem item;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.only(bottom: AppTheme.spacingSm),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(item.description, style: theme.textTheme.bodyMedium),
                if (item.condition != null)
                  Text(item.condition!, style: theme.textTheme.labelSmall),
              ],
            ),
          ),
          Text('×${item.quantity}', style: theme.textTheme.bodySmall),
          const SizedBox(width: AppTheme.spacingSm),
          Text(Money.format(item.totalCents, 'aud'), style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w500)),
        ],
      ),
    );
  }
}

// ─── Fulfilment Section ────────────────────────────────────────────────────

class _FulfilmentSection extends StatelessWidget {
  const _FulfilmentSection({required this.sale});

  final CashSale sale;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDelivery = sale.fulfillmentMethod == HandoverMethod.delivery;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppTheme.spacingLg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(
                  isDelivery ? Icons.local_shipping_outlined : Icons.handshake_outlined,
                  size: 20,
                  color: AppTheme.secondary,
                ),
                const SizedBox(width: AppTheme.spacingSm),
                Text('Fulfilment', style: theme.textTheme.headlineSmall),
              ],
            ),
            const SizedBox(height: AppTheme.spacingMd),
            Text(
              isDelivery ? 'Delivery' : 'In Person',
              style: theme.textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w500),
            ),
            if (isDelivery && sale.trackingNumber != null) ...[
              const SizedBox(height: AppTheme.spacingSm),
              Container(
                padding: const EdgeInsets.all(AppTheme.spacingMd),
                decoration: BoxDecoration(
                  color: AppTheme.surfaceVariant,
                  borderRadius: BorderRadius.circular(AppTheme.radiusSm),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (sale.trackingCarrier != null)
                      Text('Carrier: ${sale.trackingCarrier}', style: theme.textTheme.bodySmall),
                    Text('Tracking: ${sale.trackingNumber}', style: theme.textTheme.bodySmall),
                    if (sale.trackingStatus != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: StatusBadge.active(sale.trackingStatus!),
                      ),
                  ],
                ),
              ),
            ],
            if (!isDelivery && sale.meetingLocation != null) ...[
              const SizedBox(height: AppTheme.spacingSm),
              Text(sale.meetingLocation!, style: theme.textTheme.bodySmall),
              if (sale.meetingAt != null)
                Text('Meeting: ${sale.meetingAt!.shortDate} ${sale.meetingAt!.timeOnly}', style: theme.textTheme.labelSmall),
            ],
          ],
        ),
      ),
    );
  }
}

// ─── Inspection Countdown ──────────────────────────────────────────────────

/// A self-contained countdown widget that only rebuilds itself each second,
/// avoiding a full-screen rebuild via the parent's setState.
class _InspectionCountdown extends StatefulWidget {
  const _InspectionCountdown({this.deadline});

  final DateTime? deadline;

  @override
  State<_InspectionCountdown> createState() => _InspectionCountdownState();
}

class _InspectionCountdownState extends State<_InspectionCountdown> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final deadline = widget.deadline;
    if (deadline == null) return const SizedBox.shrink();

    final remaining = deadline.difference(DateTime.now());
    final isExpired = remaining.isNegative;

    final hours = remaining.inHours.abs();
    final minutes = (remaining.inMinutes.abs() % 60);
    final seconds = (remaining.inSeconds.abs() % 60);
    final display = '${hours}h ${minutes}m ${seconds}s';

    return Semantics(
      liveRegion: true,
      label: isExpired
          ? 'Inspection expired $display ago'
          : 'Inspection window: $display remaining',
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.all(AppTheme.spacingLg),
        decoration: BoxDecoration(
          color: isExpired ? AppTheme.dangerLight : AppTheme.warningLight,
          borderRadius: BorderRadius.circular(AppTheme.radiusMd),
          border: Border.all(color: isExpired ? AppTheme.danger : AppTheme.warning),
        ),
        child: Column(
          children: [
            Icon(
              Icons.timer_outlined,
              color: isExpired ? AppTheme.danger : AppTheme.warning,
              size: 24,
            ),
            const SizedBox(height: AppTheme.spacingSm),
            Text(
              isExpired ? 'Inspection Expired' : 'Inspection Window',
              style: AppTheme.sectionLabel.copyWith(
                color: isExpired ? AppTheme.danger : AppTheme.warning,
              ),
            ),
            const SizedBox(height: 4),
            Text(
              isExpired ? 'Expired $display ago' : '$display remaining',
              style: Theme.of(context).textTheme.titleLarge?.copyWith(
                color: isExpired ? AppTheme.danger : AppTheme.primary,
              ),
            ),
          ],
        ),
      ),
    );
  }
}


// ─── Action Card ───────────────────────────────────────────────────────────

class _SaleActionCard extends StatelessWidget {
  const _SaleActionCard({
    required this.sale,
    required this.role,
    required this.isSubmitting,
    required this.onAction,
  });

  final CashSale sale;
  final CashSaleRole role;
  final bool isSubmitting;
  final void Function(String) onAction;

  @override
  Widget build(BuildContext context) {
    final actions = _actionsForState();
    if (actions.isEmpty) return const SizedBox.shrink();

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppTheme.spacingLg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text('Actions', style: Theme.of(context).textTheme.headlineSmall),
            const SizedBox(height: AppTheme.spacingMd),
            ...actions.map((a) => Padding(
              padding: const EdgeInsets.only(bottom: AppTheme.spacingSm),
              child: _buildButton(a),
            )),
          ],
        ),
      ),
    );
  }

  Widget _buildButton(_SaleAction action) {
    if (action.isDanger) {
      return OutlinedButton.icon(
        onPressed: isSubmitting ? null : () => onAction(action.key),
        icon: Icon(action.icon, size: 18),
        label: Text(action.label),
        style: OutlinedButton.styleFrom(
          foregroundColor: AppTheme.danger,
          side: const BorderSide(color: AppTheme.danger),
        ),
      );
    }
    return FilledButton.icon(
      onPressed: isSubmitting ? null : () => onAction(action.key),
      icon: Icon(action.icon, size: 18),
      label: Text(action.label),
    );
  }

  List<_SaleAction> _actionsForState() {
    return switch (sale.status) {
      CashSaleStatus.agreement => [
          if (!sale.termsAgreed) _SaleAction('accept_terms', 'Accept Terms', Icons.check, false),
          _SaleAction('cancel', 'Cancel', Icons.close, true),
        ],
      CashSaleStatus.escrowHeld => [
          if (role == CashSaleRole.seller)
            _SaleAction('record_shipment', 'Mark as Shipped', Icons.local_shipping, false),
          _SaleAction('cancel', 'Cancel', Icons.close, true),
        ],
      CashSaleStatus.inTransit => [
          if (role == CashSaleRole.buyer)
            _SaleAction('record_receipt', 'Mark as Received', Icons.inbox, false),
        ],
      CashSaleStatus.handover => [
          _SaleAction('confirm_handover', 'Confirm Handover', Icons.handshake, false),
        ],
      CashSaleStatus.inspection => [
          if (role == CashSaleRole.buyer) ...[
            _SaleAction('accept_inspection', 'Accept Goods', Icons.thumb_up, false),
            _SaleAction('raise_dispute', 'Raise Dispute', Icons.gavel, true),
          ],
        ],
      _ => [],
    };
  }
}

class _SaleAction {
  const _SaleAction(this.key, this.label, this.icon, this.isDanger);
  final String key;
  final String label;
  final IconData icon;
  final bool isDanger;
}
