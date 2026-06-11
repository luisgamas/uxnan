import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/value_objects/notification_preferences.dart';

/// Persists the user's [NotificationPreferences] locally.
///
/// Backed by `shared_preferences` (non-sensitive, plain key/value) rather than
/// the encrypted secure store, which is reserved for secrets. Survives app
/// restarts so the toggles stay set and the bridge can be re-told on connect.
class NotificationPreferencesStore {
  /// Creates a store, optionally injecting a [SharedPreferences] future
  /// (for tests).
  NotificationPreferencesStore({Future<SharedPreferences>? preferences})
      : _prefs = preferences ?? SharedPreferences.getInstance();

  final Future<SharedPreferences> _prefs;

  static const String _turnCompletedKey = 'uxnan.notifications.turnCompleted';
  static const String _turnErrorKey = 'uxnan.notifications.turnError';

  /// Returns the stored preferences, or `null` if the user never set them
  /// (so the caller can keep the opted-in default).
  Future<NotificationPreferences?> read() async {
    final prefs = await _prefs;
    if (!prefs.containsKey(_turnCompletedKey) &&
        !prefs.containsKey(_turnErrorKey)) {
      return null;
    }
    return NotificationPreferences(
      turnCompleted: prefs.getBool(_turnCompletedKey) ?? true,
      turnError: prefs.getBool(_turnErrorKey) ?? true,
    );
  }

  /// Persists [preferences].
  Future<void> write(NotificationPreferences preferences) async {
    final prefs = await _prefs;
    await prefs.setBool(_turnCompletedKey, preferences.turnCompleted);
    await prefs.setBool(_turnErrorKey, preferences.turnError);
  }
}
