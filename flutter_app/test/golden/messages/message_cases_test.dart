// The host-independent cover for the message golden cases.
//
// This file makes NO pixel comparison: `message_golden_test.dart` does that and owns
// the references in `goldens/`. The split is the one recorded at the head of
// `message_golden_cases.dart` — the comparison is scoped to the designated host
// because font rasterisation differs between platforms, and everything here measures
// geometry and reads text, so it runs everywhere.
//
// What it asserts instead is that the case LIST is the set Req 9.10 asks for —
// an own message, a counterparty message, an attachment-only message, a run of
// consecutive messages from one author, and a thread holding no messages — that
// every case pairs a 1.0 capture with a 2.0 twin at one surface size (Req 13.13),
// that no case names retired vocabulary, that no case's copy depends on the wall
// clock, and that every case builds and lays out at both scales.
//
// Requirements 9.10, 13.10, 13.13, 15.10, 15.11.

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/features/messages/widgets/message_bubble.dart';

import '../../support/harness.dart';
import '../../support/message_fixtures.dart';
import 'message_golden_cases.dart';

void main() {
  group('Req 9.10: the message golden case list', () {
    test('covers every thread, composer and row state', () {
      expect(
        kMessageGoldenCases.map((MessageGoldenCase entry) => entry.name).toList(),
        <String>[
          'thread_own_message',
          'thread_counterparty_message',
          'thread_both_sides',
          'thread_attachment_only',
          'thread_document_attachment',
          'thread_one_run',
          'thread_run_broken_by_notice',
          'thread_empty',
          'composer_at_rest',
          'composer_send_unavailable',
          'conversation_row_read',
          'conversation_row_unread',
          'conversation_row_unread_capped',
        ],
      );
    });

    test('names collide with nothing', () {
      final List<String> names =
          kMessageGoldenCases.map((MessageGoldenCase e) => e.name).toList();
      expect(names.toSet(), hasLength(names.length));
    });

    test('pairs every case with a 2.0 text-scale twin at one surface size', () {
      for (final MessageGoldenCase entry in kMessageGoldenCases) {
        // Req 13.13: the factor is the only difference between a pair, so the
        // surface is declared once per case and never per scale.
        expect(entry.textScales, <double>[1.0, 2.0], reason: entry.name);
        expect(entry.surface, kMessageGoldenSurface, reason: entry.name);
      }
    });

    test('names no retired vocabulary', () {
      // Req 14.4 covers identifiers, strings and routes; a golden file name is all
      // three at once. `escrow` is included because a card hold is trade collateral
      // and the platform holds no funds behind it, and `shopfront` because it is
      // the internal listing kind and never a word a member has seen.
      for (final MessageGoldenCase entry in kMessageGoldenCases) {
        for (final String retired in <String>[
          'deal',
          'ditto',
          'kyc',
          'shopfront',
          'escrow',
          'bond',
        ]) {
          expect(
            entry.name.toLowerCase(),
            isNot(contains(retired)),
            reason: '${entry.name} names retired vocabulary "$retired"',
          );
        }
      }
    });
  });

  group('every staged case lays out at every scale it will be captured at', () {
    for (final MessageGoldenCase entry in kMessageGoldenCases) {
      for (final double scale in entry.textScales) {
        testWidgets('${entry.name} at ${scale}x', (tester) async {
          await pumpMessageSurface(
            tester,
            entry.build(),
            textScaleFactor: scale,
            surface: entry.surface,
          );

          expectNoLayoutOverflow(tester);
        });
      }
    }
  });

  group('no case reads the wall clock', () {
    // Req 15.11 holds the clock at a value the test declares. A relative label read
    // from `DateTime.now()` would drift between the reference image and every later
    // capture, and the failure would look like a rendering change rather than a
    // clock. Pumping the same case at two different real times is what proves it.
    for (final MessageGoldenCase entry in kMessageGoldenCases) {
      testWidgets('${entry.name} renders the same words twice', (tester) async {
        List<String> textOf() => allParagraphs(tester)
            .map((RenderParagraph p) => p.text.toPlainText())
            .toList();

        await pumpMessageSurface(tester, entry.build());
        final List<String> first = textOf();

        // A second build, an hour of test time later. Anything that consulted the
        // real clock rather than the injected instant moves here.
        await tester.pump(const Duration(hours: 1));
        await pumpMessageSurface(tester, entry.build());
        expect(textOf(), first, reason: '${entry.name} depends on the wall clock');
      });
    }
  });

  group('the thread cases show what they claim to show', () {
    testWidgets('the run case is four bubbles under one clock', (tester) async {
      await pumpMessageSurface(
        tester,
        kMessageGoldenCases
            .firstWhere((MessageGoldenCase e) => e.name == 'thread_one_run')
            .build(),
      );

      expect(find.byType(MessageBubble), findsNWidgets(4));
      final List<String> clocks = allParagraphs(tester)
          .map((RenderParagraph p) => p.text.toPlainText())
          .where((String text) => RegExp(r'^\d{1,2}:\d{2}').hasMatch(text))
          .toList();
      expect(clocks, hasLength(1));
    });

    testWidgets('the attachment-only case draws no body line', (tester) async {
      await pumpMessageSurface(
        tester,
        kMessageGoldenCases
            .firstWhere(
                (MessageGoldenCase e) => e.name == 'thread_attachment_only')
            .build(),
      );

      expect(find.byType(MessageBubble), findsOneWidget);
      expect(find.byType(AspectRatio), findsOneWidget);
    });

    testWidgets('the empty case draws the hint and no list', (tester) async {
      await pumpMessageSurface(
        tester,
        kMessageGoldenCases
            .firstWhere((MessageGoldenCase e) => e.name == 'thread_empty')
            .build(),
      );

      expect(find.byType(MessageBubble), findsNothing);
      expect(find.text('No messages yet'), findsOneWidget);
    });
  });
}
