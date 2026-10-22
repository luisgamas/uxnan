import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/core/errors/rpc_exception.dart';
import 'package:uxnan/domain/value_objects/message_content.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';
import 'package:uxnan/infrastructure/repositories/bridge_turn_detail_repository.dart';

void main() {
  late List<({String method, Map<String, dynamic>? params})> calls;
  late RpcMessage Function(String method, Map<String, dynamic>? params) answer;
  late BridgeTurnDetailRepository repository;

  setUp(() {
    calls = [];
    answer = (method, params) =>
        RpcMessage.response(id: '1', result: const <String, dynamic>{});
    repository = BridgeTurnDetailRepository(
      (method, params) async {
        calls.add((method: method, params: params));
        return answer(method, params);
      },
      stepPageCacheSize: 2,
    );
  });

  test('turn/steps: previews in the shape the bridge serves, and next',
      () async {
    answer = (method, params) => RpcMessage.response(
          id: '1',
          result: const {
            'steps': [
              {
                'type': 'command_execution',
                'index': 3,
                'command': 'ls',
                'status': 'completed',
              },
              {'type': 'diff', 'index': 4, 'filename': 'a', 'additions': 1},
              // Without an index it could never be fetched: dropped.
              {'type': 'tool', 'toolName': 'x', 'input': <String, dynamic>{}},
            ],
            'next': 5,
          },
        );
    final page = await repository.readSteps('th', 'tu', from: 3, to: 9);
    expect(calls.single.method, 'turn/steps');
    expect(calls.single.params, {
      'threadId': 'th',
      'turnId': 'tu',
      'from': 3,
      'to': 9,
    });
    expect(page.steps, hasLength(2));
    expect(page.next, 5);

    // Kept: the same page is not asked for again, unless fresh.
    await repository.readSteps('th', 'tu', from: 3, to: 9);
    expect(calls, hasLength(1));
    await repository.readSteps('th', 'tu', from: 3, to: 9, fresh: true);
    expect(calls, hasLength(2));
  });

  test('a next that does not move forward ends the run', () async {
    answer = (method, params) => RpcMessage.response(
          id: '1',
          result: const {'steps': <Object?>[], 'next': 3},
        );
    final page = await repository.readSteps('th', 'tu', from: 3, to: 9);
    expect(page.next, isNull);
  });

  test('turn/step reads a step whole', () async {
    answer = (method, params) => RpcMessage.response(
          id: '1',
          result: {
            'block': params?['index'] == 4
                ? {
                    'type': 'diff',
                    'filename': 'a',
                    'diff': '+x',
                    'additions': 1,
                  }
                : {'type': 'thinking', 'text': 'all of it'},
          },
        );
    final step = await repository.readStep('th', 'tu', 4);
    expect(step, isA<DiffContent>());
    expect((step as DiffContent).diff, '+x');
    expect(calls.single.params?['index'], 4);
    final thought = await repository.readStep('th', 'tu', 5);
    expect((thought as ThinkingContent).text, 'all of it');
  });

  test("the bridge's error is thrown with its code, and not kept", () async {
    answer = (method, params) => const RpcMessage(
          id: '1',
          error: RpcError(
            code: RpcException.responseTooLarge,
            message: 'Response too large',
          ),
        );
    await expectLater(
      repository.readStep('th', 'tu', 1),
      throwsA(
        isA<RpcException>().having(
          (e) => e.code,
          'code',
          RpcException.responseTooLarge,
        ),
      ),
    );
    answer = (method, params) => RpcMessage.response(
          id: '1',
          result: const {
            'block': {'type': 'command_execution', 'command': 'ls'},
          },
        );
    expect(
      await repository.readStep('th', 'tu', 1),
      isA<CommandExecutionContent>(),
    );
    expect(calls, hasLength(2));
  });

  test('rejects an invalid range or index without asking', () {
    expect(
      () => repository.readSteps('th', 'tu', from: 4, to: 2),
      throwsArgumentError,
    );
    expect(() => repository.readStep('th', 'tu', -1), throwsArgumentError);
    expect(calls, isEmpty);
  });
}
