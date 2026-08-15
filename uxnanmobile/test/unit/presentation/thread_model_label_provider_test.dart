import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/agent_model.dart';
import 'package:uxnan/domain/entities/thread.dart';
import 'package:uxnan/domain/enums/thread_status.dart';
import 'package:uxnan/domain/enums/thread_sync_state.dart';
import 'package:uxnan/presentation/providers/application_providers.dart';

const _agentId = 'antigravity-cli';

/// A thread on Antigravity running [model].
Thread _thread(String? model) => Thread(
      id: 't1',
      title: 'Thread',
      agentId: _agentId,
      syncState: ThreadSyncState.synced,
      status: ThreadStatus.active,
      model: model,
    );

/// The label the app bar's pill would show for a thread running [model], with
/// the agent reporting [models] — null meaning the list never resolves (the
/// phone is offline, or the bridge is still answering `agent/models`).
///
/// Both providers are listened to, not just read: an unlistened provider is
/// disposed as soon as the read returns, and the label would then be computed
/// against a torn-down list.
Future<String?> _label(String? model, {List<AgentModel>? models}) async {
  final container = ProviderContainer(
    overrides: [
      threadsProvider.overrideWith((ref) => Stream.value([_thread(model)])),
      agentModelsProvider(_agentId).overrideWith(
        (ref) => models == null
            ? Completer<List<AgentModel>>().future
            : Future.value(models),
      ),
    ],
  );
  addTearDown(container.dispose);
  container
    ..listen(threadsProvider, (_, __) {}, fireImmediately: true)
    ..listen(
      agentModelsProvider(_agentId),
      (_, __) {},
      fireImmediately: true,
    );
  await container.read(threadsProvider.future);
  if (models != null) {
    await container.read(agentModelsProvider(_agentId).future);
  }
  return container.read(threadModelLabelProvider('t1'));
}

void main() {
  test('resolves the routing id to the name the bridge reports', () async {
    // What the app bar showed before: `gemini-3.7-flash-high`, truncated.
    expect(
      await _label(
        'gemini-3.7-flash-high',
        models: const [
          AgentModel(
            id: 'gemini-3.7-flash-high',
            displayName: 'Gemini 3.7 Flash (High)',
          ),
        ],
      ),
      'Gemini 3.7 Flash (High)',
    );
  });

  test('falls back to the id while the model list is unavailable', () async {
    // Offline or still loading: the pill shows the id rather than going blank.
    expect(await _label('gemini-3.7-flash-high'), 'gemini-3.7-flash-high');
  });

  test('falls back to the id when the agent does not list it', () async {
    expect(
      await _label(
        'retired-model',
        models: const [
          AgentModel(
            id: 'gemini-3.7-flash-low',
            displayName: 'Gemini 3.7 Flash (Low)',
          ),
        ],
      ),
      'retired-model',
    );
  });

  test('is null when the thread runs on the agent default', () async {
    // The pill then falls back to the agent's own name, not an empty chip.
    expect(await _label(null), isNull);
  });
}
