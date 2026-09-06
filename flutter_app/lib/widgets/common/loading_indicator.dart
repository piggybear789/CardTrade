import 'package:flutter/material.dart';

import '../../core/theme.dart';

/// A centred spinner with an optional message.
///
/// For an indeterminate wait with nothing to stand in for. Where the shape of the
/// content IS known, prefer the skeleton in `skeleton.dart`: it reserves the
/// layout, so nothing moves when the data arrives (Req 11.1).
class LoadingIndicator extends StatelessWidget {
  const LoadingIndicator({this.message, super.key});

  /// Optional message displayed below the spinner.
  final String? message;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.group),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const CircularProgressIndicator.adaptive(
              valueColor: AlwaysStoppedAnimation<Color>(AppColors.iris),
            ),
            if (message != null) ...[
              const SizedBox(height: AppSpacing.cozy),
              Text(
                message!,
                style: AppText.supportText,
                textAlign: TextAlign.center,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
