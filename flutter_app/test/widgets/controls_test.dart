// Feature: mobile-visual-parity — the shared form controls.
//
// Req 8 is mostly about what a control does NOT do: taking focus must not reflow
// the fields around it, becoming invalid must not move the submit control,
// becoming busy must not resize or replace anything, and a failure must not
// arrive as a toast that is gone before a screen reader reaches the field it was
// about. Every assertion below is one of those negatives, which is why they are
// geometry and semantics rather than pixels — a golden can prove a control looks
// the same and says nothing about whether it MOVED between two states.
//
// The states themselves are staged for capture in `test/golden/forms/`, so this
// file and that case list cover Req 8.12 together.
//
// Validates: Requirements 8.1–8.12, 13.7, 13.10, 13.11

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/widgets/common/controls.dart';
import 'package:cardtrade/widgets/common/tap_target.dart';

import '../support/harness.dart';
import '../support/message_fixtures.dart';

/// The field's drawn box, which is what must not move between states.
Rect fieldRect(WidgetTester tester) =>
    tester.getRect(find.byType(TextField));

/// Records the announcements the framework sends on the accessibility channel.
///
/// Req 8.6 asks for the message to be announced ONCE as it appears, which is a
/// claim about how many announcements are sent — not about what is on screen. A
/// `liveRegion` would satisfy a screen check and re-announce on every keystroke,
/// because a rebuild happens on every keystroke.
List<String> captureAnnouncements(WidgetTester tester) {
  final List<String> announced = <String>[];
  tester.binding.defaultBinaryMessenger.setMockDecodedMessageHandler<dynamic>(
    SystemChannels.accessibility,
    (dynamic message) async {
      final Map<dynamic, dynamic> event = message as Map<dynamic, dynamic>;
      if (event['type'] == 'announce') {
        announced.add((event['data'] as Map<dynamic, dynamic>)['message'] as String);
      }
      return null;
    },
  );
  addTearDown(() {
    tester.binding.defaultBinaryMessenger
        .setMockDecodedMessageHandler<dynamic>(
      SystemChannels.accessibility,
      null,
    );
  });
  return announced;
}

/// A field whose failure and enabled state a test can drive.
class _DrivenField extends StatefulWidget {
  const _DrivenField({this.initialError, this.enabled = true});

  final String? initialError;
  final bool enabled;

  @override
  State<_DrivenField> createState() => _DrivenFieldState();
}

class _DrivenFieldState extends State<_DrivenField> {
  late String? error = widget.initialError;

  void setError(String? next) => setState(() => error = next);

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.all(AppSpacing.group),
        child: AppTextField(
          label: 'Asking price',
          helperText: 'Buyers see this.',
          errorText: error,
          enabled: widget.enabled,
        ),
      );
}

