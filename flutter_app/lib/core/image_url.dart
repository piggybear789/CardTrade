import 'env.dart';
import 'constants.dart';

/// Constructs proper Supabase Storage public URLs with image transforms.
///
/// The web app stores paths like `userId/filename.jpg` in the `item-images`
/// bucket. This class builds the full public URL with optional transforms
/// that Supabase Storage applies server-side, reducing bandwidth for mobile.
///
/// Usage:
/// ```dart
/// final url = ImageUrl.itemImage('abc123/photo.jpg', size: ImageSize.thumbnail);
/// ```
abstract final class ImageUrl {
  /// Base storage URL derived from the Supabase project URL.
  static String get _storageBase =>
      '${Env.supabaseUrl}/storage/v1/object/public';

  /// Full URL for an item image path, with optional transforms.
  ///
  /// Returns [itemPlaceholder] if path is null/empty.
  /// Returns path unchanged if it's already a full URL.
  static String itemImage(String? path, {ImageSize size = ImageSize.medium}) {
    if (path == null || path.isEmpty) return itemPlaceholder;
    if (path.startsWith('http')) return path;
    final transforms = size.transforms;
    return '$_storageBase/${AppConstants.itemImagesBucket}/$path$transforms';
  }

  /// Full URL for a user avatar path.
  ///
  /// Returns [avatarPlaceholder] if path is null/empty.
  /// Returns path unchanged if it's already a full URL.
  static String avatar(String? path, {int size = 80}) {
    if (path == null || path.isEmpty) return avatarPlaceholder;
    if (path.startsWith('http')) return path;
    return '$_storageBase/${AppConstants.avatarsBucket}/$path'
        '?width=$size&height=$size&resize=cover';
  }

  /// Placeholder for missing item images. Empty string signals the UI
  /// to show a local asset fallback (e.g. a package icon).
  static const String itemPlaceholder = '';

  /// Placeholder for missing avatars. Empty string signals the UI
  /// to show an initial-letter avatar or default icon.
  static const String avatarPlaceholder = '';
}

/// Predefined image sizes for Supabase Storage transforms.
enum ImageSize {
  /// 200x200 — grid thumbnails, small cards.
  thumbnail(width: 200, height: 200),

  /// 400x300 — list items, compact cards.
  small(width: 400, height: 300),

  /// 800x600 — detail views, medium displays.
  medium(width: 800, height: 600),

  /// 1200x900 — full-screen gallery, hero images.
  large(width: 1200, height: 900),

  /// Original size — no transforms applied.
  full(width: null, height: null);

  const ImageSize({this.width, this.height});
  final int? width;
  final int? height;

  /// Query string for Supabase Storage image transforms.
  /// Returns empty string for [full] (no transform).
  String get transforms {
    if (width == null && height == null) return '';
    final params = <String>[];
    if (width != null) params.add('width=$width');
    if (height != null) params.add('height=$height');
    params.add('resize=cover');
    return '?${params.join('&')}';
  }
}
