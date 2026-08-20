import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import 'package:cardtrade/core/extensions.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/providers/profile_provider.dart';
import 'package:cardtrade/widgets/common/error_view.dart';

// TODO: move to Env when the production domain is set
const _webAppBaseUrl = 'https://cardtrade.app';

/// Payout setup screen that explains Connect onboarding and provides
/// a CTA to launch Stripe Connect's hosted onboarding flow.
///
/// Shows current status: pending, active, or not started.
class PayoutSetupScreen extends ConsumerWidget {
  const PayoutSetupScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profileAsync = ref.watch(myProfileProvider);
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Payout Setup'),
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

          final isActive = profile.canReceiveFunds;
          final hasMerchant = profile.merchantRef != null;

          return SingleChildScrollView(
            padding: const EdgeInsets.all(AppTheme.spacingLg),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // ─── Status ────────────────────────────────────────
                if (isActive)
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(AppTheme.spacingLg),
                    decoration: BoxDecoration(
                      color: AppTheme.successLight,
                      borderRadius:
                          BorderRadius.circular(AppTheme.radiusLg),
                      border: Border.all(
                        color: AppTheme.success.withValues(alpha: 0.3),
                      ),
                    ),
                    child: Row(
                      children: [
                        const Icon(
                          Icons.check_circle_rounded,
                          color: AppTheme.success,
                          size: 32,
                        ),
                        const SizedBox(width: AppTheme.spacingMd),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Payouts active',
                                style:
                                    theme.textTheme.labelLarge?.copyWith(
                                  color: AppTheme.success,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                'You can receive funds from sales and trade dispute resolutions.',
                                style:
                                    theme.textTheme.bodySmall?.copyWith(
                                  color: AppTheme.secondary,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  )
                else if (hasMerchant)
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(AppTheme.spacingLg),
                    decoration: BoxDecoration(
                      color: AppTheme.warningLight,
                      borderRadius:
                          BorderRadius.circular(AppTheme.radiusLg),
                      border: Border.all(
                        color: AppTheme.warning.withValues(alpha: 0.3),
                      ),
                    ),
                    child: Row(
                      children: [
                        const Icon(
                          Icons.hourglass_top_rounded,
                          color: AppTheme.warning,
                          size: 32,
                        ),
                        const SizedBox(width: AppTheme.spacingMd),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                'Setup in progress',
                                style:
                                    theme.textTheme.labelLarge?.copyWith(
                                  color: AppTheme.warning,
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              const SizedBox(height: 2),
                              Text(
                                'Complete your onboarding to start receiving payouts.',
                                style:
                                    theme.textTheme.bodySmall?.copyWith(
                                  color: AppTheme.secondary,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),

                if (!isActive) ...[
                  const SizedBox(height: AppTheme.spacingXl),

                  // ─── Explanation ──────────────────────────────────
                  Text(
                    'Set up payouts',
                    style: theme.textTheme.headlineMedium,
                  ),
                  const SizedBox(height: AppTheme.spacingSm),
                  Text(
                    'To receive money from sales and dispute resolutions, you '
                    'need to set up a payout account. This is handled securely '
                    'by Stripe — we never see your bank details.',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: AppTheme.secondary,
                      height: 1.5,
                    ),
                  ),

                  const SizedBox(height: AppTheme.spacingXl),

                  // ─── How it works ────────────────────────────────
                  Text(
                    'How it works',
                    style: theme.textTheme.headlineSmall,
                  ),
                  const SizedBox(height: AppTheme.spacingMd),
                  const _StepItem(number: '1', text: 'Tap "Set Up Payouts" below'),
                  const _StepItem(
                    number: '2',
                    text: 'Complete the Stripe onboarding form',
                  ),
                  const _StepItem(
                    number: '3',
                    text: "You're ready to receive payments",
                  ),

                  const SizedBox(height: AppTheme.spacingXxl),

                  // ─── CTA ─────────────────────────────────────────
                  const Text(
                    'Setup opens in your browser',
                    style: AppTheme.metaText,
                  ),
                  const SizedBox(height: AppTheme.spacingSm),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton.icon(
                      onPressed: () => _startPayoutSetup(context),
                      icon: const Icon(Icons.account_balance_rounded),
                      label: Text(
                        hasMerchant
                            ? 'Continue Setup'
                            : 'Set Up Payouts',
                      ),
                    ),
                  ),
                ],
              ],
            ),
          );
        },
      ),
    );
  }

  Future<void> _startPayoutSetup(BuildContext context) async {
    final uri = Uri.parse('$_webAppBaseUrl/profile/payouts');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } else {
      if (context.mounted) {
        context.showError('Could not open payout setup page');
      }
    }
  }
}

/// A numbered step item for the setup instructions.
class _StepItem extends StatelessWidget {
  const _StepItem({
    required this.number,
    required this.text,
  });

  final String number;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: AppTheme.spacingMd),
      child: Row(
        children: [
          Container(
            width: 28,
            height: 28,
            alignment: Alignment.center,
            decoration: const BoxDecoration(
              color: AppTheme.accentLight,
              shape: BoxShape.circle,
            ),
            child: Text(
              number,
              style: AppTheme.rowName.copyWith(
                fontWeight: FontWeight.w700,
                color: AppTheme.accent,
              ),
            ),
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
