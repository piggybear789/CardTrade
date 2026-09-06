// The form-control golden CASES — the field states, the three button treatments
// in three states each, and a form presenting a form-level summary — staged ahead
// of the harness that captures them.
//
// THIS FILE STILL HOLDS NO `matchesGoldenFile` CALL, for the reason recorded at the
// head of `test/golden/shell/shell_golden_cases.dart`: a case declares a name, a
// surface, the scales it is captured at and the tree to capture, and says nothing
// about pixels. `form_golden_test.dart` walks this list through the harness and owns
// the references in `goldens/`; `form_cases_test.dart` builds every case at every
// declared scale and asserts it lays out, which runs on every host unlike the
// comparison.
//
// The references were captured only after `test/golden/_harness/` existed to pin the
// designated host, the typeface, the device pixel ratio, the clock, the text-scale cap
// and the animations. An image taken before that would have to be re-baselined for a
// reason that is not a design change, which is the one thing Req 15.12 forbids.
//
// THE BUSY CASES ARE THE REASON THIS LIST IS NOT JUST NINE BUTTONS. `AppButton`
// draws its spinner over a label held at zero opacity, so a busy button is the
// same WIDTH as its enabled twin. That is asserted in
// `test/widgets/controls_test.dart` in geometry, and a golden of the pair is what
// makes it reviewable — the defect it replaced collapsed a 186-pixel control to 48
// the moment it was pressed.
//
// A CAPTURED SPINNER NEEDS A STATED INSTANT. `CircularProgressIndicator` animates
// forever, so its sweep depends on when the frame was taken. [pumpsAnimation] marks
// the cases where that is load-bearing, and `form_golden_test.dart` captures those
// with reduce-motion OFF at the harness's declared phase — Req 11.7's one animated
// capture per surface, at a fixed point in the cycle. Holding the indicator still
// instead would be a picture of a state the app only shows under reduce-motion.
//
// EVERY CASE IS FIXTURE-BUILT (Req 15.11): each is a shared primitive over
// constant copy, so no case reads Supabase and none can change because the
// database did.
//
// Requirements 8.12, 13.13, 15.10, 15.11.

import 'package:flutter/material.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/widgets/common/controls.dart';

/// The phone surface every form golden is captured on.
const Size kFormGoldenSurface = Size(390, 844);

/// One golden case: a name, a surface, the text scales it is captured at, and the
/// tree to capture.
@immutable
class FormGoldenCase {
  const FormGoldenCase({
    required this.name,
    required this.build,
    this.surface = kFormGoldenSurface,
    this.textScales = const <double>[1.0, 2.0],
    this.focusField = false,
    this.pumpsAnimation = false,
  });

  /// File-name stem. The harness appends the scale, so `field_invalid` becomes
  /// `field_invalid@1.0x.png` and `…@2.0x.png`.
  final String name;

  /// The tree under test, built fresh per scale.
  final Widget Function() build;

  final Size surface;

  /// Req 13.13 pairs every state with a 2.0 twin at the same surface size.
  final List<double> textScales;

  /// Whether the capture must put the field in FOCUS first.
  ///
  /// Focus is a state no argument can express: Req 8.2 is precisely that focus
  /// changes the border's colour and nothing else, so the focused golden has to be
  /// captured with the field actually focused and at the same drawn bounds as the
  /// resting one.
  final bool focusField;

  /// Whether the case contains a running indicator whose frame depends on the
  /// clock.
  final bool pumpsAnimation;
}

/// Every case is drawn inside the same padded column, so a difference between two
/// references is a difference in the control and not in where it sits.
Widget _stage(Widget child) => Padding(
      padding: const EdgeInsets.all(AppSpacing.group),
      child: Align(alignment: Alignment.topCenter, child: child),
    );

