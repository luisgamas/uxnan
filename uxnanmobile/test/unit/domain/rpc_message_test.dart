import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';

void main() {
  group('RpcMessage classification', () {
    test('request has method and id', () {
      final m = RpcMessage.request(id: 'a', method: 'turn/send');
      expect(m.isRequest, isTrue);
      expect(m.isNotification, isFalse);
      expect(m.isResponse, isFalse);
    });

    test('notification has method but no id', () {
      final m = RpcMessage.notification(method: 'stream/turn/started');
      expect(m.isNotification, isTrue);
      expect(m.isRequest, isFalse);
    });

    test('response has id but no method', () {
      final m = RpcMessage.response(id: 'a', result: const {'ok': true});
      expect(m.isResponse, isTrue);
      expect(m.isRequest, isFalse);
    });
  });

  group('RpcMessage JSON', () {
    test('request round-trips through JSON', () {
      final m = RpcMessage.request(
        id: '7',
        method: 'git/commit',
        params: const {'message': 'feat: x'},
      );
      final decoded = RpcMessage.fromJson(m.toJson());
      expect(decoded.id, '7');
      expect(decoded.method, 'git/commit');
      expect(decoded.params, {'message': 'feat: x'});
      expect(decoded.jsonrpc, '2.0');
    });

    test('coerces a numeric id to a string', () {
      final decoded = RpcMessage.fromJson(const {
        'jsonrpc': '2.0',
        'id': 42,
        'result': {'ok': true},
      });
      expect(decoded.id, '42');
      expect(decoded.isResponse, isTrue);
    });

    test('parses an error response', () {
      final decoded = RpcMessage.fromJson(const {
        'jsonrpc': '2.0',
        'id': 'a',
        'error': {'code': -32001, 'message': 'auth required'},
      });
      expect(decoded.error, isNotNull);
      expect(decoded.error!.code, -32001);
      expect(decoded.error!.message, 'auth required');
    });
  });
}
