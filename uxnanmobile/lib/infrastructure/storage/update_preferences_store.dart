import 'package:shared_preferences/shared_preferences.dart';
import 'package:uxnan/domain/enums/update_check_interval.dart';

/// Persists the app-update checker's small, non-sensitive state on-device:
/// when the last store check ran (to throttle automatic checks), which store
/// version the user dismissed (so the "update available" banner stops nagging
/// for that exact version until a newer one ships), the chosen automatic check
/// interval, and whether a Play update was started and may still be pending.
class UpdatePreferencesStore {
  /// Creates a store, optionally injecting a [SharedPreferences] future (for
  /// tests).
  UpdatePreferencesStore({Future<SharedPreferences>? preferences})
      : _prefs = preferences ?? SharedPreferences.getInstance();

  final Future<SharedPreferences> _prefs;

  static const String _lastCheckKey = 'uxnan.updates.lastCheckMs';
  static const String _dismissedVersionKey = 'uxnan.updates.dismissedVersion';
  static const String _intervalKey = 'uxnan.updates.checkInterval';
  static const String _updateStartedKey = 'uxnan.updates.updateStarted';

  /// When the last update check completed, or null if one never ran.
  Future<DateTime?> readLastCheck() async {
    final prefs = await _prefs;
    final millis = prefs.getInt(_lastCheckKey);
    return millis == null ? null : DateTime.fromMillisecondsSinceEpoch(millis);
  }

  /// Records [when] as the moment the last check completed.
  Future<void> writeLastCheck(DateTime when) async {
    final prefs = await _prefs;
    await prefs.setInt(_lastCheckKey, when.millisecondsSinceEpoch);
  }

  /// The store version the user dismissed, or null when none is dismissed.
  Future<String?> readDismissedVersion() async {
    final prefs = await _prefs;
    final value = prefs.getString(_dismissedVersionKey);
    return (value == null || value.isEmpty) ? null : value;
  }

  /// Persists the dismissed store [version]; a null/empty value clears it (so
  /// the banner can return for a newer version).
  Future<void> writeDismissedVersion(String? version) async {
    final prefs = await _prefs;
    if (version == null || version.isEmpty) {
      await prefs.remove(_dismissedVersionKey);
      return;
    }
    await prefs.setString(_dismissedVersionKey, version);
  }

  /// The chosen automatic check interval, defaulting to
  /// [UpdateCheckInterval.defaultInterval] when unset or unrecognised.
  Future<UpdateCheckInterval> readInterval() async {
    final prefs = await _prefs;
    final value = prefs.getString(_intervalKey);
    if (value == null) return UpdateCheckInterval.defaultInterval;
    for (final interval in UpdateCheckInterval.values) {
      if (interval.name == value) return interval;
    }
    return UpdateCheckInterval.defaultInterval;
  }

  /// Persists the chosen automatic check [interval] (by its `.name`).
  Future<void> writeInterval(UpdateCheckInterval interval) async {
    final prefs = await _prefs;
    await prefs.setString(_intervalKey, interval.name);
  }

  /// Whether an update was started and may still be waiting in the store.
  ///
  /// A Play flexible download outlives the app that starts it, so this
  /// survives a restart on purpose: it is what tells the next launch to re-read
  /// the update's real stage even when the check interval hasn't elapsed, so a
  /// downloaded-but-not-installed update can still be finished (and doesn't sit
  /// on the user's storage unnoticed).
  Future<bool> readUpdateStarted() async {
    final prefs = await _prefs;
    return prefs.getBool(_updateStartedKey) ?? false;
  }

  /// Records whether an update is [started] and may still be pending. Cleared
  /// as soon as a check finds the store no longer has one in progress.
  Future<void> writeUpdateStarted({required bool started}) async {
    final prefs = await _prefs;
    if (!started) {
      await prefs.remove(_updateStartedKey);
      return;
    }
    await prefs.setBool(_updateStartedKey, true);
  }
}
