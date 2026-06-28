import 'package:shared_preferences/shared_preferences.dart';

/// Persists the app-update checker's small, non-sensitive state on-device:
/// when the last store check ran (to throttle automatic checks) and which
/// store version the user dismissed (so the "update available" banner stops
/// nagging for that exact version until a newer one ships).
class UpdatePreferencesStore {
  /// Creates a store, optionally injecting a [SharedPreferences] future (for
  /// tests).
  UpdatePreferencesStore({Future<SharedPreferences>? preferences})
      : _prefs = preferences ?? SharedPreferences.getInstance();

  final Future<SharedPreferences> _prefs;

  static const String _lastCheckKey = 'uxnan.updates.lastCheckMs';
  static const String _dismissedVersionKey = 'uxnan.updates.dismissedVersion';

  /// When the last update check completed, or null if one never ran.
  Future<DateTime?> readLastCheck() async {
    final prefs = await _prefs;
    final millis = prefs.getInt(_lastCheckKey);
    return millis == null ? null : DateTime.fromMillisecondsSinceEpoch(millis);
  }

  /// Records [when] as the moment the last check completed.
  Future<void> writeLastCheck(DateTime when) async {
    final prefs = await _prefs;
    await prefs.setInt(_lastCheckKey, when.millisecondsSinceEpoch);
  }

  /// The store version the user dismissed, or null when none is dismissed.
  Future<String?> readDismissedVersion() async {
    final prefs = await _prefs;
    final value = prefs.getString(_dismissedVersionKey);
    return (value == null || value.isEmpty) ? null : value;
  }

  /// Persists the dismissed store [version]; a null/empty value clears it (so
  /// the banner can return for a newer version).
  Future<void> writeDismissedVersion(String? version) async {
    final prefs = await _prefs;
    if (version == null || version.isEmpty) {
      await prefs.remove(_dismissedVersionKey);
      return;
    }
    await prefs.setString(_dismissedVersionKey, version);
  }
}
