// The trade contract room.
//
// It presents the regions the web contract room presents, in the web's order:
// header, progress rail, action card, detail rows, money table, timeline, and the
// shared conversation panel (Req 7.1, 7.8).
//
// COLLATERAL IS CALLED TRADE COLLATERAL, EVERYWHERE, and every place this room
// mentions it also says what it is: a temporary hold on the trader's card, released
// without a charge when the trade completes. It is never called escrow — the
// platform holds a claim on a card, not funds (Req 7.7).
//
// The disclosed fee and the side values come from the SAME advisory ports the
// server charges from, `resolveTradeSideValues` and `tradeFee`. Nothing here sums
// item values to derive a side, and nothing recomputes a fee that the contract
// records (Req 7.5).
//
// THE STEP PLAN IS SERVED, NOT PORTED. It arrives from
// `app/api/mobile/trades/step-plan`, which calls the same
// `domain/contract/tradeSteps.ts` the web room calls, and this screen reads it
// through `tradeStepPlanProvider` (`.kiro/specs/mobile-parity/` Req 11.1–11.3).
// An unavailable plan is the neutral room: no column marked, no action offered,
// never a local list and never a first step by default (Req 11.5).
//
// Requirements 7.1–7.8, 7.11, 7.12, 13.6–13.12, 14.5, 14.12; mobile-parity 11.5.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:cardtrade/core/constants.dart';
import 'package:cardtrade/core/extensions.dart';
import 'package:cardtrade/core/money.dart';
import 'package:cardtrade/core/result.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/domain/trade/trade_fee.dart';
import 'package:cardtrade/domain/trade/trade_side_values.dart';
import 'package:cardtrade/features/listings/widgets/listing_notice.dart';
import 'package:cardtrade/features/trades/widgets/trade_progress_rail.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/models/pre_auth_hold.dart';
import 'package:cardtrade/models/trade.dart';
import 'package:cardtrade/providers/auth_provider.dart';
import 'package:cardtrade/providers/listings_provider.dart';
import 'package:cardtrade/providers/trades_provider.dart';
import 'package:cardtrade/services/trades_service.dart';
import 'package:cardtrade/widgets/common/confirmation_dialog.dart';
import 'package:cardtrade/widgets/common/controls.dart';
import 'package:cardtrade/widgets/common/conversation_panel.dart';
import 'package:cardtrade/widgets/common/error_view.dart';
import 'package:cardtrade/widgets/common/load_state.dart';
import 'package:cardtrade/widgets/common/loading_indicator.dart';
import 'package:cardtrade/widgets/common/status_badge.dart';
import 'package:cardtrade/widgets/contract/contract.dart';

/// What trade collateral is, in one sentence, wherever it is mentioned (Req 7.7).
const String _collateralExplainer =
    'Trade collateral is a temporary hold on your card. No money moves, and the '
    'hold is released without a charge when the trade completes.';

/// The trade contract room — real-time view of a single trade.
class TradeRoomScreen extends ConsumerStatefulWidget {
  const TradeRoomScreen({required this.tradeId, super.key});

  /// The trade ID from the route parameter.
  final String tradeId;

  @override
  ConsumerState<TradeRoomScreen> createState() => _TradeRoomScreenState();
}

class _TradeRoomScreenState extends ConsumerState<TradeRoomScreen> {
  final _scrollController = ScrollController();
  bool _isSubmitting = false;

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _onRefresh() async {
    ref.invalidate(tradeStreamProvider(widget.tradeId));
    ref.invalidate(tradeHoldsProvider(widget.tradeId));
    ref.invalidate(tradeStepPlanProvider(widget.tradeId));
    // Allow the stream to re-emit before completing the refresh indicator.
    await ref.read(tradeStreamProvider(widget.tradeId).future);
  }

