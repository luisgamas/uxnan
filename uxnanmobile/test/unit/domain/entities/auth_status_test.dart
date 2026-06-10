import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/auth_status.dart';

void main() {
  group('AuthStatus.fromJson', () {
    test('parses a full sanitized status', () {
      final status = AuthStatus.fromJson(const {
        'agentId': 'claude-code',
        'requiresLogin': false,
        'loginInProgress': true,
        'authenticatedProvider': 'anthropic',
        'displayName': 'Claude Code',
        'transportMode': 'local',
        'platform': 'win32',
      });
      expect(status.agentId, 'claude-code');
      expect(status.requiresLogin, isFalse);
      expect(status.loginInProgress, isTrue);
      expect(status.authenticatedProvider, 'anthropic');
      expect(status.displayName, 'Claude Code');
      expect(status.transportMode, 'local');
      expect(status.platform, 'win32');
    });

    test('defaults the booleans to false and leaves optionals null', () {
      final status = AuthStatus.fromJson(const {'agentId': 'codex'});
      expect(status.agentId, 'codex');
      expect(status.requiresLogin, isFalse);
      expect(status.loginInProgress, isFalse);
      expect(status.authenticatedProvider, isNull);
      expect(status.displayName, isNull);
      expect(status.transportMode, isNull);
      expect(status.platform, isNull);
    });

    test('treats non-bool truthy values as false (tolerant)', () {
      final status = AuthStatus.fromJson(const {
        'agentId': 'codex',
        'requiresLogin': 'yes',
        'loginInProgress': 1,
      });
      expect(status.requiresLogin, isFalse);
      expect(status.loginInProgress, isFalse);
    });

    test('falls back to an empty agentId when missing', () {
      expect(AuthStatus.fromJson(const {}).agentId, '');
    });
  });
}
