import 'package:uxnan/domain/entities/trusted_device.dart';
import 'package:uxnan/infrastructure/transport/websocket_transport.dart';

/// Chooses and opens a [WebSocketTransport] for a [TrustedDevice].
///
/// Spec 02a §5.9.3 prefers a direct LAN connection and falls back to the relay.
/// LAN discovery (mDNS/Bonjour) is platform-specific and deferred; the current
/// implementation connects through the relay. The E2EE semantics are identical
/// on either channel.
// ignore: one_member_abstracts — a DI seam with multiple future impls (LAN).
abstract class TransportSelector {
  /// Returns a connected transport for [device].
  Future<WebSocketTransport> select(TrustedDevice device);
}

/// Connects to the bridge through the relay using the device's `relayUrl`.
class RelayTransportSelector implements TransportSelector {
  /// Creates a [RelayTransportSelector]. `createTransport` builds a fresh
  /// transport per connection (injected so tests can supply an in-memory one).
  RelayTransportSelector(this._createTransport);

  final WebSocketTransport Function() _createTransport;

  @override
  Future<WebSocketTransport> select(TrustedDevice device) async {
    final transport = _createTransport();
    await transport.connect(
      device.relayUrl,
      headers: {
        'x-role': 'iphone',
        'x-session-id': device.sessionId,
      },
    );
    return transport;
  }
}
