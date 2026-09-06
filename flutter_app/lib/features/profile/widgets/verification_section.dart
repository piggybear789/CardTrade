// The Verification region: the two sequential gates, in the order the web
// presents them, each drawn from its OWN server-reported status.
//
// WHY EACH STEP READS ITS OWN FIELD AND NOTHING ELSE. `product.md` and the
// identity gate port both state that the Identity_Gate and payout setup are
// independent in both directions — a verified member with no payout account is a
// normal state, and so is the reverse. So neither mark is inferred from the other,
// neither pending step is drawn as a fault, and both steps offer their own control
// while they are outstanding: a member who set payouts up first has not done
// anything wrong, and a client that refused them the identity step until payouts
// landed would be inventing an ordering the server does not enforce (Req 10.2, 10.3).
//
// NEITHER MARK IS DERIVED HERE. `satisfiesIdentityGate` and `canReceiveFunds` in
// `domain/identity/identity_gate.dart` are the only evaluations of either gate, and
// both read the profile row the server returned. This file takes their two answers
// as booleans and decides only how to draw them (Req 14.11, 14.12).
//
// THE STEP CONTROL LEAVES THE APP, AND SAYS SO. Both hosted flows are created with
// the Stripe secret key, which is not in this bundle and must not be, so the client
// cannot start either one. The affordance therefore names the page it opens and
// states that it leaves the app, rather than implying the step finishes here
// (Req 10.6, 14.6, 14.13).
//
// A PASSED STEP IS NEVER PASSED BECAUSE A HANDOFF WAS OPENED. The mark comes from
// the re-read; while that re-read is outstanding the section keeps showing the last
// status the server reported, and past [ProfileReRead.overdueAfter] it says so and
// offers to ask again (Req 10.7).
//
// Requirements 10.2–10.7, 13.6–13.12, 14.6, 14.12.

import 'package:flutter/material.dart';

import '../../../core/theme.dart';
import '../../../core/web_handoff.dart';
import '../../../widgets/common/controls.dart';
import 'profile_reread.dart';

/// The two-step verification sequence as the Account hub presents it.
class VerificationSection extends StatelessWidget {
  const VerificationSection({
    required this.identityPassed,
    required this.payoutPassed,
    required this.onIdentityDetail,
    required this.onPayoutDetail,
    this.reReadOverdue = false,
    this.onReRead,
    super.key,
  });

  /// Step one's own status: `satisfiesIdentityGate` over the server's row.
  final bool identityPassed;

  /// Step two's own status: `canReceiveFunds` over the server's row.
  final bool payoutPassed;

  /// Opens the in-app explanation of what the identity step involves.
  final VoidCallback onIdentityDetail;

  /// Opens the in-app explanation of what the payout step involves.
  final VoidCallback onPayoutDetail;

  /// Whether a status re-read has been outstanding long enough to say so.
  final bool reReadOverdue;

  /// Asks the server for both statuses again.
  final VoidCallback? onReRead;

  /// Step one's heading, in the words the web's sequence uses.
  static const String identityTitle = 'Verify your identity';

  /// Step two's heading, in the words the web's sequence uses.
  static const String payoutTitle = 'Add payout details';

  /// A step's status in words, so colour is never the only signal (Req 10.4).
  static const String passedLabel = 'Passed';
  static const String pendingLabel = 'Pending';

  /// Which step a member is being asked for next, or null where none is.
  ///
  /// The identity step is the one named while it is outstanding, because it is the
  /// step that unlocks the rest of the platform. A member who has passed it and not
  /// set payouts up is not outstanding anything — they simply cannot be paid yet,
  /// which the payout step's own copy says without the section chasing them.
  String? get outstandingStep => identityPassed ? null : identityTitle;

