// The message golden CASES — the thread states, the composer and the conversation
// row — staged ahead of the harness that captures them.
//
// THIS FILE STILL HOLDS NO `matchesGoldenFile` CALL, for the reason recorded at the
// head of `test/golden/shell/shell_golden_cases.dart`: a case declares a name, a
// surface, the scales it is captured at and the tree to capture, and says nothing
// about pixels. `message_golden_test.dart` walks this list through the harness and
// owns the references in `goldens/`; `message_cases_test.dart` builds every case at
// every declared scale and asserts it lays out, which runs on every host unlike the
// comparison.
//
// The references were captured only after `test/golden/_harness/` existed to pin the
// designated host, the typeface, the device pixel ratio, the clock, the text-scale cap
// and the animations. An image taken before that would have to be re-baselined for a
// reason that is not a design change, which is the one thing Req 15.12 forbids.
//
// EVERY INSTANT IS PINNED, AND THIS IS THE AREA WHERE THAT MATTERS MOST. A thread
// draws a day separator, a run clock and a relative age, all read from a `now` this
// client injects. Every case below hands the surface [kMessageNow] rather than
// letting it call `DateTime.now()`, so `Today` and `12m ago` are the same words in
// the reference image as in the capture — a relative label read from the wall clock
// is a time bomb in every golden (Req 15.11).
//
// THE IMAGE CASE IS THE UNRESOLVED-ATTACHMENT BRANCH, DELIBERATELY. The attachment
// bucket is private and the mobile write API exposes no participation-checked
// signing call, so a thread on this client draws the labelled placeholder rather
// than the photo. Capturing a real image would need a network read, which Req 15.11
// forbids, and would capture a state this client cannot currently reach. The gap is
// recorded in `.kiro/specs/mobile-parity/`.
//
// Both attachment references therefore also carry the announced handoff to the
// thread on the web (Req 12.6): the placeholder is what a member sees, so the
// sentence telling them where the file CAN be read is part of the state being
// captured, not an addition to it.
//
// Requirements 9.10, 12.6, 13.13, 15.10, 15.11.

import 'package:flutter/material.dart';

import 'package:cardtrade/features/messages/widgets/conversation_tile.dart';
import 'package:cardtrade/features/messages/widgets/message_input.dart';
import 'package:cardtrade/features/messages/widgets/message_thread.dart';
import 'package:cardtrade/models/message.dart';

import '../../support/message_fixtures.dart';

/// The phone surface every message golden is captured on.
const Size kMessageGoldenSurface = Size(390, 844);

/// One golden case: a name, a surface, the text scales it is captured at, and the
/// tree to capture.
@immutable
class MessageGoldenCase {
  const MessageGoldenCase({
    required this.name,
    required this.build,
    this.surface = kMessageGoldenSurface,
    this.textScales = const <double>[1.0, 2.0],
  });

  /// File-name stem. The harness appends the scale, so `thread_one_run` becomes
  /// `thread_one_run@1.0x.png` and `…@2.0x.png`.
  ///
  /// Member-facing vocabulary, and never a retired word.
  final String name;

  /// The tree under test, built fresh per scale.
  final Widget Function() build;

  final Size surface;

  /// Req 13.13 pairs every state with a 2.0 twin at the same surface size.
  final List<double> textScales;
}

/// A thread over [messages], at the pinned instant.
///
/// The thread is given the whole surface rather than a shrink-wrapped box, because
/// Req 9.3's bound is a fraction of the VIEWPORT and a thread captured inside a
/// smaller box would measure a different bubble width than the app draws.
MessageGoldenCase _threadCase(String name, List<Message> messages) =>
    MessageGoldenCase(
      name: name,
      build: () => MessageThread(
        messages: messages,
        currentUserId: kFixtureViewerId,
        emptyHint: 'No messages yet',
        now: kMessageNow,
      ),
    );

