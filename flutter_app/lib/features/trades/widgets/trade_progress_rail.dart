import 'package:flutter/material.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/models/enums.dart';

/// Horizontal stepper showing the trade lifecycle states.
///
/// States displayed: Proposed → Terms → Collateral → Transit/Handover →
/// Inspection → Complete.
///
/// Current state is highlighted with the accent color; past states show
/// checkmarks; future states are muted.
class TradeProgressRail extends StatelessWidget {
  const TradeProgressRail({
    required this.currentState,
    this.handoverMethod,
    super.key,
  });

  /// The current trade state.
  final TradeState currentState;

  /// If provided, the transit step label adapts (Transit vs Handover).
  final HandoverMethod? handoverMethod;

  /// Ordered list of display steps mapped from trade states.
  static const _stepLabels = [
    'Proposed',
    'Terms',
    'Collateral',
    'Transit', // dynamically becomes 'Handover' for in-person
    'Inspection',
    'Complete',
  ];

  /// Maps a TradeState to the step index in the progress rail.
  int get _currentStepIndex {
    return switch (currentState) {
      TradeState.negotiating => 0,
      TradeState.collateralPending => 2,
      TradeState.collateralLocked => 2,
      TradeState.inTransit => 3,
      TradeState.inspection => 4,
      TradeState.completed => 5,
      TradeState.disputed => 4, // show at inspection level
      TradeState.fraudResolved => 5,
      TradeState.cancelled => 0, // terminal, show at start
    };
  }

  @override
  Widget build(BuildContext context) {
    final stepIndex = _currentStepIndex;
    final labels = List<String>.from(_stepLabels);

    // Adapt transit step label for in-person trades.
    if (handoverMethod == HandoverMethod.inPerson) {
      labels[3] = 'Handover';
    }

    return SizedBox(
      height: 60,
      child: Row(
        children: List.generate(labels.length, (index) {
          final isCompleted = index < stepIndex;
          final isCurrent = index == stepIndex;

          return Expanded(
            child: _StepItem(
              label: labels[index],
              isCompleted: isCompleted,
              isCurrent: isCurrent,
              isFirst: index == 0,
              isLast: index == labels.length - 1,
            ),
          );
        }),
      ),
    );
  }
}

class _StepItem extends StatelessWidget {
  const _StepItem({
    required this.label,
    required this.isCompleted,
    required this.isCurrent,
    required this.isFirst,
    required this.isLast,
  });

  final String label;
  final bool isCompleted;
  final bool isCurrent;
  final bool isFirst;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final Color circleColor;
    final Widget circleChild;

    if (isCompleted) {
      circleColor = AppTheme.success;
      circleChild = const Icon(Icons.check, size: 12, color: Colors.white);
    } else if (isCurrent) {
      circleColor = AppTheme.accent;
      circleChild = Container(
        width: 6,
        height: 6,
        decoration: const BoxDecoration(
          color: Colors.white,
          shape: BoxShape.circle,
        ),
      );
    } else {
      circleColor = AppTheme.border;
      circleChild = const SizedBox.shrink();
    }

    final lineColor = isCompleted ? AppTheme.success : AppTheme.border;

    return Column(
      mainAxisSize: MainAxisSize.min,
      children: [
        Row(
          children: [
            // Left connector line
            Expanded(
              child: isFirst
                  ? const SizedBox.shrink()
                  : AnimatedContainer(
                      duration: const Duration(milliseconds: 300),
                      height: 2,
                      color: lineColor,
                    ),
            ),
            // Circle indicator
            AnimatedContainer(
              duration: const Duration(milliseconds: 300),
              width: isCurrent ? 22 : 18,
              height: isCurrent ? 22 : 18,
              decoration: BoxDecoration(
                color: circleColor,
                shape: BoxShape.circle,
                boxShadow: isCurrent
                    ? [
                        BoxShadow(
                          color: AppTheme.accent.withValues(alpha: 0.3),
                          blurRadius: 6,
                          spreadRadius: 1,
                        ),
                      ]
                    : null,
              ),
              child: Center(child: circleChild),
            ),
            // Right connector line
            Expanded(
              child: isLast
                  ? const SizedBox.shrink()
                  : AnimatedContainer(
                      duration: const Duration(milliseconds: 300),
                      height: 2,
                      color: isCurrent || isCompleted
                          ? lineColor
                          : AppTheme.border,
                    ),
            ),
          ],
        ),
        const SizedBox(height: AppTheme.spacingXs),
        Text(
          label,
          style: AppTheme.metaText.copyWith(
            fontWeight: isCurrent ? FontWeight.w600 : FontWeight.w400,
            color: isCurrent
                ? AppTheme.accent
                : isCompleted
                    ? AppTheme.primary
                    : AppTheme.muted,
          ),
          textAlign: TextAlign.center,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
        ),
      ],
    );
  }
}
