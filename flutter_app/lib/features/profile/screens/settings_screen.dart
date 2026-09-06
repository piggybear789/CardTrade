// Account settings: notifications, browse region, the policy pages and the two
// account actions.
//
// THE ANALYZER ISSUE THIS FILE CARRIED. `_showRegionPicker` took a `BuildContext`
// PARAMETER and then guarded the await with the State's own `mounted`. Those are two
// different things: `mounted` says this State is still in the tree, and says nothing
// about a context passed in from somewhere else — which is why
// `use_build_context_synchronously` fired on the `showModalBottomSheet` below it. The
// methods now take no context and use the State's own, so the guard covers the
// context actually being used. No gate, no region and no branch changes with it
// (Req 10.10, 14.8).
//
// THE POLICY ROWS ARE HANDOFFS NOW. Both were `onTap` callbacks holding a `TODO`,
// which is a row that looks like a link and does nothing. `/terms` and `/privacy` are
// website pages; the rows say so and open them (Req 10.6, 14.6).
//
// THE ACCOUNT ROW IS REAL NOW, AND IT IS NAMED FOR WHAT IT DOES. It used to read
// "Delete account", raise a danger dialog promising to "permanently delete your account
// and all associated data", and then show a SnackBar saying deletion was handled by
// support. Both halves were wrong: the dialog stated an outcome nothing performed, and
// the outcome it stated is not the one the server performs even now. Closure is
// anonymise-and-detach (decision D3) — contracts, payouts, reviews and arbitration
// records reference `profiles.id` and Req 7.4 protects them — so the row says "Close
// account" and the dialog describes the four things that actually happen. Calling it
// deletion would reproduce the same false statement in politer words (Req 7.8).
//
// Requirements 7.8, 10.6, 10.10, 13.6–13.12, 14.6, 14.8.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:cardtrade/core/result.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/core/web_handoff.dart';
import 'package:cardtrade/models/region.dart';
import 'package:cardtrade/providers/account_provider.dart';
import 'package:cardtrade/providers/auth_provider.dart';
import 'package:cardtrade/providers/region_provider.dart';
import 'package:cardtrade/services/account_service.dart';
import 'package:cardtrade/widgets/common/app_scaffold.dart';
import 'package:cardtrade/widgets/common/confirmation_dialog.dart';
import 'package:cardtrade/widgets/common/tap_target.dart';
import 'package:cardtrade/features/profile/widgets/profile_sections.dart';

