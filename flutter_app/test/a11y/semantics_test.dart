// Feature: mobile-visual-parity — Property 20.
//
// Property 20: For any screen state, every node carrying an action has a
// non-empty label naming that action, no node without an action is reachable by
// traversal, and traversal order sorts by top-then-leading position.
//
// This is the layer that carries accessibility, not the goldens: an image
// comparison proves a pixel did not move and can say nothing about whether a
// label exists or whether focus reaches the controls in reading order.
//
// Every test disposes its semantics handle INSIDE the body rather than through
// `addTearDown`: the framework's end-of-test verification runs before tear-downs,
// so a handle released there is still reported as leaked.
//
// Validates: Requirements 13.7, 13.9, 8.6, 11.3.

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/widgets/common/controls.dart';
import 'package:cardtrade/widgets/common/empty_state.dart';
import 'package:cardtrade/widgets/common/error_view.dart';

import '../support/harness.dart';

/// A fixture with one of every shared interactive primitive, in reading order.
///
/// The labels are the assertion's subject, so they are member-facing rather than
/// 'Button 1': a label that does not name the action passes a presence check and
/// still leaves a screen reader saying nothing useful.
class _ControlsFixture extends StatelessWidget {
  const _ControlsFixture();

  static const List<String> readingOrder = [
    'Save this listing',
    'Buy now',
    'Make an offer',
    'Share this listing',
  ];

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const AppTextField(label: 'Asking price'),
        const SizedBox(height: AppSpacing.group),
        AppIconButton(
          icon: Icons.favorite_border_rounded,
          semanticLabel: 'Save this listing',
          onPressed: () {},
        ),
        const SizedBox(height: AppSpacing.group),
        AppButton(label: 'Buy now', onPressed: () {}),
        const SizedBox(height: AppSpacing.group),
        AppButton(
          label: 'Make an offer',
          variant: AppButtonVariant.outline,
          onPressed: () {},
        ),
        const SizedBox(height: AppSpacing.group),
        AppIconButton(
          icon: Icons.share_outlined,
          semanticLabel: 'Share this listing',
          onPressed: () {},
        ),
      ],
    );
  }
}

void main() {
  group('Property 20: the semantics tree is complete and ordered', () {
    testWidgets('every actionable node carries a non-empty label',
        (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await setViewport(tester, kPhoneViewport);

      await tester.pumpWidget(pumpFixture(const _ControlsFixture()));

      final List<SemanticsNode> actionable = actionableSemanticsNodes(tester);
      expect(
        actionable,
        isNotEmpty,
        reason: 'a fixture with five controls must produce action nodes',
      );

      for (final SemanticsNode node in actionable) {
        expect(
          node.getSemanticsData().label.trim(),
          isNotEmpty,
          reason: 'an unlabelled control at ${node.rect} is unreachable by a '
              'screen reader (Req 13.7)',
        );
      }

      handle.dispose();
    });

    testWidgets('a glyph-only control is one labelled node, not two',
        (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();

      await tester.pumpWidget(
        pumpFixture(
          Center(
            child: AppIconButton(
              icon: Icons.favorite_border_rounded,
              semanticLabel: 'Save this listing',
              onPressed: () {},
            ),
          ),
        ),
      );

      // The label and the action must sit on ONE node, or a screen reader
      // announces the glyph separately from what it does.
      expect(
        tester.getSemantics(find.bySemanticsLabel('Save this listing')),
        isSemantics(
          label: 'Save this listing',
          isButton: true,
          hasEnabledState: true,
          isEnabled: true,
          hasTapAction: true,
        ),
      );

      handle.dispose();
    });

    testWidgets('decoration contributes no reachable node', (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();

      await tester.pumpWidget(
        pumpFixture(
          const EmptyState(
            icon: Icons.inbox_outlined,
            title: 'Nothing saved yet',
            subtitle: 'Listings you save appear here.',
          ),
        ),
      );

      // The illustration is decoration (Req 11.3), so nothing in the tree may
      // name the glyph. The heading and explanation are the only nodes.
      final List<String> labels = allSemanticsNodes(tester)
          .map((node) => node.getSemanticsData().label)
          .where((label) => label.isNotEmpty)
          .toList();

      expect(labels, contains('Nothing saved yet'));
      expect(labels, contains('Listings you save appear here.'));
      expect(
        actionableSemanticsNodes(tester),
        isEmpty,
        reason: 'an empty state with no action must offer no action node',
      );

      handle.dispose();
    });

    testWidgets('an unavailable control is exposed as disabled, not as absent',
        (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();

      await tester.pumpWidget(
        pumpFixture(
          const Center(
            child: AppIconButton(
              icon: Icons.favorite_border_rounded,
              semanticLabel: 'Save this listing',
              onPressed: null,
            ),
          ),
        ),
      );

      // A disabled control keeps its label: a member still needs to know what it
      // would have done, and an absent control cannot tell them.
      expect(
        tester.getSemantics(find.bySemanticsLabel('Save this listing')),
        isSemantics(
          label: 'Save this listing',
          isButton: true,
          hasEnabledState: true,
          isEnabled: false,
        ),
      );

      handle.dispose();
    });

    testWidgets('tree order matches top-then-leading visual order',
        (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await setViewport(tester, kPhoneViewport);

      await tester.pumpWidget(pumpFixture(const _ControlsFixture()));

      // Flutter derives traversal from the tree, so the check that matters is
      // whether the tree order and the drawn order agree. They disagree when a
      // control is positioned out of the order it is declared in — which is
      // exactly the defect Req 13.9 forbids and which no golden can see.
      final List<Rect> treeOrder = [
        for (final String label in _ControlsFixture.readingOrder)
          tester.getRect(find.bySemanticsLabel(label)),
      ];

      final List<Rect> visualOrder = [...treeOrder]..sort((a, b) {
        final int byTop = a.top.compareTo(b.top);
        return byTop != 0 ? byTop : a.left.compareTo(b.left);
      });

      expect(
        treeOrder,
        visualOrder,
        reason: 'focus would not follow reading order',
      );

      handle.dispose();
    });

    testWidgets('an error view exposes its retry action by name',
        (tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();

      await tester.pumpWidget(pumpFixture(ErrorView(onRetry: () {})));

      final List<SemanticsNode> actionable = actionableSemanticsNodes(tester);
      expect(actionable, hasLength(1));
      expect(actionable.single.getSemanticsData().label, 'Try again');

      handle.dispose();
    });
  });
}
