import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/value_objects/prompt_template.dart';

/// Persists the user's `/` command-palette prompt templates as a JSON array in
/// [SharedPreferences]. A small, user-authored list — SharedPreferences is a
/// clean fit and needs no SQLite migration (same posture as the custom-themes
/// library and the other preference stores).
class PromptTemplatesStore {
  /// Creates a store, optionally injecting a [SharedPreferences] future (tests
  /// pass a mock-backed instance).
  PromptTemplatesStore({Future<SharedPreferences>? preferences})
      : _prefs = preferences ?? SharedPreferences.getInstance();

  final Future<SharedPreferences> _prefs;

  static const String _key = 'uxnan.composer.promptTemplates';

  /// Reads the stored templates. Returns `null` when the key has **never** been
  /// written (a fresh install, which the library seeds with localized
  /// defaults), versus an empty list when the user deleted them all.
  Future<List<PromptTemplate>?> readTemplates() async {
    final prefs = await _prefs;
    final raw = prefs.getString(_key);
    if (raw == null) return null;
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! List) return const [];
      return [
        for (final entry in decoded)
          if (entry is Map)
            PromptTemplate.fromJson(entry.cast<String, dynamic>()),
      ];
    } on Object {
      return const [];
    }
  }

  /// Persists [templates] (replacing the stored array).
  Future<void> writeTemplates(List<PromptTemplate> templates) async {
    final prefs = await _prefs;
    await prefs.setString(
      _key,
      jsonEncode([for (final t in templates) t.toJson()]),
    );
  }
}
