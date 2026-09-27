import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/value_objects/profile_avatar.dart';

/// Persists the user's profile customization (non-sensitive, on-device): an
/// avatar (a preset icon or a small inline image), absent by default (the UI
/// then shows a person glyph), and the profile's refresh preferences. The name
/// is not here: it is this phone's name, kept by the phone-name manager and
/// shared with every paired PC.
class ProfilePreferencesStore {
  /// Creates a store, optionally injecting a [SharedPreferences] future
  /// (for tests).
  ProfilePreferencesStore({Future<SharedPreferences>? preferences})
      : _prefs = preferences ?? SharedPreferences.getInstance();

  final Future<SharedPreferences> _prefs;

  static const String _avatarKey = 'uxnan.profile.avatar';
  static const String _usageRefreshKey = 'uxnan.profile.usageRefreshInterval';
  static const String _usageClock24hKey = 'uxnan.profile.usageClock24h';
  static const String _metricsRefreshKey =
      'uxnan.profile.metricsRefreshInterval';

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

  /// The stored usage auto-refresh interval name, or null when unset.
  Future<String?> readUsageRefreshInterval() async {
    final prefs = await _prefs;
    return prefs.getString(_usageRefreshKey);
  }

  /// Persists the usage auto-refresh interval name.
  Future<void> writeUsageRefreshInterval(String name) async {
    final prefs = await _prefs;
    await prefs.setString(_usageRefreshKey, name);
  }

  /// The stored metrics refresh-mode name, or null when unset.
  Future<String?> readMetricsRefreshInterval() async {
    final prefs = await _prefs;
    return prefs.getString(_metricsRefreshKey);
  }

  /// Persists the metrics refresh-mode name.
  Future<void> writeMetricsRefreshInterval(String name) async {
    final prefs = await _prefs;
    await prefs.setString(_metricsRefreshKey, name);
  }

  /// Whether usage reset times use a 24-hour clock, or null when unset.
  Future<bool?> readUsageClock24h() async {
    final prefs = await _prefs;
    return prefs.getBool(_usageClock24hKey);
  }

  /// Persists the 24-hour-clock preference.
  Future<void> writeUsageClock24h({required bool value}) async {
    final prefs = await _prefs;
    await prefs.setBool(_usageClock24hKey, value);
  }
}
