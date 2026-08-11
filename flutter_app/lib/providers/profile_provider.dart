import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/profile.dart';
import '../models/review.dart';
import '../services/profile_service.dart';
import 'auth_provider.dart';

/// Provides the ProfileService.
final profileServiceProvider = Provider<ProfileService>((ref) {
  return ProfileService(ref.watch(supabaseServiceProvider));
});

/// The current user's full profile.
final myProfileProvider =
    AsyncNotifierProvider<MyProfileNotifier, Profile?>(MyProfileNotifier.new);

class MyProfileNotifier extends AsyncNotifier<Profile?> {
  @override
  FutureOr<Profile?> build() async {
    // Re-fetch when auth state changes
    ref.watch(currentUserProvider);
    final service = ref.read(profileServiceProvider);
    return service.getMyProfile();
  }

  /// Refresh the profile from the server.
  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      return ref.read(profileServiceProvider).getMyProfile();
    });
  }

  /// Update profile fields.
  Future<void> updateProfile({
    String? displayName,
    String? contactEmail,
    String? regionCode,
  }) async {
    state = await AsyncValue.guard(() async {
      return ref.read(profileServiceProvider).updateProfile(
        displayName: displayName,
        contactEmail: contactEmail,
        regionCode: regionCode,
      );
    });
  }
}

/// A public profile for a given user ID.
final publicProfileProvider =
    FutureProvider.family<PublicProfile?, String>((ref, userId) async {
  final service = ref.read(profileServiceProvider);
  return service.getPublicProfile(userId);
});

/// Reviews for a given user ID.
final reviewsProvider =
    FutureProvider.family<List<Review>, String>((ref, userId) async {
  final service = ref.read(profileServiceProvider);
  return service.getReviews(userId);
});
