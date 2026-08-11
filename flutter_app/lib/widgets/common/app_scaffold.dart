import 'package:flutter/material.dart';

/// A wrapper providing consistent page structure across the app.
///
/// Handles safe area insets, optional [AppBar] with title, body content,
/// and an optional floating action button. Use this instead of raw
/// [Scaffold] for top-level screen pages to maintain visual consistency.
class AppScaffold extends StatelessWidget {
  const AppScaffold({
    required this.body,
    this.title,
    this.actions,
    this.floatingActionButton,
    this.leading,
    this.showBackButton = true,
    super.key,
  });

  /// The main content of the page.
  final Widget body;

  /// Optional AppBar title. If null, no AppBar is shown.
  final String? title;

  /// Optional AppBar trailing actions.
  final List<Widget>? actions;

  /// Optional floating action button.
  final Widget? floatingActionButton;

  /// Optional leading widget for the AppBar.
  final Widget? leading;

  /// Whether to show the back button when navigation can pop.
  final bool showBackButton;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: title != null
          ? AppBar(
              title: Text(title!),
              actions: actions,
              leading: leading,
              automaticallyImplyLeading: showBackButton,
            )
          : null,
      body: SafeArea(
        top: title == null, // AppBar handles its own safe area
        child: body,
      ),
      floatingActionButton: floatingActionButton,
    );
  }
}
