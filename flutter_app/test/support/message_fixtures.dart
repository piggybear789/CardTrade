// Fixture data and provider overrides for the form-control and message tests,
// and for the form/message golden CASES.
//
// FIXTURES ONLY, for the reason recorded at the head of `listing_fixtures.dart`:
// Req 15.11 requires a golden to build from fixture data rather than a read, and
// a widget test that reaches a database means something different every morning.
//
// EVERY INSTANT IS DERIVED FROM ONE FIXED CLOCK. A message surface is the one
// place in this client where the wall clock is VISIBLE — a run's timestamp, a day
// separator, a conversation row's relative age — so every fixture here takes its
// time from [kFixtureInstant] and every widget under test is handed the same
// instant through its `now` parameter. Without that, half of these assertions are
// true until midnight.
//
// Requirements 8.12, 9.1–9.10, 15.10, 15.11.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/models/conversation.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/models/message.dart';
import 'package:cardtrade/providers/auth_provider.dart';
import 'package:cardtrade/providers/messages_provider.dart';

import 'harness.dart';
import 'listing_fixtures.dart';

/// The fixture conversation.
const String kFixtureConversationId = 'conversation-1';

/// The two people in it: the viewing member and their counterparty.
const String kFixtureViewerId = kFixtureBuyerId;
const String kFixtureOtherId = 'seller-9';

/// The instant every message surface is rendered AT, so `Today`, `12m ago` and a
/// run's clock are the same words on every run of the suite.
final DateTime kMessageNow = kFixtureInstant.add(const Duration(hours: 2));

/// A message as the stream delivers it.
///
/// [minutesAgo] is measured back from [kMessageNow], which is how a run fixture
/// states itself: "these two are three minutes apart" is the rule Req 9.4 is
/// about, and an absolute timestamp per message hides it.
Message makeMessage({
  required String id,
  String? senderId = kFixtureOtherId,
  String body = 'Still available?',
  MessageKind kind = MessageKind.user,
  String? systemEvent,
  double minutesAgo = 0,
  DateTime? createdAt,
  String? attachmentPath,
  String? attachmentName,
  String? attachmentMime,
  int? attachmentBytes,
}) {
  return Message(
    id: id,
    conversationId: kFixtureConversationId,
    senderId: kind == MessageKind.system ? null : senderId,
    kind: kind,
    systemEvent: systemEvent,
    body: body,
    createdAt: createdAt ??
        kMessageNow.subtract(
          Duration(milliseconds: (minutesAgo * 60000).round()),
        ),
    attachmentPath: attachmentPath,
    attachmentName: attachmentName,
    attachmentMime: attachmentMime,
    attachmentBytes: attachmentBytes,
  );
}

/// A contract notice — the room talking, which ends a run in both directions.
Message makeNotice({
  required String id,
  String body = 'Payment received. The seller can post the card.',
  double minutesAgo = 0,
}) =>
    makeMessage(
      id: id,
      kind: MessageKind.system,
      systemEvent: 'PAYMENT_RECEIVED',
      body: body,
      minutesAgo: minutesAgo,
    );

/// An image attachment with no body text — the case Req 9.5 singles out.
Message makeImageMessage({
  String id = 'message-photo',
  String? senderId = kFixtureOtherId,
  String body = '',
  double minutesAgo = 0,
}) =>
    makeMessage(
      id: id,
      senderId: senderId,
      body: body,
      minutesAgo: minutesAgo,
      attachmentPath: '$kFixtureOtherId/back-of-card.jpg',
      attachmentName: 'back-of-card.jpg',
      attachmentMime: 'image/jpeg',
      attachmentBytes: 428_000,
    );

/// A document attachment, which is a named row rather than a thumbnail.
Message makeFileMessage({
  String id = 'message-file',
  String? senderId = kFixtureOtherId,
  String body = '',
  double minutesAgo = 0,
}) =>
    makeMessage(
      id: id,
      senderId: senderId,
      body: body,
      minutesAgo: minutesAgo,
      attachmentPath: '$kFixtureOtherId/grading-report.pdf',
      attachmentName: 'grading-report.pdf',
      attachmentMime: 'application/pdf',
      attachmentBytes: 31_744,
    );

/// A conversation row as the list reads it.
Conversation makeConversation({
  String id = kFixtureConversationId,
  String? otherParticipantName = 'CardMaster',
  String? lastMessageBody = 'Posted it this morning, tracking to follow.',
  double minutesAgo = 12,
  int? unreadCount,
  String? tradeId,
  String? cashSaleId,
}) {
  return Conversation(
    id: id,
    participantA: kFixtureViewerId,
    participantB: kFixtureOtherId,
    tradeId: tradeId,
    cashSaleId: cashSaleId,
    otherParticipantName: otherParticipantName,
    lastMessageBody: lastMessageBody,
    lastMessageAt: kMessageNow.subtract(
      Duration(milliseconds: (minutesAgo * 60000).round()),
    ),
    createdAt: kFixtureInstant,
    unreadCount: unreadCount,
  );
}

/// A body of exactly [length] characters, wrapping onto many lines.
///
/// Built by padding rather than typed out, so the number in an assertion is the
/// number the widget reads (the same reason `descriptionOfLength` exists).
String bodyOfLength(int length) {
  const String seed = 'Happy to post today if you are. ';
  final StringBuffer buffer = StringBuffer();
  while (buffer.length < length) {
    buffer.write(seed);
  }
  return buffer.toString().substring(0, length);
}

/// A single word of [length] characters, with no break opportunity in it.
///
/// The case a hand-picked fixture set always misses (Property 17): a body that
/// cannot wrap is the one that overflows its bubble's bound.
String unbrokenRunOfLength(int length) => 'x' * length;

/// Everything `ConversationPanel` watches, for one conversation.
///
/// `messagesServiceProvider` is deliberately NOT overridden: it is read only when
/// a send is submitted, and a fake that silently succeeded would let a render test
/// assert a transport it never exercised.
List<Override> conversationPanelOverrides({
  required List<Message> messages,
  String? viewerId = kFixtureViewerId,
  String conversationId = kFixtureConversationId,
}) {
  return <Override>[
    messagesStreamProvider(conversationId)
        .overrideWith((ref) => Stream<List<Message>>.value(messages)),
    currentUserProvider
        .overrideWithValue(viewerId == null ? null : makeUser(viewerId)),
  ];
}

/// Pumps a message or form surface at a fixed viewport and text scale.
///
/// Three pumps rather than `pumpAndSettle`: a composer's cursor blinks and a
/// thumbnail's request never resolves, so a settle would time out on a normal
/// state rather than on a defect.
Future<void> pumpMessageSurface(
  WidgetTester tester,
  Widget child, {
  double textScaleFactor = 1.0,
  Size surface = kPhoneViewport,
  List<Override> overrides = const <Override>[],
  bool scaffold = true,
}) async {
  await setViewport(tester, surface);
  await tester.pumpWidget(
    withOverrides(
      pumpFixture(
        child,
        textScaleFactor: textScaleFactor,
        reduceMotion: true,
        scaffold: scaffold,
      ),
      overrides,
    ),
  );
  await tester.pump();
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 250));
}
