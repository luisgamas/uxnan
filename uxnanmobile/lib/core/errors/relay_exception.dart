import 'package:uxnan/core/errors/transport_exception.dart';

/// Why the user's relay did not put this phone through to its PC's bridge.
///
/// Most map one-to-one to the relay's close codes (`RELAY_CLOSE` in
/// `shared/src/relay/protocol.ts`, 4001–4011), so the app can say "your PC is
/// offline" rather than "connection failed".
enum RelayFailure {
  /// 4001 — the auth frame was malformed or its signature did not verify.
  authFailed(4001),

  /// 4002 — the relay got no auth frame in time.
  authTimeout(4002),

  /// 4003 — this phone is not paired with the bridge (or its one-time
  /// pairing ticket was used, expired or wrong).
  notAllowed(4003),

  /// 4004 — the PC's bridge is not connected to its relay right now.
  bridgeOffline(4004),

  /// 4005 — the bridge did not answer in time.
  bridgeTimeout(4005),

  /// 4006 — the bridge's end of this phone's channel went away.
  peerClosed(4006),

  /// 4008 — a control frame was too large or not valid JSON.
  badFrame(4008),

  /// 4009 — a newer connection replaced this one.
  replaced(4009),

  /// 4010 — the bridge removed this phone from the phones it trusts.
  revoked(4010),

  /// 4011 — too many phones are connected through the relay at once.
  full(4011),

  /// The relay could not be reached, or closed without a known code.
  unreachable(null),

  /// The relay answered something this app does not understand (a frame out
  /// of order, another protocol version).
  protocol(null);

  const RelayFailure(this.closeCode);

  /// The close code the relay sends for this failure, when it has one.
  final int? closeCode;

  /// The failure a relay close [code] stands for; [unreachable] for a code
  /// that is not one of the relay's.
  static RelayFailure fromCloseCode(int? code) {
    for (final failure in values) {
      if (failure.closeCode != null && failure.closeCode == code) {
        return failure;
      }
    }
    return unreachable;
  }
}

/// Raised when the user's relay refuses or drops this phone before putting it
/// through to its bridge. A [TransportException] of kind
/// [TransportErrorKind.connection], so the reconnection loop treats it like
/// any unreachable transport; [failure] says why, for the UI.
class RelayException extends TransportException {
  /// Creates a [RelayException].
  const RelayException(this.failure, String message, {super.cause})
      : super(TransportErrorKind.connection, message);

  /// Why the relay did not connect this phone.
  final RelayFailure failure;

  @override
  String toString() => 'RelayException(${failure.name}): $message';
}
