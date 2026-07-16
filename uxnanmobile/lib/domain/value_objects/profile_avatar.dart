import 'package:equatable/equatable.dart';

/// What the user's profile avatar is.
enum ProfileAvatarKind {
  /// No custom avatar — render the default person glyph.
  fallback,

  /// One of the curated preset icons, identified by [ProfileAvatar.iconKey].
  icon,

  /// A user-picked image, stored inline as base64.
  image,
}

/// The user's chosen profile avatar: the default person, a preset icon, or a
/// picked image (kept small and stored inline). Persisted locally.
class ProfileAvatar extends Equatable {
  /// The default avatar (a person glyph).
  const ProfileAvatar.fallback()
      : kind = ProfileAvatarKind.fallback,
        iconKey = null,
        imageBase64 = null,
        imageMime = null;

  /// A preset icon identified by [key] (resolved to an `IconData` in the UI —
  /// kept as a string so no dynamic `IconData` breaks icon tree-shaking).
  const ProfileAvatar.icon(String key)
      : kind = ProfileAvatarKind.icon,
        iconKey = key,
        imageBase64 = null,
        imageMime = null;

  /// A picked image, stored inline as [base64] with its [mime] type.
  const ProfileAvatar.image({required String base64, required String mime})
      : kind = ProfileAvatarKind.image,
        imageBase64 = base64,
        imageMime = mime,
        iconKey = null;

  /// Reconstructs a [ProfileAvatar] from [json], degrading to the fallback for
  /// any malformed document.
  factory ProfileAvatar.fromJson(Map<String, dynamic> json) {
    switch (json['kind']) {
      case 'icon':
        final key = json['icon'];
        return key is String && key.isNotEmpty
            ? ProfileAvatar.icon(key)
            : const ProfileAvatar.fallback();
      case 'image':
        final data = json['data'];
        final mime = json['mime'];
        return data is String && data.isNotEmpty && mime is String
            ? ProfileAvatar.image(base64: data, mime: mime)
            : const ProfileAvatar.fallback();
      default:
        return const ProfileAvatar.fallback();
    }
  }

  /// Which kind of avatar this is.
  final ProfileAvatarKind kind;

  /// The preset-icon key, when [kind] is [ProfileAvatarKind.icon].
  final String? iconKey;

  /// The inline base64 image, when [kind] is [ProfileAvatarKind.image].
  final String? imageBase64;

  /// The image's MIME type, when [kind] is [ProfileAvatarKind.image].
  final String? imageMime;

  /// Serializes to a compact JSON map for persistence.
  Map<String, dynamic> toJson() => {
        'kind': kind.name,
        if (iconKey != null) 'icon': iconKey,
        if (imageBase64 != null) 'data': imageBase64,
        if (imageMime != null) 'mime': imageMime,
      };

  @override
  List<Object?> get props => [kind, iconKey, imageBase64, imageMime];
}
