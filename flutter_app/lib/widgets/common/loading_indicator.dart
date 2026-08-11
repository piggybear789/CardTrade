import 'package:flutter/material.dart';

import '../../core/theme.dart';

/// A centered loading indicator with an optional descriptive message.
///
/// Uses [CircularProgressIndicator.adaptive] for platform-appropriate styling
/// and the app's accent color.
class LoadingIndicator extends StatelessWidget {
  const LoadingIndicator({this.message, super.key});

  /// Optional message displayed below the spinner.
  final String? message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppTheme.spacingXl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const CircularProgressIndicator.adaptive(
              valueColor: AlwaysStoppedAnimation<Color>(AppTheme.accent),
            ),
            if (message != null) ...[
              const SizedBox(height: AppTheme.spacingLg),
              Text(
                message!,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: AppTheme.secondary,
                    ),
                textAlign: TextAlign.center,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
