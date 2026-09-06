// Where a received invite link lands (Req 4.3).
//
// THE LINK IS A DESTINATION, NOT A DECISION. Everything the invite does when it is
// claimed — opening a Cash_Sale or a Trade, applying the Identity_Gate, checking
// that both parties trade in the same region, snapshotting the seller's identity
// disclosure — happens on the server, and there is no mobile endpoint in front of
// any of it. So this screen carries the token to the website rather than
// reimplementing the guards, which is the general rule `core/web_handoff.dart`
// already states for identity and payout onboarding.
//
// IT ANNOUNCES THE HANDOFF BEFORE IT PERFORMS IT (Req 12.2). A member cannot read
// the address bar of a browser that has not opened yet, so the page is named and
// the departure is stated on the affordance itself.
//
// IT CLAIMS NOTHING ABOUT THE INVITE. Whether the token is live, revoked, expired
// or the member's own is the server's answer, and this screen has not asked. It
// says what the link is FOR and hands it over; it does not draw a valid invite.
//
// Requirements 4.3, 4.7, 12.2.

import 'package:flutter/material.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/core/web_handoff.dart';
import 'package:cardtrade/widgets/common/app_scaffold.dart';
import 'package:cardtrade/widgets/common/controls.dart';

/// The screen a `/t/{token}` link opens.
class InviteScreen extends StatelessWidget {
  const InviteScreen({required this.token, super.key});

  /// The invite token exactly as the link carried it.
  final String token;

  /// The screen's heading, in the words the website's join page uses.
  static const String title = 'Private invite';

  @override
  Widget build(BuildContext context) {
    final Uri page = WebHandoff.invite(token);

    return AppScaffold(
      title: title,
      onBack: () => Navigator.of(context).maybePop(),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.group,
          AppSpacing.snug,
          AppSpacing.group,
          AppSpacing.section,
        ),
        children: <Widget>[
          Text(
            'Someone sent you this invite',
            style: AppType.subhead.copyWith(
              fontWeight: FontWeight.w600,
              color: AppColors.foreground,
            ),
            softWrap: true,
          ),
          const SizedBox(height: AppSpacing.snug),
          const Text(
            'A private invite opens a sale or a trade between just the two of '
            'you, off the public catalog.',
            style: AppText.supportText,
            softWrap: true,
          ),

          const SizedBox(height: AppSpacing.section),
          const Text('What happens next', style: AppText.sectionLabel),
          const SizedBox(height: AppSpacing.snug),
          const Text(
            'The website shows you what is on offer before you agree to '
            'anything. Nothing is committed by opening the link.',
            style: AppText.bodyText,
            softWrap: true,
          ),

          const SizedBox(height: AppSpacing.section),
          Text(
            'Opens ${WebHandoff.pageLabel(page)} in your browser. You will leave '
            'the app.',
            style: AppText.metaText,
            softWrap: true,
          ),
          const SizedBox(height: AppSpacing.snug),
          AppButton(
            label: 'Open this invite on the website',
            icon: Icons.open_in_new_rounded,
            fillWidth: true,
            onPressed: () => WebHandoff.openOrWarn(context, page),
          ),
        ],
      ),
    );
  }
}
