import 'dart:async';

import 'package:uxnan/domain/entities/project.dart';
import 'package:uxnan/domain/repositories/i_bridge_replica_repository.dart';
import 'package:uxnan/domain/value_objects/pending_action.dart';
import 'package:uxnan/domain/value_objects/replica_cursor.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';

/// A routing id the relay contract accepts (32 lowercase hex chars).
const String testRoutingId = '0123456789abcdef0123456789abcdef';

/// A wire `RelayStatus` in the exact shape `shared/src/models/relay.ts`
/// defines and every `relay/*` method answers.
Map<String, Object?> relayStatusJson({
  bool setUp = true,
  bool enabled = true,
  String state = 'connected',
  String? lastError,
  String bundledVersion = '0.1.0',
  String? deployedVersion = '0.1.0',
  bool tokenRemembered = false,
  int connectedPhones = 1,
  String provider = 'cloudflare',
  String url = 'wss://uxnan-relay.example.workers.dev',
}) =>
    {
      'endpoint': setUp
          ? {'url': url, 'routingId': testRoutingId, 'enabled': enabled}
          : null,
      if (setUp) 'provider': provider,
      'state': setUp ? state : 'off',
      if (lastError != null) 'lastError': lastError,
      'bundledVersion': bundledVersion,
      if (setUp && deployedVersion != null) 'deployedVersion': deployedVersion,
      'tokenRemembered': tokenRemembered,
      'connectedPhones': connectedPhones,
      'hostKey': 'ab' * 32,
    };

/// A bridge that answers `relay/*` requests: records each one and answers
/// [status] (or the [refusals] message as a JSON-RPC error).
class FakeRelayBridge {
  /// Creates a [FakeRelayBridge] answering [status].
  FakeRelayBridge(this.status);

  /// What every answer carries.
  Map<String, Object?> status;

  /// Methods the bridge refuses, with its human-readable message.
  final Map<String, String> refusals = {};

  /// Methods whose request never arrives (the channel dropped).
  final Set<String> lost = {};

  /// Every request, in order.
  final List<(String, Map<String, dynamic>?)> requests = [];

  /// Requests that went through the Cloudflare (long wait) sender.
  final List<String> viaCloudflare = [];

  /// Held answers: a method listed here waits until [release] is called.
  final Map<String, Completer<void>> holds = {};

  /// Lets a held [method] answer.
  void release(String method) => holds.remove(method)?.complete();

  /// The plain sender.
  Future<RpcMessage> send(String method, [Map<String, dynamic>? params]) =>
      _answer(method, params);

  /// The long-wait sender.
  Future<RpcMessage> sendViaCloudflare(
    String method, [
    Map<String, dynamic>? params,
  ]) {
    viaCloudflare.add(method);
    return _answer(method, params);
  }

  Future<RpcMessage> _answer(
    String method,
    Map<String, dynamic>? params,
  ) async {
    requests.add((method, params));
    final hold = holds[method];
    if (hold != null) await hold.future;
    if (lost.contains(method)) throw TimeoutException('lost');
    final refusal = refusals[method];
    if (refusal != null) {
      return RpcMessage(
        id: '1',
        error: RpcError(code: -32000, message: refusal),
      );
    }
    return RpcMessage(id: '1', result: status);
  }
}

/// Keeps pending actions in memory, with the same supersede rule as the
/// drift repository. Everything else is out of scope for the relay tests.
class InMemoryActionRepository implements IBridgeReplicaRepository {
  final List<PendingAction> _actions = [];
  int _nextId = 1;

  @override
  Future<void> enqueueAction(PendingAction action) async {
    _actions
      ..removeWhere(
        (a) =>
            a.deviceId == action.deviceId &&
            a.targetId == action.targetId &&
            action.kind.supersedes.contains(a.kind),
      )
      ..add(
        PendingAction(
          id: _nextId++,
          deviceId: action.deviceId,
          kind: action.kind,
          targetId: action.targetId,
          value: action.value,
          decidedAt: action.decidedAt,
        ),
      );
  }

  @override
  Future<List<PendingAction>> pendingActions(String deviceId) async =>
      _actions.where((a) => a.deviceId == deviceId).toList();

  @override
  Future<void> removeAction(int id) async =>
      _actions.removeWhere((a) => a.id == id);

  @override
  Future<void> forgetDevice(String deviceId) async =>
      _actions.removeWhere((a) => a.deviceId == deviceId);

  @override
  Future<ReplicaCursor?> cursor(String deviceId) async => null;

  @override
  Future<void> saveCursor(String deviceId, ReplicaCursor cursor) async {}

  @override
  Stream<List<Project>> watchProjects(String deviceId) => const Stream.empty();

  @override
  Future<void> upsertProjects(String deviceId, List<Project> projects) async {}

  @override
  Future<void> deleteProjects(String deviceId, List<String> ids) async {}

  @override
  Future<void> replaceProjects(String deviceId, List<Project> projects) async {}
}
