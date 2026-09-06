// The cash sale contract room.
//
// It presents the regions the web contract room presents, in the web's order:
// header, progress rail, action card, detail rows, money table, timeline, and the
// shared conversation panel (Req 7.1, 7.8).
//
// WHAT THIS SCREEN DOES NOT DO. It does not derive a step plan and there is no
// longer one to derive from: the plan arrives from
// `app/api/mobile/cash-sale/step-plan`, which calls the same
// `domain/contract/cashSaleSteps.ts` the web room calls, and this screen reads it
// through `saleStepPlanProvider` (`.kiro/specs/mobile-parity/` Req 11.1–11.3). It
// does not compute a fee or a total for display, and it does not decide what a
// member may do beyond reading the status and the role the server already reported
// (Req 7.5, 14.12). Every figure it renders is a column of the contract row,
// formatted by `core/money.dart` and by nothing else (Req 14.5).
//
// AN UNAVAILABLE PLAN IS THE NEUTRAL ROOM. No session, a transport failure, or a
// status the server declines to place all resolve to no steps, so no column is
// marked and no action is offered — never a local list and never a first step by
// default (Req 11.5, 7.11).
//
// Requirements 7.1–7.6, 7.8, 7.11, 13.6–13.12, 14.5, 14.12; mobile-parity 11.5.

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:cardtrade/core/constants.dart';
import 'package:cardtrade/core/extensions.dart';
import 'package:cardtrade/core/money.dart';
import 'package:cardtrade/core/result.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/features/sales/widgets/sale_progress_rail.dart';
import 'package:cardtrade/models/cash_sale.dart';
import 'package:cardtrade/models/cash_sale_item.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/providers/auth_provider.dart';
import 'package:cardtrade/providers/sales_provider.dart';
import 'package:cardtrade/services/sales_service.dart';
import 'package:cardtrade/widgets/common/confirmation_dialog.dart';
import 'package:cardtrade/widgets/common/controls.dart';
import 'package:cardtrade/widgets/common/conversation_panel.dart';
import 'package:cardtrade/widgets/common/error_view.dart';
import 'package:cardtrade/widgets/common/load_state.dart';
import 'package:cardtrade/widgets/common/loading_indicator.dart';
import 'package:cardtrade/widgets/common/status_badge.dart';
import 'package:cardtrade/widgets/contract/contract.dart';

