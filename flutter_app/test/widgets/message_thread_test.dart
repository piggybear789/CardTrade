// Feature: mobile-visual-parity — Property 17, plus the drawn half of Req 9.
//
// Property 17: For any body of up to 4000 characters, including unbroken runs,
// newlines and non-ASCII, the rendered bubble presents the entire text and its
// width does not exceed 82 percent of the viewport.
//
// The unbroken-run case is the one a hand-picked fixture set always misses, so the
// generated set below is built AROUND it: a body with no break opportunity is the
// only one that can push a bubble past its own bound, and it is exactly what a
// pasted tracking number or a URL is.
//
// This file also asserts what `message_runs_test.dart` cannot: that the thread
// DRAWS one clock per run, that the two token pairs land on the right sides, that
// an attachment-only message has no body area, and that a conversation row signals
// unread three ways rather than one.
//
// Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.8, 9.9, 13.10

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/core/web_handoff.dart';
import 'package:cardtrade/features/messages/widgets/message_bubble.dart';
import 'package:cardtrade/features/messages/widgets/message_thread.dart';
import 'package:cardtrade/features/messages/widgets/conversation_tile.dart';
import 'package:cardtrade/models/message.dart';
import 'package:cardtrade/widgets/common/conversation_panel.dart';

import '../support/harness.dart';
import '../support/message_fixtures.dart';

/// The bubble's own box, which is what Req 9.3 bounds — not the [MessageBubble]
/// widget, whose `Align` deliberately fills the thread's width so the bubble can
/// sit against either edge.
Size bubbleSize(WidgetTester tester, {int index = 0}) {
  final Finder box = find.descendant(
    of: find.byType(MessageBubble),
    matching: find.byType(ClipRRect),
  );
  return tester.getSize(box.at(index));
}

/// The bubble's fill, read from the decoration rather than from a pixel.
Color bubbleFill(WidgetTester tester, {int index = 0}) {
  final Finder box = find.descendant(
    of: find.byType(MessageBubble),
    matching: find.byType(DecoratedBox),
  );
  final DecoratedBox decorated = tester.widget<DecoratedBox>(box.at(index));
  return (decorated.decoration as BoxDecoration).color!;
}

Widget scrollable(Widget child) => SingleChildScrollView(child: child);

/// Every label in the semantics tree, joined.
///
/// A conversation row is ONE tappable node, so the row's avatar initial, name,
/// preview, time and unread marker all merge into a single label — which is
/// correct for a row a member activates as a whole, and is why these assertions
/// look for a phrase inside the node rather than for a node of their own.
String spokenText(WidgetTester tester) => allSemanticsNodes(tester)
    .map((SemanticsNode node) => node.getSemanticsData().label)
    .join('\n');

