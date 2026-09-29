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

  /// The persisted ordering of the list level named [level] (`projects`,
  /// `worktrees`, `agents`, `archive`), or `null` if never set (keep the
  /// default). The conversations keep the key they always had.
  Future<String?> readSort(String level) async {
    final prefs = await _prefs;
    final key = _sortKeyFor(level);
    if (!prefs.containsKey(key)) return null;
    return prefs.getString(key);
  }

  /// Persists the ordering of the list level [level] by its [Enum.name].
  Future<void> writeSort(String level, String name) async {
    final prefs = await _prefs;
    await prefs.setString(_sortKeyFor(level), name);
  }

  static String _sortKeyFor(String level) =>
      level == 'agents' ? _sortKey : '$_sortKey.$level';

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