/// The cash sale contract room — real-time view of a single sale.
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
    ref.invalidate(saleStepPlanProvider(widget.saleId));
    await ref.read(saleStreamProvider(widget.saleId).future);
  }

  @override
  Widget build(BuildContext context) {
    final saleAsync = ref.watch(saleStreamProvider(widget.saleId));
    final currentUser = ref.watch(currentUserProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Contract room')),
      body: saleAsync.when(
        loading: () => const LoadingIndicator(),
        error: (error, _) => ErrorView.forFailure(
          RequestFailure.from(error, operation: 'this contract'),
          onRetry: _onRefresh,
        ),
        data: (sale) {
          final userId = currentUser?.id ?? '';
          final role = sale.roleFor(userId);

          // The plan comes from the server and from nowhere else. An unresolved
          // or failed read is the NEUTRAL plan — an empty list — so the rail draws
          // nothing and the action card offers nothing, rather than this screen
          // guessing a step (Req 11.5).
          final steps = ref.watch(saleStepPlanProvider(widget.saleId)).value ??
              const <ContractStep>[];
          final live = activeContractStep(steps);
          final actions = live == null
              ? const <ContractAction>[]
              : _actionsFor(sale, role);

          // PullToRefresh rather than a bare indicator: _onRefresh awaits the
          // re-read, so an offline pull THROWS, and an uncaught throw inside a
          // RefreshIndicator is an unhandled error rather than a message
          // (Req 11.5, 11.10).
          return PullToRefresh(
            onRefresh: _onRefresh,
            operation: 'this contract',
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(AppSpacing.group),
              children: <Widget>[
                Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  spacing: AppSpacing.cozy,
                  children: <Widget>[
                    ContractHeader(
                      title: sale.itemTitle,
                      statusLabel: _statusLabel(sale.status),
                      statusVariant: _statusVariant(sale.status),
                      money: Money.format(
                        _viewerTotalCents(sale, role),
                        sale.currency,
                      ),
                      subtitle: role == CashSaleRole.buyer
                          ? 'You are buying'
                          : 'You are selling',
                    ),
                    SaleProgressRail(steps: steps),
                    // Req 7.6: no active step, no action card. That covers a
                    // completed sale, a halted one, and the neutral presentation
                    // of a plan the server could not supply.
                    ContractActionCard(
                      step: live,
                      primary: actions.isEmpty ? null : actions.first,
                      secondary: actions.skip(1).toList(),
                      tone: _tone(sale.status),
                    ),
                    _ItemSection(sale: sale),
                    if (sale.fromShopfront)
                      _ContractLineItems(
                        saleId: widget.saleId,
                        currency: sale.currency,
                      ),
                    ContractSection(
                      title: 'Money',
                      explainer: role == CashSaleRole.buyer
                          ? 'What you pay, and what the platform holds until you '
                              'accept the item.'
                          : 'What the buyer pays, and what reaches you once they '
                              'accept the item.',
                      children: <Widget>[
                        ContractMoneyTable(
                          semanticsLabel: 'Payment breakdown',
                          rows: _moneyRows(sale, role),
                        ),
                      ],
                    ),
                    _FulfilmentSection(sale: sale),
                    if (sale.status == CashSaleStatus.inspection)
                      _InspectionCountdown(deadline: sale.inspectionDeadlineAt),
                    ContractSection(
                      title: 'History',
                      children: <Widget>[
                        ContractTimeline(events: _events(sale)),
                      ],
                    ),
                    if (sale.conversationId != null)
                      ConversationPanel(conversationId: sale.conversationId!),
                  ],
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  // ─── Presentation of the status the server reported ──────────────────────

  /// The status in member-facing words, taken from the status itself so a value
  /// this screen has no copy for still reads as what the server reported
  /// (Req 7.11).
  static String _statusLabel(CashSaleStatus status) =>
      enumToString(status).enumLabel;

  static StatusBadgeVariant _statusVariant(CashSaleStatus status) {
    return switch (status) {
      CashSaleStatus.completed => StatusBadgeVariant.completed,
      CashSaleStatus.escrowHeld ||
      CashSaleStatus.inTransit ||
      CashSaleStatus.handover ||
      CashSaleStatus.inspection =>
        StatusBadgeVariant.active,
      CashSaleStatus.agreement || CashSaleStatus.paymentPending =>
        StatusBadgeVariant.pending,
      CashSaleStatus.disputed ||
      CashSaleStatus.cancelled ||
      CashSaleStatus.failed ||
      CashSaleStatus.refunded =>
        StatusBadgeVariant.error,
    };
  }

  static ContractActionTone _tone(CashSaleStatus status) {
    return switch (status) {
      CashSaleStatus.agreement || CashSaleStatus.paymentPending =>
        ContractActionTone.caution,
      CashSaleStatus.disputed => ContractActionTone.alert,
      _ => ContractActionTone.live,
    };
  }

  // ─── Money ───────────────────────────────────────────────────────────────

  /// The viewer's own total: what a buyer is charged, or what a seller receives.
  ///
  /// Both are server-recorded figures. The seller's is `amount_cents` less the
  /// platform fee, exactly as `sellerNetCents` in the web room: shipping is a
  /// pass-through that belongs to the seller and the fee is already computed on
  /// the item price alone. Nothing here recomputes a fee (Req 7.5).
  static int _viewerTotalCents(CashSale sale, CashSaleRole role) {
    if (role == CashSaleRole.buyer) return sale.amountCents;
    final int net = sale.amountCents - sale.platformFeeCents;
    return net < 0 ? 0 : net;
  }

  static List<ContractMoneyRow> _moneyRows(CashSale sale, CashSaleRole role) {
    final bool isDelivery = sale.fulfillmentMethod == HandoverMethod.delivery;
    return <ContractMoneyRow>[
      ContractMoneyRow(
        label: 'Item price',
        value: Money.format(sale.agreedPriceCents, sale.currency),
      ),
      ContractMoneyRow(
        label: isDelivery ? 'Shipping' : 'Shipping (not applicable)',
        value: Money.format(sale.shippingCostCents, sale.currency),
      ),
      ContractMoneyRow(
        label: 'Platform fee (${AppConstants.platformFeeBps ~/ 100}%)',
        value: Money.format(sale.platformFeeCents, sale.currency),
        hint: 'Charged on the item price only.',
      ),
      ContractMoneyRow(
        label: role == CashSaleRole.buyer ? 'You pay' : 'You receive',
        value: Money.format(_viewerTotalCents(sale, role), sale.currency),
        total: true,
      ),
    ];
  }

  // ─── History ─────────────────────────────────────────────────────────────

  /// The contract's own timestamps, named. A null timestamp is an event that has
  /// not happened and is simply absent; nothing is inferred from the status.
  static List<ContractEvent> _events(CashSale sale) {
    final List<ContractEvent> events = <ContractEvent>[
      ContractEvent(label: 'Purchase request opened', at: sale.createdAt),
    ];

    void add(String label, DateTime? at) {
      if (at != null) events.add(ContractEvent(label: label, at: at));
    }

    add('Buyer accepted the terms', sale.buyerTermsAcceptedAt);
    add('Seller accepted the terms', sale.sellerTermsAcceptedAt);
    add('Seller posted the item', sale.shippedAt);
    add('Carrier confirmed delivery', sale.carrierDeliveredAt);
    add('Buyer recorded receipt', sale.receivedAt);
    add('Buyer confirmed the handover', sale.buyerHandoverConfirmedAt);
    add('Seller confirmed the handover', sale.sellerHandoverConfirmedAt);
    add('Buyer accepted the item', sale.inspectionAcceptedAt);
    add('Dispute raised', sale.disputedAt);
    add('Sale cancelled', sale.cancelledAt);
    add('Sale completed', sale.completedAt);
    add('Seller paid', sale.sellerPayoutAt);
    return events;
  }

  // ─── Actions ─────────────────────────────────────────────────────────────

  /// The controls for the live step, first one primary. The set is unchanged from
  /// the previous room: this restyles what a member may do, it does not widen it.
  List<ContractAction> _actionsFor(CashSale sale, CashSaleRole role) {
    // A null callback is how a control says "a call is in flight": the shared
    // button then presents itself as unavailable (Req 8.9, 8.10).
    VoidCallback? tap(String key) =>
        _isSubmitting ? null : () => _handleAction(key, sale);

    return switch (sale.status) {
      CashSaleStatus.agreement => <ContractAction>[
          if (!sale.termsAgreed)
            ContractAction(
              label: 'Accept terms',
              icon: Icons.check_rounded,
              onPressed: tap('accept_terms'),
            ),
          ContractAction(
            label: 'Cancel sale',
            icon: Icons.close_rounded,
            destructive: true,
            onPressed: tap('cancel'),
          ),
        ],
      CashSaleStatus.escrowHeld => <ContractAction>[
          if (role == CashSaleRole.seller)
            ContractAction(
              label: 'Mark as shipped',
              icon: Icons.local_shipping_outlined,
              onPressed: tap('record_shipment'),
            ),
          ContractAction(
            label: 'Cancel sale',
            icon: Icons.close_rounded,
            destructive: true,
            onPressed: tap('cancel'),
          ),
        ],
      CashSaleStatus.inTransit => <ContractAction>[
          if (role == CashSaleRole.buyer)
            ContractAction(
              label: 'Mark as received',
              icon: Icons.inbox_outlined,
              onPressed: tap('record_receipt'),
            ),
        ],
      CashSaleStatus.handover => <ContractAction>[
          ContractAction(
            label: 'Confirm handover',
            icon: Icons.handshake_outlined,
            onPressed: tap('confirm_handover'),
          ),
        ],
      CashSaleStatus.inspection => <ContractAction>[
          if (role == CashSaleRole.buyer) ...<ContractAction>[
            ContractAction(
              label: 'Accept the item',
              icon: Icons.thumb_up_outlined,
              onPressed: tap('accept_inspection'),
            ),
            ContractAction(
              label: 'Raise a dispute',
              icon: Icons.gavel_outlined,
              destructive: true,
              onPressed: tap('raise_dispute'),
            ),
          ],
        ],
      _ => const <ContractAction>[],
    };
  }

  Future<void> _handleAction(String action, CashSale sale) async {
    final service = ref.read(salesServiceProvider);

    if (action == 'cancel') {
      final confirmed = await ConfirmationDialog.danger(
        context: context,
        title: 'Cancel sale?',
        message: 'This will cancel the transaction. Any held funds will be released.',
        confirmLabel: 'Cancel sale',
      );
      if (!mounted) return;
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
        title: const Text('Record shipment'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          spacing: AppSpacing.group,
          children: <Widget>[
            AppTextField(controller: carrierController, label: 'Carrier'),
            AppTextField(controller: trackingController, label: 'Tracking number'),
          ],
        ),
        actions: <Widget>[
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

// ─── Item ──────────────────────────────────────────────────────────────────

class _ItemSection extends StatelessWidget {
  const _ItemSection({required this.sale});

  final CashSale sale;

  @override
  Widget build(BuildContext context) {
    final bool hasImage = sale.itemImagePaths.isNotEmpty;

    return ContractSection(
      title: 'Item',
      children: <Widget>[
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          spacing: AppSpacing.cozy,
          children: <Widget>[
            Container(
              width: AppMetrics.minHitArea,
              height: AppMetrics.minHitArea,
              decoration: BoxDecoration(
                color: AppColors.muted,
                borderRadius: BorderRadius.circular(AppRadius.md),
                border: Border.all(color: AppColors.border, width: AppMetrics.hairline),
              ),
              clipBehavior: Clip.antiAlias,
              child: hasImage
                  ? Image.network(
                      sale.itemImagePaths.first,
                      fit: BoxFit.cover,
                      errorBuilder: (_, _, _) => const _ItemPlaceholder(),
                    )
                  : const _ItemPlaceholder(),
            ),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                spacing: AppSpacing.tight,
                children: <Widget>[
                  Text(sale.itemTitle, style: AppText.rowName),
                  if (sale.itemDescription != null)
                    Text(sale.itemDescription!, style: AppText.supportText),
                ],
              ),
            ),
          ],
        ),
        if (sale.itemCondition != null)
          ContractDetailRow(label: 'Condition', value: sale.itemCondition!),
        if (sale.fromShopfront)
          // Member-facing copy never says "shopfront", and it always states that
          // nothing is held on a binder.
          const ContractDetailRow(
            label: 'Listing',
            value: 'From a binder or bulk listing — nothing is held on it',
          ),
      ],
    );
  }
}

class _ItemPlaceholder extends StatelessWidget {
  const _ItemPlaceholder();

  @override
  Widget build(BuildContext context) => const ExcludeSemantics(
        child: Icon(
          Icons.image_outlined,
          size: AppIconSize.large,
          color: AppColors.mutedForeground,
        ),
      );
}

// ─── Contract line items ───────────────────────────────────────────────────

/// What this contract covers, where the listing is a binder and cannot say.
///
/// Arbitration reads the contract and never the listing, which is why these lines
/// exist at all — so they are presented as rows of the room, not as chat.
class _ContractLineItems extends ConsumerWidget {
  const _ContractLineItems({required this.saleId, required this.currency});

  final String saleId;

  /// The contract's own currency, so a line reads in the same denomination as the
  /// total above it.
  final String currency;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final lineItemsAsync = ref.watch(saleLineItemsProvider(saleId));

    return lineItemsAsync.when(
      loading: () => const SizedBox.shrink(),
      error: (_, _) => const SizedBox.shrink(),
      data: (items) {
        if (items.isEmpty) return const SizedBox.shrink();

        return ContractSection(
          title: 'What this covers',
          explainer: 'The cards this contract is for. The price is the sum of '
              'these lines.',
          children: <Widget>[
            for (final CashSaleItem item in items)
              _LineItemRow(item: item, currency: currency),
          ],
        );
      },
    );
  }
}

class _LineItemRow extends StatelessWidget {
  const _LineItemRow({required this.item, required this.currency});

  final CashSaleItem item;
  final String currency;

  @override
  Widget build(BuildContext context) {
    final String qualifier = <String>[
      if (item.condition != null && item.condition!.trim().isNotEmpty)
        item.condition!.trim(),
      '×${item.quantity}',
    ].join(' · ');

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: AppSpacing.cozy,
      children: <Widget>[
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            spacing: AppSpacing.tight,
            children: <Widget>[
              Text(item.description, style: AppText.bodyText),
              Text(qualifier, style: AppText.metaText),
            ],
          ),
        ),
        Text(Money.format(item.totalCents, currency), style: AppText.priceRow),
      ],
    );
  }
}

// ─── Fulfilment ────────────────────────────────────────────────────────────

class _FulfilmentSection extends StatelessWidget {
  const _FulfilmentSection({required this.sale});

  final CashSale sale;

  @override
  Widget build(BuildContext context) {
    final HandoverMethod? method = sale.fulfillmentMethod;
    final bool isDelivery = method == HandoverMethod.delivery;

    return ContractSection(
      title: 'Fulfilment',
      children: <Widget>[
        ContractDetailRow(
          label: 'Method',
          icon: isDelivery
              ? Icons.local_shipping_outlined
              : Icons.handshake_outlined,
          value: switch (method) {
            HandoverMethod.delivery => 'Delivery',
            HandoverMethod.inPerson => 'In person',
            null => 'Not set',
          },
        ),
        if (isDelivery && sale.trackingCarrier != null)
          ContractDetailRow(label: 'Carrier', value: sale.trackingCarrier!),
        if (isDelivery && sale.trackingNumber != null)
          ContractDetailRow(label: 'Tracking', value: sale.trackingNumber!),
        if (isDelivery && sale.trackingStatus != null)
          ContractDetailRow(
            label: 'Carrier status',
            child: StatusBadge.active(sale.trackingStatus!),
          ),
        if (!isDelivery && sale.meetingLocation != null)
          ContractDetailRow(label: 'Meeting place', value: sale.meetingLocation!),
        if (!isDelivery && sale.meetingAt != null)
          ContractDetailRow(
            label: 'Meeting time',
            value: '${sale.meetingAt!.shortDate} ${sale.meetingAt!.timeOnly}',
          ),
      ],
    );
  }
}

// ─── Inspection countdown ──────────────────────────────────────────────────

/// A self-contained countdown that rebuilds only itself each second.
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
    final DateTime? deadline = widget.deadline;
    if (deadline == null) return const SizedBox.shrink();

    final Duration remaining = deadline.difference(DateTime.now());
    final bool isExpired = remaining.isNegative;

    final int hours = remaining.inHours.abs();
    final int minutes = remaining.inMinutes.abs() % 60;
    final int seconds = remaining.inSeconds.abs() % 60;
    final String display = '${hours}h ${minutes}m ${seconds}s';
    final Tint tint = isExpired ? AppTint.alert : AppTint.caution;

    return Semantics(
      liveRegion: true,
      label: isExpired
          ? 'Inspection expired $display ago'
          : 'Inspection window: $display remaining',
      child: ExcludeSemantics(
        child: Container(
          width: double.infinity,
          padding: const EdgeInsets.all(AppSpacing.cozy),
          decoration: BoxDecoration(
            color: tint.fill,
            borderRadius: BorderRadius.circular(AppRadius.lg),
            border: Border.all(color: tint.edge!, width: AppMetrics.hairline),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            spacing: AppSpacing.tight,
            children: <Widget>[
              Row(
                spacing: AppSpacing.snug,
                children: <Widget>[
                  Icon(
                    Icons.timer_outlined,
                    size: AppIconSize.base,
                    color: tint.ink,
                  ),
                  // Expanded, because at a 2.0 text scale the heading beside the
                  // glyph is wider than the card: an unconstrained Row overflowed
                  // by 158 pixels, which is the kind of defect a 2.0 twin exists
                  // to catch (Req 13.10, 13.13).
                  Expanded(
                    child: Text(
                      isExpired ? 'Inspection expired' : 'Inspection window',
                      style: AppText.rowName,
                    ),
                  ),
                ],
              ),
              Text(
                isExpired ? 'Expired $display ago' : '$display remaining',
                style: AppText.priceRow,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
