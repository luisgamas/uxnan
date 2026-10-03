import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/infrastructure/transport/request_correlator.dart';

void main() {
  group('RequestCorrelator', () {
    test('resolves a registered request with its response', () async {
      final correlator = RequestCorrelator();
      final future = correlator.register('1');
      expect(correlator.pendingCount, 1);

      final handled = correlator.resolve(
        RpcMessage.response(id: '1', result: const {'ok': true}),
      );
      expect(handled, isTrue);

      final response = await future;
      expect(response.id, '1');
      expect(correlator.pendingCount, 0);
    });

    test('resolve for an unknown id returns false', () {
      final correlator = RequestCorrelator();
      expect(
        correlator.resolve(RpcMessage.response(id: 'nope', result: 1)),
        isFalse,
      );
    });

    test('times out when no response arrives', () async {
      final correlator =
          RequestCorrelator(timeout: const Duration(milliseconds: 30));
      await expectLater(
        correlator.register('1'),
        throwsA(isA<TimeoutException>()),
      );
      expect(correlator.pendingCount, 0);
    });

    test('a request given its own limit waits that long instead', () async {
      final correlator =
          RequestCorrelator(timeout: const Duration(milliseconds: 20));
      final slow = correlator.register(
        'deploy',
        within: const Duration(milliseconds: 200),
      );
      await Future<void>.delayed(const Duration(milliseconds: 60));
      // Past the default limit, still pending.
      expect(correlator.pendingCount, 1);
      correlator.resolve(RpcMessage.response(id: 'deploy', result: 1));
      expect((await slow).result, 1);
    });

    test('rejectAll fails every pending request', () async {
      final correlator = RequestCorrelator();
      final a = correlator.register('a');
      final b = correlator.register('b');
      correlator.rejectAll(StateError('disconnected'));

      await expectLater(a, throwsA(isA<StateError>()));
      await expectLater(b, throwsA(isA<StateError>()));
      expect(correlator.pendingCount, 0);
    });

    test('re-registering the same id returns the same future', () {
      final correlator = RequestCorrelator();
      final first = correlator.register('x');
      final second = correlator.register('x');
      expect(identical(first, second), isTrue);
      expect(correlator.pendingCount, 1);
    });
  });
}
