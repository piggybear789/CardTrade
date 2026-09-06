// Editing the parts of a profile a member owns: display name, contact email,
// trading region and avatar.
//
// TOKENS AND SHARED CONTROLS ONLY. The fields are `AppTextField`, so the border,
// fill, error placement and the 40-drawn/48-touched separation come from one place
// (Req 8.1–8.6); the save control is `AppButton.busy`, which keeps its own bounds
// while the write is in flight rather than collapsing to a spinner (Req 8.10). The
// hand-rolled `Colors.white` camera disc and its 6-pixel inset are gone with them.
//
// THE REGION FIELD STILL OFFERS ONLY TRADING REGIONS, and the server still owns
// whether the change is allowed: once a payout account exists the region is fixed at
// its country and `setTradingRegion` refuses to move it. Nothing here decides that.
//
// Requirements 8.1–8.10, 10.1, 13.6–13.12, 14.12.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:cardtrade/core/extensions.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/core/web_handoff.dart';
import 'package:cardtrade/models/profile.dart';
import 'package:cardtrade/models/region.dart';
import 'package:cardtrade/providers/profile_provider.dart';
import 'package:cardtrade/providers/region_provider.dart';
import 'package:cardtrade/widgets/common/app_scaffold.dart';
import 'package:cardtrade/widgets/common/avatar.dart';
import 'package:cardtrade/widgets/common/controls.dart';
import 'package:cardtrade/widgets/common/error_view.dart';
import 'package:cardtrade/features/profile/widgets/profile_reread.dart';
import 'package:cardtrade/features/profile/widgets/profile_sections.dart';

/// The member's own editable profile fields.
class EditProfileScreen extends ConsumerStatefulWidget {
  const EditProfileScreen({super.key});

  @override
  ConsumerState<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends ConsumerState<EditProfileScreen> {
  final TextEditingController _nameController = TextEditingController();
  final TextEditingController _emailController = TextEditingController();
  String? _selectedRegion;
  bool _isSaving = false;
  bool _initialized = false;

  /// Field-level failures, presented on the field they belong to (Req 8.5).
  String? _nameError;
  String? _emailError;

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    super.dispose();
  }

  void _initFields(Profile profile) {
    if (_initialized) return;
    _nameController.text = profile.displayName;
    _emailController.text = profile.contactEmail;
    _selectedRegion = profile.regionCode;
    _initialized = true;
  }

  bool _validate() {
    final String name = _nameController.text.trim();
    final String email = _emailController.text.trim();
    setState(() {
      _nameError = name.isEmpty
          ? 'Enter a display name'
          : name.length < 2
              ? 'Use at least 2 characters'
              : null;
      _emailError = email.isEmpty
          ? 'Enter a contact email'
          : !email.contains('@')
              ? 'Enter a valid email address'
              : null;
    });
    return _nameError == null && _emailError == null;
  }

  Future<void> _save() async {
    if (!_validate()) return;
    setState(() => _isSaving = true);

    await ref.read(myProfileProvider.notifier).updateProfile(
          displayName: _nameController.text.trim(),
          contactEmail: _emailController.text.trim(),
          regionCode: _selectedRegion,
        );

    if (!mounted) return;
    setState(() => _isSaving = false);
    context.showSuccess('Profile updated');
    context.pop();
  }

  @override
  Widget build(BuildContext context) {
    final AsyncValue<List<Region>> regionsAsync =
        ref.watch(tradingRegionsProvider);

    return AppScaffold(
      title: 'Edit profile',
      onBack: () => Navigator.of(context).maybePop(),
      body: ProfileReRead(
        builder: (BuildContext context, ProfileReadState state) {
          final Profile? profile = state.lastReported;
          if (profile == null) {
            if (state.read.hasError) {
              return ErrorView(
                title: 'We could not load your profile',
                message: 'Your profile did not load. Please try again.',
                onRetry: state.retry,
              );
            }
            return const ProfileStepSkeleton(announcement: 'Loading your profile');
          }

          _initFields(profile);

          return ListView(
            padding: const EdgeInsets.fromLTRB(
              AppSpacing.group,
              AppSpacing.snug,
              AppSpacing.group,
              AppSpacing.section,
            ),
            children: <Widget>[
              Center(
                child: Avatar(
                  imageUrl: profile.avatarPath,
                  displayName: profile.displayName,
                  size: AvatarSize.xl,
                ),
              ),
              const SizedBox(height: AppSpacing.snug),
              // A CAPTION IS NOT A PATH (Req 12.5). This read "Profile pictures
              // are set on the website for now." and stopped there, which tells a
              // member the capability exists and gives them nothing to reach it
              // with. The app has no avatar picker, so the row hands off — and it
              // names the page and states the departure first (Req 12.2).
              ProfileMenuRow(
                icon: Icons.account_circle_outlined,
                label: 'Change your profile picture',
                trailingNote:
                    'Opens ${WebHandoff.pageLabel(WebHandoff.profile)} in your '
                    'browser',
                leavesApp: true,
                onTap: () => WebHandoff.openOrWarn(context, WebHandoff.profile),
              ),
              const SizedBox(height: AppSpacing.section),

              AppTextField(
                controller: _nameController,
                label: 'Display name',
                errorText: _nameError,
                textInputAction: TextInputAction.next,
              ),
              const SizedBox(height: AppSpacing.group),

              AppTextField(
                controller: _emailController,
                label: 'Contact email',
                keyboardType: TextInputType.emailAddress,
                errorText: _emailError,
              ),
              const SizedBox(height: AppSpacing.group),

              regionsAsync.when(
                loading: () => const ProfileStepSkeleton(
                  announcement: 'Loading trading regions',
                ),
                error: (Object error, _) => const AppFormSummary(
                  message: 'We could not load the list of trading regions.',
                ),
                data: (List<Region> regions) => AppChoiceChips<String>(
                  label: 'Trading region',
                  options: regions.map((Region r) => r.code).toList(),
                  selected: _selectedRegion,
                  labelOf: (String code) => regions
                      .firstWhere((Region r) => r.code == code)
                      .label,
                  helperText:
                      'Where you trade. Contracts run inside one region.',
                  onSelected: (String? code) {
                    setState(() => _selectedRegion = code);
                  },
                ),
              ),
              const SizedBox(height: AppSpacing.section),

              AppButton(
                label: 'Save',
                fillWidth: true,
                busy: _isSaving,
                onPressed: _save,
              ),
            ],
          );
        },
      ),
    );
  }
}
