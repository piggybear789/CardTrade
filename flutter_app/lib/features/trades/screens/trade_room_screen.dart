import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:cardtrade/core/extensions.dart';
import 'package:cardtrade/core/money.dart';
import 'package:cardtrade/core/result.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/domain/trade/trade_fee.dart';
import 'package:cardtrade/domain/trade/trade_side_values.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/models/pre_auth_hold.dart';
import 'package:cardtrade/models/trade.dart';
import 'package:cardtrade/providers/auth_provider.dart';
import 'package:cardtrade/providers/listings_provider.dart';
import 'package:cardtrade/providers/trades_provider.dart';
import 'package:cardtrade/services/trades_service.dart';
import 'package:cardtrade/widgets/common/confirmation_dialog.dart';
import 'package:cardtrade/widgets/common/conversation_panel.dart';
import 'package:cardtrade/widgets/common/error_view.dart';
import 'package:cardtrade/widgets/common/loading_indicator.dart';
import 'package:cardtrade/widgets/common/status_badge.dart';
import 'package:cardtrade/features/trades/widgets/trade_progress_rail.dart';

/// The trade contract room — real-time view of a single trade.
///
/// Displays status banner, progress rail, terms, fulfilment info,
/// action card, hold indicators, and an integrated conversation panel.
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
    // Allow the stream to re-emit before completing the refresh indicator.
    await ref.read(tradeStreamProvider(widget.tradeId).future);
  }

  @override
  Widget build(BuildContext context) {
    final tradeAsync = ref.watch(tradeStreamProvider(widget.tradeId));
    final currentUser = ref.watch(currentUserProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Trade Room'),
      ),
      body: tradeAsync.when(
        loading: () => const LoadingIndicator(),
        error: (error, _) => ErrorView(
          message: 'Failed to load trade',
          onRetry: () => ref.invalidate(tradeStreamProvider(widget.tradeId)),
        ),
        data: (trade) {
          final userId = currentUser?.id ?? '';
          final role = trade.roleFor(userId);

          return RefreshIndicator(
            onRefresh: _onRefresh,
            child: ListView(
              controller: _scrollController,
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(AppTheme.spacingLg),
              children: [
                _StatusBanner(state: trade.state),
                const SizedBox(height: AppTheme.spacingLg),
                TradeProgressRail(
                  currentState: trade.state,
                  handoverMethod: trade.handoverMethod,
                ),
                const SizedBox(height: AppTheme.spacingXl),
                _TermsSection(trade: trade),
                if (trade.cashAmountCents != 0) ...[
                  const SizedBox(height: AppTheme.spacingLg),
                  _CashAdjustment(trade: trade),
                ],
                const SizedBox(height: AppTheme.spacingLg),
                _FeeDisclosure(trade: trade),
                const SizedBox(height: AppTheme.spacingLg),
                _FulfilmentInfo(trade: trade),
                const SizedBox(height: AppTheme.spacingLg),
                _HoldIndicators(tradeId: widget.tradeId),
                if (!isTerminalTradeState(trade.state)) ...[
                  const SizedBox(height: AppTheme.spacingLg),
                  _ActionCard(
                    trade: trade,
                    role: role,
                    isSubmitting: _isSubmitting,
                    onAction: (action) => _handleAction(action, trade),
                  ),
                ],
                if (trade.conversationId != null) ...[
                  const SizedBox(height: AppTheme.spacingXl),
                  ConversationPanel(
                    conversationId: trade.conversationId!,
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

  Future<void> _handleAction(TradeAction action, Trade trade) async {
    final service = ref.read(tradesServiceProvider);

    // Cancel requires confirmation.
    if (action == TradeAction.declineOffer) {
      final confirmed = await ConfirmationDialog.danger(
        context: context,
        title: 'Cancel trade?',
        message:
            'This will cancel the trade. Any collateral holds will be released.',
        confirmLabel: 'Cancel Trade',
      );
      if (!confirmed) return;
    }

    // Report Handover Failed requires confirmation — freezes the trade.
    if (action == TradeAction.reportHandoverFailed) {
      final confirmed = await ConfirmationDialog.show(
        context: context,
        title: 'Report Handover Failed',
        message:
            'This will freeze the trade. Neither party\'s collateral will be captured. Are you sure?',
        confirmLabel: 'Report Failed',
      );
      if (!confirmed) return;
    }

    // Raise Dispute requires confirmation — destructive, friction tax applies.
    if (action == TradeAction.raiseDispute) {
      final confirmed = await ConfirmationDialog.danger(
        context: context,
        title: 'Raise Dispute',
        message:
            'This starts a formal dispute process. A \$20 friction tax may be charged. This cannot be undone.',
        confirmLabel: 'Raise Dispute',
      );
      if (!confirmed) return;
    }

    setState(() => _isSubmitting = true);

    final result = await switch (action) {
      TradeAction.acceptTerms =>
        service.acceptTerms(widget.tradeId, trade.termsVersion),
      TradeAction.declineOffer =>
        service.declineOffer(widget.tradeId, reason: 'Declined by user'),
      TradeAction.recordShipment =>
        _showTradeShipmentDialog(service),
      TradeAction.recordReceipt =>
        service.recordReceipt(widget.tradeId),
      TradeAction.confirmHandover =>
        service.confirmHandover(widget.tradeId),
      TradeAction.reportHandoverFailed =>
        service.reportHandoverFailed(widget.tradeId, 'Handover failed'),
      TradeAction.recordAcceptance =>
        service.recordAcceptance(widget.tradeId),
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
      widget.tradeId,
      carrier: carrierController.text.trim(),
      trackingNumber: trackingController.text.trim(),
    );
  }
}

// ─── Status Banner ─────────────────────────────────────────────────────────

class _StatusBanner extends StatelessWidget {
  const _StatusBanner({required this.state});

  final TradeState state;

  @override
  Widget build(BuildContext context) {
    final (color, bgColor, label) = switch (state) {
      TradeState.completed => (
          Colors.white,
          AppTheme.success,
          'Trade Complete',
        ),
      TradeState.collateralLocked ||
      TradeState.inTransit ||
      TradeState.inspection =>
        (Colors.white, AppTheme.accent, 'Trade Active'),
      TradeState.negotiating || TradeState.collateralPending => (
          AppTheme.primary,
          AppTheme.warningLight,
          'Awaiting Agreement',
        ),
      TradeState.disputed ||
      TradeState.fraudResolved ||
      TradeState.cancelled =>
        (Colors.white, AppTheme.danger, enumToString(state).enumLabel),
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

// ─── Terms Section ─────────────────────────────────────────────────────────

class _TermsSection extends StatelessWidget {
  const _TermsSection({required this.trade});

  final Trade trade;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Terms', style: theme.textTheme.headlineSmall),
        const SizedBox(height: AppTheme.spacingMd),
        Row(
          children: [
            // Initiator item
            Expanded(child: const _ItemCard(label: 'You offer')),
            const Padding(
              padding: EdgeInsets.symmetric(horizontal: AppTheme.spacingSm),
              child: Text(
                'vs',
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  color: AppTheme.muted,
                  fontSize: 16,
                ),
              ),
            ),
            // Counterpart item
            Expanded(child: const _ItemCard(label: 'They offer')),
          ],
        ),
        if (!trade.termsAgreed) ...[
          const SizedBox(height: AppTheme.spacingSm),
          Container(
            padding: const EdgeInsets.all(AppTheme.spacingSm),
            decoration: BoxDecoration(
              color: AppTheme.warningLight,
              borderRadius: BorderRadius.circular(AppTheme.radiusSm),
            ),
            child: Row(
              children: [
                const Icon(Icons.info_outline,
                    size: 16, color: AppTheme.warning),
                const SizedBox(width: AppTheme.spacingSm),
                Expanded(
                  child: Text(
                    'Terms not yet agreed by both parties',
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: AppTheme.warning,
                    ),
                  ),
                ),
              ],
            ),
          ),
        ],
        // Show what's being taken from a binder, if specified.
        // This is the trade-side equivalent of cash_sale_items — arbitration
        // reads it and never the listing.
        if (trade.counterpartGoodsDescription != null &&
            trade.counterpartGoodsDescription!.isNotEmpty) ...[
          const SizedBox(height: AppTheme.spacingMd),
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(AppTheme.spacingMd),
            decoration: BoxDecoration(
              color: AppTheme.surfaceVariant,
              borderRadius: BorderRadius.circular(AppTheme.radiusSm),
              border: Border.all(color: AppTheme.border),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'What you want from this listing',
                  style: theme.textTheme.labelMedium,
                ),
                const SizedBox(height: AppTheme.spacingSm),
                Text(
                  trade.counterpartGoodsDescription!,
                  style: theme.textTheme.bodyMedium,
                ),
              ],
            ),
          ),
        ],
      ],
    );
  }
}

class _ItemCard extends StatelessWidget {
  const _ItemCard({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppTheme.spacingMd),
      decoration: BoxDecoration(
        color: AppTheme.surfaceVariant,
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
        border: Border.all(color: AppTheme.border),
      ),
      child: Column(
        children: [
          Container(
            width: 56,
            height: 56,
            decoration: BoxDecoration(
              color: AppTheme.background,
              borderRadius: BorderRadius.circular(AppTheme.radiusSm),
            ),
            child: const Icon(Icons.image_outlined,
                color: AppTheme.muted, size: 24),
          ),
          const SizedBox(height: AppTheme.spacingSm),
          Text(
            label,
            style: AppTheme.sectionLabel,
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}

// ─── Cash Adjustment ───────────────────────────────────────────────────────

class _CashAdjustment extends StatelessWidget {
  const _CashAdjustment({required this.trade});

  final Trade trade;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Container(
      padding: const EdgeInsets.all(AppTheme.spacingLg),
      decoration: BoxDecoration(
        color: AppTheme.surfaceVariant,
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
        border: Border.all(color: AppTheme.border),
      ),
      child: Row(
        children: [
          const Icon(Icons.payments_outlined, size: 20, color: AppTheme.accent),
          const SizedBox(width: AppTheme.spacingMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Cash Adjustment',
                  style: theme.textTheme.labelMedium,
                ),
                const SizedBox(height: 2),
                Text(
                  Money.formatSigned(trade.cashAmountCents, trade.currency),
                  style: theme.textTheme.bodyLarge?.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
          if (trade.cashDirection != null)
            StatusBadge(
              label: trade.cashDirection == TradeCashDirection.proposerPays
                  ? 'You pay'
                  : 'They pay',
              variant: StatusBadgeVariant.neutral,
            ),
        ],
      ),
    );
  }
}

// ─── Fulfilment Info ───────────────────────────────────────────────────────

class _FulfilmentInfo extends StatelessWidget {
  const _FulfilmentInfo({required this.trade});

  final Trade trade;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final method = trade.handoverMethod;

    return Container(
      padding: const EdgeInsets.all(AppTheme.spacingLg),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(AppTheme.radiusMd),
        border: Border.all(color: AppTheme.border),
      ),
      child: Row(
        children: [
          Icon(
            method == HandoverMethod.inPerson
                ? Icons.handshake_outlined
                : Icons.local_shipping_outlined,
            size: 20,
            color: AppTheme.secondary,
          ),
          const SizedBox(width: AppTheme.spacingMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Fulfilment Method',
                  style: theme.textTheme.labelMedium,
                ),
                const SizedBox(height: 2),
                Text(
                  method == HandoverMethod.inPerson
                      ? 'In Person'
                      : method == HandoverMethod.delivery
                          ? 'Delivery'
                          : 'Not set',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    fontWeight: FontWeight.w500,
                  ),
                ),
                if (trade.meetingLocation != null) ...[
                  const SizedBox(height: 2),
                  Text(
                    trade.meetingLocation!,
                    style: theme.textTheme.bodySmall,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

// ─── Hold Indicators ───────────────────────────────────────────────────────

class _HoldIndicators extends ConsumerWidget {
  const _HoldIndicators({required this.tradeId});

  final String tradeId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final holdsAsync = ref.watch(tradeHoldsProvider(tradeId));

    return holdsAsync.when(
      loading: () => const SizedBox.shrink(),
      error: (_, __) => const SizedBox.shrink(),
      data: (holds) {
        if (holds.isEmpty) return const SizedBox.shrink();

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Trade Collateral',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: AppTheme.spacingSm),
            Text(
              'A temporary hold on your card — no money moves until the trade completes.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: AppTheme.spacingMd),
            ...holds.map((hold) => _HoldRow(hold: hold)),
          ],
        );
      },
    );
  }
}

class _HoldRow extends StatelessWidget {
  const _HoldRow({required this.hold});

  final PreAuthHold hold;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final variant = switch (hold.status) {
      HoldStatus.active => StatusBadgeVariant.active,
      HoldStatus.voided => StatusBadgeVariant.neutral,
      HoldStatus.partiallyCaptured ||
      HoldStatus.fullyCaptured =>
        StatusBadgeVariant.completed,
      HoldStatus.failed || HoldStatus.expired => StatusBadgeVariant.error,
    };

    return Padding(
      padding: const EdgeInsets.only(bottom: AppTheme.spacingSm),
      child: Container(
        padding: const EdgeInsets.all(AppTheme.spacingMd),
        decoration: BoxDecoration(
          color: AppTheme.surfaceVariant,
          borderRadius: BorderRadius.circular(AppTheme.radiusSm),
        ),
        child: Row(
          children: [
            const Icon(Icons.credit_card, size: 16, color: AppTheme.secondary),
            const SizedBox(width: AppTheme.spacingSm),
            Expanded(
              child: Text(
                Money.format(hold.amountCents, 'aud'),
                style: theme.textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
            StatusBadge(
              label: enumToString(hold.status).enumLabel,
              variant: variant,
            ),
          ],
        ),
      ),
    );
  }
}

// ─── Fee Disclosure ────────────────────────────────────────────────────────

/// Discloses the platform fee from `resolveTradeSideValues`.
///
/// The disclosed fee MUST agree with the charged fee. Three call sites read
/// the same `resolveTradeSideValues` function: collateral sizing, charged fee,
/// and this disclosure. Never re-derive a side value by summing `fmv_cents`.
class _FeeDisclosure extends ConsumerWidget {
  const _FeeDisclosure({required this.trade});

  final Trade trade;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final initiatorItemAsync = ref.watch(
      itemDetailProvider(trade.initiatorItemId),
    );
    final counterpartItemAsync = ref.watch(
      itemDetailProvider(trade.counterpartItemId),
    );

    // Both items needed to resolve side values.
    final initiatorItem = initiatorItemAsync.value;
    final counterpartItem = counterpartItemAsync.value;

    if (initiatorItem == null || counterpartItem == null) {
      return const SizedBox.shrink();
    }

    // THE SAME rule as collateral sizing and charged fee — one definition.
    final sides = resolveTradeSideValues(
      initiatorGoodsCents: initiatorItem.fmvCents,
      counterpartGoodsCents: counterpartItem.fmvCents,
      counterpartIsShopfront: counterpartItem.isShopfront,
    );

    final initiatorFeeCents = tradeFee(sides.counterpartSideCents);
    final counterpartFeeCents = tradeFee(sides.initiatorSideCents);

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
          Text(
            'Platform Fee',
            style: Theme.of(context).textTheme.labelMedium,
          ),
          const SizedBox(height: AppTheme.spacingSm),
          Text(
            '5% of what each trader receives, charged when both accept.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: AppTheme.spacingMd),
          Row(
            children: [
              Expanded(
                child: _FeeRow(
                  label: 'Your fee',
                  cents: initiatorFeeCents,
                  currency: trade.currency,
                ),
              ),
              Expanded(
                child: _FeeRow(
                  label: 'Their fee',
                  cents: counterpartFeeCents,
                  currency: trade.currency,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _FeeRow extends StatelessWidget {
  const _FeeRow({
    required this.label,
    required this.cents,
    required this.currency,
  });

  final String label;
  final int cents;
  final String currency;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: AppTheme.metaText),
        const SizedBox(height: 2),
        Text(
          Money.format(cents, currency),
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                fontWeight: FontWeight.w600,
              ),
        ),
      ],
    );
  }
}

// ─── Action Card ───────────────────────────────────────────────────────────

class _ActionCard extends StatelessWidget {
  const _ActionCard({
    required this.trade,
    required this.role,
    required this.isSubmitting,
    required this.onAction,
  });

  final Trade trade;
  final TradeViewerRole role;
  final bool isSubmitting;
  final void Function(TradeAction) onAction;

  @override
  Widget build(BuildContext context) {
    final actions = _actionsForState(trade, role);

    if (actions.isEmpty) return const SizedBox.shrink();

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AppTheme.spacingLg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Actions',
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: AppTheme.spacingMd),
            ...actions.map(
              (action) => Padding(
                padding: const EdgeInsets.only(bottom: AppTheme.spacingSm),
                child: _actionButton(context, action),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _actionButton(BuildContext context, TradeAction action) {
    final (label, icon, isDanger) = switch (action) {
      TradeAction.acceptTerms => ('Accept Terms', Icons.check, false),
      TradeAction.declineOffer => ('Cancel Trade', Icons.close, true),
      TradeAction.recordShipment =>
        ('Mark as Shipped', Icons.local_shipping, false),
      TradeAction.recordReceipt => ('Mark as Received', Icons.inbox, false),
      TradeAction.confirmHandover =>
        ('Confirm Handover', Icons.handshake, false),
      TradeAction.reportHandoverFailed =>
        ('Report Failed Handover', Icons.report_problem, true),
      TradeAction.recordAcceptance =>
        ('Accept Goods', Icons.thumb_up, false),
      TradeAction.raiseDispute =>
        ('Raise Dispute', Icons.gavel, true),
      _ => (enumToString(action).enumLabel, Icons.arrow_forward, false),
    };

    if (isDanger) {
      return OutlinedButton.icon(
        onPressed: isSubmitting ? null : () => onAction(action),
        icon: Icon(icon, size: 18),
        label: Text(label),
        style: OutlinedButton.styleFrom(
          foregroundColor: AppTheme.danger,
          side: const BorderSide(color: AppTheme.danger),
        ),
      );
    }

    return FilledButton.icon(
      onPressed: isSubmitting ? null : () => onAction(action),
      icon: Icon(icon, size: 18),
      label: Text(label),
    );
  }

  List<TradeAction> _actionsForState(Trade trade, TradeViewerRole role) {
    return switch (trade.state) {
      TradeState.negotiating => [
          if (!trade.termsAgreed) TradeAction.acceptTerms,
          TradeAction.declineOffer,
        ],
      TradeState.collateralLocked => [
          if (trade.handoverMethod == HandoverMethod.delivery)
            TradeAction.recordShipment
          else ...[
            TradeAction.confirmHandover,
            TradeAction.reportHandoverFailed,
          ],
          TradeAction.declineOffer,
        ],
      TradeState.inTransit => [
          TradeAction.recordReceipt,
        ],
      TradeState.inspection => [
          TradeAction.recordAcceptance,
          TradeAction.raiseDispute,
        ],
      _ => [],
    };
  }
}
