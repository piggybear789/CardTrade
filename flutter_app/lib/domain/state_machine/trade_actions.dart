/// Trade Actions — derives which buttons to show based on trade state and facts.
///
/// Mirrors the action derivation logic in the web app.
/// This drives the trade room UI: which buttons are visible, enabled, disabled.
library;
import '../../models/enums.dart';
import '../../models/trade.dart';

/// Facts about a trade from the viewer's perspective.
class TradeFacts {
  const TradeFacts({
    required this.state,
    required this.viewerRole,
    required this.viewerTermsAccepted,
    required this.otherTermsAccepted,
    required this.viewerShipped,
    required this.otherShipped,
    required this.viewerReceived,
    required this.otherReceived,
    required this.viewerAccepted,
    required this.otherAccepted,
    required this.viewerHandoverConfirmed,
    required this.otherHandoverConfirmed,
    required this.fulfilmentMethod,
    required this.termsVersion,
    required this.viewerTermsAcceptedVersion,
  });

  final TradeState state;
  final TradeViewerRole viewerRole;
  final bool viewerTermsAccepted;
  final bool otherTermsAccepted;
  final bool viewerShipped;
  final bool otherShipped;
  final bool viewerReceived;
  final bool otherReceived;
  final bool viewerAccepted;
  final bool otherAccepted;
  final bool viewerHandoverConfirmed;
  final bool otherHandoverConfirmed;
  final HandoverMethod? fulfilmentMethod;
  final int termsVersion;
  final int? viewerTermsAcceptedVersion;

  /// Build TradeFacts from a Trade model and the current user ID.
  factory TradeFacts.fromTrade(Trade trade, String currentUserId) {
    final isInitiator = trade.initiatorId == currentUserId;
    final role = isInitiator ? TradeViewerRole.initiator : TradeViewerRole.counterpart;

    return TradeFacts(
      state: trade.state,
      viewerRole: role,
      viewerTermsAccepted: isInitiator
          ? trade.initiatorTermsAcceptedVersion == trade.termsVersion
          : trade.counterpartTermsAcceptedVersion == trade.termsVersion,
      otherTermsAccepted: isInitiator
          ? trade.counterpartTermsAcceptedVersion == trade.termsVersion
          : trade.initiatorTermsAcceptedVersion == trade.termsVersion,
      viewerShipped: isInitiator
          ? trade.initiatorShippedAt != null
          : trade.counterpartShippedAt != null,
      otherShipped: isInitiator
          ? trade.counterpartShippedAt != null
          : trade.initiatorShippedAt != null,
      viewerReceived: isInitiator
          ? trade.initiatorReceivedAt != null
          : trade.counterpartReceivedAt != null,
      otherReceived: isInitiator
          ? trade.counterpartReceivedAt != null
          : trade.initiatorReceivedAt != null,
      viewerAccepted: isInitiator
          ? trade.initiatorAcceptedAt != null
          : trade.counterpartAcceptedAt != null,
      otherAccepted: isInitiator
          ? trade.counterpartAcceptedAt != null
          : trade.initiatorAcceptedAt != null,
      viewerHandoverConfirmed: isInitiator
          ? trade.initiatorHandoverConfirmedAt != null
          : trade.counterpartHandoverConfirmedAt != null,
      otherHandoverConfirmed: isInitiator
          ? trade.counterpartHandoverConfirmedAt != null
          : trade.initiatorHandoverConfirmedAt != null,
      fulfilmentMethod: trade.handoverMethod,
      termsVersion: trade.termsVersion,
      viewerTermsAcceptedVersion: isInitiator
          ? trade.initiatorTermsAcceptedVersion
          : trade.counterpartTermsAcceptedVersion,
    );
  }
}

/// Derives the set of actions available to the viewer.
Set<TradeAction> availableActions(TradeFacts facts) {
  final actions = <TradeAction>{};

  switch (facts.state) {
    case TradeState.negotiating:
      // Can accept if not already accepted current version
      if (!facts.viewerTermsAccepted) {
        actions.add(TradeAction.acceptTerms);
      }
      // Can decline if it's a received offer (counterpart in NEGOTIATING)
      if (facts.viewerRole == TradeViewerRole.counterpart) {
        actions.add(TradeAction.declineOffer);
      }
      // Can propose new terms (edit)
      actions.add(TradeAction.proposeTerms);

    case TradeState.collateralPending:
      // A declined card leaves the trade here on purpose so the hold can be
      // re-sought after they replace the card. The server no-ops if the first
      // placement is still in flight.
      actions.add(TradeAction.retryCollateral);
      break;

    case TradeState.collateralLocked:
      if (facts.fulfilmentMethod == HandoverMethod.delivery) {
        // DELIVERY: record shipment if not already shipped
        if (!facts.viewerShipped) {
          actions.add(TradeAction.recordShipment);
        }
      } else if (facts.fulfilmentMethod == HandoverMethod.inPerson) {
        // IN_PERSON: confirm handover if not already confirmed
        if (!facts.viewerHandoverConfirmed) {
          actions.add(TradeAction.confirmHandover);
        }
        // Can report handover failed
        actions.add(TradeAction.reportHandoverFailed);
      }

    case TradeState.inTransit:
      // Record receipt if other has shipped and viewer hasn't confirmed receipt
      if (facts.otherShipped && !facts.viewerReceived) {
        actions.add(TradeAction.recordReceipt);
      }
      // Can report handover failed (lost parcel etc)
      actions.add(TradeAction.reportHandoverFailed);

    case TradeState.inspection:
      // Accept goods if not already accepted
      if (!facts.viewerAccepted) {
        actions.add(TradeAction.recordAcceptance);
      }
      // Can raise dispute if not already accepted
      if (!facts.viewerAccepted) {
        actions.add(TradeAction.raiseDispute);
      }

    case TradeState.completed:
    case TradeState.fraudResolved:
    case TradeState.cancelled:
      // Terminal — no actions
      break;

    case TradeState.disputed:
      // Only staff can resolve disputes — no user actions
      // But fraud can be reported
      actions.add(TradeAction.reportFraud);
  }

  return actions;
}

/// Whether the viewer can cancel this trade.
///
/// Cancellation is available in NEGOTIATING only (before collateral).
bool canCancel(TradeFacts facts) {
  return facts.state == TradeState.negotiating;
}
