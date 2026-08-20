import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:cardtrade/core/extensions.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/models/enums.dart';
import 'package:cardtrade/providers/profile_provider.dart';
import 'package:cardtrade/widgets/common/error_view.dart';

// TODO: move to Env when the production domain is set
const _webAppBaseUrl = 'https://cardtrade.app';

/// Explanation screen for identity verification (Stripe Identity).
///
/// Shows what verification means, why it's needed, a benefits list,
/// and a CTA to launch the Stripe Identity flow in the browser.
/// Displays current status if already verified or pending.
class IdentityVerificationScreen extends ConsumerWidget {
  const IdentityVerificationScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profileAsync = ref.watch(myProfileProvider);
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Identity Verification'),
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

          final status = profile.identityCheckStatus;
          final isVerified = status == IdentityCheckStatus.verified;
          final isPending = status == IdentityCheckStatus.pending;

          return SingleChildScrollView(
            padding: const EdgeInsets.all(AppTheme.spacingLg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // ─── Status Indicator ──────────────────────────────
                if (isVerified)
                  const _StatusBanner(
                    icon: Icons.check_circle_rounded,
                    color: AppTheme.success,
                    label: 'Identity verified',
                    description:
                        'Your identity has been verified. You can list items, sell, and trade.',
                  )
                else if (isPending)
                  const _StatusBanner(
                    icon: Icons.hourglass_top_rounded,
                    color: AppTheme.warning,
                    label: 'Verification pending',
                    description:
                        'Your identity check is being reviewed. This usually takes a few minutes.',
                  ),

                if (!isVerified) ...[
                  const SizedBox(height: AppTheme.spacingXl),

                  // ─── Explanation ──────────────────────────────────
                  Text(
                    'Why verify your identity?',
                    style: theme.textTheme.headlineMedium,
                  ),
                  const SizedBox(height: AppTheme.spacingSm),
                  Text(
                    "CardTrade verifies every seller's identity with a photo ID "
                    'and selfie check to keep the marketplace safe. This protects '
                    'both buyers and sellers.',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: AppTheme.secondary,
                      height: 1.5,
                    ),
                  ),

                  const SizedBox(height: AppTheme.spacingXl),

                  // ─── Benefits List ───────────────────────────────
                  Text(
                    'What you unlock',
                    style: theme.textTheme.headlineSmall,
                  ),
                  const SizedBox(height: AppTheme.spacingMd),
                  const _BenefitItem(
                    icon: Icons.storefront_rounded,
                    text: 'List items for sale',
                  ),
                  const _BenefitItem(
                    icon: Icons.swap_horiz_rounded,
                    text: 'Propose and accept trades',
                  ),
                  const _BenefitItem(
                    icon: Icons.verified_user_rounded,
                    text: 'Verified badge on your profile',
                  ),
                  const _BenefitItem(
                    icon: Icons.shield_rounded,
                    text: 'Dispute resolution & fraud protection',
                  ),

                  const SizedBox(height: AppTheme.spacingXl),

                  // ─── What's needed ───────────────────────────────
                  Text(
                    "What you'll need",
                    style: theme.textTheme.headlineSmall,
                  ),
                  const SizedBox(height: AppTheme.spacingMd),
                  const _BenefitItem(
                    icon: Icons.badge_outlined,
                    text: 'A valid government-issued photo ID',
                  ),
                  const _BenefitItem(
                    icon: Icons.face_rounded,
                    text: 'A selfie for comparison',
                  ),

                  const SizedBox(height: AppTheme.spacingXxl),

                  // ─── CTA ─────────────────────────────────────────
                  if (!isPending) ...[
                    const Text(
                      'Verification opens in your browser',
                      style: AppTheme.metaText,
                    ),
                    const SizedBox(height: AppTheme.spacingSm),
                    SizedBox(
                      width: double.infinity,
                      child: ElevatedButton.icon(
                        onPressed: () => _startVerification(context),
                        icon: const Icon(Icons.verified_rounded),
                        label: const Text('Start Verification'),
                      ),
                    ),
                  ],
                ],
              ],
            ),
          );
        },
      ),
    );
  }

  Future<void> _startVerification(BuildContext context) async {
    final uri = Uri.parse('$_webAppBaseUrl/profile/identity');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } else {
      if (context.mounted) {
        context.showError('Could not open verification page');
      }
    }
  }
}

/// A status banner showing the current verification state.
class _StatusBanner extends StatelessWidget {
  const _StatusBanner({
    required this.icon,
    required this.color,
    required this.label,
    required this.description,
  });

  final IconData icon;
  final Color color;
  final String label;
  final String description;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppTheme.spacingLg),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(AppTheme.radiusLg),
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Icon(icon, color: color, size: 32),
          const SizedBox(width: AppTheme.spacingMd),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  label,
                  style: Theme.of(context).textTheme.labelLarge?.copyWith(
                        color: color,
                        fontWeight: FontWeight.w600,
                      ),
                ),
                const SizedBox(height: 2),
                Text(
                  description,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: AppTheme.secondary,
                      ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// A single benefit item with icon and text.
class _BenefitItem extends StatelessWidget {
  const _BenefitItem({
    required this.icon,
    required this.text,
  });

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppTheme.spacingMd),
      child: Row(
        children: [
          Container(
            padding: const EdgeInsets.all(AppTheme.spacingSm),
            decoration: BoxDecoration(
              color: AppTheme.accentLight,
              borderRadius: BorderRadius.circular(AppTheme.radiusMd),
            ),
            child: Icon(icon, size: 18, color: AppTheme.accent),
          ),
          const SizedBox(width: AppTheme.spacingMd),
          Expanded(
            child: Text(
              text,
              style: Theme.of(context).textTheme.bodyMedium,
            ),
          ),
        ],
      ),
    );
  }
}
