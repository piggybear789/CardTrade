// The thread body: the ONE surface that turns a list of messages into bubbles,
// runs, contract notices and day marks.
//
// It exists because there were two of them. `conversation_detail_screen.dart` drew
// a timestamp after ten minutes of silence and `conversation_panel.dart` after
// five, each with its own inline system-message branch and its own empty hint — so
// the same conversation grouped differently depending on which screen you opened
// it from, which is exactly what Req 9.4 fixes. The grouping rule itself is
// `message_runs.dart`; this file only draws what that returns.
//
// Requirements 9.1, 9.3, 9.4, 13.7, 13.10, 13.11.

import 'package:flutter/material.dart';

import 'package:cardtrade/core/extensions.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/models/message.dart';

import 'message_bubble.dart';
import 'message_runs.dart';

/// A scrollable, bottom-anchored message thread.
class MessageThread extends StatelessWidget {
  const MessageThread({
    required this.messages,
    required this.currentUserId,
    required this.emptyHint,
    this.controller,
    this.shrinkWrap = false,
    this.padding = const EdgeInsets.symmetric(
      horizontal: AppSpacing.cozy,
      vertical: AppSpacing.snug,
    ),
    this.now,
    super.key,
  });

  /// The conversation's messages, oldest first, as the stream delivers them.
  final List<Message> messages;

  /// The viewing member, used to decide which side a run sits on.
  final String currentUserId;

  /// What replaces the bubble list while the conversation holds none (Req 9.1).
  final String emptyHint;

  final ScrollController? controller;

  /// Whether the list sizes itself to its content, as the room's panel needs.
  final bool shrinkWrap;

  final EdgeInsets padding;

  /// The instant relative labels are measured against. Injected only by tests.
  final DateTime? now;

  @override
  Widget build(BuildContext context) {
    if (messages.isEmpty) {
      return Padding(
        padding: const EdgeInsets.all(AppSpacing.group),
        child: Center(
          // Req 9.1: `body` level, `--muted-foreground`, centred. Not a smaller
          // size — de-emphasis is the token's job, not the type scale's.
          child: Text(
            emptyHint,
            textAlign: TextAlign.center,
            style: AppText.supportText,
          ),
        ),
      );
    }

    // Reversed so the newest run is item zero of a reversed list: that anchors the
    // thread at the bottom and opens it already scrolled to the latest message,
    // without a post-frame scroll jump.
    final List<MessageRun> runs =
        partitionMessageRuns(messages, currentUserId, now: now)
            .reversed
            .toList(growable: false);

    return ListView.builder(
      controller: controller,
      reverse: true,
      shrinkWrap: shrinkWrap,
      padding: padding,
      itemCount: runs.length,
      itemBuilder: (BuildContext context, int index) {
        final MessageRun run = runs[index];
        return Padding(
          // Req 9.4: one run is separated from the next by at least the `group`
          // step, while the bubbles inside a run sit `tight` apart. The list is
          // reversed, so this run's separation from the one above it is its top
          // inset.
          padding: const EdgeInsets.only(top: AppSpacing.group),
          child: switch (run.kind) {
            MessageRunKind.day => _DayMarker(label: run.dayLabel!),
            MessageRunKind.notice => _NoticeRun(run: run),
            MessageRunKind.authored => _AuthoredRun(run: run),
          },
        );
      },
    );
  }
}

/// A calendar-day separator, centred and authorless.
class _DayMarker extends StatelessWidget {
  const _DayMarker({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) => Center(
        child: Text(
          label,
          style: AppText.metaText.copyWith(fontWeight: FontWeight.w500),
        ),
      );
}

/// A run of contract notices — the room talking, not a person.
///
/// Each notice carries only its clock time because the shared day marker above
/// the run owns the calendar date for both contract and participant activity.
class _NoticeRun extends StatelessWidget {
  const _NoticeRun({required this.run});

  final MessageRun run;

  @override
  Widget build(BuildContext context) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        spacing: AppSpacing.group,
        children: <Widget>[
          for (final Message notice in run.messages)
            Column(
              mainAxisSize: MainAxisSize.min,
              children: <Widget>[
                Text(
                  notice.createdAt.toLocal().timeOnly,
                  textAlign: TextAlign.center,
                  style: AppText.metaText,
                ),
                const SizedBox(height: AppSpacing.tight),
                Text(
                  notice.body,
                  textAlign: TextAlign.center,
                  style: AppText.supportText,
                ),
              ],
            ),
        ],
      );
}

/// A run of consecutive messages from one author, with ONE timestamp after it.
class _AuthoredRun extends StatelessWidget {
  const _AuthoredRun({required this.run});

  final MessageRun run;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment:
          run.mine ? CrossAxisAlignment.end : CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: <Widget>[
        for (int i = 0; i < run.messages.length; i++)
          Padding(
            padding: EdgeInsets.only(top: i == 0 ? 0 : AppSpacing.tight),
            child: MessageBubble(message: run.messages[i], mine: run.mine),
          ),
        const SizedBox(height: AppSpacing.tight),
        // Req 9.4: one timestamp for the run, at the `meta` level, after its last
        // bubble — not one per message.
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AppSpacing.tight),
          child: Text(run.stamp.toLocal().timeOnly, style: AppText.metaText),
        ),
      ],
    );
  }
}
