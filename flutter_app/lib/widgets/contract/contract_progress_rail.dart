// WHERE ARE WE. The whole contract lifecycle as one row of markers, matching the
// web's `components/contract/ContractProgressRail.tsx`: it answers only "how far
// along is this" and leaves "what do I do now" to the action card.
//
// The row NEVER scrolls, wraps, or drops a column. Every step keeps an
// equal-width column at a 320-pixel viewport, and a label too wide for its column
// is truncated on one line with the full label reachable by activating that
// column's marker (Req 7.2). Six columns at 320 logical pixels is 53 each, which
// is what keeps two adjacent 48-pixel touch targets from intersecting (Req 13.6) —
// a rail wanting more columns than that needs a narrower target, not a wider rail.
//
// Every state differs by SHAPE as well as by colour — a tick, a filled marker, an
// unfilled marker, a cross — so the four remain distinguishable in greyscale
// (Req 7.3, 13.11). Nothing here animates: a state change is applied outright,
// which is the end state a reduce-motion member is owed anyway (Req 13.12).
//
// Requirements 7.2, 7.3, 7.11, 13.6, 13.7, 13.11, 13.12.

import 'package:flutter/material.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/models/contract_step.dart';
import 'package:cardtrade/widgets/common/tap_target.dart';

/// The contract lifecycle as a row of markers, one per step.
class ContractProgressRail extends StatefulWidget {
  const ContractProgressRail({required this.steps, super.key});

  /// The ordered step list, exactly as the room supplied it. A step is never
  /// omitted, reordered or collapsed here.
  final List<ContractStep> steps;

  @override
  State<ContractProgressRail> createState() => _ContractProgressRailState();
}

class _ContractProgressRailState extends State<ContractProgressRail> {
  String? _openId;

  @override
  Widget build(BuildContext context) {
    final List<ContractStep> steps = widget.steps;
    if (steps.isEmpty) return const SizedBox.shrink();

    ContractStep? open;
    for (final ContractStep step in steps) {
      if (step.id == _openId) open = step;
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: AppSpacing.snug,
      children: <Widget>[
        Semantics(
          container: true,
          label: 'Contract progress',
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: <Widget>[
              for (int index = 0; index < steps.length; index++)
                Expanded(
                  child: _RailStep(
                    step: steps[index],
                    next: index + 1 < steps.length ? steps[index + 1] : null,
                    first: index == 0,
                    last: index == steps.length - 1,
                    selected: steps[index].id == _openId,
                    onTap: () => setState(() {
                      _openId = steps[index].id == _openId ? null : steps[index].id;
                    }),
                  ),
                ),
            ],
          ),
        ),
        if (open != null) _Disclosure(step: open),
      ],
    );
  }
}

/// The full label and detail of the column a member activated.
///
/// A live region, because the rail's own labels are truncated: this is where the
/// whole sentence is read out, and it appears without the reader moving (Req 7.2).
class _Disclosure extends StatelessWidget {
  const _Disclosure({required this.step});

  final ContractStep step;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      child: Text.rich(
        TextSpan(
          children: <InlineSpan>[
            TextSpan(text: step.label, style: AppText.rowName),
            if (step.detail != null && step.detail!.trim().isNotEmpty)
              TextSpan(text: ' — ${step.detail!.trim()}', style: AppText.supportText),
          ],
        ),
        // No cap: the disclosure exists so the truncated label can be read in
        // full, and truncating it again would defeat that (Req 13.10).
        style: AppText.bodyText,
      ),
    );
  }
}

class _RailStep extends StatelessWidget {
  const _RailStep({
    required this.step,
    required this.next,
    required this.first,
    required this.last,
    required this.selected,
    required this.onTap,
  });

  final ContractStep step;
  final ContractStep? next;
  final bool first;
  final bool last;
  final bool selected;
  final VoidCallback onTap;

  /// The connector colour for a step, so the line entering a column matches the
  /// column it leads to rather than always reading as pending.
  static Color _connectorColor(ContractStep? step) {
    return switch (step?.status) {
      ContractStepStatus.done => AppColors.trust,
      ContractStepStatus.active => AppColors.iris,
      ContractStepStatus.halted => AppColors.destructive,
      ContractStepStatus.pending => AppColors.border,
      null => AppColors.border,
    };
  }

  /// What this marker means, in words, because the shape alone is not reachable
  /// by a screen reader (Req 13.7).
  String get _stateInWords => switch (step.status) {
        ContractStepStatus.done => 'complete',
        ContractStepStatus.active => 'current step',
        ContractStepStatus.halted => 'the contract ended here',
        ContractStepStatus.pending => 'not reached',
      };