/// The thread states Req 9.10 requires: an own message, a counterparty message, an
/// attachment-only message, a run of consecutive messages from one author, and a
/// thread holding no messages.
final List<MessageGoldenCase> kMessageThreadGoldenCases = <MessageGoldenCase>[
  _threadCase('thread_own_message', <Message>[
    makeMessage(
      id: 'm1',
      senderId: kFixtureViewerId,
      body: 'Posted it this morning.',
      minutesAgo: 6,
    ),
  ]),
  _threadCase('thread_counterparty_message', <Message>[
    makeMessage(id: 'm1', body: 'Still available?', minutesAgo: 6),
  ]),
  // Both sides at once, because the pair of tokens is what a reviewer compares and
  // a swap between them is invisible in either single-sided capture.
  _threadCase('thread_both_sides', <Message>[
    makeMessage(id: 'm1', body: 'Still available?', minutesAgo: 20),
    makeMessage(
      id: 'm2',
      senderId: kFixtureViewerId,
      body: 'It is. Happy to post today.',
      minutesAgo: 18,
    ),
  ]),
  // Req 9.5: no body area and no placeholder line under the attachment.
  _threadCase('thread_attachment_only', <Message>[
    makeImageMessage(minutesAgo: 4),
  ]),
  _threadCase('thread_document_attachment', <Message>[
    makeFileMessage(minutesAgo: 4),
  ]),
  // Req 9.4: four bubbles, `tight` apart, under ONE clock.
  _threadCase('thread_one_run', <Message>[
    makeMessage(id: 'm1', body: 'Two things.', minutesAgo: 9),
    makeMessage(id: 'm2', body: 'It is sleeved.', minutesAgo: 8),
    makeMessage(id: 'm3', body: 'And it is graded.', minutesAgo: 7),
    makeMessage(id: 'm4', body: 'Photos on the listing.', minutesAgo: 6),
  ]),
  // A run ended by a contract notice, which is the boundary the rule turns on and
  // the one a single-run capture cannot show.
  _threadCase('thread_run_broken_by_notice', <Message>[
    makeMessage(id: 'm1', body: 'Paying now.', minutesAgo: 12),
    makeNotice(id: 'n1', minutesAgo: 11),
    makeMessage(id: 'm2', body: 'Thanks, posting today.', minutesAgo: 10),
  ]),
  _threadCase('thread_empty', const <Message>[]),
];

/// The composer's own states. Not named by Req 9.10, but Req 9.6 puts bounds on it
/// that only a picture makes reviewable: one line at rest and four at the ceiling.
final List<MessageGoldenCase> kComposerGoldenCases = <MessageGoldenCase>[
  MessageGoldenCase(
    name: 'composer_at_rest',
    build: () => Align(
      alignment: Alignment.bottomCenter,
      child: MessageInput(onSubmit: (String _) async => null),
    ),
  ),
  MessageGoldenCase(
    name: 'composer_send_unavailable',
    build: () => Align(
      alignment: Alignment.bottomCenter,
      child: MessageInput(enabled: false, onSubmit: (String _) async => null),
    ),
  ),
];

/// The conversation row's states: read, unread, and the capped count.
final List<MessageGoldenCase> kConversationRowGoldenCases = <MessageGoldenCase>[
  MessageGoldenCase(
    name: 'conversation_row_read',
    build: () => Align(
      alignment: Alignment.topCenter,
      child: ConversationTile(
        conversation: makeConversation(),
        onTap: _noop,
        now: kMessageNow,
      ),
    ),
  ),
  MessageGoldenCase(
    name: 'conversation_row_unread',
    build: () => Align(
      alignment: Alignment.topCenter,
      child: ConversationTile(
        conversation: makeConversation(unreadCount: 3, cashSaleId: 'sale-1'),
        onTap: _noop,
        now: kMessageNow,
      ),
    ),
  ),
  MessageGoldenCase(
    name: 'conversation_row_unread_capped',
    build: () => Align(
      alignment: Alignment.topCenter,
      child: ConversationTile(
        conversation: makeConversation(unreadCount: 140),
        onTap: _noop,
        now: kMessageNow,
      ),
    ),
  ),
];

/// Every message golden case: threads, then the composer, then the rows.
final List<MessageGoldenCase> kMessageGoldenCases = <MessageGoldenCase>[
  ...kMessageThreadGoldenCases,
  ...kComposerGoldenCases,
  ...kConversationRowGoldenCases,
];

/// A tap callback that does nothing, so a row renders as interactive without a
/// case needing a closure of its own.
void _noop() {}
