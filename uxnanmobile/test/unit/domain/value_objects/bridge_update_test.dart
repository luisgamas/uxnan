import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/bridge_update.dart';

void main() {
  group('BridgeUpdate.fromJson', () {
    test('reads an update under way and a failure', () {
      final updating = BridgeUpdate.fromJson(const {
        'version': '0.0.28',
        'latestVersion': '0.0.29',
        'available': true,
        'canApply': true,
        'phase': 'updating',
        'targetVersion': '0.0.29',
      });
      expect(updating?.phase, BridgeUpdatePhase.updating);
      expect(updating?.targetVersion, '0.0.29');

      final failed = BridgeUpdate.fromJson(const {
        'version': '0.0.28',
        'available': true,
        'canApply': true,
        'phase': 'failed',
        'failure': {
          'reason': 'permission',
          'message': 'EACCES',
          'command': 'npm install -g uxnan-bridge@latest',
        },
      });
      expect(failed?.phase, BridgeUpdatePhase.failed);
      expect(failed?.failure?.reason, 'permission');
      expect(failed?.failure?.command, 'npm install -g uxnan-bridge@latest');
    });

    test('says why a bridge cannot update itself', () {
      final cli = BridgeUpdate.fromJson(const {
        'version': '0.0.28',
        'available': true,
        'canApply': false,
        'unsupportedReason': 'the bridge was started in a terminal',
        'phase': 'idle',
      });
      expect(cli?.canApply, isFalse);
      expect(cli?.unsupportedReason, contains('terminal'));
    });

    test('is tolerant: malformed input is null, unknown phases are idle', () {
      expect(BridgeUpdate.fromJson(null), isNull);
      expect(BridgeUpdate.fromJson(const {'available': true}), isNull);
      final odd = BridgeUpdate.fromJson(const {
        'version': '1',
        'phase': 'something-new',
        'failure': 'nonsense',
      });
      expect(odd?.phase, BridgeUpdatePhase.idle);
      expect(odd?.failure, isNull);
      expect(odd?.available, isFalse);
    });
  });
}
