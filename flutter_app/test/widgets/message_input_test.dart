// Feature: mobile-visual-parity — Property 18.
//
// Property 18: For any two drafts where one is a prefix of the other, the longer
// draft's composer is no shorter, and every draft renders between one and four
// lines.
//
// Both halves matter and they fail differently. A composer that is not MONOTONIC
// jumps as a member types, which is the shape a hand-tuned pill had; one that is
// not BOUNDED grows until the thread it belongs to is off the screen, which is
// what Req 9.6's four-line ceiling exists to stop.
//
// The prefix relation is the generator: it is the only ordering over drafts under
// which "no shorter" is a claim about the composer rather than about the text, and
// it is what typing actually is.
//
// This file also covers Req 9.7, the half of the composer that has nothing to do
// with height: a refused send returns the draft to the field rather than losing it.
//
// Validates: Requirements 9.6, 9.7, 8.10

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/features/messages/widgets/message_input.dart';
import 'package:cardtrade/widgets/common/controls.dart';
import 'package:cardtrade/widgets/common/tap_target.dart';

import '../support/harness.dart';
import '../support/message_fixtures.dart';

/// The composer's own drawn height.
double composerHeight(WidgetTester tester) =>
    tester.getSize(find.byType(MessageInput)).height;

/// The field's controller, which is the composer's private draft.
TextEditingController draftController(WidgetTester tester) =>
    tester.widget<TextField>(find.byType(TextField)).controller!;

/// A composer that records what it was asked to send and answers [failure].
class _RecordingComposer extends StatelessWidget {
  const _RecordingComposer({required this.sent, this.failure});

  final List<String> sent;
  final String? failure;

  @override
  Widget build(BuildContext context) => Align(
        alignment: Alignment.bottomCenter,
        child: MessageInput(
          onSubmit: (String text) async {
            sent.add(text);
            return failure;
          },
        ),
      );
}

Future<void> pumpComposer(
  WidgetTester tester, {
  List<String>? sent,
  String? failure,
  double textScaleFactor = 1.0,
  Size surface = kPhoneViewport,
}) async {
  await pumpMessageSurface(
    tester,
    _RecordingComposer(sent: sent ?? <String>[], failure: failure),
    textScaleFactor: textScaleFactor,
    surface: surface,
  );
}

/// A draft of [lines] wrapped lines, built by newlines rather than by width.
///
/// Newlines rather than a long paragraph on purpose: the number of lines a
/// paragraph wraps onto depends on the font, and the test font's metrics are not
/// the shipped typeface's, so a width-based fixture would assert the ceiling at a
/// different draft length here than on a device.
String draftOfLines(int lines) =>
    List<String>.generate(lines, (int i) => 'line ${i + 1}').join('\n');