FormGoldenCase _fieldCase(
  String name, {
  String? errorText,
  bool enabled = true,
  bool focusField = false,
}) {
  return FormGoldenCase(
    name: name,
    focusField: focusField,
    build: () => _stage(
      AppTextField(
        label: 'Asking price',
        hint: 'e.g. 42',
        // Short copy deliberately, for the reason `listing_fixtures.dart`
        // records: the test font's square glyphs make every string roughly twice
        // as wide here as in the shipped typeface, so realistic copy would
        // overflow the 2.0-scale twin for a reason that does not exist on a
        // device.
        helperText: 'Buyers see this.',
        errorText: errorText,
        enabled: enabled,
        prefixText: r'$',
      ),
    ),
  );
}

FormGoldenCase _buttonCase(
  String name, {
  required AppButtonVariant variant,
  bool enabled = true,
  bool busy = false,
}) {
  return FormGoldenCase(
    name: name,
    pumpsAnimation: busy,
    build: () => _stage(
      AppButton(
        label: 'Save listing',
        variant: variant,
        busy: busy,
        onPressed: enabled ? () {} : null,
      ),
    ),
  );
}

/// The field states Req 8.12 requires: at rest, focused, invalid and disabled.
final List<FormGoldenCase> kFieldGoldenCases = <FormGoldenCase>[
  _fieldCase('field_at_rest'),
  _fieldCase('field_focused', focusField: true),
  _fieldCase('field_invalid', errorText: 'Enter a price.'),
  _fieldCase('field_disabled', enabled: false),
];

/// The nine button states Req 8.12 requires: the primary, outlined and
/// destructive treatments, each enabled, disabled and busy.
///
/// `primary` here is the criterion's word for the affirmative treatment, which is
/// `AppButtonVariant.action` — the web's pastel `--action` fill with its defined
/// edge. The solid iris `AppButtonVariant.primary` is captured beside it because
/// the two are easy to confuse in review and a swap between them is exactly the
/// kind of change a golden should catch.
final List<FormGoldenCase> kButtonGoldenCases = <FormGoldenCase>[
  for (final (String stem, AppButtonVariant variant) in <(
    String,
    AppButtonVariant
  )>[
    ('button_primary', AppButtonVariant.action),
    ('button_iris', AppButtonVariant.primary),
    ('button_outlined', AppButtonVariant.outline),
    ('button_destructive', AppButtonVariant.destructive),
  ]) ...<FormGoldenCase>[
    _buttonCase('${stem}_enabled', variant: variant),
    _buttonCase('${stem}_disabled', variant: variant, enabled: false),
    _buttonCase('${stem}_busy', variant: variant, busy: true),
  ],
];

/// A form presenting a form-level summary above its submit control (Req 8.11),
/// which is the last state Req 8.12 names.
final List<FormGoldenCase> kFormSummaryGoldenCases = <FormGoldenCase>[
  FormGoldenCase(
    name: 'form_with_summary',
    build: () => _stage(
      Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          const AppFormSummary(message: 'Could not save. Try again.'),
          const SizedBox(height: AppSpacing.group),
          const AppTextField(label: 'Asking price', prefixText: r'$'),
          const SizedBox(height: AppSpacing.group),
          AppChoiceChips<String>(
            label: 'Condition',
            options: const <String>['Mint', 'Near Mint'],
            selected: 'Near Mint',
            onSelected: (String? _) {},
            labelOf: (String option) => option,
          ),
          const SizedBox(height: AppSpacing.group),
          AppButton(label: 'Save listing', fillWidth: true, onPressed: () {}),
        ],
      ),
    ),
  ),
  // The chosen-option pair on its own, because Req 8.8's selected fill and its
  // check glyph are a state a member reads at a glance and a token swap here would
  // be invisible in the composite above.
  FormGoldenCase(
    name: 'choice_chips_selected',
    build: () => _stage(
      AppChoiceChips<String>(
        label: 'Condition',
        options: const <String>['Mint', 'Near Mint', 'Graded'],
        selected: 'Near Mint',
        helperText: 'Buyers filter on this.',
        onSelected: (String? _) {},
        labelOf: (String option) => option,
      ),
    ),
  ),
];

/// Every form golden case: fields, buttons, then the summary and choice states.
final List<FormGoldenCase> kFormGoldenCases = <FormGoldenCase>[
  ...kFieldGoldenCases,
  ...kButtonGoldenCases,
  ...kFormSummaryGoldenCases,
];
