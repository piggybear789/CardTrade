// The trade room's rail: the SERVED step plan, styled.
//
// THIS FILE USED TO DECLARE THE PLAN AND NO LONGER DOES. It held six column
// labels, a `Map<TradeState, int>` placing each state on one of them, and a set of
// states it called halted — a step plan in an app bundle that the server had never
// agreed to. `domain/contract/tradeSteps.ts` derives the real one, which also
// BRANCHES on the fulfilment method (a posted trade ships and confirms arrival; a
// face-to-face one meets once) and names whichever trader is outstanding. A
// hard-coded six-column list cannot express either.
//
// `app/api/mobile/trades/step-plan` serves it for the trade the caller is a party
// to. The room reads it through `tradeStepPlanProvider` and passes it here. Every
// label, detail line and done/active/pending/halted mark was decided by the server
// (`.kiro/specs/mobile-parity/` Req 11.1–11.3).
//
// AN UNAVAILABLE PLAN IS AN EMPTY LIST and draws nothing — no session, a transport
// failure, or a state the server declines to place. Nothing to fall back to, by
// construction (Req 11.5, and mobile-visual-parity Req 7.11).
//
// Requirements 7.2, 7.3, 7.11, 14.12; mobile-parity 11.3, 11.5, 11.6.

import 'package:flutter/material.dart';

import 'package:cardtrade/widgets/contract/contract.dart';

/// Horizontal stepper showing the trade lifecycle, as the server described it.
class TradeProgressRail extends StatelessWidget {
  const TradeProgressRail({required this.steps, super.key});

  /// The served plan, unmodified. Empty is the neutral presentation.
  final List<ContractStep> steps;

  @override
  Widget build(BuildContext context) => ContractProgressRail(steps: steps);
}
