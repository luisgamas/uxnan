import 'package:uxnan/domain/entities/connection_session.dart';

/// Contract for the phone-local connection-session log that powers the
/// connection metrics (time connected, longest session, sessions count,
/// relay-vs-direct split) on the profile / per-PC screens.
///
/// Phone-only: nothing here crosses the wire.
abstract class IConnectionSessionRepository {
  /// Records the start of a new connection session.
  Future<void> startSession(ConnectionSession session);

  /// Advances an open session's last-active time (called by the heartbeat), so
  /// a force-kill can be closed at the last-known-good time.
  Future<void> touchSession(String id, DateTime at);

  /// Closes the open session with [id] at [endedAt] (a clean teardown).
  Future<void> endSession(String id, DateTime endedAt);

  /// Closes any session left open by a previous run (the app was killed without
  /// a clean disconnect) at its own last-active time, so metrics never inflate.
  /// Run once at startup.
  Future<void> closeDanglingSessions();

  /// All recorded sessions, most recent first (for metrics aggregation).
  Future<List<ConnectionSession>> getAll();

  /// Emits the recorded sessions whenever they change.
  Stream<List<ConnectionSession>> watchAll();
}
