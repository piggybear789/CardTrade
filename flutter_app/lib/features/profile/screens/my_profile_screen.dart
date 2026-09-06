// The Account hub — the phone's `/profile`.
//
// THREE REGIONS, IN THE WEB'S ORDER, UNDER THE WEB'S LABELS: Profile, then
// Verification, then Payouts (Req 10.1). The screen this replaces had one
// "Verification" card between a stats row and a menu, which put the two gates in the
// middle of the page and gave payout reporting no place at all.
//
// EVERY GATE ANSWER COMES FROM THE PORT. `satisfiesIdentityGate` and
// `canReceiveFunds` in `domain/identity/identity_gate.dart` are the only evaluations
// (Req 14.11, 14.12). The `Profile` model carries getters of the same names, and this
// screen deliberately does not read them: two spellings of one predicate is how the
// pair drifts, and the port is the one pinned to the TypeScript.
//
// EVERY COUNT IS EITHER A READ NUMERAL OR A PLACEHOLDER. It previously wrote
// `provider.value?.length ?? 0`, so a list that had not loaded drew a confident zero
// (Req 10.8). See [ProfileCount].
//
// THE STATUSES ARE RE-READ ON RESUME AND NEVER LATCHED. Both steps finish on a
// hosted page in the browser, so returning to the app is the only signal there is —
// and it is a signal that the member came back, not that anything passed. See
// [ProfileReRead] (Req 10.7).
//
// Requirements 10.1–10.8, 13.6–13.12, 14.6, 14.12.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/core/web_handoff.dart';
import 'package:cardtrade/domain/identity/identity_gate.dart' as gate;
import 'package:cardtrade/models/profile.dart';
import 'package:cardtrade/providers/auth_provider.dart';
import 'package:cardtrade/providers/listings_provider.dart';
import 'package:cardtrade/providers/sales_provider.dart';
import 'package:cardtrade/providers/trades_provider.dart';
import 'package:cardtrade/providers/profile_provider.dart';
import 'package:cardtrade/widgets/common/app_scaffold.dart';
import 'package:cardtrade/widgets/common/avatar.dart';
import 'package:cardtrade/widgets/common/confirmation_dialog.dart';
import 'package:cardtrade/widgets/common/controls.dart';
import 'package:cardtrade/widgets/common/empty_state.dart';
import 'package:cardtrade/widgets/common/error_view.dart';
import 'package:cardtrade/widgets/common/mobile_chrome.dart';
import 'package:cardtrade/widgets/common/skeleton.dart';
import 'package:cardtrade/features/profile/widgets/profile_reread.dart';
import 'package:cardtrade/features/profile/widgets/profile_sections.dart';
import 'package:cardtrade/features/profile/widgets/verification_section.dart';

/// The signed-in member's own account surface.
class MyProfileScreen extends ConsumerWidget {
  const MyProfileScreen({super.key});

  /// The hub's own title, matching the bottom navigation label.
  static const String title = 'Account';

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!ref.watch(isAuthenticatedProvider)) {
      return AppScaffold(
        title: title,
        body: EmptyState(
          icon: Icons.person_outline,
          title: 'Sign in to see your account',
          subtitle: 'Manage your listings, trades and verification.',
          actionLabel: 'Sign in',
          onAction: () => context.push('/auth/sign-in'),
        ),
      );
    }

    return AppScaffold(
      title: title,
      actions: <ChromeAction>[
        ChromeAction(
          icon: Icons.edit_outlined,
          semanticLabel: 'Edit your profile',
          onPressed: () => context.push('/profile/edit'),
        ),
      ],
      body: ProfileReRead(
        builder: (BuildContext context, ProfileReadState state) {
          final Profile? profile = state.lastReported;

          // Nothing has been reported yet, so there is nothing to retain: this is a
          // first load, not a re-read.
          if (profile == null) {
            if (state.read.hasError) {
              return ErrorView(
                title: 'We could not load your account',
                message: 'Your account details did not load. Please try again.',
                onRetry: state.retry,
              );
            }
            return const _AccountSkeleton();
          }

          return _AccountBody(profile: profile, state: state);
        },
      ),
    );
  }
}

