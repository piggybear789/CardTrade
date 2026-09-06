// ONE QUESTION AT A TIME. The single card that answers "what do I do now" for a
// contract, matching the web's `components/contract/ContractActionCard.tsx`.
//
// It renders NOTHING when the step list has no active step — a finished contract,
// a halted one, and the neutral presentation Req 7.11 prescribes for a status the
// step list does not recognise. It presents at most ONE primary action, styled as
// the listing detail's primary is; everything else is an outlined control
// (Req 7.6).
//
// "At most one" rather than "exactly one": where the live step is the OTHER
// party's move the room supplies no primary, and the card is then the sentence
// that says whose move it is. Inventing a control for a member who cannot act is
// worse than showing none.
//
// Requirements 7.1, 7.6, 7.11, 8.9, 8.10, 13.6, 13.7.

import 'package:flutter/material.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/models/contract_step.dart';
import 'package:cardtrade/widgets/common/controls.dart';

/// The visual weight of the action card.
enum ContractActionTone {
  /// The live, ordinary case: the iris wash.
  live,

  /// A settled outcome.
  settled,

  /// Something needing attention that is not yet a failure.
  caution,

  /// A failure or a dispute.
  alert,
}

/// One control the room offers for the live step.
class ContractAction {
  const ContractAction({
    required this.label,
    required this.onPressed,
    this.icon,
    this.destructive = false,
  });

  /// The control's visible label.
  final String label;

  /// Activation callback. Null presents the control as unavailable, which is how
  /// the room expresses "a call is in flight" (Req 8.9, 8.10).
  final VoidCallback? onPressed;

  /// An optional leading glyph. The label carries the meaning.
  final IconData? icon;

  /// Whether this action cannot be undone, drawn in `--destructive`.
  final bool destructive;
}

/// The one card in a contract room that says what happens now.
class ContractActionCard extends StatelessWidget {
  const ContractActionCard({
    required this.step,
    this.primary,
    this.secondary = const <ContractAction>[],
    this.note,
    this.tone = ContractActionTone.live,
    super.key,
  });

  /// The live step. Null once the contract is on no step at all, in which case
  /// this card renders nothing.
  final ContractStep? step;

  /// The single control for the live step, where the viewer has one.
  final ContractAction? primary;

  /// Everything else the viewer may do here, drawn as outlined controls.
  final List<ContractAction> secondary;

  /// One line of supporting fact under the detail — a deadline, a figure.
  final String? note;

  final ContractActionTone tone;

  @override
  Widget build(BuildContext context) {
    final ContractStep? live = step;
    if (live == null) return const SizedBox.shrink();

    final Tint tint = switch (tone) {
      ContractActionTone.live => AppTint.eyebrow,
      ContractActionTone.settled => AppTint.successChip,
      ContractActionTone.caution => AppTint.caution,
      ContractActionTone.alert => AppTint.alert,
    };

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppSpacing.cozy),
      decoration: BoxDecoration(
        color: tint.fill,
        borderRadius: BorderRadius.circular(AppRadius.lg),
        border: Border.all(color: tint.edge!, width: AppMetrics.hairline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        // `cozy` between stacked controls, so two 40-pixel controls keep 48-pixel
        // touch rectangles that do not intersect (Req 13.6).
        spacing: AppSpacing.cozy,
        children: <Widget>[
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            spacing: AppSpacing.tight,
            children: <Widget>[
              Text(
                live.label,
                style: AppType.lead.copyWith(
                  fontWeight: FontWeight.w600,
                  color: AppColors.foreground,
                ),
              ),
              if (live.detail != null && live.detail!.trim().isNotEmpty)
                Text(live.detail!.trim(), style: AppText.supportText),
              if (note != null && note!.trim().isNotEmpty)
                Text(note!.trim(), style: AppText.metaText),
            ],
          ),
          if (primary != null)
            AppButton(
              label: primary!.label,
              onPressed: primary!.onPressed,
              icon: primary!.icon,
              variant: primary!.destructive
                  ? AppButtonVariant.destructive
                  : AppButtonVariant.action,
              fillWidth: true,
            ),
          for (final ContractAction action in secondary)
            _SecondaryControl(action: action),
        ],
      ),
    );
  }
}

/// A secondary action: outlined, whether or not it is destructive (Req 7.6). A
/// destructive one keeps the `--destructive` ink and edge so the warning survives.
class _SecondaryControl extends StatelessWidget {
  const _SecondaryControl({required this.action});

  final ContractAction action;

  @override
  Widget build(BuildContext context) {
    if (!action.destructive) {
      return AppButton(
        label: action.label,
        onPressed: action.onPressed,
        icon: action.icon,
        variant: AppButtonVariant.outline,
        fillWidth: true,
      );
    }

    // MERGED onto the themed outlined style rather than replacing it, so the
    // drawn height, radius and label level still come from the one place that
    // owns them and only the ink and the edge change here.
    return OutlinedButtonTheme(
      data: OutlinedButtonThemeData(
        // The overriding style is the RECEIVER: `merge` keeps the receiver's
        // non-null fields and fills its null ones from the argument, so the
        // destructive ink wins and everything it does not name is the theme's.
        style: OutlinedButton.styleFrom(
          foregroundColor: AppColors.destructive,
          disabledForegroundColor: AppColors.mutedForeground,
          side: const BorderSide(color: AppColors.destructive, width: AppMetrics.hairline),
        ).merge(Theme.of(context).outlinedButtonTheme.style),
      ),
      child: AppButton(
        label: action.label,
        onPressed: action.onPressed,
        icon: action.icon,
        variant: AppButtonVariant.outline,
        fillWidth: true,
      ),
    );
  }
}
