import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/value_objects/accent_color.dart';

/// Persists appearance + language preferences (non-sensitive, on-device): the
/// theme mode (system/light/dark), the user-picked accent color (a seed id
/// resolved against [AccentPalette]) and the manual locale override (absent
/// = follow the device language).
///
/// Only the accent **id** is stored (e.g. `purple`); the seed color is
/// resolved from the immutable [AccentPalette] at hydrate time, so adding a
/// new swatch is non-breaking for old saves. The `AccentPalette.fromId`
/// parser is tolerant of unknown ids (returns the brand default), so a
/// removed swatch also degrades gracefully.
class AppearancePreferencesStore {
  /// Creates a store, optionally injecting a [SharedPreferences] future
  /// (for tests).
  AppearancePreferencesStore({Future<SharedPreferences>? preferences})
      : _prefs = preferences ?? SharedPreferences.getInstance();

  final Future<SharedPreferences> _prefs;

  static const String _themeModeKey = 'uxnan.appearance.themeMode';
  static const String _localeKey = 'uxnan.appearance.localeTag';
  static const String _accentIdKey = 'uxnan.appearance.accentId';

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

  /// The stored accent id (e.g. `purple`), or null when no preference has
  /// been persisted yet (a first-run user keeps the brand default).
  Future<String?> readAccentId() async {
    final prefs = await _prefs;
    final id = prefs.getString(_accentIdKey);
    return (id == null || id.isEmpty) ? null : id;
  }

  /// Persists the accent id. A null or empty value clears the override and
  /// the picker falls back to the brand default at hydrate time.
  Future<void> writeAccentId(String? value) async {
    final prefs = await _prefs;
    if (value == null || value.isEmpty) {
      await prefs.remove(_accentIdKey);
    } else {
      await prefs.setString(_accentIdKey, value);
    }
  }
}
