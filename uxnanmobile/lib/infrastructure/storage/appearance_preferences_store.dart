import 'package:shared_preferences/shared_preferences.dart';

/// Persists appearance + language preferences (non-sensitive, on-device): the
/// theme mode (system/light/dark) and the manual locale override (absent =
/// follow the device language).
///
/// FOR-DEV: a custom accent-color key will live here once accent theming is
/// brand-independent (see `FOR-DEV.md`).
class AppearancePreferencesStore {
  /// Creates a store, optionally injecting a [SharedPreferences] future
  /// (for tests).
  AppearancePreferencesStore({Future<SharedPreferences>? preferences})
      : _prefs = preferences ?? SharedPreferences.getInstance();

  final Future<SharedPreferences> _prefs;

  static const String _themeModeKey = 'uxnan.appearance.themeMode';
  static const String _localeKey = 'uxnan.appearance.localeTag';

  /// The stored theme mode name (`system`/`light`/`dark`), or null if unset.
  Future<String?> readThemeMode() async {
    final prefs = await _prefs;
    return prefs.getString(_themeModeKey);
  }

  /// Persists the theme-mode name.
  Future<void> writeThemeMode(String value) async {
    final prefs = await _prefs;
    await prefs.setString(_themeModeKey, value);
  }

  /// The stored locale tag (e.g. `es`), or null when following the device
  /// language.
  Future<String?> readLocaleTag() async {
    final prefs = await _prefs;
    final tag = prefs.getString(_localeKey);
    return (tag == null || tag.isEmpty) ? null : tag;
  }

  /// Persists the locale tag; a null value clears the override (system
  /// default).
  Future<void> writeLocaleTag(String? value) async {
    final prefs = await _prefs;
    if (value == null || value.isEmpty) {
      await prefs.remove(_localeKey);
    } else {
      await prefs.setString(_localeKey, value);
    }
  }
}
