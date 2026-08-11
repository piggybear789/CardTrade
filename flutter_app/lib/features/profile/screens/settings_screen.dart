import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/providers/auth_provider.dart';
import 'package:cardtrade/providers/region_provider.dart';
import 'package:cardtrade/widgets/common/confirmation_dialog.dart';

/// Settings screen with notification preferences, region, about info,
/// sign out, and delete account options.
class SettingsScreen extends ConsumerStatefulWidget {
  const SettingsScreen({super.key});

  @override
  ConsumerState<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends ConsumerState<SettingsScreen> {
  bool _notificationsEnabled = true;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final browseRegion = ref.watch(browseRegionProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
      ),
      body: ListView(
        children: [
          // ─── Notifications ───────────────────────────────────────
          const _SectionHeader(title: 'Notifications'),
          SwitchListTile(
            title: const Text('Push notifications'),
            subtitle: const Text('Receive alerts for messages, offers and trades'),
            value: _notificationsEnabled,
            onChanged: (value) {
              setState(() => _notificationsEnabled = value);
            },
          ),
          const Divider(),

          // ─── Region ──────────────────────────────────────────────
          const _SectionHeader(title: 'Region'),
          ListTile(
            title: const Text('Browse region'),
            subtitle: Text(browseRegion.toUpperCase()),
            trailing: const Icon(
              Icons.chevron_right_rounded,
              color: AppTheme.muted,
            ),
            onTap: () => _showRegionPicker(context),
          ),
          const Divider(),

          // ─── About ───────────────────────────────────────────────
          const _SectionHeader(title: 'About'),
          const ListTile(
            title: Text('Version'),
            subtitle: Text('1.0.0'),
          ),
          ListTile(
            title: const Text('Terms of Service'),
            trailing: const Icon(
              Icons.open_in_new_rounded,
              size: 18,
              color: AppTheme.muted,
            ),
            onTap: () {
              // TODO: launch terms URL
            },
          ),
          ListTile(
            title: const Text('Privacy Policy'),
            trailing: const Icon(
              Icons.open_in_new_rounded,
              size: 18,
              color: AppTheme.muted,
            ),
            onTap: () {
              // TODO: launch privacy URL
            },
          ),
          const Divider(),

          // ─── Account Actions ─────────────────────────────────────
          const _SectionHeader(title: 'Account'),
          ListTile(
            leading: const Icon(Icons.logout_rounded, color: AppTheme.secondary),
            title: const Text('Sign out'),
            onTap: () => _handleSignOut(context),
          ),
          ListTile(
            leading: const Icon(Icons.delete_forever_rounded,
                color: AppTheme.danger),
            title: Text(
              'Delete account',
              style: theme.textTheme.bodyLarge?.copyWith(
                color: AppTheme.danger,
              ),
            ),
            onTap: () => _handleDeleteAccount(context),
          ),
          const SizedBox(height: AppTheme.spacingXxxl),
        ],
      ),
    );
  }

  Future<void> _showRegionPicker(BuildContext context) async {
    final regions = await ref.read(regionsProvider.future);
    if (!mounted) return;

    final currentRegion = ref.read(browseRegionProvider);

    await showModalBottomSheet(
      context: context,
      builder: (context) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Padding(
                padding: const EdgeInsets.all(AppTheme.spacingLg),
                child: Text(
                  'Browse region',
                  style: Theme.of(context).textTheme.headlineSmall,
                ),
              ),
              ...regions.map((region) {
                return ListTile(
                  title: Text(region.label),
                  trailing: region.code == currentRegion
                      ? const Icon(Icons.check_rounded,
                          color: AppTheme.accent)
                      : null,
                  onTap: () {
                    ref.read(browseRegionProvider.notifier).set(region.code);
                    Navigator.of(context).pop();
                  },
                );
              }),
              const SizedBox(height: AppTheme.spacingLg),
            ],
          ),
        );
      },
    );
  }

  Future<void> _handleSignOut(BuildContext context) async {
    final confirmed = await ConfirmationDialog.show(
      context: context,
      title: 'Sign out',
      message: 'Are you sure you want to sign out?',
      confirmLabel: 'Sign out',
    );
    if (confirmed && mounted) {
      await ref.read(authActionsProvider.notifier).signOut();
    }
  }

  Future<void> _handleDeleteAccount(BuildContext context) async {
    final confirmed = await ConfirmationDialog.danger(
      context: context,
      title: 'Delete account',
      message:
          'This will permanently delete your account and all associated data. '
          'This action cannot be undone.',
      confirmLabel: 'Delete forever',
    );
    if (confirmed && mounted) {
      // TODO: call account deletion service
    }
  }
}

/// A section header label for the settings list.
class _SectionHeader extends StatelessWidget {
  const _SectionHeader({required this.title});

  final String title;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(
        AppTheme.spacingLg,
        AppTheme.spacingLg,
        AppTheme.spacingLg,
        AppTheme.spacingSm,
      ),
      child: Text(
        title,
        style: Theme.of(context).textTheme.labelMedium?.copyWith(
              fontWeight: FontWeight.w600,
              color: AppTheme.muted,
              letterSpacing: 0.5,
            ),
      ),
    );
  }
}
