/// The DEBUG half of the fail-closed configuration gate (Req 6.3).
///
/// A release build never reaches this widget: `main.dart` throws on a non-empty
/// [validateConfig] result under `kReleaseMode` and lands in `StartupErrorApp`
/// instead (Req 6.2). What is left is the debug case, where the requirement is
/// to report on a VISIBLE in-app surface and keep running — the pre-existing
/// `debugPrint` is exactly what that replaces, because a line in the console is
/// invisible to anyone who is not watching the console.
///
/// The surface is a strip pinned above the running app, in the shape of a
/// `MaterialBanner`, so an unset `STRIPE_PUBLISHABLE_KEY` is loud without
/// blocking local work: everything below it is the real app, and the strip can
/// be dismissed. With a complete config it renders nothing at all and adds no
/// layout of its own.
///
/// PRIVACY: it renders `MissingConfig.key` and `MissingConfig.reason`, both of
/// which are value-free by construction. See the PRIVACY note in
/// `core/config_gate.dart`. Never add the value here — this strip is on screen
/// during screen shares and screenshots.
library;

import 'package:flutter/material.dart';

import 'config_gate.dart';
import 'theme.dart';

/// Renders [child], with a dismissible report above it when [problems] is
/// non-empty.
class ConfigReportBanner extends StatefulWidget {
  const ConfigReportBanner({
    required this.problems,
    required this.child,
    super.key,
  });

  /// The result of [validateConfig]. Empty is the normal state.
  final List<MissingConfig> problems;

  final Widget child;

  @override
  State<ConfigReportBanner> createState() => _ConfigReportBannerState();
}

class _ConfigReportBannerState extends State<ConfigReportBanner> {
  bool _dismissed = false;

  @override
  Widget build(BuildContext context) {
    if (widget.problems.isEmpty || _dismissed) return widget.child;

    return Column(
      children: [
        _ReportStrip(
          problems: widget.problems,
          onDismiss: () => setState(() => _dismissed = true),
        ),
        Expanded(child: widget.child),
      ],
    );
  }
}

class _ReportStrip extends StatelessWidget {
  const _ReportStrip({required this.problems, required this.onDismiss});

  final List<MissingConfig> problems;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    final Tint tint = AppTint.alert;

    return Material(
      color: AppColors.background,
      child: SafeArea(
        bottom: false,
        child: Container(
          width: double.infinity,
          decoration: BoxDecoration(
            color: tint.fill,
            border: Border(
              bottom: BorderSide(
                color: tint.edge ?? AppColors.border,
                width: AppMetrics.hairline,
              ),
            ),
          ),
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.group,
            vertical: AppSpacing.cozy,
          ),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                Icons.warning_amber_rounded,
                size: AppIconSize.large,
                color: tint.ink,
              ),
              const SizedBox(width: AppSpacing.snug),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Configuration incomplete',
                      style: Theme.of(context).textTheme.labelLarge?.copyWith(
                        color: tint.ink,
                      ),
                    ),
                    const SizedBox(height: AppSpacing.tight),
                    // One line per offending key. `MissingConfig.toString()` is
                    // 'KEY: reason' and carries no value.
                    for (final MissingConfig problem in problems)
                      Text(
                        problem.toString(),
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: tint.ink,
                        ),
                      ),
                  ],
                ),
              ),
              const SizedBox(width: AppSpacing.snug),
              IconButton(
                onPressed: onDismiss,
                icon: const Icon(Icons.close),
                iconSize: AppIconSize.base,
                color: tint.ink,
                tooltip: 'Dismiss',
                constraints: const BoxConstraints(
                  minWidth: AppMetrics.minHitArea,
                  minHeight: AppMetrics.minHitArea,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
