// What step two of verification involves, and the outbound action that starts it.
//
// PAYOUT SETUP IS NOT THE IDENTITY GATE, IN EITHER DIRECTION. This screen presents
// only `canReceiveFunds` — approved, settlements enabled, and an account reference —
// and says nothing about whether the member is verified. A member may legitimately
// hold either step without the other, so nothing here is drawn as an error for the
// absence of the other one (Req 10.2, 10.3).
//
// THE STATE IS THE PROVIDER'S, READ BACK. `canReceiveFunds` in
// `domain/identity/identity_gate.dart` is the only evaluation; returning from the
// hosted flow proves nothing, and a resume re-reads the row (Req 10.7, 14.12).
//
// THE HOSTED FLOW IS A HANDOFF, and this file now says so through `WebHandoff`
// rather than a private base URL and a bare `launchUrl` (Req 10.6, 14.6).
//
// PAYOUT REPORTING IS NOT HERE. What a member is owed and what has landed is a
// seven-query read model on the web with no mobile counterpart; the hub links to it
// rather than approximating it.
//
// Requirements 10.2–10.7, 13.6–13.12, 14.6, 14.12.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/core/web_handoff.dart';
import 'package:cardtrade/domain/identity/identity_gate.dart' as gate;
import 'package:cardtrade/models/profile.dart';
import 'package:cardtrade/widgets/common/app_scaffold.dart';
import 'package:cardtrade/widgets/common/controls.dart';
import 'package:cardtrade/widgets/common/error_view.dart';
import 'package:cardtrade/widgets/common/status_badge.dart';
import 'package:cardtrade/features/profile/widgets/profile_reread.dart';
import 'package:cardtrade/features/profile/widgets/profile_sections.dart';

/// Step two of verification: where a member's money is sent.
class PayoutSetupScreen extends ConsumerWidget {
  const PayoutSetupScreen({super.key});

  /// The step's heading, in the words the web's sequence uses.
  static const String title = 'Add payout details';

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
                title: 'We could not load your payout status',
                message: 'Your payout status did not load. Please try again.',
                onRetry: state.retry,
              );
            }
            return const ProfileStepSkeleton(
              announcement: 'Loading your payout status',
            );
          }

          return _PayoutStep(
            payable: gate.canReceiveFunds(
              merchantStatus: profile.merchantStatus,
              merchantSettlementsEnabled: profile.merchantSettlementsEnabled,
              merchantRef: profile.merchantRef,
            ),
            // Whether the account SHELL exists. It is the difference between
            // starting the hosted flow and resuming it, and nothing more: creating
            // the account is the beginning of onboarding, never its completion.
            started: profile.merchantRef != null,
            reReadOverdue: state.overdue,
            onReRead: state.retry,
          );
        },
      ),
    );
  }
}

class _PayoutStep extends StatelessWidget {
  const _PayoutStep({
    required this.payable,
    required this.started,
    required this.reReadOverdue,
    required this.onReRead,
  });

  final bool payable;
  final bool started;
  final bool reReadOverdue;
  final VoidCallback onReRead;

  @override
  Widget build(BuildContext context) {
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
                payable ? 'Your payout account is set up' : PayoutSetupScreen.title,
                style: AppType.subhead.copyWith(
                  fontWeight: FontWeight.w600,
                  color: AppColors.foreground,
                ),
                softWrap: true,
              ),
            ),
            StatusBadge(
              label: payable ? 'Passed' : 'Pending',
              variant: payable
                  ? StatusBadgeVariant.completed
                  : StatusBadgeVariant.neutral,
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.snug),
        Text(
          payable
              ? 'Money from a completed sale, and any collateral awarded to you, '
                  'is released to this account.'
              : 'This is where money from a sale is sent. Our payment provider '
                  'collects your bank details directly — we never see them.',
          style: AppText.supportText,
          softWrap: true,
        ),

        if (!payable) ...<Widget>[
          const SizedBox(height: AppSpacing.section),
          const Text('What this unlocks', style: AppText.sectionLabel),
          const SizedBox(height: AppSpacing.snug),
          const Text(
            'Receiving money. Listing, selling and trading do not need it, and '
            'buying never does.',
            style: AppText.bodyText,
            softWrap: true,
          ),

          const SizedBox(height: AppSpacing.section),
          Text(
            'Opens ${WebHandoff.pageLabel(WebHandoff.payoutSetup)} in your '
            'browser. You will leave the app and come back to this screen.',
            style: AppText.metaText,
            softWrap: true,
          ),
          const SizedBox(height: AppSpacing.snug),
          AppButton(
            label: started
                ? 'Finish payout setup on the website'
                : 'Add payout details on the website',
            icon: Icons.open_in_new_rounded,
            fillWidth: true,
            onPressed: () =>
                WebHandoff.openOrWarn(context, WebHandoff.payoutSetup),
          ),
        ],

        if (payable) ...<Widget>[
          const SizedBox(height: AppSpacing.section),
          ProfileMenuRow(
            icon: Icons.account_balance_wallet_outlined,
            label: 'View your payouts',
            trailingNote: 'Opens ${WebHandoff.pageLabel(WebHandoff.payoutReport)} '
                'in your browser',
            leavesApp: true,
            onTap: () => WebHandoff.openOrWarn(context, WebHandoff.payoutReport),
          ),
        ],

        if (reReadOverdue) ...<Widget>[
          const SizedBox(height: AppSpacing.group),
          ProfileReReadNotice(onReRead: onReRead),
        ],
      ],
    );
  }
}
