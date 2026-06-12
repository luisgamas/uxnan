import 'package:shared_preferences/shared_preferences.dart';

/// Persists conversation-view preferences (non-sensitive, on-device) — for now
/// just whether the agent's "thinking" section is shown.
class ConversationPreferencesStore {
  /// Creates a store, optionally injecting a [SharedPreferences] future
  /// (for tests).
  ConversationPreferencesStore({Future<SharedPreferences>? preferences})
      : _prefs = preferences ?? SharedPreferences.getInstance();

  final Future<SharedPreferences> _prefs;

  static const String _showThinkingKey = 'uxnan.conversation.showThinking';

  /// Whether the agent-thinking section is shown, or `null` if never set (so
  /// the caller keeps the default).
  Future<bool?> readShowThinking() async {
    final prefs = await _prefs;
    if (!prefs.containsKey(_showThinkingKey)) return null;
    return prefs.getBool(_showThinkingKey);
  }

  /// Persists the show-thinking preference.
  Future<void> writeShowThinking({required bool value}) async {
    final prefs = await _prefs;
    await prefs.setBool(_showThinkingKey, value);
  }
}
