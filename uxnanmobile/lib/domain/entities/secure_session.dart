import 'dart:typed_data';

import 'package:uxnan/domain/enums/handshake_mode.dart';

/// Immutable cryptographic material for an active E2EE session.
///
/// Holds the AES-256 [derivedKey] (kept in memory only, never persisted — spec
/// 02b §5.2) plus the monotonic sequence counters used for replay protection
/// and catch-up. Sequence updates return a new instance. See
/// `architecture/02a-system-architecture.md` (section 5.1.1 / 5.9).
class SecureSession {
  /// Creates a [SecureSession].
  const SecureSession({
    required this.sessionId,
    required this.macDeviceId,
    required this.phoneDeviceId,
    required this.derivedKey,
    required this.keyEpoch,
    required this.mode,
    this.bridgeOutboundSeq = 0,
    this.phoneOutboundSeq = 1,
  });

  /// Session identifier shared with the bridge and relay.
  final String sessionId;

  /// Identifier of the paired bridge device.
  final String macDeviceId;

  /// Identifier of this phone.
  final String phoneDeviceId;

  /// AES-256 key derived during the handshake (32 bytes). In-memory only.
  final Uint8List derivedKey;

  /// Last sequence number applied from the bridge's outbound stream (0 = none
  /// applied yet). Inbound envelopes must have a strictly greater `seq`.
  final int bridgeOutboundSeq;

  /// Next sequence number to use for messages sent to the bridge. Sequence
  /// numbers are 1-based, so the first outbound message is `seq` 1.
  final int phoneOutboundSeq;

  /// Key renegotiation counter.
  final int keyEpoch;

  /// Handshake mode that established this session.
  final HandshakeMode mode;

  /// Returns a copy with the last-applied bridge sequence advanced to [seq].
  SecureSession withBridgeSeq(int seq) => _copyWith(bridgeOutboundSeq: seq);

  /// Returns a copy with the next phone sequence advanced to [seq].
  SecureSession withPhoneSeq(int seq) => _copyWith(phoneOutboundSeq: seq);

  SecureSession _copyWith({int? bridgeOutboundSeq, int? phoneOutboundSeq}) {
    return SecureSession(
      sessionId: sessionId,
      macDeviceId: macDeviceId,
      phoneDeviceId: phoneDeviceId,
      derivedKey: derivedKey,
      keyEpoch: keyEpoch,
      mode: mode,
      bridgeOutboundSeq: bridgeOutboundSeq ?? this.bridgeOutboundSeq,
      phoneOutboundSeq: phoneOutboundSeq ?? this.phoneOutboundSeq,
    );
  }
}
