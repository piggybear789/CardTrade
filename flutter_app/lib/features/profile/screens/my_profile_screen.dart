import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/providers/auth_provider.dart';
import 'package:cardtrade/providers/listings_provider.dart';
import 'package:cardtrade/providers/sales_provider.dart';
import 'package:cardtrade/providers/trades_provider.dart';
import 'package:cardtrade/providers/profile_provider.dart';
import 'package:cardtrade/widgets/common/avatar.dart';
import 'package:cardtrade/widgets/common/confirmation_dialog.dart';
import 'package:cardtrade/widgets/common/error_view.dart';

/// The Profile tab content showing the current user's profile overview.
///
/// Displays avatar, name, region, verification status, rating, stats,
/// and navigation menu items (My Listings, Purchases, etc.).
class MyProfileScreen extends ConsumerWidget {
  const MyProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isAuthenticated = ref.watch(isAuthenticatedProvider);

    // Show sign-in prompt for unauthenticated users
    if (!isAuthenticated) {
      return Scaffold(
        appBar: AppBar(title: const Text('Profile')),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.person_outline, size: 48, color: AppTheme.muted),
                const SizedBox(height: 16),
                Text(
                  'Sign in to see your profile',
                  style: Theme.of(context).textTheme.headlineMedium,
                ),
                const SizedBox(height: 8),
                Text(
                  'Manage your listings, trades, and account settings.',
                  style: Theme.of(context).textTheme.bodySmall,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 24),
                FilledButton(
                  onPressed: () => context.push('/auth/sign-in'),
                  child: const Text('Sign In'),
                ),
                const SizedBox(height: 8),
                TextButton(
                  onPressed: () => context.push('/auth/sign-up'),
                  child: const Text('Create Account'),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final profileAsync = ref.watch(myProfileProvider);
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Profile'),
        actions: [
          IconButton(
            icon: const Icon(Icons.edit_outlined),
            onPressed: () => context.push('/profile/edit'),
          ),
        ],
      ),
      body: profileAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => ErrorView(
          message: error.toString(),
          onRetry: () => ref.read(myProfileProvider.notifier).refresh(),
        ),
        data: (profile) {
          if (profile == null) {
            return const Center(child: Text('Profile not found.'));
          }

          final listingsCount =
              ref.watch(myListingsProvider).value?.length ?? 0;
          final salesCount = ref.watch(mySalesProvider).value?.length ?? 0;
          final tradesCount = ref.watch(myTradesProvider).value?.length ?? 0;

          return SingleChildScrollView(
            padding: const EdgeInsets.all(AppTheme.spacingLg),
            child: Column(
              children: [
                // ─── Avatar + Name ─────────────────────────────────
                Center(
                  child: Stack(
                    children: [
                      Avatar(
                        imageUrl: profile.avatarPath,
                        displayName: profile.displayName,
                        size: AvatarSize.xl,
                        showVerifiedBadge: profile.isVerified,
                      ),
                      Positioned(
                        right: 0,
                        bottom: 0,
                        child: Semantics(
                          button: true,
                          label: 'Change profile picture',
                          child: SizedBox(
                            width: 40,
                            height: 40,
                            child: Material(
                              color: AppTheme.accent,
                              shape: const CircleBorder(),
                              clipBehavior: Clip.antiAlias,
                              child: InkWell(
                                customBorder: const CircleBorder(),
                                onTap: () => context.push('/profile/edit'),
                                child: const Center(
                                  child: Icon(
                                    Icons.camera_alt_rounded,
                                    size: 18,
                                    color: Colors.white,
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: AppTheme.spacingMd),
                Text(
                  profile.displayName,
                  style: theme.textTheme.headlineMedium,
                ),
                if (profile.regionCode != null) ...[
                  const SizedBox(height: AppTheme.spacingXs),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(
                        Icons.location_on_outlined,
                        size: 14,
                        color: AppTheme.secondary,
                      ),
                      const SizedBox(width: 4),
                      Text(
                        profile.regionCode!.toUpperCase(),
                        style: theme.textTheme.bodySmall,
                      ),
                    ],
                  ),
                ],

                // ─── Rating ────────────────────────────────────────
                if (profile.rating != null) ...[
                  const SizedBox(height: AppTheme.spacingSm),
                  Semantics(
                    label:
                        '${profile.rating!.toStringAsFixed(1)} out of 5 stars from ${profile.ratingCount} reviews',
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        ...List.generate(5, (i) {
                          return Icon(
                            i < profile.rating!.round()
                                ? Icons.star_rounded
                                : Icons.star_border_rounded,
                            size: 18,
                            color: AppTheme.warning,
                          );
                        }),
                        const SizedBox(width: AppTheme.spacingXs),
                        Text(
                          '(${profile.ratingCount})',
                          style: theme.textTheme.labelSmall,
                        ),
                      ],
                    ),
                  ),
                ],

                const SizedBox(height: AppTheme.spacingXl),

                // ─── Verification Status Card ──────────────────────
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(AppTheme.spacingLg),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Verification',
                          style: theme.textTheme.labelLarge,
                        ),
                        const SizedBox(height: AppTheme.spacingMd),
                        _VerificationRow(
                          label: 'Identity',
                          isComplete: profile.isVerified,
                          ctaLabel: 'Verify now',
                          onTap: profile.isVerified
                              ? null
                              : () => context.push('/profile/verify'),
                        ),
                        const Divider(height: AppTheme.spacingLg),
                        _VerificationRow(
                          label: 'Payouts',
                          isComplete: profile.canReceiveFunds,
                          ctaLabel: 'Set up',
                          onTap: profile.canReceiveFunds
                              ? null
                              : () => context.push('/profile/payouts'),
                        ),
                      ],
                    ),
                  ),
                ),

                const SizedBox(height: AppTheme.spacingXl),

                // ─── Quick Stats ───────────────────────────────────
                _QuickStatsRow(
                  listings: listingsCount,
                  trades: tradesCount,
                  sales: salesCount,
                ),

                const SizedBox(height: AppTheme.spacingXl),

                // ─── Menu Items ────────────────────────────────────
                Card(
                  child: Column(
                    children: [
                      _MenuItem(
                        icon: Icons.storefront_rounded,
                        label: 'My Listings',
                        onTap: () => context.push('/listings/mine'),
                      ),
                      const Divider(height: 1),
                      _MenuItem(
                        icon: Icons.handshake_outlined,
                        label: 'Trades',
                        onTap: () => context.push('/trades'),
                      ),
                      const Divider(height: 1),
                      _MenuItem(
                        icon: Icons.local_offer_outlined,
                        label: 'Offers',
                        onTap: () => context.push('/offers'),
                      ),
                      const Divider(height: 1),
                      _MenuItem(
                        icon: Icons.bookmark_border_rounded,
                        label: 'Saved',
                        onTap: () => context.push('/saved'),
                      ),
                      const Divider(height: 1),
                      _MenuItem(
                        icon: Icons.settings_outlined,
                        label: 'Settings',
                        onTap: () => context.push('/settings'),
                      ),
                    ],
                  ),
                ),

                const SizedBox(height: AppTheme.spacingXl),

                // ─── Sign Out ──────────────────────────────────────
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: () async {
                      final confirmed = await ConfirmationDialog.show(
                        context: context,
                        title: 'Sign out',
                        message: 'Are you sure you want to sign out?',
                        confirmLabel: 'Sign out',
                      );
                      if (confirmed) {
                        ref.read(authActionsProvider.notifier).signOut();
                      }
                    },
                    icon: const Icon(Icons.logout_rounded),
                    label: const Text('Sign Out'),
                  ),
                ),

                const SizedBox(height: AppTheme.spacingXxxl),
              ],
            ),
          );
        },
      ),
    );
  }
}

