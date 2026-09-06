// The shared screen wrapper: the phone top strip above a screen's content.
//
// It renders [MobileChrome] rather than an `AppBar` so that the inset-plus-54
// content edge, the borderless flat strip and the 40-drawn/48-touched controls
// have ONE definition (Req 4.1–4.4). An `AppBar` would need its elevation, its
// scrolled-under elevation and its surface tint switched off at every call site,
// and the first screen to forget one of the three is a strip that grows a shadow
// the web does not have as soon as a member scrolls.
//
// The strip is part of the BODY rather than the `appBar` slot, deliberately: the
// slot adds the status-bar inset itself, from outside the widget, which puts the
// 54 in one file and the inset in another and leaves neither able to state the
// total. Here the widget owns both halves of the measurement.
//
// Requirements 4.1–4.4, 13.7.

import 'package:flutter/material.dart';

import 'mobile_chrome.dart';

/// A wrapper providing consistent page structure across the app.
class AppScaffold extends StatelessWidget {
  const AppScaffold({
    required this.body,
    this.title,
    this.actions = const <ChromeAction>[],
    this.onBack,
    this.backSemanticLabel = 'Go back',
    this.compactChrome = false,
    this.floatingActionButton,
    this.bottomBar,
    super.key,
  });

  /// The main content of the page.
  final Widget body;

  /// Optional strip title, rendered at the `rowName` role.
  final String? title;

  /// At most [MobileChrome.maxActions] trailing controls (Req 4.4).
  final List<ChromeAction> actions;

  /// Back affordance callback. Absent when a screen cannot be left backwards.
  final VoidCallback? onBack;

  /// What the back affordance does, in member-facing words (Req 13.7).
  final String backSemanticLabel;

  /// Whether to draw the compact strip: the status-bar inset alone, for a screen
  /// that titles itself.
  final bool compactChrome;

  /// Optional floating action button.
  final Widget? floatingActionButton;

  /// Optional docked bar below the content, above the shell's own bar.
  final Widget? bottomBar;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Column(
        children: <Widget>[
          MobileChrome(
            title: title,
            onBack: onBack,
            backSemanticLabel: backSemanticLabel,
            actions: actions,
            compact: compactChrome,
          ),
          // The strip has already consumed the top inset, so the content below
          // it must not consume it a second time.
          Expanded(
            child: SafeArea(top: false, child: body),
          ),
        ],
      ),
      bottomNavigationBar: bottomBar,
      floatingActionButton: floatingActionButton,
    );
  }
}
