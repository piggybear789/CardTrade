import 'package:flutter/material.dart';

import '../../core/theme.dart';

/// An empty state placeholder for screens or lists with no content.
///
/// Shows a large icon, title, explanatory subtitle, and an optional
/// action button. Centered with generous spacing for visual comfort.
class EmptyState extends StatelessWidget {
  const EmptyState({
    required this.icon,
    required this.title,
    this.subtitle,
    this.actionLabel,
    this.onAction,
    super.key,
  });

  /// Large icon displayed at the top.
  final IconData icon;

  /// Primary heading for the empty state.
  final String title;

  /// Optional supporting text explaining what the user can do.
  final String? subtitle;

  /// Label for the optional action button.
  final String? actionLabel;

  /// Callback for the action button. Button is hidden if null.
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: AppTheme.spacingXxl,
          vertical: AppTheme.spacingXxxl,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(
              icon,
              size: 64,
              color: AppTheme.muted.withOpacity(0.6),
            ),
            const SizedBox(height: AppTheme.spacingXl),
            Text(
              title,
              style: theme.textTheme.headlineSmall,
              textAlign: TextAlign.center,
            ),
            if (subtitle != null) ...[
              const SizedBox(height: AppTheme.spacingSm),
              Text(
                subtitle!,
                style: theme.textTheme.bodyMedium?.copyWith(
                  color: AppTheme.secondary,
                ),
                textAlign: TextAlign.center,
              ),
            ],
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: AppTheme.spacingXl),
              ElevatedButton(
                onPressed: onAction,
                child: Text(actionLabel!),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
