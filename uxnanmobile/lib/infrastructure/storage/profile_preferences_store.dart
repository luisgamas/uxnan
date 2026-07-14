import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/value_objects/profile_avatar.dart';

/// Persists the user's profile customization (non-sensitive, on-device): a
/// display name and an avatar (a preset icon or a small inline image). Both are
/// absent by default (the UI then shows a neutral name + person glyph).
class ProfilePreferencesStore {
  /// Creates a store, optionally injecting a [SharedPreferences] future
  /// (for tests).
  ProfilePreferencesStore({Future<SharedPreferences>? preferences})
      : _prefs = preferences ?? SharedPreferences.getInstance();

  final Future<SharedPreferences> _prefs;

  static const String _nameKey = 'uxnan.profile.name';
  static const String _avatarKey = 'uxnan.profile.avatar';

  /// The stored display name, or null when unset.
  Future<String?> readName() async {
    final prefs = await _prefs;
    final name = prefs.getString(_nameKey);
    return (name == null || name.isEmpty) ? null : name;
  }

  /// Persists the display name; a null/empty value clears it.
  Future<void> writeName(String? name) async {
    final prefs = await _prefs;
    if (name == null || name.trim().isEmpty) {
      await prefs.remove(_nameKey);
    } else {
      await prefs.setString(_nameKey, name.trim());
    }
  }

  /// The stored avatar, or null when unset (the UI uses the fallback).
  Future<ProfileAvatar?> readAvatar() async {
    final prefs = await _prefs;
    final raw = prefs.getString(_avatarKey);
    if (raw == null || raw.isEmpty) return null;
    try {
      final decoded = jsonDecode(raw);
      return decoded is Map
          ? ProfileAvatar.fromJson(decoded.cast<String, dynamic>())
          : null;
    } on Object {
      return null;
    }
  }

  /// Persists [avatar] as JSON; a null or fallback avatar clears the key.
  Future<void> writeAvatar(ProfileAvatar? avatar) async {
    final prefs = await _prefs;
    if (avatar == null || avatar.kind == ProfileAvatarKind.fallback) {
      await prefs.remove(_avatarKey);
    } else {
      await prefs.setString(_avatarKey, jsonEncode(avatar.toJson()));
    }
  }
}
