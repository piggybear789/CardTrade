import 'package:flutter/material.dart';

import '../../core/theme.dart';

/// A reusable Material 3 confirmation dialog.
///
/// Returns `true` if the user confirms, `false` (or null) on cancel/dismiss.
/// Use [ConfirmationDialog.danger] for destructive actions (red confirm button).
///
/// Usage:
/// ```dart
/// final confirmed = await ConfirmationDialog.show(
///   context: context,
///   title: 'Cancel trade?',
///   message: 'This action cannot be undone.',
/// );
/// ```
class ConfirmationDialog extends StatelessWidget {
  const ConfirmationDialog({
    required this.title,
    required this.message,
    this.confirmLabel = 'Confirm',
    this.cancelLabel = 'Cancel',
    this.isDanger = false,
    super.key,
  });

  /// Dialog title.
  final String title;

  /// Explanatory message body.
  final String message;

  /// Label for the confirm button.
  final String confirmLabel;

  /// Label for the cancel button.
  final String cancelLabel;

  /// When true, the confirm button uses danger (red) styling.
  final bool isDanger;

  /// Shows the dialog and returns whether the user confirmed.
  static Future<bool> show({
    required BuildContext context,
    required String title,
    required String message,
    String confirmLabel = 'Confirm',
    String cancelLabel = 'Cancel',
    bool isDanger = false,
  }) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (_) => ConfirmationDialog(
        title: title,
        message: message,
        confirmLabel: confirmLabel,
        cancelLabel: cancelLabel,
        isDanger: isDanger,
      ),
    );
    return result ?? false;
  }

  /// Convenience for destructive action dialogs.
  static Future<bool> danger({
    required BuildContext context,
    required String title,
    required String message,
    String confirmLabel = 'Delete',
    String cancelLabel = 'Cancel',
  }) {
    return show(
      context: context,
      title: title,
      message: message,
      confirmLabel: confirmLabel,
      cancelLabel: cancelLabel,
      isDanger: true,
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return AlertDialog(
      title: Text(title),
      content: Text(
        message,
        style: theme.textTheme.bodyMedium?.copyWith(
          color: AppTheme.secondary,
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: Text(cancelLabel),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(true),
          style: isDanger
              ? FilledButton.styleFrom(backgroundColor: AppTheme.danger)
              : null,
          child: Text(confirmLabel),
        ),
      ],
    );
  }
}
