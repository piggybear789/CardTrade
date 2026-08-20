/// Trade State Machine — source of truth for trade state transitions.
///
/// Mirrors `domain/state-machine/machine.ts` in the web app.
/// This is the EXACT transitions table from the server.
///
/// The client uses this to determine which actions to show/hide in the
/// trade room UI. The server is authoritative — this is for display only.
library;
import '../../models/enums.dart';

/// The full transitions table. Read this rather than any summary.
///
/// Map<CurrentState, Map<Event, NextState>>
const Map<TradeState, Map<TradeEvent, TradeState>> transitions = {
  TradeState.negotiating: {
    TradeEvent.termsAgreed: TradeState.collateralPending,
    TradeEvent.offerDeclined: TradeState.cancelled,
  },
  TradeState.collateralPending: {
    TradeEvent.holdsConfirmed: TradeState.collateralLocked,
    TradeEvent.holdsFailed: TradeState.collateralPending, // self-loop, retry
  },
  TradeState.collateralLocked: {
    TradeEvent.bothShipped: TradeState.inTransit,
    TradeEvent.bothHandoverConfirmed: TradeState.inspection, // in-person skips IN_TRANSIT
    TradeEvent.handoverFailed: TradeState.disputed,
  },
  TradeState.inTransit: {
    TradeEvent.bothReceived: TradeState.inspection,
    TradeEvent.handoverFailed: TradeState.disputed,
  },
  TradeState.inspection: {
    TradeEvent.bothAccepted: TradeState.completed,
    TradeEvent.inspectionExpired: TradeState.completed,
    TradeEvent.conditionDispute: TradeState.disputed,
    TradeEvent.fraudConfirmed: TradeState.fraudResolved,
  },
  TradeState.disputed: {
    TradeEvent.disputeResolved: TradeState.completed,
    TradeEvent.fraudConfirmed: TradeState.fraudResolved,
  },
  // Terminal states — no transitions out
  TradeState.completed: {},
  TradeState.fraudResolved: {},
  TradeState.cancelled: {},
};

/// Whether a transition from [from] via [event] is valid.
bool canTransition(TradeState from, TradeEvent event) {
  return transitions[from]?.containsKey(event) ?? false;
}

/// Attempts a state transition. Returns the next state or null if invalid.
TradeState? tryTransition(TradeState from, TradeEvent event) {
  return transitions[from]?[event];
}

/// Whether the given state is terminal (no further transitions).
bool isTerminal(TradeState state) {
  return transitions[state]?.isEmpty ?? true;
}

/// All events that are valid from the given state.
Set<TradeEvent> validEvents(TradeState state) {
  return transitions[state]?.keys.toSet() ?? {};
}