/// A row showing verification status with a checkmark or CTA button.
class _VerificationRow extends StatelessWidget {
  const _VerificationRow({
    required this.label,
    required this.isComplete,
    required this.ctaLabel,
    this.onTap,
  });

  final String label;
  final bool isComplete;
  final String ctaLabel;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(
          isComplete
              ? Icons.check_circle_rounded
              : Icons.radio_button_unchecked,
          size: 20,
          color: isComplete ? AppTheme.success : AppTheme.muted,
        ),
        const SizedBox(width: AppTheme.spacingSm),
        Expanded(
          child: Text(
            label,
            style: Theme.of(context).textTheme.bodyMedium,
          ),
        ),
        if (!isComplete && onTap != null)
          TextButton(
            onPressed: onTap,
            child: Text(ctaLabel),
          )
        else if (isComplete)
          Text(
            'Complete',
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: AppTheme.success,
                  fontWeight: FontWeight.w500,
                ),
          ),
      ],
    );
  }
}

/// A quick stats row showing listings, trades, and sales counts.
class _QuickStatsRow extends StatelessWidget {
  const _QuickStatsRow({
    required this.listings,
    required this.trades,
    required this.sales,
  });

  final int listings;
  final int trades;
  final int sales;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        _StatItem(count: listings, label: 'Listings'),
        _StatItem(count: trades, label: 'Trades'),
        _StatItem(count: sales, label: 'Sales'),
      ],
    );
  }
}

class _StatItem extends StatelessWidget {
  const _StatItem({required this.count, required this.label});

  final int count;
  final String label;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Expanded(
      child: Column(
        children: [
          Text(
            count.toString(),
            style: theme.textTheme.headlineMedium?.copyWith(
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: theme.textTheme.labelSmall,
          ),
        ],
      ),
    );
  }
}

/// A menu list item with icon, label, and chevron.
class _MenuItem extends StatelessWidget {
  const _MenuItem({
    required this.icon,
    required this.label,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon, color: AppTheme.secondary),
      title: Text(label),
      trailing: const Icon(
        Icons.chevron_right_rounded,
        color: AppTheme.muted,
      ),
      onTap: onTap,
    );
  }
}