void main() {
  group('Property 17: a bubble contains its whole body within its bound', () {
    // 82 percent of the phone viewport. Stated here as the requirement states it
    // rather than read from the metric, so a change to the metric is a failure
    // here and not a silently-agreed change.
    final double bound = kPhoneViewport.width * 0.82;

    final Map<String, String> bodies = <String, String>{
      'a single character': 'k',
      'one short line': 'Still available?',
      'a wrapping paragraph': bodyOfLength(400),
      'the 4000-character ceiling': bodyOfLength(4000),
      'an unbroken run of 40': unbrokenRunOfLength(40),
      'an unbroken run of 400': unbrokenRunOfLength(400),
      'an unbroken run of 4000': unbrokenRunOfLength(4000),
      'author-typed newlines': 'Two cards:\n\n- Charizard\n- Blastoise\n',
      'non-ASCII': 'Pokémon カード、ホロ — 状態は良好です。ありがとう 🎴',
      'a mixed body': '${bodyOfLength(120)}\n${unbrokenRunOfLength(90)}\nok',
    };

    for (final MapEntry<String, String> entry in bodies.entries) {
      for (final bool mine in <bool>[true, false]) {
        testWidgets(
          '${entry.key}, ${mine ? 'own' : 'counterparty'} bubble',
          (tester) async {
            await pumpMessageSurface(
              tester,
              scrollable(
                MessageBubble(
                  message: makeMessage(id: 'm1', body: entry.value),
                  mine: mine,
                ),
              ),
            );

            // ─── the whole body is presented ──────────────────────────
            //
            // Req 9.1 forbids truncating any part of it, so the assertion is on
            // the laid-out paragraph and not on the widget's arguments: a
            // `maxLines` added to the bubble would pass an argument check and
            // still cut the text.
            final RenderParagraph paragraph =
                allParagraphs(tester).single;
            expect(paragraph.text.toPlainText(), entry.value.trim());
            expectNoTruncatedText(tester, context: entry.key);
            expectNoLayoutOverflow(tester);

            // ─── and it fits inside the bound ─────────────────────────
            expect(
              bubbleSize(tester).width,
              lessThanOrEqualTo(bound + 0.01),
              reason: '${entry.key} exceeded 82 percent of the viewport',
            );
          },
        );
      }
    }

    testWidgets('the bound holds at a 2.0 text scale', (tester) async {
      // The width bound is a fraction of the VIEWPORT, so a larger face must
      // reflow rather than widen. This is the pair Req 13.13 covers in pixels and
      // this covers in geometry.
      await pumpMessageSurface(
        tester,
        scrollable(
          MessageBubble(
            message: makeMessage(id: 'm1', body: unbrokenRunOfLength(200)),
            mine: false,
          ),
        ),
        textScaleFactor: 2.0,
      );

      expect(bubbleSize(tester).width, lessThanOrEqualTo(bound + 0.01));
      expectNoLayoutOverflow(tester);
    });

    testWidgets('the bound holds on the narrowest committed viewport',
        (tester) async {
      await pumpMessageSurface(
        tester,
        scrollable(
          MessageBubble(
            message: makeMessage(id: 'm1', body: bodyOfLength(600)),
            mine: true,
          ),
        ),
        surface: kNarrowViewport,
      );

      expect(
        bubbleSize(tester).width,
        lessThanOrEqualTo(kNarrowViewport.width * 0.82 + 0.01),
      );
      expectNoLayoutOverflow(tester);
    });
  });

  group('Req 9.2 and 9.3: the bubble wears the web pair and side', () {
    testWidgets('an own bubble is --primary on --primary-foreground',
        (tester) async {
      await pumpMessageSurface(
        tester,
        MessageBubble(message: makeMessage(id: 'm1'), mine: true),
      );

      expect(bubbleFill(tester), AppColors.primary);
      expect(
        allParagraphs(tester).single.text.style!.color,
        AppColors.primaryForeground,
      );
    });

    testWidgets('a counterparty bubble is --muted on --foreground',
        (tester) async {
      await pumpMessageSurface(
        tester,
        MessageBubble(message: makeMessage(id: 'm1'), mine: false),
      );

      expect(bubbleFill(tester), AppColors.muted);
      expect(
        allParagraphs(tester).single.text.style!.color,
        AppColors.foreground,
      );
    });

    testWidgets('own sits trailing, counterparty leading', (tester) async {
      await pumpMessageSurface(
        tester,
        MessageThread(
          messages: <Message>[
            makeMessage(id: 'theirs', senderId: kFixtureOtherId, minutesAgo: 20),
            makeMessage(id: 'mine', senderId: kFixtureViewerId, minutesAgo: 1),
          ],
          currentUserId: kFixtureViewerId,
          emptyHint: 'No messages yet',
          now: kMessageNow,
        ),
      );

      // The thread is reversed, so index 0 of the finder is the newest bubble —
      // the viewer's own. Each box is compared against the thread's centre line
      // rather than against the other box, which is what "against the edge"
      // means and what stays true when one bubble is much shorter.
      final double centre = kPhoneViewport.width / 2;
      final Rect ownBox = tester
          .getRect(find.descendant(
            of: find.byType(MessageBubble),
            matching: find.byType(ClipRRect),
          ).at(0));
      final Rect theirBox = tester
          .getRect(find.descendant(
            of: find.byType(MessageBubble),
            matching: find.byType(ClipRRect),
          ).at(1));

      expect(ownBox.right, greaterThan(centre));
      expect(ownBox.left, greaterThan(theirBox.left));
      expect(theirBox.left, lessThan(centre));
    });
  });

  group('Req 9.5: an attachment is presented, and never as a blank line', () {
    testWidgets('an attachment-only message has no body area', (tester) async {
      await pumpMessageSurface(
        tester,
        MessageBubble(message: makeImageMessage(), mine: false),
      );

      // The unavailable branch is the NORMAL one on this client: the bucket is
      // private and the mobile write API exposes no signing call, so the bubble
      // says a photo is there and where it can be read (Req 12.6). What it must
      // not do is draw an empty line box where the body would have been.
      // The icon font's glyph is dropped: the outbound marker on the handoff row
      // is a paragraph too, and asserting a code point tests the font.
      final List<String> texts = allParagraphs(tester)
          .where(
            (RenderParagraph p) => p.text.style?.fontFamily != 'MaterialIcons',
          )
          .map((RenderParagraph p) => p.text.toPlainText())
          .toList();
      expect(
        texts,
        <String>[
          'Photo',
          MessageBubble.attachmentHandoffNotice(
            WebHandoff.conversation(kFixtureConversationId),
          ),
        ],
      );
      expectNoLayoutOverflow(tester);
    });

    testWidgets('a thumbnail is square and bounded to 224', (tester) async {
      await pumpMessageSurface(
        tester,
        MessageBubble(message: makeImageMessage(), mine: false),
      );

      final Size thumb = tester.getSize(find.byType(AspectRatio));
      expect(thumb.width, thumb.height);
      expect(thumb.width, lessThanOrEqualTo(AppMetrics.attachmentThumb));
    });

    testWidgets('the thumbnail stays inside the bubble on a narrow viewport',
        (tester) async {
      // 82 percent of 320 is 262, and a hard `SizedBox(224)` would still fit
      // there — the case that catches a fixed size is a viewport under about 273.
      await pumpMessageSurface(
        tester,
        MessageBubble(message: makeImageMessage(), mine: false),
        surface: const Size(260, 600),
      );

      final Size thumb = tester.getSize(find.byType(AspectRatio));
      expect(thumb.width, lessThanOrEqualTo(260 * 0.82 + 0.01));
      expectNoLayoutOverflow(tester);
    });

    testWidgets('a document attachment names the file and its size',
        (tester) async {
      await pumpMessageSurface(
        tester,
        MessageBubble(message: makeFileMessage(), mine: false),
      );

      expect(find.text('grading-report.pdf'), findsOneWidget);
      expect(find.text('31 KB'), findsOneWidget);
    });

    test('a file size reads in the web\'s own words', () {
      expect(MessageBubble.formatAttachmentBytes(0), '0 B');
      expect(MessageBubble.formatAttachmentBytes(1023), '1023 B');
      // The boundaries, because a unit that flips one byte early reads as a
      // rounding bug to anyone comparing the two clients.
      expect(MessageBubble.formatAttachmentBytes(1024), '1 KB');
      expect(MessageBubble.formatAttachmentBytes(1024 * 1024 - 1), '1024 KB');
      expect(MessageBubble.formatAttachmentBytes(1024 * 1024), '1.0 MB');
      expect(MessageBubble.formatAttachmentBytes(2_516_582), '2.4 MB');
    });

    testWidgets('an attachment with a body draws both', (tester) async {
      await pumpMessageSurface(
        tester,
        MessageBubble(
          message: makeImageMessage(body: 'Back of the card, as promised.'),
          mine: false,
        ),
      );

      expect(find.text('Back of the card, as promised.'), findsOneWidget);
      expect(find.byType(AspectRatio), findsOneWidget);
    });
  });

  group('Req 9.4: the thread draws one clock per run', () {
    testWidgets('four messages in one run carry one timestamp', (tester) async {
      await pumpMessageSurface(
        tester,
        MessageThread(
          messages: <Message>[
            for (int i = 0; i < 4; i++)
              makeMessage(
                id: 'm$i',
                senderId: kFixtureOtherId,
                body: 'line $i',
                minutesAgo: (4 - i).toDouble(),
              ),
          ],
          currentUserId: kFixtureViewerId,
          emptyHint: 'No messages yet',
          now: kMessageNow,
        ),
      );

      expect(find.byType(MessageBubble), findsNWidgets(4));
      // One day mark plus one run stamp. Four clocks under four bubbles is what
      // this replaced, and it read as four separate exchanges.
      expect(find.text('Today'), findsOneWidget);
      final List<String> metaTexts = allParagraphs(tester)
          .map((RenderParagraph p) => p.text.toPlainText())
          .where((String text) => RegExp(r'^\d{1,2}:\d{2}').hasMatch(text))
          .toList();
      expect(metaTexts, hasLength(1));
    });

    testWidgets('an empty thread presents a centred hint, not a list',
        (tester) async {
      await pumpMessageSurface(
        tester,
        const MessageThread(
          messages: <Message>[],
          currentUserId: kFixtureViewerId,
          emptyHint: 'No messages yet',
        ),
      );

      expect(find.byType(MessageBubble), findsNothing);
      expect(find.byType(ListView), findsNothing);
      final RenderParagraph hint = allParagraphs(tester).single;
      expect(hint.text.toPlainText(), 'No messages yet');
      // Req 9.1: `body` level in `--muted-foreground`, not a smaller face.
      expect(hint.text.style!.fontSize, AppText.supportText.fontSize);
      expect(hint.text.style!.color, AppColors.mutedForeground);
    });

    testWidgets('a contract notice is centred and carries its own date',
        (tester) async {
      await pumpMessageSurface(
        tester,
        MessageThread(
          messages: <Message>[
            makeMessage(id: 'm1', minutesAgo: 30),
            makeNotice(id: 'n1', minutesAgo: 10),
          ],
          currentUserId: kFixtureViewerId,
          emptyHint: 'No messages yet',
          now: kMessageNow,
        ),
      );

      // The notice is not a bubble, so exactly one bubble is in the tree.
      expect(find.byType(MessageBubble), findsOneWidget);
      expect(
        find.text('Payment received. The seller can post the card.'),
        findsOneWidget,
      );
      expectNoLayoutOverflow(tester);
    });

    testWidgets('the embedded panel and the thread group identically',
        (tester) async {
      // The defect this replaced: the panel stamped after ten minutes of silence
      // and the standalone screen after five, so one conversation grouped two
      // ways depending on where it was opened.
      final List<Message> messages = <Message>[
        makeMessage(id: 'm0', senderId: kFixtureOtherId, body: 'a', minutesAgo: 8),
        makeMessage(id: 'm1', senderId: kFixtureOtherId, body: 'b', minutesAgo: 6),
        makeMessage(id: 'm2', senderId: kFixtureViewerId, body: 'c', minutesAgo: 5),
      ];

      await pumpMessageSurface(
        tester,
        const ConversationPanel(conversationId: kFixtureConversationId),
        overrides: conversationPanelOverrides(messages: messages),
      );

      expect(find.byType(MessageThread), findsOneWidget);
      expect(find.byType(MessageBubble), findsNWidgets(3));
      final List<String> clocks = allParagraphs(tester)
          .map((RenderParagraph p) => p.text.toPlainText())
          .where((String text) => RegExp(r'^\d{1,2}:\d{2}').hasMatch(text))
          .toList();
      // Two runs — the counterparty's pair and the viewer's single — so two
      // clocks, which is the same partition `message_runs_test.dart` asserts.
      expect(clocks, hasLength(2));
      expectNoLayoutOverflow(tester);
    });
  });

  group('Req 9.8 and 9.9: the conversation row', () {
    testWidgets('presents name, one-line preview and a relative time',
        (tester) async {
      await pumpMessageSurface(
        tester,
        ConversationTile(
          conversation: makeConversation(minutesAgo: 12),
          onTap: () {},
          now: kMessageNow,
        ),
      );

      expect(find.text('CardMaster'), findsOneWidget);
      expect(find.text('12m ago'), findsOneWidget);

      // The preview is the one line in this row that is deliberately truncated:
      // a list of previews that wrapped would be a list of paragraphs.
      final RenderParagraph preview = allParagraphs(tester).firstWhere(
        (RenderParagraph p) => p.text.toPlainText().startsWith('Posted it'),
      );
      expect(preview.maxLines, 1);
      // Req 9.8 separates the preview from the name by TOKEN and WEIGHT, not by
      // size — the Subtext_Rule. Both are at the `body` level.
      expect(preview.text.style!.fontSize, AppText.bodyText.fontSize);
      expect(preview.text.style!.color, AppColors.mutedForeground);
    });

    testWidgets('unread is signalled by weight and a count, not by colour alone',
        (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();

      await pumpMessageSurface(
        tester,
        ConversationTile(
          conversation: makeConversation(unreadCount: 3),
          onTap: () {},
          now: kMessageNow,
        ),
      );

      final RenderParagraph name = allParagraphs(tester)
          .firstWhere((RenderParagraph p) => p.text.toPlainText() == 'CardMaster');
      expect(name.text.style!.fontWeight, FontWeight.w700);
      expect(find.text('3'), findsOneWidget);
      // Req 9.9: the marker is LABELLED with its count, so the signal reaches a
      // screen reader as a number and not as an unnamed dot.
      expect(spokenText(tester), contains('3 unread messages'));

      handle.dispose();
    });

    testWidgets('a read row is semibold, not bold, and carries no marker',
        (tester) async {
      await pumpMessageSurface(
        tester,
        ConversationTile(
          conversation: makeConversation(),
          onTap: () {},
          now: kMessageNow,
        ),
      );

      final RenderParagraph name = allParagraphs(tester)
          .firstWhere((RenderParagraph p) => p.text.toPlainText() == 'CardMaster');
      expect(name.text.style!.fontWeight, FontWeight.w600);
      expect(find.text('0'), findsNothing);
    });

    testWidgets('one unread message is singular', (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();

      await pumpMessageSurface(
        tester,
        ConversationTile(
          conversation: makeConversation(unreadCount: 1),
          onTap: () {},
          now: kMessageNow,
        ),
      );

      expect(spokenText(tester), contains('1 unread message'));

      handle.dispose();
    });

    testWidgets('the count is capped at 99+ and still labelled in full',
        (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();

      await pumpMessageSurface(
        tester,
        ConversationTile(
          conversation: makeConversation(unreadCount: 140),
          onTap: () {},
          now: kMessageNow,
        ),
      );

      // The same threshold Req 4.13 puts on the chrome badge: the DRAWN marker
      // caps, the spoken label does not, because "99+ unread" is less useful than
      // the number when a screen reader is the only signal.
      expect(find.text('99+'), findsOneWidget);
      expect(spokenText(tester), contains('140 unread messages'));
      expect(spokenText(tester), isNot(contains('99+')));

      handle.dispose();
    });

    testWidgets('the whole row is one hit area of at least 48', (tester) async {
      await pumpMessageSurface(
        tester,
        ConversationTile(
          conversation: makeConversation(),
          onTap: () {},
          now: kMessageNow,
        ),
      );

      expect(
        tester.getSize(find.byType(InkWell)).height,
        greaterThanOrEqualTo(AppMetrics.minHitArea),
      );
    });

    testWidgets('reflows without truncating the name at a 2.0 scale',
        (tester) async {
      await pumpMessageSurface(
        tester,
        ConversationTile(
          // Short on purpose: the test font's square glyphs make a realistic name
          // far wider here than in Plus Jakarta Sans, which is the trap
          // `a11y/text_scale_test.dart` records.
          conversation: makeConversation(
            otherParticipantName: 'Sam',
            lastMessageBody: 'Sent.',
          ),
          onTap: () {},
          now: kMessageNow,
        ),
        textScaleFactor: 2.0,
      );

      expectNoLayoutOverflow(tester);
      final RenderParagraph name = allParagraphs(tester)
          .firstWhere((RenderParagraph p) => p.text.toPlainText() == 'Sam');
      expect(name.didExceedMaxLines, isFalse);
    });
  });
}