  @override
  Widget build(BuildContext context) {
    return Column(
      mainAxisSize: MainAxisSize.min,
      spacing: AppSpacing.tight,
      children: <Widget>[
        // The marker row is drawn at the 48-pixel hit height on purpose: the
        // marker itself stays 20 pixels, and reserving the row means the
        // expanded touch rectangle lives INSIDE the rail's own bounds instead of
        // being clipped away by it (Req 13.6).
        SizedBox(
          height: AppMetrics.minHitArea,
          child: Row(
            children: <Widget>[
              Expanded(
                child: _Connector(
                  colour: first ? null : _connectorColor(step),
                ),
              ),
              _Marker(
                step: step,
                selected: selected,
                semanticLabel: '${step.label} — $_stateInWords',
                onTap: onTap,
              ),
              Expanded(
                child: _Connector(
                  colour: last ? null : _connectorColor(next),
                ),
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.tight),
          child: Text(
            // The column draws the SHORT label the server chose; the full sentence
            // is what the marker's accessible name and the disclosure carry, so
            // truncating here loses nothing a member cannot reach.
            step.railLabel,
            style: AppText.metaText.copyWith(
              fontWeight: step.status == ContractStepStatus.pending
                  ? FontWeight.w400
                  : FontWeight.w600,
              color: switch (step.status) {
                ContractStepStatus.active => AppColors.foreground,
                ContractStepStatus.halted => AppColors.destructive,
                ContractStepStatus.done => AppColors.mutedForeground,
                ContractStepStatus.pending => AppColors.mutedForeground,
              },
            ),
            textAlign: TextAlign.center,
            // Req 7.2 asks for one line with a trailing ellipsis. The whole label
            // is one tap away in the disclosure, which is what makes clipping it
            // here acceptable where Req 13.10 would otherwise forbid it.
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
          ),
        ),
      ],
    );
  }
}

/// One half of the line between two markers. A null [colour] is the outside edge
/// of the first or last column, which has nothing to connect to.
class _Connector extends StatelessWidget {
  const _Connector({required this.colour});

  final Color? colour;

  @override
  Widget build(BuildContext context) {
    if (colour == null) return const SizedBox.shrink();
    return Container(
      height: AppMetrics.railConnector,
      decoration: BoxDecoration(
        color: colour,
        borderRadius: BorderRadius.circular(AppRadius.full),
      ),
    );
  }
}

class _Marker extends StatelessWidget {
  const _Marker({
    required this.step,
    required this.selected,
    required this.semanticLabel,
    required this.onTap,
  });

  final ContractStep step;
  final bool selected;
  final String semanticLabel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final (Color fill, Color edge, Widget? glyph) = switch (step.status) {
      // A tick, and only ever for a step that genuinely completed.
      ContractStepStatus.done => (
          AppTint.successChip.fill!,
          AppColors.trust,
          const Icon(Icons.check_rounded, size: AppIconSize.micro, color: AppColors.trust),
        ),
      // Filled: a solid inner disc, so "here" survives greyscale.
      ContractStepStatus.active => (
          AppTint.eyebrow.fill!,
          AppColors.iris,
          const _ActiveCore(),
        ),
      // A cross. Never a tick (Req 7.3).
      ContractStepStatus.halted => (
          AppTint.alert.fill!,
          AppColors.destructive,
          const Icon(Icons.close_rounded, size: AppIconSize.micro, color: AppColors.destructive),
        ),
      // Unfilled: the card surface, an edge, and nothing inside it.
      ContractStepStatus.pending => (AppColors.card, AppColors.border, null),
    };

    // TapTarget OUTSIDE Semantics, as `widgets/common/controls.dart` records: a
    // render box between the expansion and the gesture clips the expansion away.
    return TapTarget(
      child: Semantics(
        button: true,
        label: semanticLabel,
        hint: 'Show this step',
        child: GestureDetector(
          behavior: HitTestBehavior.opaque,
          onTap: onTap,
          child: Container(
            width: AppMetrics.railMarker,
            height: AppMetrics.railMarker,
            decoration: BoxDecoration(
              color: fill,
              shape: BoxShape.circle,
              border: Border.all(
                color: selected ? AppColors.ring : edge,
                width: AppMetrics.hairline,
              ),
            ),
            child: glyph == null ? null : Center(child: ExcludeSemantics(child: glyph)),
          ),
        ),
      ),
    );
  }
}

/// The filled core of the active marker.
class _ActiveCore extends StatelessWidget {
  const _ActiveCore();

  @override
  Widget build(BuildContext context) {
    return Container(
      width: AppIconSize.micro / 2,
      height: AppIconSize.micro / 2,
      decoration: const BoxDecoration(
        color: AppColors.irisInk,
        shape: BoxShape.circle,
      ),
    );
  }
}
