import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'package:cardtrade/core/extensions.dart';
import 'package:cardtrade/core/theme.dart';
import 'package:cardtrade/providers/profile_provider.dart';
import 'package:cardtrade/providers/region_provider.dart';
import 'package:cardtrade/widgets/common/avatar.dart';
import 'package:cardtrade/widgets/common/error_view.dart';

/// Edit profile screen for updating display name, contact email,
/// region, and avatar.
class EditProfileScreen extends ConsumerStatefulWidget {
  const EditProfileScreen({super.key});

  @override
  ConsumerState<EditProfileScreen> createState() => _EditProfileScreenState();
}

class _EditProfileScreenState extends ConsumerState<EditProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController();
  String? _selectedRegion;
  bool _isSaving = false;
  bool _initialized = false;

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    super.dispose();
  }

  void _initFields() {
    final profile = ref.read(myProfileProvider).value;
    if (profile != null && !_initialized) {
      _nameController.text = profile.displayName;
      _emailController.text = profile.contactEmail;
      _selectedRegion = profile.regionCode;
      _initialized = true;
    }
  }

  Future<void> _save() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isSaving = true);

    await ref.read(myProfileProvider.notifier).updateProfile(
          displayName: _nameController.text.trim(),
          contactEmail: _emailController.text.trim(),
          regionCode: _selectedRegion,
        );

    if (mounted) {
      setState(() => _isSaving = false);
      context.showSuccess('Profile updated');
      context.pop();
    }
  }

  @override
  Widget build(BuildContext context) {
    final profileAsync = ref.watch(myProfileProvider);
    final regionsAsync = ref.watch(tradingRegionsProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Edit Profile'),
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

          _initFields();

          return SingleChildScrollView(
            padding: const EdgeInsets.all(AppTheme.spacingLg),
            child: Form(
              key: _formKey,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // ─── Avatar ──────────────────────────────────────
                  Center(
                    child: GestureDetector(
                      onTap: () {
                        // TODO: implement avatar picker
                      },
                      child: Stack(
                        children: [
                          Avatar(
                            imageUrl: profile.avatarPath,
                            displayName: profile.displayName,
                            size: AvatarSize.xl,
                          ),
                          Positioned(
                            right: 0,
                            bottom: 0,
                            child: Container(
                              padding: const EdgeInsets.all(6),
                              decoration: const BoxDecoration(
                                color: AppTheme.accent,
                                shape: BoxShape.circle,
                              ),
                              child: const Icon(
                                Icons.camera_alt_rounded,
                                size: 16,
                                color: Colors.white,
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const SizedBox(height: AppTheme.spacingXl),

                  // ─── Display Name ────────────────────────────────
                  TextFormField(
                    controller: _nameController,
                    decoration: const InputDecoration(
                      labelText: 'Display name',
                    ),
                    validator: (value) {
                      if (value == null || value.trim().isEmpty) {
                        return 'Display name is required';
                      }
                      if (value.trim().length < 2) {
                        return 'Must be at least 2 characters';
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: AppTheme.spacingLg),

                  // ─── Contact Email ───────────────────────────────
                  TextFormField(
                    controller: _emailController,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(
                      labelText: 'Contact email',
                    ),
                    validator: (value) {
                      if (value == null || value.trim().isEmpty) {
                        return 'Email is required';
                      }
                      if (!value.contains('@')) {
                        return 'Enter a valid email';
                      }
                      return null;
                    },
                  ),
                  const SizedBox(height: AppTheme.spacingLg),

                  // ─── Region ──────────────────────────────────────
                  regionsAsync.when(
                    loading: () => const LinearProgressIndicator(),
                    error: (_, _) => const Text('Failed to load regions'),
                    data: (regions) {
                      return DropdownButtonFormField<String>(
                        initialValue: _selectedRegion,
                        decoration: const InputDecoration(
                          labelText: 'Trading region',
                        ),
                        items: regions
                            .map((r) => DropdownMenuItem(
                                  value: r.code,
                                  child: Text(r.label),
                                ))
                            .toList(),
                        onChanged: (value) {
                          setState(() => _selectedRegion = value);
                        },
                      );
                    },
                  ),
                  const SizedBox(height: AppTheme.spacingXxl),

                  // ─── Save Button ─────────────────────────────────
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      onPressed: _isSaving ? null : _save,
                      child: _isSaving
                          ? const SizedBox(
                              width: 20,
                              height: 20,
                              child: CircularProgressIndicator(
                                strokeWidth: 2,
                                color: Colors.white,
                              ),
                            )
                          : const Text('Save'),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
