// What step one of verification involves, and the outbound action that starts it.
//
// THIS SCREEN EXPLAINS; STRIPE DECIDES. The session is created with the secret key,
// which is not in this bundle and must not be, so the check itself runs on a hosted
// page in the device browser. The affordance names that page and says it leaves the
// app rather than implying the check happens here (Req 10.6, 14.13), and it goes
// through `WebHandoff` rather than reaching for `url_launcher` and a base URL of its
// own — which is what this file did, with a second copy of the web address in a
// `TODO` comment beside it.
//
// THE STATUS IS THE SERVER'S. `verificationState` in
// `domain/identity/identity_gate.dart` is the only reading of it, and returning from
// the browser does not change it; a resume re-reads the row and the mark follows that
// (Req 10.2, 10.7, 14.12).
//
// PENDING IS NOT FAILED, AND FAILED IS NOT PENDING. The screen this replaces drew
// two states — verified and pending — and drew a rejected check as an untouched one,
// offering "Start Verification" to a member whose check had come back not approved
// with nothing to say that it had.
//
// Requirements 10.2–10.7, 13.6–13.12, 14.6, 14.12.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/core/web_handoff.dart';
import 'package:cardtrade/domain/identity/identity_gate.dart';
import 'package:cardtrade/models/profile.dart';
import 'package:cardtrade/widgets/common/app_scaffold.dart';
import 'package:cardtrade/widgets/common/controls.dart';
import 'package:cardtrade/widgets/common/error_view.dart';
import 'package:cardtrade/widgets/common/status_badge.dart';
import 'package:cardtrade/features/profile/widgets/profile_reread.dart';
import 'package:cardtrade/features/profile/widgets/profile_sections.dart';

/// Step one of verification: what it asks for and what it unlocks.
class IdentityVerificationScreen extends ConsumerWidget {
  const IdentityVerificationScreen({super.key});

  /// The step's heading, in the words the web's sequence uses.
  static const String title = 'Verify your identity';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return AppScaffold(
      title: title,
      onBack: () => Navigator.of(context).maybePop(),
      body: ProfileReRead(
        builder: (BuildContext context, ProfileReadState state) {
          final Profile? profile = state.lastReported;
          if (profile == null) {
            if (state.read.hasError) {
              return ErrorView(
                title: 'We could not load your status',
                message: 'Your verification status did not load. '
                    'Please try again.',
                onRetry: state.retry,
              );
            }
            return const ProfileStepSkeleton(
              announcement: 'Loading your status',
            );
          }

          return _IdentityStep(
            state: verificationState(profile.identityCheckStatus),
            verifiedName: profile.identityCheckName,
            reReadOverdue: state.overdue,
            onReRead: state.retry,
          );
        },
      ),
    );
  }
}

class _IdentityStep extends StatelessWidget {
  const _IdentityStep({
    required this.state,
    required this.verifiedName,
    required this.reReadOverdue,
    required this.onReRead,
  });

  final VerificationState state;

  /// The document-backed name, which is the whole of what the check gives back to
  /// the app. Never a document number, an address or a date of birth.
  final String? verifiedName;

  final bool reReadOverdue;
  final VoidCallback onReRead;

