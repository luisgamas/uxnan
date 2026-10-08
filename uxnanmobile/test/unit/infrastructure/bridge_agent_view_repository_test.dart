import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/agent_view_page.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/infrastructure/repositories/bridge_agent_view_repository.dart';

void main() {
  test('reads view/read and promotes entries in the bounded LRU', () async {
    final calls = <String>[];
    final repository = BridgeAgentViewRepository(
      (method, params) async {
        expect(method, 'view/read');
        final id = params!['viewId']! as String;
        calls.add(id);
        return RpcMessage.response(
          id: 'r',
          result: {'viewId': id, 'title': id, 'html': '<p>$id</p>', 'bytes': 8},
        );
      },
      cacheSize: 2,
    );
    Future<AgentViewPage> read(String id) => repository.readView(id);

    expect((await read('0' * 32)).title, '0' * 32);
    await read('1' * 32);
    await read('0' * 32);
    await read('2' * 32);
    await read('1' * 32);
    expect(calls, ['0' * 32, '1' * 32, '2' * 32, '1' * 32]);
  });

  test('does not cache failed reads', () async {
    var calls = 0;
    final repository = BridgeAgentViewRepository((_, __) async {
      calls++;
      return RpcMessage.response(
        id: 'r',
        error: const RpcError(code: 404, message: 'missing'),
      );
    });
    await expectLater(repository.readView('a' * 32), throwsStateError);
    await expectLater(repository.readView('a' * 32), throwsStateError);
    expect(calls, 2);
  });
}
