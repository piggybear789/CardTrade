import '../models/profile.dart';
import '../models/review.dart';
import 'supabase_service.dart';

/// Service for profile operations.
class ProfileService {
  ProfileService(this._supabase);

  final SupabaseService _supabase;

  /// Fetch the current user's full profile.
  Future<Profile?> getMyProfile() async {
    final userId = _supabase.currentUserId;
    if (userId == null) return null;

    final response = await _supabase
        .from('profiles')
        .select()
        .eq('id', userId)
        .maybeSingle();

    if (response == null) return null;
    return Profile.fromJson(response);
  }

  /// Fetch a public profile by user ID.
  Future<PublicProfile?> getPublicProfile(String userId) async {
    final response = await _supabase
        .from('public_profiles')
        .select()
        .eq('id', userId)
        .maybeSingle();

    if (response == null) return null;
    return PublicProfile.fromJson(response);
  }

  /// Update the current user's profile.
  Future<Profile> updateProfile({
    String? displayName,
    String? contactEmail,
    String? regionCode,
  }) async {
    final userId = _supabase.currentUserId!;
    final updates = <String, dynamic>{};
    if (displayName != null) updates['display_name'] = displayName;
    if (contactEmail != null) updates['contact_email'] = contactEmail;
    if (regionCode != null) updates['region_code'] = regionCode;

    final response = await _supabase
        .from('profiles')
        .update(updates)
        .eq('id', userId)
        .select()
        .single();

    return Profile.fromJson(response);
  }

  /// Update avatar path after image upload.
  Future<void> updateAvatar(String avatarPath) async {
    final userId = _supabase.currentUserId!;
    await _supabase
        .from('profiles')
        .update({'avatar_path': avatarPath})
        .eq('id', userId);
  }

  /// Fetch reviews for a user.
  Future<List<Review>> getReviews(String userId) async {
    final response = await _supabase
        .from('reviews')
        .select('''
          *,
          reviewer:profiles!reviews_reviewer_id_fkey(display_name, avatar_path)
        ''')
        .eq('reviewee_id', userId)
        .order('created_at', ascending: false);

    return (response as List).map((json) {
      final reviewer = json['reviewer'] as Map<String, dynamic>?;
      return Review.fromJson({
        ...json,
        'reviewer_display_name': reviewer?['display_name'],
        'reviewer_avatar_path': reviewer?['avatar_path'],
      });
    }).toList();
  }
}
