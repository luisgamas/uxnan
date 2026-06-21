import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/value_objects/custom_theme.dart';

/// Persists appearance + language preferences (non-sensitive, on-device): the
/// theme mode (system/light/dark), the user's authored [CustomTheme]s and the
/// manual locale override (absent = follow the device language).
///
/// Custom themes live in a small library persisted under
/// `uxnan.appearance.customThemes` as a JSON array of [CustomTheme] documents
/// (each one describing a complete M3 light + dark pair). A separate key,
/// `uxnan.appearance.activeCustomThemeId`, records which entry is the user's
/// active theme, and `uxnan.appearance.useCustomTheme` records the master
/// switch on the Personalization screen. The legacy single-theme key
/// `uxnan.appearance.customTheme` is read on first hydrate and migrated into
/// the new library, then ignored on subsequent loads.
class AppearancePreferencesStore {
  /// Creates a store, optionally injecting a [SharedPreferences] future
  /// (for tests).
  AppearancePreferencesStore({Future<SharedPreferences>? preferences})
      : _prefs = preferences ?? SharedPreferences.getInstance();

  final Future<SharedPreferences> _prefs;

  static const String _themeModeKey = 'uxnan.appearance.themeMode';
  static const String _localeKey = 'uxnan.appearance.localeTag';
  static const String _customThemeKey = 'uxnan.appearance.customTheme';
  static const String _customThemesKey = 'uxnan.appearance.customThemes';
  static const String _activeCustomThemeIdKey =
      'uxnan.appearance.activeCustomThemeId';
  static const String _useCustomThemeKey = 'uxnan.appearance.useCustomTheme';
  static const String _customThemesExpandedKey =
      'uxnan.appearance.customThemesExpanded';

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

  /// Reads the legacy single-theme document under
  /// `uxnan.appearance.customTheme`, if any. Returns null for an unset or
  /// unparseable document. Retained for one-shot migration into the new
  /// library shape; app code should call [readCustomThemesLibrary] instead.
  Future<CustomTheme?> readCustomTheme() async {
    final prefs = await _prefs;
    final raw = prefs.getString(_customThemeKey);
    if (raw == null || raw.isEmpty) return null;
    try {
      return CustomTheme.fromJsonString(raw);
    } on Object {
      return null;
    }
  }

  /// Persists [theme] as JSON under the legacy single-theme key. Retained
  /// for tests and migration; app code should call
  /// [writeCustomThemesLibrary] instead.
  Future<void> writeCustomTheme(CustomTheme? theme) async {
    final prefs = await _prefs;
    if (theme == null) {
      await prefs.remove(_customThemeKey);
      return;
    }
    await prefs.setString(_customThemeKey, jsonEncode(theme.toJson()));
  }

  /// Reads the custom-themes library from disk. Returns an empty list when
  /// the key is absent or unparseable; unparseable entries are silently
  /// dropped so a partially corrupt document does not brick the app.
  Future<List<CustomTheme>> readCustomThemesLibrary() async {
    final prefs = await _prefs;
    final raw = prefs.getString(_customThemesKey);
    if (raw == null || raw.isEmpty) return const <CustomTheme>[];
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) return const <CustomTheme>[];
      final out = <CustomTheme>[];
      for (final entry in decoded) {
        if (entry is! Map) continue;
        try {
          out.add(CustomTheme.fromJson(entry.cast<String, dynamic>()));
        } on Object {
          // Skip a malformed entry; the rest of the library still loads.
        }
      }
      return out;
    } on Object {
      return const <CustomTheme>[];
    }
  }

  /// Persists [themes] as the new library document. A null or empty value
  /// clears the key so a future hydrate re-seeds the built-in examples.
  Future<void> writeCustomThemesLibrary(List<CustomTheme>? themes) async {
    final prefs = await _prefs;
    if (themes == null || themes.isEmpty) {
      await prefs.remove(_customThemesKey);
      return;
    }
    final encoded = jsonEncode(themes.map((t) => t.toJson()).toList());
    await prefs.setString(_customThemesKey, encoded);
  }

  /// The id of the user's active custom theme, or null when no theme is
  /// selected (first-run, or the master switch on Personalization is off).
  Future<String?> readActiveCustomThemeId() async {
    final prefs = await _prefs;
    final id = prefs.getString(_activeCustomThemeIdKey);
    return (id == null || id.isEmpty) ? null : id;
  }

  /// Persists the active-theme id; a null value clears the selection.
  Future<void> writeActiveCustomThemeId(String? id) async {
    final prefs = await _prefs;
    if (id == null || id.isEmpty) {
      await prefs.remove(_activeCustomThemeIdKey);
      return;
    }
    await prefs.setString(_activeCustomThemeIdKey, id);
  }

  /// The persisted master switch for custom themes on the Personalization
  /// screen. Defaults to false on first hydrate.
  Future<bool> readUseCustomTheme() async {
    final prefs = await _prefs;
    return prefs.getBool(_useCustomThemeKey) ?? false;
  }

  /// Persists the master switch for custom themes.
  Future<void> writeUseCustomTheme({required bool value}) async {
    final prefs = await _prefs;
    await prefs.setBool(_useCustomThemeKey, value);
  }

  /// The persisted expansion state of the custom-themes library tile on
  /// the Personalization screen. Defaults to false (collapsed) when unset.
  Future<bool> readCustomThemesExpanded() async {
    final prefs = await _prefs;
    return prefs.getBool(_customThemesExpandedKey) ?? false;
  }

  /// Persists the expansion state of the custom-themes library tile so
  /// the user's choice (expanded vs collapsed) survives restarts.
  Future<void> writeCustomThemesExpanded({required bool value}) async {
    final prefs = await _prefs;
    await prefs.setBool(_customThemesExpandedKey, value);
  }
}
