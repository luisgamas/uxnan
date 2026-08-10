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
  static const String _collapsedKey = 'uxnan.threads.collapsedProjects';
  static const String _lastDeviceKey = 'uxnan.threads.lastDevice';

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

  /// Project ids the user has collapsed in the spaces list.
  ///
  /// The COLLAPSED set is stored rather than the expanded one, so a project the
  /// user has never touched — including one that appears later — comes back
  /// open. Storing "expanded" would leave every new project shut.
  Future<Set<String>> readCollapsedProjects() async {
    final prefs = await _prefs;
    return (prefs.getStringList(_collapsedKey) ?? const []).toSet();
  }

  /// Persists the collapsed set.
  Future<void> writeCollapsedProjects(Set<String> ids) async {
    final prefs = await _prefs;
    await prefs.setStringList(_collapsedKey, ids.toList());
  }

  /// The PC whose list was last on screen, or `null` if there has not been one.
  ///
  /// Only the permanent drawer needs this, and only as a **fallback**: it asks
  /// the open conversation which PC it belongs to first. This answers the case
  /// that has no conversation to ask — a cold start, or a window wide enough
  /// for a drawer before anything has been opened — where the alternative is a
  /// drawer that is simply blank.
  Future<String?> readLastVisitedDevice() async {
    final prefs = await _prefs;
    return prefs.getString(_lastDeviceKey);
  }

  /// Persists the PC whose list was last on screen.
  Future<void> writeLastVisitedDevice(String deviceId) async {
    final prefs = await _prefs;
    await prefs.setString(_lastDeviceKey, deviceId);
  }
}
