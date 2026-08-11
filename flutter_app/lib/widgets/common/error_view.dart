import 'package:flutter/material.dart';

import '../../core/theme.dart';

/// A friendly error view centered in available space.
///
/// Displays an error icon, title, descriptive message, and an optional
/// retry button. Designed to feel helpful rather than alarming.
class ErrorView extends StatelessWidget {
  const ErrorView({
    this.title = 'Something went wrong',
    this.message = 'We couldn\'t load this content. Please try again.',
    this.onRetry,
    this.icon = Icons.error_outline_rounded,
    super.key,
  });

  /// Heading text (keep short and friendly).
  final String title;

  /// Descriptive message explaining what happened.
  final String message;

  /// Called when the retry button is tapped. If null, no button is shown.
  final VoidCallback? onRetry;

  /// The icon displayed above the title.
  final IconData icon;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppTheme.spacingXl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 56,
              color: AppTheme.muted,
            ),
            const SizedBox(height: AppTheme.spacingLg),
            Text(
              title,
              style: theme.textTheme.headlineSmall,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: AppTheme.spacingSm),
            Text(
              message,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: AppTheme.secondary,
              ),
              textAlign: TextAlign.center,
            ),
            if (onRetry != null) ...[
              const SizedBox(height: AppTheme.spacingXl),
              OutlinedButton.icon(
                onPressed: onRetry,
                icon: const Icon(Icons.refresh_rounded, size: 18),
                label: const Text('Try again'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