  @override
  Widget build(BuildContext context) {
    final bool passed = state == VerificationState.verified;

    return ListView(
      padding: const EdgeInsets.fromLTRB(
        AppSpacing.group,
        AppSpacing.snug,
        AppSpacing.group,
        AppSpacing.section,
      ),
      children: <Widget>[
        Row(
          spacing: AppSpacing.snug,
          children: <Widget>[
            Expanded(
              child: Text(
                _headline(state),
                style: AppType.subhead.copyWith(
                  fontWeight: FontWeight.w600,
                  color: AppColors.foreground,
                ),
                softWrap: true,
              ),
            ),
            StatusBadge(label: _statusLabel(state), variant: _variant(state)),
          ],
        ),
        const SizedBox(height: AppSpacing.snug),
        Text(_explanation(state), style: AppText.supportText, softWrap: true),

        if (passed && verifiedName != null) ...<Widget>[
          const SizedBox(height: AppSpacing.snug),
          Text('Verified as $verifiedName', style: AppText.bodyText),
        ],

        if (!passed) ...<Widget>[
          const SizedBox(height: AppSpacing.section),
          const Text('What this unlocks', style: AppText.sectionLabel),
          const SizedBox(height: AppSpacing.snug),
          const _StepFact(
            icon: Icons.storefront_rounded,
            text: 'Listing cards for sale',
          ),
          const _StepFact(
            icon: Icons.swap_horiz_rounded,
            text: 'Entering a trade',
          ),
          const _StepFact(
            icon: Icons.verified_user_rounded,
            text: 'Being named as the seller on a contract',
          ),

          const SizedBox(height: AppSpacing.section),
          const Text("What you'll need", style: AppText.sectionLabel),
          const SizedBox(height: AppSpacing.snug),
          const _StepFact(
            icon: Icons.badge_outlined,
            text: 'A government-issued photo ID',
          ),
          const _StepFact(
            icon: Icons.face_rounded,
            text: 'A selfie, to compare against it',
          ),

          const SizedBox(height: AppSpacing.section),
          Text(
            'Opens ${WebHandoff.pageLabel(WebHandoff.identityVerification)} in '
            'your browser. You will leave the app and come back to this screen.',
            style: AppText.metaText,
            softWrap: true,
          ),
          const SizedBox(height: AppSpacing.snug),
          AppButton(
            label: state == VerificationState.inProgress
                ? 'Check your verification on the website'
                : 'Verify on the website',
            icon: Icons.open_in_new_rounded,
            fillWidth: true,
            onPressed: () => WebHandoff.openOrWarn(
              context,
              WebHandoff.identityVerification,
            ),
          ),
        ],

        if (reReadOverdue) ...<Widget>[
          const SizedBox(height: AppSpacing.group),
          ProfileReReadNotice(onReRead: onReRead),
        ],
      ],
    );
  }

  static String _headline(VerificationState state) => switch (state) {
        VerificationState.verified => 'Your identity is verified',
        VerificationState.inProgress => 'Your check is being reviewed',
        VerificationState.notApproved => 'Your check was not approved',
        VerificationState.notStarted => IdentityVerificationScreen.title,
      };

  static String _statusLabel(VerificationState state) => switch (state) {
        VerificationState.verified => 'Passed',
        VerificationState.inProgress => 'In review',
        VerificationState.notApproved => 'Not approved',
        VerificationState.notStarted => 'Pending',
      };

  static StatusBadgeVariant _variant(VerificationState state) => switch (state) {
        VerificationState.verified => StatusBadgeVariant.completed,
        VerificationState.inProgress => StatusBadgeVariant.pending,
        VerificationState.notApproved => StatusBadgeVariant.error,
        VerificationState.notStarted => StatusBadgeVariant.neutral,
      };

  static String _explanation(VerificationState state) => switch (state) {
        VerificationState.verified =>
          'You can list cards, sell and enter trades.',
        VerificationState.inProgress =>
          'This usually takes a few minutes. You do not need to do anything '
              'else while it is reviewed.',
        VerificationState.notApproved =>
          'You can try again on the website. A clearer photo of the same '
              'document is usually enough.',
        VerificationState.notStarted =>
          'We check every seller against a photo ID to keep known fraudsters '
              'off the marketplace. Buying does not need it.',
      };
}

/// One line of what a step unlocks or asks for.
class _StepFact extends StatelessWidget {
  const _StepFact({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.snug),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        spacing: AppSpacing.snug,
        children: <Widget>[
          ExcludeSemantics(
            child: Container(
              padding: const EdgeInsets.all(AppSpacing.snug),
              decoration: BoxDecoration(
                color: AppTint.eyebrow.fill,
                borderRadius: BorderRadius.circular(AppRadius.md),
              ),
              child: Icon(icon, size: AppIconSize.base, color: AppColors.irisInk),
            ),
          ),
          Expanded(child: Text(text, style: AppText.bodyText, softWrap: true)),
        ],
      ),
    );
  }
}