void main() {
  group('Req 8.1–8.3: a field is identified by its edge, at the lead level', () {
    test('the resting edge is --input and focus changes only its colour', () {
      final InputDecorationThemeData fields =
          AppTheme.lightTheme.inputDecorationTheme;

      InputBorder border(InputBorder? b) => b!;
      Color colourOf(InputBorder? b) => border(b).borderSide.color;
      double widthOf(InputBorder? b) => border(b).borderSide.width;

      // `--input` is a DARKER value than `--border` because a field's edge is the
      // only thing identifying it as a control (Req 8.1, 13.2).
      expect(colourOf(fields.enabledBorder), AppColors.input);
      expect(colourOf(fields.focusedBorder), AppColors.ring);
      expect(colourOf(fields.errorBorder), AppColors.destructive);
      expect(colourOf(fields.focusedErrorBorder), AppColors.destructive);
      // Req 8.9: an inert field is filled AND edged in `--muted`, so it reads as
      // inert rather than merely empty.
      expect(colourOf(fields.disabledBorder), AppColors.muted);

      // Req 8.2: the WIDTH is the same in every state. A thicker focus ring would
      // reflow every field below it.
      final double resting = widthOf(fields.enabledBorder);
      expect(widthOf(fields.focusedBorder), resting);
      expect(widthOf(fields.errorBorder), resting);
      expect(widthOf(fields.focusedErrorBorder), resting);
      expect(widthOf(fields.disabledBorder), resting);
      expect(resting, AppMetrics.hairline);
    });

    test('helper copy is de-emphasised by TOKEN, not by size', () {
      // The Subtext_Rule (Req 8.4): `--muted-foreground` at the `body` level, and
      // never a smaller face.
      final InputDecorationThemeData fields =
          AppTheme.lightTheme.inputDecorationTheme;
      expect(fields.helperStyle!.color, AppColors.mutedForeground);
      expect(fields.helperStyle!.fontSize, AppText.bodyText.fontSize);
      expect(fields.errorStyle!.color, AppColors.destructive);
      expect(fields.errorStyle!.fontSize, AppText.bodyText.fontSize);
      expect(fields.labelStyle!.fontSize, AppText.bodyText.fontSize);
    });

    testWidgets('field text renders at the lead level', (tester) async {
      await pumpMessageSurface(tester, const _DrivenField());
      await tester.enterText(find.byType(TextField), '42');
      await tester.pump();

      expect(
        tester.widget<TextField>(find.byType(TextField)).style!.fontSize,
        AppType.lead.fontSize,
      );
    });

    testWidgets('taking focus does not move the field', (tester) async {
      await pumpMessageSurface(tester, const _DrivenField());

      final Rect resting = fieldRect(tester);
      await tester.tap(find.byType(TextField));
      await tester.pump();

      expect(
        tester.widget<TextField>(find.byType(TextField)).focusNode?.hasFocus ??
            FocusManager.instance.primaryFocus != null,
        isTrue,
      );
      expect(fieldRect(tester), resting);
    });

    testWidgets('a money field carries its currency symbol inside the field',
        (tester) async {
      await pumpMessageSurface(
        tester,
        const Padding(
          padding: EdgeInsets.all(AppSpacing.group),
          child: AppTextField(label: 'Asking price', prefixText: r'$'),
        ),
      );

      // Fixed copy ahead of the value, matching the web's `money-input.tsx`.
      expect(find.text(r'$'), findsOneWidget);
    });
  });

  group('Req 8.5 and 8.6: an inline failure, announced once', () {
    testWidgets('the message renders below the field and stays until valid',
        (tester) async {
      await pumpMessageSurface(tester, const _DrivenField());

      final _DrivenFieldState state =
          tester.state<_DrivenFieldState>(find.byType(_DrivenField));
      state.setError('Enter a price above zero.');
      await tester.pump();

      // Measured against the EDITABLE line rather than against the decorator's
      // box, which already encloses the message slot — comparing the message to
      // its own container would pass whatever the decorator did with it.
      final Rect message = tester.getRect(find.text('Enter a price above zero.'));
      final Rect editable = tester.getRect(find.byType(EditableText));
      // "Immediately below" as an ordering, not to the pixel: the editable box
      // carries its own descent padding, so the two rectangles overlap by about a
      // pixel while the message is plainly under the value.
      expect(message.top, greaterThan(editable.top));
      expect(message.bottom, greaterThan(editable.bottom));
      expect(message.left, lessThan(editable.right));

      // Req 8.5: it stays rendered while the field is invalid, across rebuilds
      // that a member typing would cause.
      await tester.enterText(find.byType(TextField), '5');
      await tester.pump();
      expect(find.text('Enter a price above zero.'), findsOneWidget);

      state.setError(null);
      await tester.pump();
      expect(find.text('Enter a price above zero.'), findsNothing);
    });

    testWidgets('the failure occupies the helper\'s slot, not a second one',
        (tester) async {
      await pumpMessageSurface(tester, const _DrivenField());
      final double valid = fieldRect(tester).height;

      tester
          .state<_DrivenFieldState>(find.byType(_DrivenField))
          .setError('Enter a price above zero.');
      await tester.pump();

      // Req 8.5 puts the message "inside the same group as its helper text", so
      // becoming invalid must not double the height of the copy below the field
      // and push every control under it down the screen. The assertion is the
      // HEIGHT rather than the helper's absence: Material keeps the helper in the
      // tree at zero opacity while it swaps them, so a presence check would be
      // measuring an implementation detail of the decorator.
      expect(fieldRect(tester).height, valid);
    });

    testWidgets('it is announced once, absent to present, and never re-announced',
        (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      final List<String> announced = captureAnnouncements(tester);

      await pumpMessageSurface(tester, const _DrivenField());
      expect(announced, isEmpty, reason: 'a valid field announces nothing');

      final _DrivenFieldState state =
          tester.state<_DrivenFieldState>(find.byType(_DrivenField));
      state.setError('Enter a price above zero.');
      await tester.pump();
      expect(announced, <String>['Enter a price above zero.']);

      // A rebuild with the SAME message is every keystroke. Announcing again
      // would talk over a member who is already fixing it.
      state.setError('Enter a price above zero.');
      await tester.pump();
      await tester.enterText(find.byType(TextField), '5');
      await tester.pump();
      expect(announced, hasLength(1));

      // A DIFFERENT failure is new information and is announced.
      state.setError('Enter a whole number of dollars.');
      await tester.pump();
      expect(announced, hasLength(2));

      handle.dispose();
    });

    testWidgets('the announcement does not move focus off the field',
        (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      captureAnnouncements(tester);
      await pumpMessageSurface(tester, const _DrivenField());

      await tester.tap(find.byType(TextField));
      await tester.pump();
      final FocusNode? before = FocusManager.instance.primaryFocus;

      tester
          .state<_DrivenFieldState>(find.byType(_DrivenField))
          .setError('Enter a price above zero.');
      await tester.pump();

      expect(FocusManager.instance.primaryFocus, same(before));

      handle.dispose();
    });

    testWidgets('the field and its failure are read together, as one node',
        (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pumpMessageSurface(
        tester,
        const _DrivenField(initialError: 'Enter a price above zero.'),
      );

      // Req 8.6: the message is the field's accessible description, so a screen
      // reader reaching the field reads the two together. A transient snack bar
      // is gone before that happens and does not say which field it was about.
      final String spoken = allSemanticsNodes(tester)
          .map((SemanticsNode node) {
            final SemanticsData data = node.getSemanticsData();
            return '${data.label} ${data.hint} ${data.value}';
          })
          .join('\n');
      expect(spoken, contains('Enter a price above zero.'));
      expect(spoken, contains('Asking price'));

      handle.dispose();
    });

    testWidgets('a failure reflows onto a second line rather than being cut',
        (tester) async {
      // Material defaults `errorMaxLines` to one, which at a 2.0 scale on a
      // 320-pixel viewport cuts the end off a sentence — and an invalid field
      // whose reason is half-shown is worse than one with no reason.
      //
      // The copy is SHORT on purpose, for the reason `a11y/text_scale_test.dart`
      // records: the test font's square glyphs make every string roughly twice as
      // wide here as in Plus Jakarta Sans, so a realistic sentence would fail this
      // assertion for a reason that does not exist on a device. Two lines is what
      // the criterion is about, and this is two lines.
      await pumpMessageSurface(
        tester,
        const _DrivenField(initialError: 'Enter a price.'),
        surface: kNarrowViewport,
        textScaleFactor: 2.0,
      );

      expectNoTruncatedText(tester, context: 'a field failure at a 2.0 scale');
      expectNoLayoutOverflow(tester);
    });

    testWidgets('a wrapping label is not ellipsised at a 2.0 scale',
        (tester) async {
      // Material builds `labelText` with `overflow: ellipsis`, which is why
      // AppTextField passes a label WIDGET instead.
      await pumpMessageSurface(
        tester,
        const Padding(
          padding: EdgeInsets.all(AppSpacing.group),
          child: AppTextField(label: 'Asking price in dollars'),
        ),
        surface: kNarrowViewport,
        textScaleFactor: 2.0,
      );

      final RenderParagraph label = allParagraphs(tester).firstWhere(
        (RenderParagraph p) =>
            p.text.toPlainText() == 'Asking price in dollars',
      );
      expect(label.didExceedMaxLines, isFalse);
      expect(label.softWrap, isTrue);
    });
  });

  group('Req 8.7 and 8.9: 40 drawn, 48 touched, muted when inert', () {
    testWidgets('a button is drawn at 40 and touched at 48', (tester) async {
      await pumpMessageSurface(
        tester,
        Center(child: AppButton(label: 'Buy now', onPressed: () {})),
      );

      final RenderTapTarget target = tester.renderObject<RenderTapTarget>(
        find.ancestor(
          of: find.text('Buy now'),
          matching: find.byType(TapTarget),
        ),
      );
      expect(target.drawnRect.height, AppMetrics.controlHeight);
      expect(target.targetRect.shortestSide,
          greaterThanOrEqualTo(AppMetrics.minHitArea));
    });

    testWidgets('a button label is at the body level in every variant',
        (tester) async {
      // Req 8.7: the label level does not follow the size variant.
      for (final AppButtonVariant variant in AppButtonVariant.values) {
        await pumpMessageSurface(
          tester,
          Center(
            child: AppButton(
              label: 'Buy now',
              variant: variant,
              onPressed: () {},
            ),
          ),
        );
        final RenderParagraph label = allParagraphs(tester)
            .firstWhere((RenderParagraph p) => p.text.toPlainText() == 'Buy now');
        expect(
          label.text.style!.fontSize,
          AppText.bodyText.fontSize,
          reason: '$variant drew its label at another level',
        );
      }
    });

    testWidgets('a disabled field keeps its drawn height and its fill goes muted',
        (tester) async {
      await pumpMessageSurface(tester, const _DrivenField());
      final double enabledHeight = fieldRect(tester).height;
      expect(
        tester.widget<TextField>(find.byType(TextField)).decoration!.fillColor,
        AppColors.card,
      );

      await pumpMessageSurface(tester, const _DrivenField(enabled: false));
      expect(fieldRect(tester).height, enabledHeight);
      expect(
        tester.widget<TextField>(find.byType(TextField)).decoration!.fillColor,
        AppColors.muted,
      );
    });

    testWidgets('a disabled button keeps its label and its target',
        (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pumpMessageSurface(
        tester,
        const Center(child: AppButton(label: 'Buy now', onPressed: null)),
      );

      final RenderTapTarget target = tester.renderObject<RenderTapTarget>(
        find.ancestor(
          of: find.text('Buy now'),
          matching: find.byType(TapTarget),
        ),
      );
      expect(target.drawnRect.height, AppMetrics.controlHeight);
      expect(target.targetRect.shortestSide,
          greaterThanOrEqualTo(AppMetrics.minHitArea));
      // Disabled, not absent: a member still needs to know what it would do.
      expect(
        tester.getSemantics(find.bySemanticsLabel('Buy now')),
        isSemantics(label: 'Buy now', hasEnabledState: true, isEnabled: false),
      );

      handle.dispose();
    });
  });

  group('Req 8.10: a busy control does not move, resize or activate', () {
    testWidgets('the spinner sits inside the bounds the control already had',
        (tester) async {
      int taps = 0;
      await pumpMessageSurface(
        tester,
        Center(child: AppButton(label: 'Save listing', onPressed: () => taps++)),
      );
      final Size resting = tester.getSize(find.byType(AppButton));

      await pumpMessageSurface(
        tester,
        Center(
          child: AppButton(
            label: 'Save listing',
            busy: true,
            onPressed: () => taps++,
          ),
        ),
      );

      expect(tester.getSize(find.byType(AppButton)), resting);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      // The indicator is smaller than the drawn height, so the control's bounds
      // and its target are exactly what they were.
      expect(
        tester.getSize(find.byType(CircularProgressIndicator)).height,
        AppIconSize.base,
      );
      expect(
        tester.getSize(find.byType(CircularProgressIndicator)).height,
        lessThan(AppMetrics.controlHeight),
      );
    });

    testWidgets('it cannot be activated while it waits', (tester) async {
      int taps = 0;
      await pumpMessageSurface(
        tester,
        Center(
          child: AppButton(
            label: 'Save listing',
            busy: true,
            onPressed: () => taps++,
          ),
        ),
      );

      await tester.tap(find.byType(AppButton), warnIfMissed: false);
      await tester.pump();

      // The callback is dropped here rather than at every call site: a screen that
      // forgot the guard would otherwise submit twice while its own spinner was on
      // screen.
      expect(taps, 0);
    });

    testWidgets('it reports its label and that it is waiting', (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pumpMessageSurface(
        tester,
        Center(
          child: AppButton(label: 'Save listing', busy: true, onPressed: () {}),
        ),
      );

      // While busy the label is a spinner, so the button carries no visible text
      // and would reach a screen reader unlabelled (Req 13.7). `Waiting` is
      // carried as a VALUE because Flutter's semantics model has no busy flag —
      // and a value persists without motion, which Req 13.11 also asks for.
      expect(
        tester.getSemantics(find.bySemanticsLabel('Save listing')),
        isSemantics(
          label: 'Save listing',
          value: 'Waiting for the server',
          isButton: true,
          hasEnabledState: true,
          isEnabled: false,
        ),
      );

      handle.dispose();
    });
  });

  group('Req 8.8 and 13.11: a chosen option is not chosen by colour alone', () {
    testWidgets('the selected chip wears the accent pair, semibold, and a check',
        (tester) async {
      String? chosen = 'Near Mint';
      await pumpMessageSurface(
        tester,
        Padding(
          padding: const EdgeInsets.all(AppSpacing.group),
          child: AppChoiceChips<String>(
            label: 'Condition',
            options: const <String>['Mint', 'Near Mint'],
            selected: chosen,
            onSelected: (String? value) => chosen = value,
            labelOf: (String option) => option,
          ),
        ),
      );

      final ChoiceChip selected = tester
          .widgetList<ChoiceChip>(find.byType(ChoiceChip))
          .firstWhere((ChoiceChip chip) => chip.selected);
      final ChoiceChip unselected = tester
          .widgetList<ChoiceChip>(find.byType(ChoiceChip))
          .firstWhere((ChoiceChip chip) => !chip.selected);

      expect(selected.selectedColor, AppColors.accent);
      expect(selected.labelStyle!.color, AppColors.accentForeground);
      // Weight and a glyph as well as the fill, so the state survives greyscale.
      expect(selected.labelStyle!.fontWeight, FontWeight.w600);
      expect(selected.avatar, isNotNull);
      expect(unselected.labelStyle!.fontWeight, FontWeight.w400);
      expect(unselected.avatar, isNull);
    });

    testWidgets('a disabled group offers no selection and goes muted',
        (tester) async {
      await pumpMessageSurface(
        tester,
        Padding(
          padding: const EdgeInsets.all(AppSpacing.group),
          child: AppChoiceChips<String>(
            label: 'Condition',
            options: const <String>['Mint', 'Near Mint'],
            selected: null,
            enabled: false,
            onSelected: (String? _) {},
            labelOf: (String option) => option,
          ),
        ),
      );

      for (final ChoiceChip chip
          in tester.widgetList<ChoiceChip>(find.byType(ChoiceChip))) {
        expect(chip.onSelected, isNull);
        expect(chip.disabledColor, AppColors.muted);
        expect(chip.labelStyle!.color, AppColors.mutedForeground);
      }
    });

    testWidgets('a group failure is rendered where a field\'s would be',
        (tester) async {
      await pumpMessageSurface(
        tester,
        Padding(
          padding: const EdgeInsets.all(AppSpacing.group),
          child: AppChoiceChips<String>(
            label: 'Condition',
            options: const <String>['Mint', 'Near Mint'],
            selected: null,
            helperText: 'Buyers filter on this.',
            errorText: 'Choose a condition.',
            onSelected: (String? _) {},
            labelOf: (String option) => option,
          ),
        ),
      );

      final RenderParagraph message = allParagraphs(tester).firstWhere(
        (RenderParagraph p) => p.text.toPlainText() == 'Choose a condition.',
      );
      expect(message.text.style!.color, AppColors.destructive);
      expect(message.text.style!.fontSize, AppText.bodyText.fontSize);
      // One group, one message slot: the failure replaces the helper.
      expect(find.text('Buyers filter on this.'), findsNothing);
    });
  });

  group('Req 8.11: a form-level summary, only where no field owns the failure',
      () {
    testWidgets('it is a persistent region above the submit control, with a glyph',
        (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await pumpMessageSurface(
        tester,
        Padding(
          padding: const EdgeInsets.all(AppSpacing.group),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              const AppFormSummary(
                message: 'This listing could not be saved. Try again.',
              ),
              const SizedBox(height: AppSpacing.group),
              AppButton(label: 'Save listing', onPressed: () {}),
            ],
          ),
        ),
      );

      final Rect summary = tester.getRect(find.byType(AppFormSummary));
      final Rect submit = tester.getRect(find.byType(AppButton));
      expect(summary.bottom, lessThanOrEqualTo(submit.top));

      // A glyph as well as the colour, so it is still a warning in greyscale.
      expect(find.byIcon(Icons.error_outline_rounded), findsOneWidget);
      // Not a snack bar: nothing transient, and no `SnackBar` in the tree.
      expect(find.byType(SnackBar), findsNothing);
      expect(
        allSemanticsNodes(tester)
            .map((SemanticsNode n) => n.getSemanticsData().label)
            .join('\n'),
        contains('This listing could not be saved. Try again.'),
      );

      handle.dispose();
    });

    testWidgets('a long summary reflows at a 2.0 scale', (tester) async {
      await pumpMessageSurface(
        tester,
        const Padding(
          padding: EdgeInsets.all(AppSpacing.group),
          child: AppFormSummary(message: 'Could not save. Try again.'),
        ),
        surface: kNarrowViewport,
        textScaleFactor: 2.0,
      );

      expectNoTruncatedText(tester, context: 'a form summary at a 2.0 scale');
      expectNoLayoutOverflow(tester);
    });
  });
}
