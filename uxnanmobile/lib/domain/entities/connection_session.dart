import 'package:equatable/equatable.dart';
import 'package:uxnan/domain/enums/connection_transport.dart';

/// One phone→PC connection session: from the moment a live encrypted channel
/// was committed until it was torn down.
///
/// Persisted locally (drift, phone-only — it never leaves the device) so the
/// profile / per-PC metrics can show data the wire contracts don't provide:
/// total time connected, longest session, sessions count and the
/// relay-vs-direct split.
class ConnectionSession extends Equatable {
  /// Creates a [ConnectionSession].
  const ConnectionSession({
    required this.id,
    required this.deviceId,
    required this.transport,
    required this.startedAt,
    required this.lastActiveAt,
    this.endpoint,
    this.endedAt,
  });

  /// Unique session id.
  final String id;

  /// The `macDeviceId` of the PC this session connected to.
  final String deviceId;

  /// Whether the live channel ran over the relay or a direct host.
  final ConnectionTransport transport;

  /// The real URL the channel used (winning direct host, or the relay), if
  /// known.
  final String? endpoint;

  /// When the live channel was committed.
  final DateTime startedAt;

  /// The last moment the channel was confirmed alive (advanced by the
  /// heartbeat). Used to close a session left dangling by a force-kill at the
  /// last-known-good time instead of inflating its duration.
  final DateTime lastActiveAt;

  /// When the session was torn down, or null while it is still open.
  final DateTime? endedAt;

  /// Whether the session is still open (no clean teardown recorded yet).
  bool get isOpen => endedAt == null;

  /// The session's duration: [startedAt]→[endedAt] when closed, else
  /// [startedAt]→[lastActiveAt] for an open/dangling session.
  Duration get duration => (endedAt ?? lastActiveAt).difference(startedAt);

  /// Returns a copy with selected fields replaced.
  ConnectionSession copyWith({DateTime? lastActiveAt, DateTime? endedAt}) {
    return ConnectionSession(
      id: id,
      deviceId: deviceId,
      transport: transport,
      endpoint: endpoint,
      startedAt: startedAt,
      lastActiveAt: lastActiveAt ?? this.lastActiveAt,
      endedAt: endedAt ?? this.endedAt,
    );
  }

  @override
  List<Object?> get props => [
        id,
        deviceId,
        transport,
        endpoint,
        startedAt,
        lastActiveAt,
        endedAt,
      ];
}
