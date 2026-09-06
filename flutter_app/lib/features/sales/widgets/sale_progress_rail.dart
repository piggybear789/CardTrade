// The sale room's rail: the SERVED step plan, styled.
//
// THIS FILE USED TO DECLARE THE PLAN AND NO LONGER DOES. It held six column
// labels, a `Map<CashSaleStatus, int>` placing each status on one of them, and a
// halted flag — a step plan the server never agreed to, sitting in an app bundle.
// A sale room drawn from it told a member how far their contract had progressed
// from a list that could not carry DISPUTED, FAILED or REFUNDED at all, and that a
// new `Cash_Sale_Status` would silently mis-draw.
//
// `domain/contract/cashSaleSteps.ts` derives the real plan for all 13 statuses,
// and `app/api/mobile/cash-sale/step-plan` serves it for the contract the caller
// is a party to. The room reads it through `saleStepPlanProvider` and passes it
// here. Every label, every detail line — with the counterparty's name already in
// it — and every done/active/pending/halted mark was decided by the server
// (`.kiro/specs/mobile-parity/` Req 11.1–11.3).
//
// AN UNAVAILABLE PLAN IS AN EMPTY LIST, and this rail draws nothing for one. No
// session, a transport failure, or a status the server declines to place all land
// there. There is nothing to fall back TO — that is what removing the list bought
// (Req 11.5, and mobile-visual-parity Req 7.11).
//
// Requirements 7.2, 7.3, 7.11, 14.12; mobile-parity 11.3, 11.5, 11.6.

import 'package:flutter/material.dart';

import 'package:cardtrade/widgets/contract/contract.dart';

/// Horizontal stepper showing the cash sale lifecycle, as the server described it.
class SaleProgressRail extends StatelessWidget {
  const SaleProgressRail({required this.steps, super.key});

  /// The served plan, unmodified. Empty is the neutral presentation, not an error
  /// to paper over: this widget neither reorders, relabels nor supplies steps.
  final List<ContractStep> steps;

  @override
  Widget build(BuildContext context) => ContractProgressRail(steps: steps);
}