  @override
  Widget build(BuildContext context) {
    final String? outstanding = outstandingStep;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        if (outstanding != null)
          Padding(
            padding: const EdgeInsets.only(bottom: AppSpacing.cozy),
            child: Text('Next step: $outstanding', style: AppText.supportText),
          ),

        _VerificationStep(
          title: identityTitle,
          passed: identityPassed,
          unlocks: 'Listing, selling and entering a trade.',
          // The ONLY place a photo identity document is mentioned: it is what this
          // step asks for and it is not what the payout step asks for (Req 10.5).
          requirement: 'A photo ID and a selfie, checked once.',
          handoff: WebHandoff.identityVerification,
          actionLabel: 'Verify on the website',
          detailLabel: "What you'll need",
          onDetail: onIdentityDetail,
        ),

        const Divider(height: AppSpacing.section),

        _VerificationStep(
          title: payoutTitle,
          passed: payoutPassed,
          unlocks: 'Receiving money.',
          handoff: WebHandoff.payoutSetup,
          actionLabel: 'Add payout details on the website',
          detailLabel: 'How payouts work',
          onDetail: onPayoutDetail,
        ),

        if (reReadOverdue && onReRead != null) ...<Widget>[
          const SizedBox(height: AppSpacing.group),
          ProfileReReadNotice(onReRead: onReRead!),
        ],
      ],
    );
  }
}

/// One step: its mark, its status in words, what it unlocks, and its control.
class _VerificationStep extends StatelessWidget {
  const _VerificationStep({
    required this.title,
    required this.passed,
    required this.unlocks,
    required this.handoff,
    required this.actionLabel,
    required this.detailLabel,
    required this.onDetail,
    this.requirement,
  });

  final String title;
  final bool passed;
  final String unlocks;
  final String? requirement;
  final Uri handoff;
  final String actionLabel;
  final String detailLabel;
  final VoidCallback onDetail;

  @override
  Widget build(BuildContext context) {
    // Req 10.4: `--trust` for a passed step, `--muted-foreground` for a pending
    // one. Req 13.11: the mark's SHAPE differs as well — a filled tick against an
    // open ring — so the two states survive greyscale.
    final Color ink = passed ? AppColors.trust : AppColors.mutedForeground;
    final IconData mark =
        passed ? Icons.check_circle_rounded : Icons.radio_button_unchecked;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          spacing: AppSpacing.snug,
          children: <Widget>[
            ExcludeSemantics(
              child: Padding(
                // Optical alignment with the first line of the title rather than
                // with the block, so the mark does not float above a wrapped
                // heading at a large text scale.
                padding: const EdgeInsets.only(top: AppSpacing.tight),
                child: Icon(mark, size: AppIconSize.large, color: ink),
              ),
            ),
            Expanded(child: Text(title, style: AppText.rowName, softWrap: true)),
            Text(
              passed
                  ? VerificationSection.passedLabel
                  : VerificationSection.pendingLabel,
              style: AppText.badgeText.copyWith(color: ink),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.tight),
        Text('Unlocks: $unlocks', style: AppText.supportText, softWrap: true),
        if (requirement != null)
          Text(requirement!, style: AppText.supportText, softWrap: true),

        if (!passed) ...<Widget>[
          const SizedBox(height: AppSpacing.cozy),
          Text(
            'Opens ${WebHandoff.pageLabel(handoff)} in your browser. '
            'You will leave the app and come back to this screen.',
            style: AppText.metaText,
            softWrap: true,
          ),
          const SizedBox(height: AppSpacing.snug),
          AppButton(
            label: actionLabel,
            icon: Icons.open_in_new_rounded,
            fillWidth: true,
            onPressed: () => WebHandoff.openOrWarn(context, handoff),
          ),
          // `group`, not `snug`: two stacked 40-pixel controls carry 48-pixel
          // touch rectangles, which would intersect at anything less (Req 13.6).
          const SizedBox(height: AppSpacing.group),
          AppButton(
            label: detailLabel,
            variant: AppButtonVariant.outline,
            fillWidth: true,
            onPressed: onDetail,
          ),
        ],
      ],
    );
  }
}
