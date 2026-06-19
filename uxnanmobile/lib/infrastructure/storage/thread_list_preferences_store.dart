import 'package:shared_preferences/shared_preferences.dart';

/// Persists thread-list view preferences (non-sensitive, on-device): the list
/// ordering and the compact-density toggle. Shared by the active and archived
/// thread lists so both honour the same persisted choice.
///
/// The ordering is stored as the [Enum.name] string (decoupled from the
/// presentation enum) so the store never depends on the UI layer.
class ThreadListPreferencesStore {
  /// Creates a store, optionally injecting a [SharedPreferences] future
  /// (for tests).
  ThreadListPreferencesStore({Future<SharedPreferences>? preferences})
      : _prefs = preferences ?? SharedPreferences.getInstance();

  final Future<SharedPreferences> _prefs;

  static const String _sortKey = 'uxnan.threads.sort';
  static const String _compactKey = 'uxnan.threads.compact';

  /// The persisted sort mode name, or `null` if never set (keep the default).
  Future<String?> readSort() async {
    final prefs = await _prefs;
    if (!prefs.containsKey(_sortKey)) return null;
    return prefs.getString(_sortKey);
  }

  /// Persists the sort mode by its [Enum.name].
  Future<void> writeSort(String name) async {
    final prefs = await _prefs;
    await prefs.setString(_sortKey, name);
  }

  /// Whether the compact density is on, or `null` if never set (keep default).
  Future<bool?> readCompact() async {
    final prefs = await _prefs;
    if (!prefs.containsKey(_compactKey)) return null;
    return prefs.getBool(_compactKey);
  }

  /// Persists the compact-density preference.
  Future<void> writeCompact({required bool value}) async {
    final prefs = await _prefs;
    await prefs.setBool(_compactKey, value);
  }
}