void main() {
  group('Property 18: the composer is monotonic and bounded', () {
    testWidgets('a longer prefix is never shorter, and never past four lines',
        (tester) async {
      await pumpComposer(tester);

      // One growing draft, sampled at every prefix boundary that matters: the
      // empty field, one line, each line up to the ceiling, and well past it.
      final List<String> prefixes = <String>[
        '',
        'H',
        'Happy to post today',
        draftOfLines(2),
        draftOfLines(3),
        draftOfLines(4),
        draftOfLines(5),
        draftOfLines(12),
        bodyOfLength(1200),
        bodyOfLength(4000),
      ];

      double previous = -1;
      double? ceiling;
      final double oneLine = composerHeight(tester);

      for (final String draft in prefixes) {
        await tester.enterText(find.byType(TextField), draft);
        await tester.pump();
        final double height = composerHeight(tester);

        expect(
          height,
          greaterThanOrEqualTo(previous),
          reason: 'the composer shrank as the draft grew: '
              '${draft.length} characters measured $height after $previous',
        );
        previous = height;

        // The four-line draft is the ceiling; everything longer must measure
        // exactly the same, because past it the FIELD scrolls its own content.
        if (draft == draftOfLines(4)) ceiling = height;
        if (ceiling != null) {
          expect(
            height,
            ceiling,
            reason: 'a draft past four lines grew the composer',
          );
        }

        expect(height, greaterThanOrEqualTo(oneLine));
        expectNoLayoutOverflow(tester);
      }

      // And the ceiling is a real bound, not the one-line height by accident: a
      // composer that never grew at all would satisfy monotonicity trivially.
      expect(ceiling, isNotNull);
      expect(ceiling, greaterThan(oneLine));
    });

    testWidgets('it returns to a shorter height as the draft shortens',
        (tester) async {
      await pumpComposer(tester);

      final double oneLine = composerHeight(tester);
      await tester.enterText(find.byType(TextField), draftOfLines(4));
      await tester.pump();
      final double fourLines = composerHeight(tester);
      expect(fourLines, greaterThan(oneLine));

      // Req 9.6 asks for this explicitly. A composer that only grows leaves a
      // member with four lines of empty field after they send a long message.
      await tester.enterText(find.byType(TextField), 'ok');
      await tester.pump();
      expect(composerHeight(tester), oneLine);
    });

    testWidgets('the field opens at one line', (tester) async {
      await pumpComposer(tester);

      final TextField field = tester.widget<TextField>(find.byType(TextField));
      expect(field.minLines, 1);
      expect(field.maxLines, MessageInput.maxDraftLines);
      expect(MessageInput.maxDraftLines, 4);
    });

    testWidgets('the bound holds at a 2.0 text scale', (tester) async {
      // The ceiling is four LINES, not a pixel height, so a larger face makes a
      // taller composer and must still stop at four of them.
      await pumpComposer(tester, textScaleFactor: 2.0);

      final double oneLine = composerHeight(tester);
      await tester.enterText(find.byType(TextField), draftOfLines(4));
      await tester.pump();
      final double fourLines = composerHeight(tester);
      await tester.enterText(find.byType(TextField), draftOfLines(20));
      await tester.pump();

      expect(composerHeight(tester), fourLines);
      expect(fourLines, greaterThan(oneLine));
      expectNoLayoutOverflow(tester);
    });
  });

  group('Req 9.6: the composer accepts no more than 4000 characters', () {
    testWidgets('a longer draft is cut to the ceiling, not refused whole',
        (tester) async {
      await pumpComposer(tester);

      await tester.enterText(find.byType(TextField), bodyOfLength(4600));
      await tester.pump();

      // The same ceiling the messages table's own body check enforces, so the
      // field stops a draft the server would reject anyway.
      expect(draftController(tester).text.length, MessageInput.maxDraftLength);
      expect(MessageInput.maxDraftLength, 4000);
    });

    testWidgets('the send control keeps a 48-pixel target', (tester) async {
      await pumpComposer(tester);
      await tester.enterText(find.byType(TextField), 'ready');
      await tester.pump();

      // The control is DRAWN at 40 and touched at 48 — Req 9.6 names the target
      // and Req 8.7 forbids reaching it by inflating the drawn height.
      expect(
        tester.getSize(find.byType(AppIconButton)).height,
        AppMetrics.controlHeight,
      );
      final Finder target = find.ancestor(
        of: find.byIcon(Icons.send_rounded),
        matching: find.byType(TapTarget),
      );
      final RenderTapTarget rendered =
          tester.renderObject<RenderTapTarget>(target);
      expect(rendered.drawnRect.height, AppMetrics.controlHeight);
      expect(
        rendered.targetRect.shortestSide,
        greaterThanOrEqualTo(AppMetrics.minHitArea),
      );
      // The target CONTAINS the control rather than replacing it: Req 8.7 forbids
      // reaching 48 by drawing a 48-pixel button.
      expect(rendered.targetRect.contains(rendered.drawnRect.topLeft), isTrue);
    });
  });

  group('Req 9.7: a refused send keeps the draft', () {
    testWidgets('the text stays in the field and the failure is beside it',
        (tester) async {
      final List<String> sent = <String>[];
      await pumpComposer(
        tester,
        sent: sent,
        failure: 'Message not sent. Check your connection and try again.',
      );

      await tester.enterText(find.byType(TextField), 'Posting it today.');
      await tester.pump();
      await tester.tap(find.byType(AppIconButton));
      await tester.pump();
      await tester.pump();

      expect(sent, <String>['Posting it today.']);
      // The draft is the assertion. It previously cleared the field before the
      // request resolved and ignored the result, which lost the draft silently on
      // every failure.
      expect(draftController(tester).text, 'Posting it today.');
      expect(
        find.text('Message not sent. Check your connection and try again.'),
        findsOneWidget,
      );

      // …and the same draft sends again without being retyped.
      await tester.tap(find.byType(AppIconButton));
      await tester.pump();
      await tester.pump();
      expect(sent, <String>['Posting it today.', 'Posting it today.']);
    });

    testWidgets('a successful send clears the field', (tester) async {
      final List<String> sent = <String>[];
      await pumpComposer(tester, sent: sent);

      await tester.enterText(find.byType(TextField), 'On its way.');
      await tester.pump();
      await tester.tap(find.byType(AppIconButton));
      await tester.pump();
      await tester.pump();

      expect(sent, <String>['On its way.']);
      expect(draftController(tester).text, isEmpty);
      expect(find.byType(AppIconButton), findsOneWidget);
    });

    testWidgets('nothing is appended to the thread optimistically',
        (tester) async {
      // There is no unsent bubble to remove, because the realtime stream is the
      // only thing that puts a message in the list. This asserts the composer
      // does not carry its own copy of the message.
      final List<String> sent = <String>[];
      await pumpComposer(tester, sent: sent, failure: 'Refused.');

      await tester.enterText(find.byType(TextField), 'Hello');
      await tester.pump();
      await tester.tap(find.byType(AppIconButton));
      await tester.pump();
      await tester.pump();

      expect(find.text('Hello'), findsOneWidget);
    });

    testWidgets('an empty or whitespace draft submits nothing', (tester) async {
      final List<String> sent = <String>[];
      await pumpComposer(tester, sent: sent);

      await tester.enterText(find.byType(TextField), '   ');
      await tester.pump();
      // The send control is unavailable rather than absent, so a member can see
      // what it would do (Req 8.9).
      expect(
        tester.widget<AppIconButton>(find.byType(AppIconButton)).onPressed,
        isNull,
      );
      await tester.tap(find.byType(AppIconButton), warnIfMissed: false);
      await tester.pump();
      expect(sent, isEmpty);
    });
  });

  group('Req 8.10: the composer does not move while a send is in flight', () {
    testWidgets('the busy stand-in keeps the row at its own height',
        (tester) async {
      final List<String> sent = <String>[];
      // A send that never resolves, so the in-flight frame can be measured.
      await pumpMessageSurface(
        tester,
        Align(
          alignment: Alignment.bottomCenter,
          child: MessageInput(
            onSubmit: (String text) {
              sent.add(text);
              return Future<String?>.delayed(
                const Duration(seconds: 30),
                () => null,
              );
            },
          ),
        ),
      );

      await tester.enterText(find.byType(TextField), 'Sending this.');
      await tester.pump();
      final double before = composerHeight(tester);

      await tester.tap(find.byType(AppIconButton));
      await tester.pump();

      expect(sent, hasLength(1));
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(composerHeight(tester), before);
      // The progress indicator stands in for the control at the control's own
      // size, so nothing in the row resizes.
      expect(
        tester.getSize(find.byType(CircularProgressIndicator)).height,
        AppIconSize.large,
      );
      // And the draft is still selectable and still there: a field that greys out
      // mid-send reads as the draft having been taken away.
      expect(draftController(tester).text, 'Sending this.');
      expect(
        tester.widget<TextField>(find.byType(TextField)).enabled,
        isTrue,
      );

      // Let the pending send resolve so no timer outlives the test.
      await tester.pump(const Duration(seconds: 31));
      await tester.pump();
    });

    testWidgets('the busy control reports itself to a screen reader',
        (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pumpMessageSurface(
        tester,
        Align(
          alignment: Alignment.bottomCenter,
          child: MessageInput(
            onSubmit: (String text) => Future<String?>.delayed(
              const Duration(seconds: 30),
              () => null,
            ),
          ),
        ),
      );

      await tester.enterText(find.byType(TextField), 'Sending this.');
      await tester.pump();
      await tester.tap(find.byType(AppIconButton));
      await tester.pump();

      // Flutter's semantics model has no busy flag, so the state is carried as a
      // label — which persists without motion and therefore satisfies Req 13.11
      // as well as 8.10.
      expect(find.bySemanticsLabel('Sending message'), findsOneWidget);

      await tester.pump(const Duration(seconds: 31));
      await tester.pump();
      handle.dispose();
    });
  });
}
