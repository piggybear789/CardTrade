// What has already happened on this contract, oldest first — the web's contract
// timeline as a phone-width list.
//
// EVERY ROW IS A TIMESTAMP THE SERVER RECORDED ON THE CONTRACT ROW. A room builds
// this list by naming the timestamps it already received and dropping the ones
// that are null; nothing here decides what happened, infers an event from a state,
// or orders events by anything other than the instants themselves (Req 14.12).
//
// This region is register-primary in the design's coverage map (entry R6): the
// events are contract data, so a fixture pins this widget's appearance and a
// reviewer walks one real sale and one real trade for phrasing and density.
//
// Requirements 7.1, 13.11.

import 'package:flutter/material.dart';

import 'package:cardtrade/core/extensions.dart';
import 'package:cardtrade/core/theme.dart';

/// One thing that happened, and when.
class ContractEvent {
  const ContractEvent({required this.label, required this.at});

  /// What happened, in member-facing words.
  final String label;

  /// When the server recorded it.
  final DateTime at;
}

/// The contract's history, oldest first.
class ContractTimeline extends StatelessWidget {
  const ContractTimeline({required this.events, super.key});

  /// The events to present. A room passes only the timestamps it holds; this
  /// widget sorts them and renders nothing where there are none.
  final List<ContractEvent> events;

  @override
  Widget build(BuildContext context) {
    if (events.isEmpty) return const SizedBox.shrink();

    final List<ContractEvent> ordered = List<ContractEvent>.of(events)
      ..sort((ContractEvent a, ContractEvent b) => a.at.compareTo(b.at));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      spacing: AppSpacing.cozy,
      children: <Widget>[
        for (final ContractEvent event in ordered) _EventRow(event: event),
      ],
    );
  }
}

class _EventRow extends StatelessWidget {
  const _EventRow({required this.event});

  final ContractEvent event;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      spacing: AppSpacing.snug,
      children: <Widget>[
        // A marker, not a colour: the row's meaning is entirely in its words, so
        // this is decoration and is hidden from assistive technology.
        ExcludeSemantics(
          child: Padding(
            padding: const EdgeInsets.only(top: AppSpacing.tight),
            child: Container(
              width: AppMetrics.railConnector,
              height: AppMetrics.railConnector,
              decoration: const BoxDecoration(
                color: AppColors.mutedForeground,
                shape: BoxShape.circle,
              ),
            ),
          ),
        ),
        Expanded(child: Text(event.label, style: AppText.bodyText)),
        Text(
          event.at.shortDate,
          style: AppText.metaText,
          textAlign: TextAlign.right,
        ),
      ],
    );
  }
}
