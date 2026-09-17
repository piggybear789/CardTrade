// Feature: mobile-visual-parity — Property 16.
//
// Property 16: For any sequence of messages with generated authors, timestamps and
// contract notices, the rendered run partition matches the rule — same author
// within five minutes, broken at a change of calendar day or a contract notice —
// and exactly one timestamp renders per run.
//
// `partitionMessageRuns` is a pure function over a list, which is why it was
// separated from the widget that draws it. The property therefore asserts the
// PARTITION here without pumping a frame; `test/widgets/message_thread_test.dart`
// then asserts that the thread draws one clock per run of it.
//
// Dart has no fast-check, so the generated sequences are built from a seeded
// `Random` in the test, as the design's "Test locations" section prescribes for
// the Flutter-side properties. The seed is fixed so a failure is reproducible.
//
// Validates: Requirements 9.4

import 'dart:math';

import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/core/relative_time.dart';
import 'package:cardtrade/features/messages/widgets/message_runs.dart';
import 'package:cardtrade/models/message.dart';

import 'support/message_fixtures.dart';

/// The three authors a generated sequence draws from: the viewer, the
/// counterparty, and the room itself.
const String _viewer = kFixtureViewerId;
const String _other = kFixtureOtherId;

/// Re-derives the partition rule independently of the implementation, so the
/// property compares two expressions of Req 9.4 rather than the code with itself.
///
/// Deliberately written as the requirement reads, one clause at a time.
List<List<Message>> _expectedGrouping(List<Message> messages) {
  final List<List<Message>> groups = <List<Message>>[];
  for (final Message message in messages) {
    final List<Message>? open = groups.isEmpty ? null : groups.last;
    final bool bothNotices = open != null &&
        open.last.isSystem &&
        message.isSystem &&
        calendarDay(open.last.createdAt) == calendarDay(message.createdAt) &&
        open.last.cashSaleId == message.cashSaleId &&
        message.systemEvent != 'AGREEMENT_CREATED';
    final bool sameAuthoredRun = open != null &&
        !open.last.isSystem &&
        !message.isSystem &&
        open.last.senderId == message.senderId &&
        calendarDay(open.last.createdAt) == calendarDay(message.createdAt) &&
        message.createdAt.difference(open.last.createdAt).abs() <=
            kMessageRunGap;

    if (bothNotices || sameAuthoredRun) {
      open.add(message);
    } else {
      groups.add(<Message>[message]);
    }
  }
  return groups;
}

/// A generated sequence of up to [length] messages, ascending in time.
///
/// The generator is constrained to the shapes the rule actually turns on: gaps
/// either side of the five-minute boundary, midnight crossings, and notices
/// interleaved with authored messages. A uniform generator over hours would
/// almost never produce two messages inside one run, so the interesting half of
/// the partition would go untested.
List<Message> _generateSequence(Random random, int length) {
  DateTime cursor = DateTime(2026, 1, 15, 22, 40);
  final List<Message> messages = <Message>[];

  for (int i = 0; i < length; i++) {
    // Gaps chosen around the boundary, plus one that crosses midnight.
    final Duration gap = switch (random.nextInt(6)) {
      0 => const Duration(seconds: 30),
      1 => const Duration(minutes: 4, seconds: 59),
      2 => kMessageRunGap,
      3 => const Duration(minutes: 5, seconds: 1),
      4 => const Duration(minutes: 40),
      _ => const Duration(hours: 3),
    };
    cursor = cursor.add(gap);

    final int kind = random.nextInt(5);
    messages.add(
      kind == 0
          ? makeNotice(id: 'm$i', minutesAgo: 0).copyWith(createdAt: cursor)
          : makeMessage(
              id: 'm$i',
              senderId: random.nextBool() ? _viewer : _other,
              body: 'line $i',
              createdAt: cursor,
            ),
    );
  }
  return messages;
}

