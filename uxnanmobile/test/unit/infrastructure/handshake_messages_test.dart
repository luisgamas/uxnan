import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/enums/handshake_mode.dart';
import 'package:uxnan/infrastructure/transport/handshake_messages.dart';

ClientHello _hello({int lastAppliedBridgeOutboundSeq = 0}) => ClientHello(
      sessionId: 'session-xyz',
      handshakeMode: HandshakeMode.trustedReconnect,
      phoneDeviceId: 'phone-1',
      phoneIdentityPublicKey: Uint8List.fromList(List<int>.filled(32, 1)),
      phoneEphemeralPublicKey: Uint8List.fromList(List<int>.filled(32, 2)),
      clientNonce: Uint8List.fromList(List<int>.filled(32, 3)),
      lastAppliedBridgeOutboundSeq: lastAppliedBridgeOutboundSeq,
    );

void main() {
  group('ClientHello.toJson resumeState', () {
    test('omits resumeState when no seq has been applied (0)', () {
      final json = _hello().toJson();
      expect(json.containsKey('resumeState'), isFalse);
    });

    test('carries resumeState.lastAppliedBridgeOutboundSeq when > 0', () {
      final json = _hello(lastAppliedBridgeOutboundSeq: 7).toJson();
      expect(json['resumeState'], {'lastAppliedBridgeOutboundSeq': 7});
    });

    test('serializes the core handshake fields as hex', () {
      final json = _hello().toJson();
      expect(json['kind'], 'clientHello');
      expect(json['sessionId'], 'session-xyz');
      expect(json['handshakeMode'], 'trusted_reconnect');
      expect(json['clientNonce'], '03' * 32);
    });
  });
}
