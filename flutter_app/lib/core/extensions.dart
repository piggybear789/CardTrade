import 'package:flutter/material.dart';
import 'package:timeago/timeago.dart' as timeago;

/// Extension on DateTime for common formatting patterns.
extension DateTimeX on DateTime {
  /// Relative time string: "2 hours ago", "just now", etc.
  String get timeAgo => timeago.format(this);

  /// Short date: "12 Aug 2024"
  String get shortDate {
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '$day ${months[month - 1]} $year';
  }

  /// Time only: "2:30 PM"
  String get timeOnly {
    final hour = this.hour > 12 ? this.hour - 12 : this.hour;
    final period = this.hour >= 12 ? 'PM' : 'AM';
    final min = minute.toString().padLeft(2, '0');
    return '$hour:$min $period';
  }
}

/// Extension on String for common operations.
extension StringX on String {
  /// Capitalizes the first letter.
  String get capitalized {
    if (isEmpty) return this;
    return '${this[0].toUpperCase()}${substring(1)}';
  }

  /// Converts SNAKE_CASE enum to readable: "IN_TRANSIT" → "In Transit"
  String get enumLabel {
    return split('_')
        .map((w) => w.toLowerCase().capitalized)
        .join(' ');
  }
}

/// Extension on BuildContext for quick access to theme/media.
extension BuildContextX on BuildContext {
  ThemeData get theme => Theme.of(this);
  TextTheme get textTheme => Theme.of(this).textTheme;
  ColorScheme get colorScheme => Theme.of(this).colorScheme;
  MediaQueryData get mediaQuery => MediaQuery.of(this);
  double get screenWidth => mediaQuery.size.width;
  double get screenHeight => mediaQuery.size.height;
  EdgeInsets get padding => mediaQuery.padding;

  /// Shows a success snackbar.
  void showSuccess(String message) {
    ScaffoldMessenger.of(this).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: const Color(0xFF16a34a),
      ),
    );
  }

  /// Shows an error snackbar.
  void showError(String message) {
    ScaffoldMessenger.of(this).showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: const Color(0xFFdc2626),
      ),
    );
  }

  /// Shows an info snackbar.
  void showInfo(String message) {
    ScaffoldMessenger.of(this).showSnackBar(
      SnackBar(content: Text(message)),
    );
  }
}

/// Extension on num for SizedBox shortcuts.
extension NumSpacing on num {
  /// Vertical gap of this height.
  SizedBox get verticalGap => SizedBox(height: toDouble());

  /// Horizontal gap of this width.
  SizedBox get horizontalGap => SizedBox(width: toDouble());
}
