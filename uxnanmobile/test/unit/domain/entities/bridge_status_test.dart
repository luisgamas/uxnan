import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/bridge_status.dart';

void main() {
  group('BridgeStatus.fromJson', () {
    test('parses a full status', () {
      final status = BridgeStatus.fromJson(const {
        'version': '0.1.0',
        'relayConnected': true,
        'lanEnabled': true,
        'activeSessions': 2,
        'platform': 'win32',
        'uptimeMs': 1000,
        'latestVersion': '0.2.0',
        'updateAvailable': true,
      });
      expect(status.relayConnected, isTrue);
      expect(status.version, '0.1.0');
      expect(status.lanEnabled, isTrue);
      expect(status.activeSessions, 2);
      expect(status.latestVersion, '0.2.0');
      expect(status.updateAvailable, isTrue);
    });

    test('defaults relayConnected to false and leaves optionals null', () {
      final status = BridgeStatus.fromJson(const {});
      expect(status.relayConnected, isFalse);
      expect(status.version, isNull);
      expect(status.lanEnabled, isNull);
      expect(status.activeSessions, isNull);
      expect(status.latestVersion, isNull);
      expect(status.updateAvailable, isFalse);
    });

    test('defaults updateAvailable to false against an older bridge', () {
      // An older bridge omits the update fields entirely.
      final status = BridgeStatus.fromJson(const {
        'version': '0.1.0',
        'relayConnected': false,
      });
      expect(status.latestVersion, isNull);
      expect(status.updateAvailable, isFalse);
    });

    test('treats a non-bool relayConnected as false (tolerant)', () {
      final status = BridgeStatus.fromJson(const {'relayConnected': 'yes'});
      expect(status.relayConnected, isFalse);
    });
  });
}
