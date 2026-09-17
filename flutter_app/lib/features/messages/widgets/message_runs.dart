// Run partitioning for a message thread, and the ONE place Req 9.4's grouping
// rule is expressed.
//
// A run is consecutive messages from the same author sent within five minutes of
// one another, ended by a change of calendar day or by a contract notice. It gets
// ONE timestamp after its last bubble rather than one per message, which is the
// whole point: a burst of four short replies used to carry four clocks and read as
// four separate exchanges.
//
// This is deliberately a pure function over a list, separate from the widget that
// draws it, so Property 16 can assert the partition without pumping a frame. The
// previous grouping lived inline in two places — `conversation_detail_screen.dart`
// showed a stamp after ten minutes of silence and `conversation_panel.dart` after
// five — so the same thread grouped differently in a room and in the inbox.
//
// It is presentation, not a rule: it decides where a clock is drawn and nothing
// about eligibility, money or contract state (Req 14.12).
//
// Requirements 9.4.

import '../../../core/relative_time.dart';
import '../../../models/message.dart';

/// A run ends after this much silence between two messages from one author.
const Duration kMessageRunGap = Duration(minutes: 5);

/// What a thread draws at one position in the list.
enum MessageRunKind {
  /// A calendar-day separator shared by participant and contract activity.
  day,

  /// A run of contract notices — the room talking, not a person.
  notice,

  /// A run of consecutive messages from one author.
  authored,
}

/// One item in a partitioned thread.
class MessageRun {
  MessageRun._({
    required this.kind,
    required this.messages,
    required this.mine,
    required this.dayLabel,
  });

  /// Which of the three shapes this run is.
  final MessageRunKind kind;

  /// The messages in this run, oldest first. Empty only for [MessageRunKind.day].
  final List<Message> messages;

  /// Whether the viewing member authored this run. Always false for a notice run.
  final bool mine;

  /// The separator's copy. Non-null only for [MessageRunKind.day].
  final String? dayLabel;

  /// A stable identity for a list builder: the first message's id, or the day.
  String get key => switch (kind) {
        MessageRunKind.day => 'day-$dayLabel',
        _ => '${kind.name}-${messages.first.id}',
      };

  /// The instant the run's single timestamp reports: its last message's.
  DateTime get stamp => messages.last.createdAt;
}

/// Partitions [messages] — oldest first — into day marks, notice runs and
/// authored runs, per Req 9.4.
///
/// [now] is injected only so a day separator can say `Today` deterministically in
/// a golden; it plays no part in the partition itself.
List<MessageRun> partitionMessageRuns(
  List<Message> messages,
  String currentUserId, {
  DateTime? now,
}) {
  final List<MessageRun> runs = <MessageRun>[];
  DateTime? lastDay;

  for (final Message message in messages) {
    final DateTime day = calendarDay(message.createdAt);
    final bool newDay = lastDay == null || day != lastDay;
    if (newDay) {
      runs.add(MessageRun._(
        kind: MessageRunKind.day,
        messages: <Message>[],
        mine: false,
        dayLabel: dayMarkerLabel(message.createdAt, now: now),
      ));
      lastDay = day;
    }

    if (message.isSystem) {
      // Contract notices share the thread's calendar chronology. A run cannot
      // cross a Cash_Sale boundary, and AGREEMENT_CREATED also splits legacy
      // rows written before migration 0113 carried cash_sale_id.
      final MessageRun? open = runs.isEmpty ? null : runs.last;
      final bool startsContract = message.systemEvent == 'AGREEMENT_CREATED';
      final bool sameCashSale = open != null &&
          open.kind == MessageRunKind.notice &&
          open.messages.last.cashSaleId == message.cashSaleId;
      if (sameCashSale && !startsContract) {
        open.messages.add(message);
      } else {
        runs.add(MessageRun._(
          kind: MessageRunKind.notice,
          messages: <Message>[message],
          mine: false,
          dayLabel: null,
        ));
      }
      continue;
    }

    final MessageRun? open = runs.isEmpty ? null : runs.last;
    final bool canMerge = !newDay &&
        open != null &&
        open.kind == MessageRunKind.authored &&
        _authorOf(open.messages.last) == _authorOf(message) &&
        message.createdAt.difference(open.messages.last.createdAt).abs() <=
            kMessageRunGap;

    if (canMerge) {
      open.messages.add(message);
    } else {
      runs.add(MessageRun._(
        kind: MessageRunKind.authored,
        messages: <Message>[message],
        mine: message.isMine(currentUserId),
        dayLabel: null,
      ));
    }
  }

  return runs;
}

/// A message's author, with a null sender treated as one anonymous author rather
/// than as a distinct one per message.
String _authorOf(Message message) => message.senderId ?? '';
