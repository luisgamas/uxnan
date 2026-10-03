import 'package:shared_preferences/shared_preferences.dart';

/// Remembers the PCs whose "set up remote access" hint the person dismissed
/// (non-sensitive, on-device), so the hint never comes back for them.
class RemoteAccessHintStore {
  /// Creates a store, optionally injecting a [SharedPreferences] future
  /// (for tests).
  RemoteAccessHintStore({Future<SharedPreferences>? preferences})
      : _prefs = preferences ?? SharedPreferences.getInstance();

  final Future<SharedPreferences> _prefs;

  static const String _dismissedKey = 'uxnan.devices.remoteAccessHintDismissed';

  /// The `macDeviceId`s whose hint was dismissed.
  Future<Set<String>> readDismissed() async {
    final prefs = await _prefs;
    return (prefs.getStringList(_dismissedKey) ?? const []).toSet();
  }

  /// Persists the dismissed set.
  Future<void> writeDismissed(Set<String> deviceIds) async {
    final prefs = await _prefs;
    await prefs.setStringList(_dismissedKey, deviceIds.toList()..sort());
  }
}
