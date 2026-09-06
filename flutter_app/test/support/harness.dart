// Shared scaffolding for the Stage 2 primitive tests.
//
// Deliberately NOT the golden harness. Task 11.1 owns `test/golden/_harness/`,
// its designated host, its comparator and its reference images. Everything here
// is host-independent: it measures geometry and reads the semantics tree, so it
// runs the same on any machine and nothing in it needs a `.png`.
//
// Requirements 13.6–13.12, 11.1–11.4.

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:cardtrade/core/theme.dart';

/// A phone-width viewport, matching the width the mobile design is drawn for.
const Size kPhoneViewport = Size(390, 844);

/// The narrowest viewport the design commits to (Req 7.2 names 320).
const Size kNarrowViewport = Size(320, 844);

/// Wraps [child] in the real application theme at a fixed text scale.
///
/// The theme is the app's own, not a test double: a primitive drawn against
/// Material's defaults would pass here and look wrong in the app.
/// Set [scaffold] to false where [child] brings its own `Scaffold` — a whole
/// screen under `AppScaffold` does, and nesting one inside another puts two
/// bottom-bar slots and two `ScaffoldMessenger` scopes in the tree.
Widget pumpFixture(
  Widget child, {
  double textScaleFactor = 1.0,
  bool reduceMotion = false,
  bool capTextScale = true,
  bool scaffold = true,
}) {
  return MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: AppTheme.lightTheme,
    // Inside the app, not around it: `MaterialApp` establishes its own
    // MediaQuery from the view, so a wrapper outside it is simply replaced.
    // Ordering matters — the raw factor is declared first and
    // [CappedTextScale] then caps it, exactly as `main.dart` arranges it.
    builder: (context, navigatorChild) {
      final Widget content = navigatorChild ?? const SizedBox.shrink();
      return MediaQuery(
        data: MediaQuery.of(context).copyWith(
          textScaler: TextScaler.linear(textScaleFactor),
          disableAnimations: reduceMotion,
        ),
        child: capTextScale ? CappedTextScale(child: content) : content,
      );
    },
    home: scaffold ? Scaffold(body: child) : child,
  );
}

/// Pins the viewport so a measured rectangle means something.
Future<void> setViewport(WidgetTester tester, Size size) async {
  tester.view.devicePixelRatio = 1.0;
  tester.view.physicalSize = size;
  addTearDown(tester.view.reset);
}

/// Every semantics node in the current tree, in tree order.
///
/// Rooted at the app rather than at a binding's `semanticsOwner`: the owner
/// accessors are deprecated in favour of interacting with the tree, and
/// `getSemantics` walks up from the app to the node that encloses everything,
/// which is the same node.
List<SemanticsNode> allSemanticsNodes(WidgetTester tester) {
  final Finder app = find.byType(MaterialApp);
  if (app.evaluate().isEmpty) return const [];
  final SemanticsNode root = tester.getSemantics(app);

  final List<SemanticsNode> nodes = [];
  void walk(SemanticsNode node) {
    nodes.add(node);
    node.visitChildren((SemanticsNode child) {
      walk(child);
      return true;
    });
  }

  walk(root);
  return nodes;
}

/// Every node that carries an activation action — the set Req 13.7 governs.
List<SemanticsNode> actionableSemanticsNodes(WidgetTester tester) {
  return allSemanticsNodes(tester).where((node) {
    final SemanticsData data = node.getSemanticsData();
    return data.hasAction(SemanticsAction.tap) ||
        data.hasAction(SemanticsAction.longPress);
  }).toList();
}

/// Every laid-out paragraph, so a test can ask whether any of them was cut.
List<RenderParagraph> allParagraphs(WidgetTester tester) =>
    tester.renderObjectList<RenderParagraph>(find.byType(RichText)).toList();

/// Fails if any paragraph lost text to a maximum-line clamp.
///
/// `didExceedMaxLines` is the honest signal: it is true exactly when the
/// paragraph had more to say than it was allowed to draw, whether the overflow
/// was ellipsised, faded or clipped (Req 13.10).
void expectNoTruncatedText(WidgetTester tester, {String? context}) {
  for (final RenderParagraph paragraph in allParagraphs(tester)) {
    expect(
      paragraph.didExceedMaxLines,
      isFalse,
      reason: '${context == null ? '' : '$context: '}text was truncated: '
          '"${paragraph.text.toPlainText()}"',
    );
  }
}

/// Fails if the last pump recorded a layout overflow or any other exception.
void expectNoLayoutOverflow(WidgetTester tester) {
  final Object? error = tester.takeException();
  expect(
    error,
    isNull,
    reason: 'the layout reported $error',
  );
}
