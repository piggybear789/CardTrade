import 'dart:io';
import 'package:path/path.dart' as p;
import 'package:supabase_flutter/supabase_flutter.dart' show FileOptions;
import '../core/constants.dart';
import 'supabase_service.dart';

/// Service for Supabase Storage operations (image uploads).
class StorageService {
  StorageService(this._supabase);

  final SupabaseService _supabase;

  /// Upload an item image and return the storage path.
  Future<String> uploadItemImage(File file) async {
    final userId = _supabase.currentUserId!;
    final ext = p.extension(file.path);
    final fileName = '${DateTime.now().millisecondsSinceEpoch}$ext';
    final path = '$userId/$fileName';

    await _supabase
        .storage(AppConstants.itemImagesBucket)
        .upload(path, file);

    return path;
  }

  /// Upload multiple item images and return their storage paths.
  Future<List<String>> uploadItemImages(List<File> files) async {
    final paths = <String>[];
    for (final file in files) {
      final path = await uploadItemImage(file);
      paths.add(path);
    }
    return paths;
  }

  /// Upload an avatar image and return the storage path.
  Future<String> uploadAvatar(File file) async {
    final userId = _supabase.currentUserId!;
    final ext = p.extension(file.path);
    final path = '$userId/avatar$ext';

    await _supabase
        .storage(AppConstants.avatarsBucket)
        .upload(path, file, fileOptions: const FileOptions(upsert: true));

    return path;
  }

  /// Get a public URL for a storage path.
  String getPublicUrl(String bucket, String path) {
    return _supabase
        .storage(bucket)
        .getPublicUrl(path);
  }

  /// Get the public URL for an item image.
  String getItemImageUrl(String path) =>
      getPublicUrl(AppConstants.itemImagesBucket, path);

  /// Get the public URL for an avatar.
  String getAvatarUrl(String path) =>
      getPublicUrl(AppConstants.avatarsBucket, path);

  /// Delete a file from storage.
  Future<void> deleteFile(String bucket, String path) async {
    await _supabase.storage(bucket).remove([path]);
  }
}
