import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/infrastructure/transport/outbound_message_buffer.dart';

RpcMessage _msg(String id) => RpcMessage.request(id: id, method: 'turn/send');

void main() {
  group('OutboundMessageBuffer', () {
    test('drains messages in FIFO order', () {
      final buffer = OutboundMessageBuffer()
        ..enqueue(_msg('1'))
        ..enqueue(_msg('2'))
        ..enqueue(_msg('3'));
      expect(buffer.length, 3);

      final drained = buffer.drainAll();
      expect(drained.map((p) => p.message.id).toList(), ['1', '2', '3']);
      expect(buffer.isEmpty, isTrue);
    });

    test('evicts the oldest message when full (sliding window)', () {
      final buffer = OutboundMessageBuffer(maxSize: 2)
        ..enqueue(_msg('1'))
        ..enqueue(_msg('2'))
        ..enqueue(_msg('3'));

      expect(buffer.length, 2);
      final drained = buffer.drainAll();
      expect(drained.map((p) => p.message.id).toList(), ['2', '3']);
    });

    test('drainAll on an empty buffer returns nothing', () {
      final buffer = OutboundMessageBuffer();
      expect(buffer.drainAll(), isEmpty);
      expect(buffer.isEmpty, isTrue);
    });
  });
}