/// The hub's three regions, drawn from the profile the server last reported.
class _AccountBody extends ConsumerWidget {
  const _AccountBody({required this.profile, required this.state});

  final Profile profile;
  final ProfileReadState state;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // The two gate answers, each from the port and each from its own columns.
    final bool identityPassed =
        gate.satisfiesIdentityGate(profile.identityCheckStatus);
    final bool payoutPassed = gate.canReceiveFunds(
      merchantStatus: profile.merchantStatus,
      merchantSettlementsEnabled: profile.merchantSettlementsEnabled,
      merchantRef: profile.merchantRef,
    );

    return RefreshIndicator(
      onRefresh: () async => ref.read(myProfileProvider.notifier).refresh(),
      child: ListView(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.group,
          AppSpacing.snug,
          AppSpacing.group,
          AppSpacing.section,
        ),
        children: <Widget>[
          _Identity(profile: profile, identityPassed: identityPassed),
          const SizedBox(height: AppSpacing.section),

          ProfileSection(
            title: 'Profile',
            padded: false,
            child: Column(
              children: <Widget>[
                Padding(
                  padding: const EdgeInsets.all(AppSpacing.cozy),
                  child: Row(
                    children: <Widget>[
                      ProfileCount(
                        label: 'Listings',
                        read: ref.watch(myListingsProvider),
                      ),
                      ProfileCount(
                        label: 'Trades',
                        read: ref.watch(myTradesProvider),
                      ),
                      ProfileCount(
                        label: 'Sales',
                        read: ref.watch(mySalesProvider),
                      ),
                    ],
                  ),
                ),
                const Divider(height: AppMetrics.hairline),
                ProfileMenuRow(
                  icon: Icons.storefront_rounded,
                  label: 'My listings',
                  onTap: () => context.push('/listings/mine'),
                ),
                const Divider(height: AppMetrics.hairline),
                ProfileMenuRow(
                  icon: Icons.swap_horiz_rounded,
                  label: 'Trades',
                  onTap: () => context.push('/trades'),
                ),
                const Divider(height: AppMetrics.hairline),
                ProfileMenuRow(
                  icon: Icons.local_offer_outlined,
                  label: 'Offers',
                  onTap: () => context.push('/offers'),
                ),
                const Divider(height: AppMetrics.hairline),
                ProfileMenuRow(
                  icon: Icons.bookmark_border_rounded,
                  label: 'Saved',
                  onTap: () => context.push('/saved'),
                ),
                const Divider(height: AppMetrics.hairline),
                ProfileMenuRow(
                  icon: Icons.settings_outlined,
                  label: 'Settings',
                  // `/profile/settings`, which is the route the router declares.
                  // This row pushed `/settings` and the identity row pushed
                  // `/profile/verify`; neither path exists, so both were dead.
                  onTap: () => context.push('/profile/settings'),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.section),

          ProfileSection(
            title: 'Verification',
            child: VerificationSection(
              identityPassed: identityPassed,
              payoutPassed: payoutPassed,
              reReadOverdue: state.overdue,
              onReRead: state.retry,
              onIdentityDetail: () => context.push('/profile/identity'),
              onPayoutDetail: () => context.push('/profile/payouts'),
            ),
          ),
          const SizedBox(height: AppSpacing.section),

          ProfileSection(
            title: 'Payouts',
            padded: false,
            child: Column(
              children: <Widget>[
                Padding(
                  padding: const EdgeInsets.all(AppSpacing.cozy),
                  child: Text(
                    payoutPassed
                        ? 'Your payout account is set up. Money from a completed '
                            'sale is released to it.'
                        : 'No payout account yet. You can list, sell and trade '
                            'without one — you just cannot be paid until it is set up.',
                    style: AppText.supportText,
                    softWrap: true,
                  ),
                ),
                const Divider(height: AppMetrics.hairline),
                ProfileMenuRow(
                  icon: Icons.account_balance_wallet_outlined,
                  label: 'View your payouts',
                  trailingNote:
                      'Opens ${WebHandoff.pageLabel(WebHandoff.payoutReport)} '
                      'in your browser',
                  leavesApp: true,
                  onTap: () =>
                      WebHandoff.openOrWarn(context, WebHandoff.payoutReport),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.section),

          AppButton(
            label: 'Sign out',
            icon: Icons.logout_rounded,
            variant: AppButtonVariant.outline,
            fillWidth: true,
            onPressed: () => _signOut(context, ref),
          ),
        ],
      ),
    );
  }

  Future<void> _signOut(BuildContext context, WidgetRef ref) async {
    final bool confirmed = await ConfirmationDialog.show(
      context: context,
      title: 'Sign out',
      message: 'Are you sure you want to sign out?',
      confirmLabel: 'Sign out',
    );
    if (!confirmed) return;
    await ref.read(authActionsProvider.notifier).signOut();
  }
}

/// The block above the sections: who the member is.
class _Identity extends StatelessWidget {
  const _Identity({required this.profile, required this.identityPassed});

  final Profile profile;
  final bool identityPassed;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: <Widget>[
        Avatar(
          imageUrl: profile.avatarPath,
          displayName: profile.displayName,
          size: AvatarSize.xl,
          // The badge is the gate's own answer, drawn from the port like every
          // other reading of it.
          showVerifiedBadge: identityPassed,
        ),
        const SizedBox(height: AppSpacing.snug),
        Text(
          profile.displayName,
          style: AppType.subhead.copyWith(
            fontWeight: FontWeight.w600,
            color: AppColors.foreground,
          ),
          textAlign: TextAlign.center,
        ),
        if (profile.regionCode != null) ...<Widget>[
          const SizedBox(height: AppSpacing.tight),
          Row(
            mainAxisSize: MainAxisSize.min,
            spacing: AppSpacing.tight,
            children: <Widget>[
              const ExcludeSemantics(
                child: Icon(
                  Icons.location_on_outlined,
                  size: AppIconSize.button,
                  color: AppColors.mutedForeground,
                ),
              ),
              Text(profile.regionCode!.toUpperCase(), style: AppText.metaText),
            ],
          ),
        ],
        if (profile.rating != null) ...<Widget>[
          const SizedBox(height: AppSpacing.snug),
          _Rating(rating: profile.rating!, count: profile.ratingCount),
        ],
      ],
    );
  }
}

/// The member's own rating, as five marks and a count.
class _Rating extends StatelessWidget {
  const _Rating({required this.rating, required this.count});

  final double rating;
  final int count;

  /// The web's rating stars are the same amber edge the pastel action carries.
  static const Color _star = AppColors.actionBorder;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      container: true,
      excludeSemantics: true,
      label: '${rating.toStringAsFixed(1)} out of 5, from $count reviews',
      child: Row(
        mainAxisSize: MainAxisSize.min,
        spacing: AppSpacing.tight,
        children: <Widget>[
          for (int i = 0; i < 5; i++)
            Icon(
              i < rating.round() ? Icons.star_rounded : Icons.star_border_rounded,
              size: AppIconSize.base,
              color: _star,
            ),
          Text('($count)', style: AppText.metaText),
        ],
      ),
    );
  }
}

/// The hub's first load: the blocks that will hold the identity block and the
/// three regions, at the sizes they will occupy.
class _AccountSkeleton extends StatelessWidget {
  const _AccountSkeleton();

  @override
  Widget build(BuildContext context) {
    return SkeletonRegion(
      announcement: 'Loading your account',
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.group,
          AppSpacing.snug,
          AppSpacing.group,
          AppSpacing.section,
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Center(
              child: SkeletonBox(
                width: AvatarSize.xl.diameter,
                height: AvatarSize.xl.diameter,
                circle: true,
              ),
            ),
            const SizedBox(height: AppSpacing.snug),
            const SkeletonTextLines(level: AppText.rowName, widths: [0.4]),
            const SizedBox(height: AppSpacing.section),
            const SkeletonTextLines(
              level: AppText.supportText,
              widths: [1.0, 0.9, 0.6],
            ),
            const SizedBox(height: AppSpacing.section),
            const SkeletonTextLines(
              level: AppText.supportText,
              widths: [1.0, 0.85, 0.5],
            ),
          ],
        ),
      ),
    );
  }
}