void main() {
  group('Property 16: message runs partition correctly', () {
    test('the partition matches the rule over 200 generated sequences', () {
      final Random random = Random(20260115);

      for (int trial = 0; trial < 200; trial++) {
        final List<Message> messages =
            _generateSequence(random, 1 + random.nextInt(12));
        final List<MessageRun> runs =
            partitionMessageRuns(messages, _viewer, now: kMessageNow);

        // ─── every message appears exactly once, in order ────────────
        final List<String> partitioned = <String>[
          for (final MessageRun run in runs)
            for (final Message message in run.messages) message.id,
        ];
        expect(
          partitioned,
          messages.map((Message m) => m.id).toList(),
          reason: 'the partition dropped, duplicated or reordered a message',
        );

        // ─── the grouping is the rule's grouping ─────────────────────
        final List<List<String>> actual = <List<String>>[
          for (final MessageRun run in runs)
            if (run.kind != MessageRunKind.day)
              run.messages.map((Message m) => m.id).toList(),
        ];
        final List<List<String>> expected = <List<String>>[
          for (final List<Message> group in _expectedGrouping(messages))
            group.map((Message m) => m.id).toList(),
        ];
        expect(actual, expected, reason: 'grouping disagrees with Req 9.4');

        // ─── exactly one timestamp per run ───────────────────────────
        //
        // A run reports ONE stamp, and it is its last message's — which is what
        // "one timestamp after the run's last bubble" means.
        for (final MessageRun run in runs) {
          if (run.kind == MessageRunKind.day) {
            expect(run.messages, isEmpty);
            expect(run.dayLabel, isNotNull);
            continue;
          }
          expect(run.messages, isNotEmpty);
          expect(run.stamp, run.messages.last.createdAt);
        }

        // ─── a day mark precedes every change of calendar day ────────
        final List<String> dayLabels = <String>[
          for (final MessageRun run in runs)
            if (run.kind == MessageRunKind.day) run.dayLabel!,
        ];
        final Set<DateTime> messageDays = <DateTime>{
          for (final Message message in messages)
            calendarDay(message.createdAt),
        };
        expect(
          dayLabels,
          hasLength(messageDays.length),
          reason: 'one day mark per calendar day in the shared thread',
        );

        // ─── keys are unique, so a list builder cannot collide ───────
        final List<String> keys =
            runs.map((MessageRun run) => run.key).toList();
        expect(keys.toSet(), hasLength(keys.length));
      }
    });

    test('two messages five minutes apart to the second are one run', () {
      // The boundary is inclusive: Req 9.4 says "within five minutes", so the
      // five-minute mark itself merges. This is the assertion that fails when the
      // comparison is written `<` instead of `<=`.
      final DateTime first = DateTime(2026, 1, 15, 12, 0);
      final List<MessageRun> runs = partitionMessageRuns(
        <Message>[
          makeMessage(id: 'a', createdAt: first),
          makeMessage(id: 'b', createdAt: first.add(kMessageRunGap)),
        ],
        _viewer,
        now: kMessageNow,
      );
      expect(runs.where((r) => r.kind == MessageRunKind.authored), hasLength(1));
    });

    test('one second past five minutes is two runs', () {
      final DateTime first = DateTime(2026, 1, 15, 12, 0);
      final List<MessageRun> runs = partitionMessageRuns(
        <Message>[
          makeMessage(id: 'a', createdAt: first),
          makeMessage(
            id: 'b',
            createdAt: first.add(kMessageRunGap + const Duration(seconds: 1)),
          ),
        ],
        _viewer,
        now: kMessageNow,
      );
      expect(runs.where((r) => r.kind == MessageRunKind.authored), hasLength(2));
    });

    test('a change of author breaks a run inside the gap', () {
      final DateTime first = DateTime(2026, 1, 15, 12, 0);
      final List<MessageRun> runs = partitionMessageRuns(
        <Message>[
          makeMessage(id: 'a', senderId: _other, createdAt: first),
          makeMessage(
            id: 'b',
            senderId: _viewer,
            createdAt: first.add(const Duration(seconds: 20)),
          ),
        ],
        _viewer,
        now: kMessageNow,
      );
      final List<MessageRun> authored =
          runs.where((r) => r.kind == MessageRunKind.authored).toList();
      expect(authored, hasLength(2));
      expect(authored.first.mine, isFalse);
      expect(authored.last.mine, isTrue);
    });

    test('a contract notice ends a run in both directions', () {
      final DateTime first = DateTime(2026, 1, 15, 12, 0);
      final List<MessageRun> runs = partitionMessageRuns(
        <Message>[
          makeMessage(id: 'a', createdAt: first),
          makeNotice(id: 'n').copyWith(
            createdAt: first.add(const Duration(seconds: 30)),
          ),
          makeMessage(
            id: 'b',
            createdAt: first.add(const Duration(seconds: 60)),
          ),
        ],
        _viewer,
        now: kMessageNow,
      );
      expect(
        runs.map((MessageRun r) => r.kind).toList(),
        <MessageRunKind>[
          MessageRunKind.day,
          MessageRunKind.authored,
          MessageRunKind.notice,
          MessageRunKind.authored,
        ],
      );
    });

    test('consecutive notices from one Cash Sale are one run and never mine', () {
      final DateTime first = DateTime(2026, 1, 15, 12, 0);
      final List<MessageRun> runs = partitionMessageRuns(
        <Message>[
          makeNotice(id: 'n1').copyWith(
            cashSaleId: 'sale-a',
            createdAt: first,
          ),
          makeNotice(id: 'n2').copyWith(
            cashSaleId: 'sale-a',
            createdAt: first.add(const Duration(hours: 9)),
          ),
        ],
        _viewer,
        now: kMessageNow,
      );
      final List<MessageRun> notices =
          runs.where((run) => run.kind == MessageRunKind.notice).toList();
      expect(notices, hasLength(1));
      expect(notices.single.messages, hasLength(2));
      expect(notices.single.mine, isFalse);
    });

    test('one day marker does not merge notices from different Cash Sales', () {
      final DateTime first = DateTime(2026, 1, 15, 9);
      final List<MessageRun> runs = partitionMessageRuns(
        <Message>[
          makeNotice(id: 'n1').copyWith(
            cashSaleId: 'sale-a',
            createdAt: first,
          ),
          makeNotice(id: 'n2').copyWith(
            cashSaleId: 'sale-b',
            createdAt: first.add(const Duration(minutes: 1)),
          ),
        ],
        _viewer,
        now: kMessageNow,
      );
      expect(
        runs.where((run) => run.kind == MessageRunKind.day),
        hasLength(1),
      );
      expect(
        runs.where((run) => run.kind == MessageRunKind.notice),
        hasLength(2),
      );
    });

    test('midnight ends a run eleven minutes wide', () {
      final List<MessageRun> runs = partitionMessageRuns(
        <Message>[
          makeMessage(id: 'a', createdAt: DateTime(2026, 1, 15, 23, 55)),
          makeMessage(id: 'b', createdAt: DateTime(2026, 1, 16, 0, 1)),
        ],
        _viewer,
        now: kMessageNow,
      );
      expect(
        runs.map((MessageRun r) => r.kind).toList(),
        <MessageRunKind>[
          MessageRunKind.day,
          MessageRunKind.authored,
          MessageRunKind.day,
          MessageRunKind.authored,
        ],
      );
    });

    test('an empty thread partitions to nothing', () {
      expect(
        partitionMessageRuns(const <Message>[], _viewer, now: kMessageNow),
        isEmpty,
      );
    });

    test('a null sender is one anonymous author, not one per message', () {
      // `senderId` is nullable on the model. Treating null as distinct per
      // message would split what is visibly one run into single-bubble runs.
      final DateTime first = DateTime(2026, 1, 15, 12, 0);
      final List<MessageRun> runs = partitionMessageRuns(
        <Message>[
          makeMessage(id: 'a', senderId: null, createdAt: first),
          makeMessage(
            id: 'b',
            senderId: null,
            createdAt: first.add(const Duration(seconds: 30)),
          ),
        ],
        _viewer,
        now: kMessageNow,
      );
      expect(runs.where((r) => r.kind == MessageRunKind.authored), hasLength(1));
    });
  });
}