/// Notification preferences, browse region, policy pages and account actions.
class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  bool _notificationsEnabled = true;

  @override
  Widget build(BuildContext context) {
    final String browseRegion = ref.watch(browseRegionProvider);

    return AppScaffold(
      title: 'Settings',
      onBack: () => Navigator.of(context).maybePop(),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(
          AppSpacing.group,
          AppSpacing.snug,
          AppSpacing.group,
          AppSpacing.section,
        ),
        children: <Widget>[
          ProfileSection(
            title: 'Notifications',
            padded: false,
            child: SwitchListTile(
              title: const Text('Push notifications', style: AppText.bodyText),
              subtitle: const Text(
                'Alerts for messages, offers and trades',
                style: AppText.metaText,
              ),
              value: _notificationsEnabled,
              onChanged: (bool value) {
                setState(() => _notificationsEnabled = value);
              },
            ),
          ),
          const SizedBox(height: AppSpacing.section),

          ProfileSection(
            title: 'Region',
            padded: false,
            child: ProfileMenuRow(
              icon: Icons.public_rounded,
              label: 'Browse region',
              trailingNote: browseRegion.toUpperCase(),
              onTap: _showRegionPicker,
            ),
          ),
          const SizedBox(height: AppSpacing.section),

          ProfileSection(
            title: 'About',
            padded: false,
            child: Column(
              children: <Widget>[
                const ListTile(
                  title: Text('Version', style: AppText.bodyText),
                  subtitle: Text(_appVersion, style: AppText.metaText),
                ),
                const Divider(height: AppMetrics.hairline),
                ProfileMenuRow(
                  icon: Icons.description_outlined,
                  label: 'Terms of service',
                  trailingNote:
                      'Opens ${WebHandoff.pageLabel(WebHandoff.terms)} in your browser',
                  leavesApp: true,
                  onTap: () => WebHandoff.openOrWarn(context, WebHandoff.terms),
                ),
                const Divider(height: AppMetrics.hairline),
                ProfileMenuRow(
                  icon: Icons.privacy_tip_outlined,
                  label: 'Privacy policy',
                  trailingNote:
                      'Opens ${WebHandoff.pageLabel(WebHandoff.privacy)} in your browser',
                  leavesApp: true,
                  onTap: () => WebHandoff.openOrWarn(context, WebHandoff.privacy),
                ),
              ],
            ),
          ),
          const SizedBox(height: AppSpacing.section),

          ProfileSection(
            title: 'Account',
            padded: false,
            child: Column(
              children: <Widget>[
                ProfileMenuRow(
                  icon: Icons.logout_rounded,
                  label: 'Sign out',
                  onTap: _handleSignOut,
                ),
                const Divider(height: AppMetrics.hairline),
                ListTile(
                  leading: const ExcludeSemantics(
                    child: Icon(
                      Icons.no_accounts_rounded,
                      size: AppIconSize.large,
                      color: AppColors.destructive,
                    ),
                  ),
                  title: Text(
                    closeAccountLabel,
                    style: AppText.bodyText.copyWith(
                      color: AppColors.destructive,
                    ),
                  ),
                  subtitle: const Text(
                    'Permanent. Your profile stops being publicly identifiable.',
                    style: AppText.metaText,
                  ),
                  onTap: _handleCloseAccount,
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  /// The build a member would quote in a support message.
  static const String _appVersion = '1.0.0';

  /// Picks the BROWSE region, which is a display scope and never the trading
  /// region: `profiles.region_code` is stated at onboarding and the server owns it.
  Future<void> _showRegionPicker() async {
    final List<Region> regions = await ref.read(regionsProvider.future);
    // The State's own context, so `mounted` is the correct guard for it.
    if (!mounted) return;

    final String currentRegion = ref.read(browseRegionProvider);

    await showModalBottomSheet<void>(
      context: context,
      builder: (BuildContext sheetContext) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: <Widget>[
              const Padding(
                padding: EdgeInsets.all(AppSpacing.cozy),
                child: Text('Browse region', style: AppText.rowName),
              ),
              for (final Region region in regions)
                ListTile(
                  title: Text(region.label, style: AppText.bodyText),
                  trailing: region.code == currentRegion
                      ? const ExcludeSemantics(
                          child: Icon(
                            Icons.check_rounded,
                            size: AppIconSize.large,
                            color: AppColors.irisInk,
                          ),
                        )
                      : null,
                  selected: region.code == currentRegion,
                  onTap: () {
                    ref.read(browseRegionProvider.notifier).set(region.code);
                    Navigator.of(sheetContext).pop();
                  },
                ),
              const SizedBox(height: AppSpacing.cozy),
            ],
          ),
        );
      },
    );
  }

  Future<void> _handleSignOut() async {
    final bool confirmed = await ConfirmationDialog.show(
      context: context,
      title: 'Sign out',
      message: 'Are you sure you want to sign out?',
      confirmLabel: 'Sign out',
    );
    if (!confirmed || !mounted) return;
    await ref.read(authActionsProvider.notifier).signOut();
  }

  /// Confirms, calls the Account_Closure_Service, and presents whatever it returned.
  ///
  /// The three shapes of answer are handled separately and none of them is allowed to
  /// borrow another's copy (Req 7.8):
  ///
  ///  - success — the server closed the account, so the outcome may be stated, and
  ///    the member is signed out of this device afterwards;
  ///  - a refusal — the reason is presented, with a `MONEY_IN_FLIGHT` refusal's
  ///    blocking categories spelled out as sentences a member can act on;
  ///  - a transport failure — nothing is claimed at all, because nothing is known.
  Future<void> _handleCloseAccount() async {
    final bool confirmed = await ConfirmationDialog.danger(
      context: context,
      title: 'Close your account?',
      // What the server actually does, in the order it does it. No mention of
      // deleting data: `closeAccount` anonymises the profile, marks it closed,
      // revokes sessions and detaches the sign-in, and deliberately retains the
      // contract, payout and arbitration records (Req 7.4, 7.5).
      message: 'Closing your account removes your display name, photo, bio and '
          'links, so your profile is no longer publicly identifiable. Your '
          'sales, trades and payout records are kept, because accounting and '
          'dispute resolution need them. Your sign-in stops working. This '
          'cannot be undone.',
      confirmLabel: closeAccountLabel,
    );
    if (!confirmed || !mounted) return;

    final Result<AccountClosure> result =
        await ref.read(accountServiceProvider).closeAccount();
    if (!mounted) return;

    switch (result) {
      case Ok<AccountClosure>():
        await _showOutcome(
          title: 'Your account is closed',
          message: 'Your profile is no longer publicly identifiable and your '
              'sign-in no longer works. Your sales, trades and payout records '
              'are kept for accounting and dispute resolution.',
        );
        if (!mounted) return;
        // Signing out is what takes the member out of the authenticated app: the
        // router redirects on the auth state change, exactly as it does for the
        // Sign out row above.
        await ref.read(authActionsProvider.notifier).signOut();

      case Err<AccountClosure>(:final String error, :final String? message, :final Map<String, dynamic>? details):
        if (error == 'MONEY_IN_FLIGHT') {
          await _showOutcome(
            title: 'Your account cannot be closed yet',
            message: _refusalMessage(message, details),
          );
          return;
        }

        // `SIGN_OUT_INCOMPLETE` and `DETACH_INCOMPLETE` mean the account IS closed
        // but a later step did not finish, and the server's own message states that
        // carefully. Composing our own here would be a second, worse account of a
        // partial outcome, so the server's wording is shown as-is — for these and
        // for every other refusal.
        final bool closedAnyway =
            error == 'SIGN_OUT_INCOMPLETE' || error == 'DETACH_INCOMPLETE';
        await _showOutcome(
          title: closedAnyway
              ? 'Your account is closed'
              : 'We could not close your account',
          message: message ?? 'Please try again.',
        );
        if (closedAnyway && mounted) {
          await ref.read(authActionsProvider.notifier).signOut();
        }
    }
  }

  /// The refusal, as the server worded it, followed by the categories that block it.
  String _refusalMessage(String? serverMessage, Map<String, dynamic>? details) {
    final Object? raw = details?['blockers'];
    final List<String> codes = raw is List
        ? raw.whereType<String>().toList(growable: false)
        : const <String>[];

    final String lead = serverMessage ??
        'Your account still has activity in progress, so it cannot be closed yet.';
    if (codes.isEmpty) return lead;

    final String list =
        codes.map((String code) => '\u2022 ${closureBlockerSentence(code)}').join('\n');
    return '$lead\n\n$list\n\nOnce these have finished, you can close your '
        'account here.';
  }

  /// A one-button dialog stating an outcome. Awaits dismissal so the caller can act
  /// after the member has read it.
  Future<void> _showOutcome({
    required String title,
    required String message,
  }) {
    return showDialog<void>(
      context: context,
      builder: (BuildContext dialogContext) => AlertDialog(
        title: Text(
          title,
          style: AppType.subhead.copyWith(fontWeight: FontWeight.w600),
        ),
        content: Text(message, style: AppText.supportText),
        actions: <Widget>[
          TapTarget(
            child: FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('OK'),
            ),
          ),
        ],
      ),
    );
  }
}

/// The label the account row and its confirm button both use.
///
/// "Close", not "Delete": the server anonymises and detaches rather than deleting,
/// and a control named for an outcome it does not perform is the defect Req 7.8
/// names.
const String closeAccountLabel = 'Close account';

/// One blocking category, as a sentence.
///
/// PRESENTATION, NOT A RULE, and deliberately not a ninth Dart domain port. The
/// Money_In_Flight rule lives once, in `domain/account/accountClosure.ts`; this
/// evaluates nothing, decides nothing and reads no state. It turns a code the SERVER
/// already chose into words, and a member being told `ACTIVE_TRADE_COLLATERAL` is
/// being told nothing.
String closureBlockerSentence(String code) {
  switch (code) {
    case 'ACTIVE_CASH_SALE':
      return 'a sale is still in progress';
    case 'ACTIVE_TRADE_COLLATERAL':
      return 'a trade is still holding collateral on your card';
    case 'PENDING_PAYOUT':
      return 'a payout has not reached you yet';
    case 'OPEN_DISPUTE':
      return 'a dispute is still open';
    default:
      // A category this build has not been taught. Still a sentence, and still not
      // the code itself.
      return 'something on your account has not finished yet';
  }
}
