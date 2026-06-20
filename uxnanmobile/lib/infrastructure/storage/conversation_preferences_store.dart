import 'package:shared_preferences/shared_preferences.dart';

/// Persists conversation-view preferences (non-sensitive, on-device): whether
/// the agent's "thinking" section is shown, and whether sending a message jumps
/// the scroll to the latest.
class ConversationPreferencesStore {
  /// Creates a store, optionally injecting a [SharedPreferences] future
  /// (for tests).
  ConversationPreferencesStore({Future<SharedPreferences>? preferences})
      : _prefs = preferences ?? SharedPreferences.getInstance();

  final Future<SharedPreferences> _prefs;

  static const String _showThinkingKey = 'uxnan.conversation.showThinking';
  static const String _scrollOnSendKey = 'uxnan.conversation.scrollOnSend';
  static const String _contextIndicatorModeKey =
      'uxnan.conversation.contextIndicatorMode';
  static const String _confirmPushKey = 'uxnan.git.confirmPush';
  static const String _confirmPrKey = 'uxnan.git.confirmPr';

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

  /// Whether sending a message jumps the scroll to the latest even when the
  /// user has scrolled up, or `null` if never set (keep the default).
  Future<bool?> readScrollOnSend() async {
    final prefs = await _prefs;
    if (!prefs.containsKey(_scrollOnSendKey)) return null;
    return prefs.getBool(_scrollOnSendKey);
  }

  /// Persists the scroll-to-latest-on-send preference.
  Future<void> writeScrollOnSend({required bool value}) async {
    final prefs = await _prefs;
    await prefs.setBool(_scrollOnSendKey, value);
  }

  /// The context-indicator display mode (enum name), or `null` if never set
  /// (keep the default).
  Future<String?> readContextIndicatorMode() async {
    final prefs = await _prefs;
    if (!prefs.containsKey(_contextIndicatorModeKey)) return null;
    return prefs.getString(_contextIndicatorModeKey);
  }

  /// Persists the context-indicator display mode (enum name).
  Future<void> writeContextIndicatorMode(String value) async {
    final prefs = await _prefs;
    await prefs.setString(_contextIndicatorModeKey, value);
  }

  /// Whether a confirmation is required before pushing, or `null` if never set.
  Future<bool?> readConfirmPush() async {
    final prefs = await _prefs;
    if (!prefs.containsKey(_confirmPushKey)) return null;
    return prefs.getBool(_confirmPushKey);
  }

  /// Persists the confirm-before-push preference.
  Future<void> writeConfirmPush({required bool value}) async {
    final prefs = await _prefs;
    await prefs.setBool(_confirmPushKey, value);
  }

  /// Whether a confirmation is required before opening a PR, or `null` when
  /// never set.
  Future<bool?> readConfirmPr() async {
    final prefs = await _prefs;
    if (!prefs.containsKey(_confirmPrKey)) return null;
    return prefs.getBool(_confirmPrKey);
  }

  /// Persists the confirm-before-PR preference.
  Future<void> writeConfirmPr({required bool value}) async {
    final prefs = await _prefs;
    await prefs.setBool(_confirmPrKey, value);
  }
}