  @override
  Widget build(BuildContext context) {
    final tradeAsync = ref.watch(tradeStreamProvider(widget.tradeId));
    final currentUser = ref.watch(currentUserProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Trade room')),
      body: tradeAsync.when(
        loading: () => const LoadingIndicator(),
        error: (error, _) => ErrorView.forFailure(
          RequestFailure.from(error, operation: 'this trade'),
          onRetry: _onRefresh,
        ),
        data: (trade) {
          final userId = currentUser?.id ?? '';
          final role = trade.roleFor(userId);

          // The plan comes from the server and from nowhere else. An unresolved
          // or failed read is the NEUTRAL plan — an empty list — so the rail draws
          // nothing and the action card offers nothing (Req 11.5).
          final steps = ref.watch(tradeStepPlanProvider(widget.tradeId)).value ??
              const <ContractStep>[];
          final live = activeContractStep(steps);
          final actions =
              live == null ? const <ContractAction>[] : _actionsFor(trade);

          // See the note in the sale room: an awaited re-read that fails offline
          // must become a message, not an unhandled error (Req 11.5, 11.10).
          return PullToRefresh(
            onRefresh: _onRefresh,
            operation: 'this trade',
            child: ListView(
              controller: _scrollController,
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(AppSpacing.group),
              children: <Widget>[
                Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  spacing: AppSpacing.cozy,
                  children: <Widget>[
                    ContractHeader(
                      title: 'Trade',
                      statusLabel: _stateLabel(trade.state),
                      statusVariant: _stateVariant(trade.state),
                      subtitle: role == TradeViewerRole.initiator
                          ? 'You opened this trade'
                          : 'You were offered this trade',
                    ),
                    TradeProgressRail(steps: steps),
                    // Req 7.6: no active step, no action card.
                    ContractActionCard(
                      step: live,
                      primary: actions.isEmpty ? null : actions.first,
                      secondary: actions.skip(1).toList(),
                      tone: _tone(trade.state),
                    ),
                    _TermsSection(trade: trade),
                    _TradeMoneySection(trade: trade, role: role),
                    _FulfilmentSection(trade: trade),
                    _CollateralSection(tradeId: widget.tradeId, trade: trade),
                    ContractSection(
                      title: 'History',
                      children: <Widget>[
                        ContractTimeline(events: _events(trade)),
                      ],
                    ),
                    if (trade.conversationId != null)
                      ConversationPanel(conversationId: trade.conversationId!),
                  ],
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  // ─── Presentation of the state the server reported ───────────────────────

  /// The state in member-facing words, taken from the state itself so a value
  /// this screen has no copy for still reads as what the server reported
  /// (Req 7.11).
  static String _stateLabel(TradeState state) => enumToString(state).enumLabel;

  static StatusBadgeVariant _stateVariant(TradeState state) {
    return switch (state) {
      TradeState.completed => StatusBadgeVariant.completed,
      TradeState.collateralLocked ||
      TradeState.inTransit ||
      TradeState.inspection =>
        StatusBadgeVariant.active,
      TradeState.negotiating || TradeState.collateralPending =>
        StatusBadgeVariant.pending,
      TradeState.disputed || TradeState.fraudResolved || TradeState.cancelled =>
        StatusBadgeVariant.error,
    };
  }

  static ContractActionTone _tone(TradeState state) {
    return switch (state) {
      TradeState.negotiating || TradeState.collateralPending =>
        ContractActionTone.caution,
      TradeState.disputed => ContractActionTone.alert,
      _ => ContractActionTone.live,
    };
  }

  // ─── History ─────────────────────────────────────────────────────────────

  /// The trade's own timestamps, named. Absent where the server holds none.
  static List<ContractEvent> _events(Trade trade) {
    final List<ContractEvent> events = <ContractEvent>[
      ContractEvent(label: 'Trade offered', at: trade.createdAt),
    ];

    void add(String label, DateTime? at) {
      if (at != null) events.add(ContractEvent(label: label, at: at));
    }

    add('You accepted the terms', trade.initiatorTermsAcceptedAt);
    add('They accepted the terms', trade.counterpartTermsAcceptedAt);
    add('Your item was posted', trade.initiatorShippedAt);
    add('Their item was posted', trade.counterpartShippedAt);
    add('Carrier confirmed your delivery', trade.initiatorCarrierDeliveredAt);
    add('Carrier confirmed their delivery', trade.counterpartCarrierDeliveredAt);
    add('You confirmed the handover', trade.initiatorHandoverConfirmedAt);
    add('They confirmed the handover', trade.counterpartHandoverConfirmedAt);
    add('You accepted what you received', trade.initiatorAcceptedAt);
    add('They accepted what they received', trade.counterpartAcceptedAt);
    add('Dispute raised', trade.disputedAt);
    add('Fraud reported', trade.fraudClaimedAt);
    add('Trade cancelled', trade.cancelledAt);
    return events;
  }

  // ─── Actions ─────────────────────────────────────────────────────────────

  /// The controls for the live step, first one primary. Unchanged from the
  /// previous room: this restyles what a trader may do, it does not widen it.
  List<ContractAction> _actionsFor(Trade trade) {
    ContractAction action(
      TradeAction key,
      String label, {
      IconData? icon,
      bool destructive = false,
    }) {
      return ContractAction(
        label: label,
        icon: icon,
        destructive: destructive,
        onPressed: _isSubmitting ? null : () => _handleAction(key, trade),
      );
    }

    return switch (trade.state) {
      TradeState.negotiating => <ContractAction>[
          if (!trade.termsAgreed)
            action(TradeAction.acceptTerms, 'Accept terms',
                icon: Icons.check_rounded),
          action(TradeAction.declineOffer, 'Cancel trade',
              icon: Icons.close_rounded, destructive: true),
        ],
      TradeState.collateralPending => <ContractAction>[
          action(TradeAction.retryCollateral, 'Retry the card hold',
              icon: Icons.credit_card),
        ],
      TradeState.collateralLocked => <ContractAction>[
          if (trade.handoverMethod == HandoverMethod.delivery)
            action(TradeAction.recordShipment, 'Mark as shipped',
                icon: Icons.local_shipping_outlined)
          else ...<ContractAction>[
            action(TradeAction.confirmHandover, 'Confirm handover',
                icon: Icons.handshake_outlined),
            action(TradeAction.reportHandoverFailed, 'Handover did not happen',
                icon: Icons.report_problem_outlined, destructive: true),
          ],
          action(TradeAction.declineOffer, 'Cancel trade',
              icon: Icons.close_rounded, destructive: true),
        ],
      TradeState.inTransit => <ContractAction>[
          action(TradeAction.recordReceipt, 'Mark as received',
              icon: Icons.inbox_outlined),
        ],
      TradeState.inspection => <ContractAction>[
          action(TradeAction.recordAcceptance, 'Accept what you received',
              icon: Icons.thumb_up_outlined),
          action(TradeAction.raiseDispute, 'Raise a dispute',
              icon: Icons.gavel_outlined, destructive: true),
        ],
      _ => const <ContractAction>[],
    };
  }

  Future<void> _handleAction(TradeAction action, Trade trade) async {
    final service = ref.read(tradesServiceProvider);

    // Each confirmation is followed by a `mounted` check before the NEXT use of
    // this State's context, which is what Req 7.12 asks for: an await between a
    // dialog and the context that opens the following one is exactly the gap the
    // analyzer was reporting.
    if (action == TradeAction.declineOffer) {
      final confirmed = await ConfirmationDialog.danger(
        context: context,
        title: 'Cancel trade?',
        message: 'This will cancel the trade. Any trade collateral is released '
            'without a charge.',
        confirmLabel: 'Cancel trade',
      );
      if (!mounted) return;
      if (!confirmed) return;
    }

    if (action == TradeAction.reportHandoverFailed) {
      final confirmed = await ConfirmationDialog.show(
        context: context,
        title: 'Report that the handover did not happen',
        message: 'This freezes the trade. Neither trader’s collateral is '
            'captured. Are you sure?',
        confirmLabel: 'Report it',
      );
      if (!mounted) return;
      if (!confirmed) return;
    }

    if (action == TradeAction.raiseDispute) {
      final confirmed = await ConfirmationDialog.danger(
        context: context,
        title: 'Raise a dispute',
        message: 'This starts a formal dispute. A \$20 friction tax may be '
            'charged. This cannot be undone.',
        confirmLabel: 'Raise dispute',
      );
      if (!mounted) return;
      if (!confirmed) return;
    }

    setState(() => _isSubmitting = true);

    final result = await switch (action) {
      TradeAction.acceptTerms =>
        service.acceptTerms(widget.tradeId, trade.termsVersion),
      TradeAction.retryCollateral => service.retryCollateral(widget.tradeId),
      TradeAction.declineOffer =>
        service.declineOffer(widget.tradeId, reason: 'Declined by user'),
      TradeAction.recordShipment => _showTradeShipmentDialog(service),
      TradeAction.recordReceipt => service.recordReceipt(widget.tradeId),
      TradeAction.confirmHandover => service.confirmHandover(widget.tradeId),
      TradeAction.reportHandoverFailed =>
        service.reportHandoverFailed(widget.tradeId, 'Handover failed'),
      TradeAction.recordAcceptance => service.recordAcceptance(widget.tradeId),
      TradeAction.raiseDispute =>
        service.raiseDispute(widget.tradeId, 'Condition issue'),
      _ => Future<Result<dynamic>?>.value(null),
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
        ref.invalidate(tradeStreamProvider(widget.tradeId));
      } else {
        context.showError(msg);
      }
    }
  }

  Future<Result<dynamic>?> _showTradeShipmentDialog(TradesService service) async {
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
      widget.tradeId,
      carrier: carrierController.text.trim(),
      trackingNumber: trackingController.text.trim(),
    );
  }
}

// ─── Terms ─────────────────────────────────────────────────────────────────

class _TermsSection extends StatelessWidget {
  const _TermsSection({required this.trade});

  final Trade trade;

  @override
  Widget build(BuildContext context) {
    final String? binderGoods = trade.counterpartGoodsDescription;

    return ContractSection(
      title: 'Terms',
      explainer: 'What each side is putting up, and any cash to even it out.',
      children: <Widget>[
        if (!trade.termsAgreed)
          // The caution wash, from the ONE place that owns it. Reused rather than
          // re-declared: a second copy of the `.cardtrade-warning` rule is a
          // second wash to keep in step.
          const ListingNotice(
            message: 'Both traders have not accepted the same terms yet.',
          ),
        if (trade.cashAmountCents != 0)
          ContractDetailRow(
            label: trade.cashDirection == TradeCashDirection.proposerPays
                ? 'Cash to even it out — you pay'
                : 'Cash to even it out — they pay',
            icon: Icons.payments_outlined,
            value: Money.formatSigned(trade.cashAmountCents, trade.currency),
          ),
        if (trade.declaredValueCents != null)
          ContractDetailRow(
            label: 'Declared value',
            value: Money.format(trade.declaredValueCents!, trade.currency),
          ),
        // What is coming out of a binder. The trade-side equivalent of a cash
        // sale's line items, and part of the TERMS: arbitration reads the
        // contract and never the listing.
        if (binderGoods != null && binderGoods.trim().isNotEmpty)
          ContractSubRow(
            label: 'What you want from that listing',
            body: binderGoods.trim(),
          ),
        if (trade.offerMessage != null && trade.offerMessage!.trim().isNotEmpty)
          ContractSubRow(label: 'Offer message', body: trade.offerMessage!.trim()),
      ],
    );
  }
}

// ─── Money ─────────────────────────────────────────────────────────────────

/// Side values, the viewer's fee, and the collateral figure — one table.
///
/// The side values and the fee come from the same two ports the server charges
/// from. The room does not sum item values and does not recompute a fee: a
/// disclosure that disagrees with the charge is the money bug those ports exist to
/// prevent.
class _TradeMoneySection extends ConsumerWidget {
  const _TradeMoneySection({required this.trade, required this.role});

  final Trade trade;
  final TradeViewerRole role;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final initiatorItem = ref.watch(itemDetailProvider(trade.initiatorItemId)).value;
    final counterpartItem = ref.watch(itemDetailProvider(trade.counterpartItemId)).value;

    if (initiatorItem == null || counterpartItem == null) {
      return const SizedBox.shrink();
    }

    // THE SAME rule as the collateral sizing and the charged fee — one definition.
    final TradeSideValues sides = resolveTradeSideValues(
      initiatorGoodsCents: initiatorItem.fmvCents,
      counterpartGoodsCents: counterpartItem.fmvCents,
      counterpartIsShopfront: counterpartItem.isShopfront,
    );

    final bool viewerIsInitiator = role == TradeViewerRole.initiator;
    final int yourSideCents =
        viewerIsInitiator ? sides.initiatorSideCents : sides.counterpartSideCents;
    final int theirSideCents =
        viewerIsInitiator ? sides.counterpartSideCents : sides.initiatorSideCents;

    // A trader's fee is charged on what they RECEIVE, which is the other side.
    final int yourFeeCents = tradeFee(theirSideCents);

    return ContractSection(
      title: 'Money',
      explainer: 'A trade moves goods, not cash. The platform fee is '
          '${AppConstants.platformFeeBps ~/ 100}% of what each trader receives, '
          'charged when both accept.',
      children: <Widget>[
        ContractMoneyTable(
          semanticsLabel: 'Trade money breakdown',
          rows: <ContractMoneyRow>[
            ContractMoneyRow(
              label: 'Your side is worth',
              value: Money.format(yourSideCents, trade.currency),
            ),
            ContractMoneyRow(
              label: 'Their side is worth',
              value: Money.format(theirSideCents, trade.currency),
              hint: counterpartItem.isShopfront
                  ? 'A binder or bulk listing is worth whatever is offered '
                      'against it.'
                  : null,
            ),
            ContractMoneyRow(
              label: 'Your trade fee '
                  '(${AppConstants.platformFeeBps ~/ 100}%)',
              value: Money.format(yourFeeCents, trade.currency),
              total: true,
            ),
          ],
        ),
      ],
    );
  }
}

// ─── Fulfilment ────────────────────────────────────────────────────────────

class _FulfilmentSection extends StatelessWidget {
  const _FulfilmentSection({required this.trade});

  final Trade trade;

  @override
  Widget build(BuildContext context) {
    final HandoverMethod? method = trade.handoverMethod;
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
        if (isDelivery && trade.initiatorTrackingNumber != null)
          ContractDetailRow(
            label: 'Their tracking of your parcel',
            value: trade.initiatorTrackingNumber!,
          ),
        if (isDelivery && trade.counterpartTrackingNumber != null)
          ContractDetailRow(
            label: 'Tracking of their parcel',
            value: trade.counterpartTrackingNumber!,
          ),
        if (!isDelivery && trade.meetingLocation != null)
          ContractDetailRow(label: 'Meeting place', value: trade.meetingLocation!),
        if (!isDelivery && trade.meetingAt != null)
          ContractDetailRow(
            label: 'Meeting time',
            value: '${trade.meetingAt!.shortDate} ${trade.meetingAt!.timeOnly}',
          ),
        if (trade.deliveryCostCents != null && trade.deliveryCostCents != 0)
          ContractDetailRow(
            label: 'Postage',
            value: Money.format(trade.deliveryCostCents!, trade.currency),
          ),
        if (trade.inspectionDeadlineAt != null)
          ContractDetailRow(
            label: 'Inspection closes',
            value: '${trade.inspectionDeadlineAt!.shortDate} '
                '${trade.inspectionDeadlineAt!.timeOnly}',
          ),
      ],
    );
  }
}

// ─── Trade collateral ──────────────────────────────────────────────────────

/// The card holds behind this trade, named for what they are.
///
/// The region renders even before a hold exists, because the explanation of what
/// collateral IS is the part a trader needs before they accept terms — not after
/// the hold has already been placed (Req 7.7).
class _CollateralSection extends ConsumerWidget {
  const _CollateralSection({required this.tradeId, required this.trade});

  final String tradeId;
  final Trade trade;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final holdsAsync = ref.watch(tradeHoldsProvider(tradeId));
    final List<PreAuthHold> holds = holdsAsync.value ?? const <PreAuthHold>[];

    return ContractSection(
      title: 'Trade collateral',
      explainer: _collateralExplainer,
      children: <Widget>[
        for (final PreAuthHold hold in holds)
          ContractDetailRow(
            label: Money.format(hold.amountCents, trade.currency),
            icon: Icons.credit_card,
            child: StatusBadge(
              label: enumToString(hold.status).enumLabel,
              variant: _holdVariant(hold.status),
            ),
          ),
        if (holds.isNotEmpty && holds.any((PreAuthHold hold) => hold.expiresAt != null))
          ContractDetailRow(
            label: 'Hold expires',
            value: holds
                .map((PreAuthHold hold) => hold.expiresAt)
                .whereType<DateTime>()
                .reduce((DateTime a, DateTime b) => a.isBefore(b) ? a : b)
                .shortDate,
          ),
      ],
    );
  }

  static StatusBadgeVariant _holdVariant(HoldStatus status) {
    return switch (status) {
      HoldStatus.active => StatusBadgeVariant.active,
      HoldStatus.voided => StatusBadgeVariant.neutral,
      HoldStatus.partiallyCaptured || HoldStatus.fullyCaptured =>
        StatusBadgeVariant.completed,
      HoldStatus.failed || HoldStatus.expired => StatusBadgeVariant.error,
    };
  }
}
