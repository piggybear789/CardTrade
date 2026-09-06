// The step model both contract rooms hand to the progress rail and the action
// card, and the ONE place a served step plan becomes that model.
//
// THIS IS PRESENTATION, AND THERE IS NO LONGER A STEP PLAN ANYWHERE IN THE APP.
// The plan for all 13 Cash_Sale statuses and all 9 Trade_States is derived by
// `domain/contract/cashSaleSteps.ts` and `domain/contract/tradeSteps.ts` and
// SERVED over `app/api/mobile/{cash-sale,trades}/step-plan`
// (`.kiro/specs/mobile-parity/` Requirement 11). Each step arrives with its rail
// label, its full label, its detail line — counterparty name already interpolated
// — and its done/active/pending/halted state. Nothing below decides what a
// contract's steps are, which one it has reached, or what a member may do.
//
// Until Requirement 11 landed, each room declared its own labels and its own
// state→column map, and this file turned a column index into statuses. Both are
// gone: the index builder existed only to serve those lists, and keeping it would
// leave the shape of the problem lying around for someone to fill in again. What
// is left is the model, the parse, and "which step is live".
//
// THE NEUTRAL PLAN IS AN EMPTY LIST, and that is deliberate rather than
// convenient. No session, a transport failure, or a status the server declines to
// place all resolve to no steps — so no column is drawn, `activeContractStep`
// returns null, the action card renders nothing, and the room presents the status
// the server reported with every other region readable (Req 11.5, and
// mobile-visual-parity Req 7.6, 7.11). There is no local list to fall back to and
// no first step to default to, because there is no local list.
//
// Requirements 7.2, 7.3, 7.6, 7.11, 14.12; mobile-parity 11.3, 11.5.

import 'package:flutter/foundation.dart';

/// How far a contract has got through one step of its own plan.
///
/// These are the four values the server sends, and the four the rail can draw.
/// The derivation also distinguishes a `blocked` step — live but unable to start —
/// and collapses it onto `pending` before sending, because a phone with no marker
/// for that state must not be the thing that decides how to draw it.
enum ContractStepStatus {
  /// Behind the contract: drawn with a tick.
  done,

  /// Where the contract is now: drawn with a filled marker.
  active,

  /// Not reached: drawn with an unfilled marker.
  pending,

  /// Where a contract STOPPED. Drawn with a cross and never with a tick, because
  /// a cancelled contract wearing the same mark as a completed one is the bug
  /// this status exists to prevent (Req 7.3).
  halted,
}

/// The wire spelling of each status, as `lib/api/contractStepPlan.ts` sends it.
const Map<String, ContractStepStatus> _wireStatuses = <String, ContractStepStatus>{
  'done': ContractStepStatus.done,
  'active': ContractStepStatus.active,
  'pending': ContractStepStatus.pending,
  'halted': ContractStepStatus.halted,
};

/// One column of a contract progress rail, exactly as the server described it.
@immutable
class ContractStep {
  const ContractStep({
    required this.id,
    required this.label,
    required this.status,
    String? railLabel,
    this.detail,
  }) : _railLabel = railLabel;

  /// Stable identity for this column, used to track which one is disclosed.
  final String id;

  /// The step in full — a sentence. What the action card titles itself with and
  /// what a screen reader is given for the column's marker.
  final String label;

  /// Whether the contract is behind, on, past or stopped at this column.
  final ContractStepStatus status;

  /// A sentence disclosed when the member activates this column's marker, and
  /// the outcome copy a halted column carries (Req 7.2, 7.3).
  final String? detail;

  final String? _railLabel;

  /// One or two words for the column itself, chosen by the server. Falls back to
  /// [label], which is what the server does when a step has no short form.
  String get railLabel {
    final String? short = _railLabel;
    return short == null || short.trim().isEmpty ? label : short;
  }
}

/// Parse a served step plan into the rail's model.
///
/// [data] is the `data` object of the endpoint's `ActionResult`. Returns the
/// NEUTRAL plan — an empty list — for anything it cannot read in full: a null
/// body, a missing `steps` array, a step with no label, or a status spelling this
/// build does not know. Partial plans are not returned, because half a plan
/// renders as a contract that has not got as far as it has (Req 11.5).
List<ContractStep> contractStepsFromServed(dynamic data) {
  if (data is! Map) return const <ContractStep>[];
  final dynamic rawSteps = data['steps'];
  if (rawSteps is! List || rawSteps.isEmpty) return const <ContractStep>[];

  final List<ContractStep> steps = <ContractStep>[];
  for (final dynamic raw in rawSteps) {
    if (raw is! Map) return const <ContractStep>[];

    final Object? id = raw['id'];
    final Object? label = raw['label'];
    final ContractStepStatus? status = _wireStatuses[raw['status']];
    if (id is! String || id.isEmpty) return const <ContractStep>[];
    if (label is! String || label.trim().isEmpty) return const <ContractStep>[];
    if (status == null) return const <ContractStep>[];

    final Object? railLabel = raw['railLabel'];
    final Object? detail = raw['detail'];

    steps.add(
      ContractStep(
        id: id,
        label: label.trim(),
        railLabel: railLabel is String ? railLabel : null,
        status: status,
        detail: detail is String && detail.trim().isNotEmpty ? detail.trim() : null,
      ),
    );
  }

  return steps;
}

/// The one column the contract is on, or null where it is on none.
///
/// Null for a finished contract, a halted one, and the neutral plan — the three
/// cases in which the action card must present no primary action (Req 7.6, 7.11).
ContractStep? activeContractStep(List<ContractStep> steps) {
  for (final ContractStep step in steps) {
    if (step.status == ContractStepStatus.active) return step;
  }
  return null;
}
