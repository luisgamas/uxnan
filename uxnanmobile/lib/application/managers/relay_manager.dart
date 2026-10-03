import 'dart:async';

import 'package:rxdart/rxdart.dart';
import 'package:uxnan/application/managers/action_outbox.dart';
import 'package:uxnan/application/managers/thread_manager.dart' show RpcSend;
import 'package:uxnan/application/processors/domain_event.dart';
import 'package:uxnan/core/utils/logger.dart';
import 'package:uxnan/domain/enums/connection_phase.dart';
import 'package:uxnan/domain/value_objects/pending_action.dart';
import 'package:uxnan/domain/value_objects/relay_status.dart';
import 'package:uxnan/domain/value_objects/rpc_message.dart';

/// What became of switching the relay on or off ([RelayManager.setEnabled]).
enum RelaySwitchOutcome {
  /// The bridge applied it; the status it answered is the mirror now.
  applied,

  /// The PC was out of reach: the switch is kept on this phone and sent,
  /// dated, the next time it is reachable — the latest decision wins.
  kept,
}

/// The connected PC's relay, as its bridge reports it, and the `relay/*`
/// actions the phone can ask the bridge for (architecture/02a §5.10).
///
/// The bridge owns the relay: it deploys the Worker into the user's own
/// Cloudflare account, keeps its control socket open and tells every client
/// how it stands (`stream/relay/updated`). This manager only mirrors that and
/// asks; every action answers with the status after it, which replaces the
/// mirror. How the phone *reaches* the PC through the relay is not kept here:
/// that endpoint arrives in the PC's shared settings and is stored by
/// `BridgeReplica`.
///
/// Switching the relay on or off is the one action that also works while the
/// PC is out of reach: it is kept in the [ActionOutbox] and sent, dated, when
/// the PC is reachable again (`relay/set { ageMs }`), like a rename.
class RelayManager {
  /// Creates a [RelayManager] and starts following [domainEvents].
  ///
  /// [sendCloudflareRequest] carries the requests the bridge answers only
  /// after talking to Cloudflare (set up, update, delete) with a longer wait
  /// than the default ([cloudflareTimeout]); it defaults to [sendRequest].
  /// [currentDeviceId] names the PC the live channel belongs to, so a switch
  /// meant for another PC is kept instead of sent to the wrong one.
  RelayManager({
    required RpcSend sendRequest,
    required Stream<DomainEvent> domainEvents,
    Stream<ConnectionPhase>? connectionPhases,
    RpcSend? sendCloudflareRequest,
    String? Function()? currentDeviceId,
    ActionOutbox? outbox,
  })  : _sendRequest = sendRequest,
        _sendCloudflareRequest = sendCloudflareRequest ?? sendRequest,
        _currentDeviceId = currentDeviceId,
        _outbox = outbox {
    _eventsSub = domainEvents.listen(_onEvent);
    _phaseSub = connectionPhases?.listen(_onPhase);
  }

  /// How long a request that waits on Cloudflare may take before the phone
  /// gives up on its answer. Deploying the relay takes up to a minute.
  static const Duration cloudflareTimeout = Duration(seconds: 120);

  final RpcSend _sendRequest;
  final RpcSend _sendCloudflareRequest;
  final String? Function()? _currentDeviceId;
  final ActionOutbox? _outbox;
  late final StreamSubscription<DomainEvent> _eventsSub;
  StreamSubscription<ConnectionPhase>? _phaseSub;
  ConnectionPhase? _phase;

  final BehaviorSubject<RelayStatus?> _status = BehaviorSubject.seeded(null);

  /// The connected PC's relay status; `null` while not connected, before it
  /// was read, or against a bridge that does not know `relay/status`.
  Stream<RelayStatus?> get statusStream => _status.stream;

  /// The last status the bridge reported this connection.
  RelayStatus? get status => _status.value;

  void _onPhase(ConnectionPhase phase) {
    final was = _phase;
    _phase = phase;
    if (phase == ConnectionPhase.connected &&
        was != ConnectionPhase.connected) {
      unawaited(refresh());
    } else if (phase != ConnectionPhase.connected) {
      // A new connection may be another PC: its status stands only once read.
      _status.add(null);
    }
  }

  void _onEvent(DomainEvent event) {
    if (event case RelayUpdatedEvent(:final status)) {
      if (RelayStatus.fromJson(status) case final RelayStatus next) {
        _status.add(next);
      }
    }
  }

  /// Re-reads the status (`relay/status`). Never throws: a bridge that cannot
  /// answer leaves the status unknown.
  Future<RelayStatus?> refresh() async {
    try {
      return await _ask('relay/status');
    } on Object catch (error, stackTrace) {
      AppLogger.warn('relay/status failed', error, stackTrace);
      return null;
    }
  }

  /// Deploys the relay into the user's Cloudflare account (`relay/setup`).
  /// The bridge uses [apiToken] for this call and drops it, unless [remember]
  /// keeps it in the PC's system keyring; it never comes back in any answer.
  Future<RelayStatus?> setup({
    required String accountId,
    required String apiToken,
    bool remember = false,
  }) =>
      _ask(
        'relay/setup',
        params: {
          'provider': 'cloudflare',
          'accountId': accountId,
          'apiToken': apiToken,
          'remember': remember,
        },
        viaCloudflare: true,
      );

  /// Uses a relay the user deployed themselves (`relay/use`).
  Future<RelayStatus?> use(String url) =>
      _ask('relay/use', params: {'url': url});

  /// Switches serving phones through the PC [deviceId]'s relay on or off
  /// (`relay/set`).
  ///
  /// Sent now while that PC is the connected one; kept for later otherwise,
  /// or when the request is lost on the way ([RelaySwitchOutcome.kept]).
  /// Throws the bridge's [RpcError] when it refuses.
  Future<RelaySwitchOutcome> setEnabled({
    required String deviceId,
    required bool enabled,
  }) async {
    final outbox = _outbox;
    if (_reachable(deviceId)) {
      try {
        await _ask('relay/set', params: {'enabled': enabled});
        return RelaySwitchOutcome.applied;
      } on RpcError {
        rethrow;
      } on Object catch (error, stackTrace) {
        if (outbox == null) rethrow;
        AppLogger.warn('relay/set did not arrive (kept)', error, stackTrace);
      }
    }
    if (outbox == null) {
      throw StateError('relay/set: PC out of reach, nothing to keep it in');
    }
    await outbox.keep(
      PendingAction(
        deviceId: deviceId,
        kind: PendingActionKind.setRelay,
        targetId: deviceId,
        value: '$enabled',
        decidedAt: outbox.now(),
      ),
    );
    return RelaySwitchOutcome.kept;
  }

  /// The relay switch kept for the PC [deviceId] that it has not heard yet
  /// (`true` on, `false` off), or `null` when none is waiting.
  Future<bool?> pendingEnabled(String deviceId) async {
    final outbox = _outbox;
    if (outbox == null) return null;
    final waiting = await outbox.pending(deviceId);
    final last =
        waiting.where((a) => a.kind == PendingActionKind.setRelay).lastOrNull;
    return last == null ? null : last.value == 'true';
  }

  bool _reachable(String deviceId) {
    if (_phase != ConnectionPhase.connected) return false;
    final current = _currentDeviceId;
    return current == null || current() == deviceId;
  }

  /// Redeploys the relay version this bridge ships (`relay/update`).
  /// [apiToken] is needed unless one is remembered.
  Future<RelayStatus?> update({String? apiToken, bool? remember}) => _ask(
        'relay/update',
        params: {
          if (apiToken != null) 'apiToken': apiToken,
          if (remember != null) 'remember': remember,
        },
        viaCloudflare: true,
      );

  /// Gives the bridge a new routing id on its relay (`relay/rotate`): the old
  /// one stops working, and paired phones learn the new one through the
  /// shared settings.
  Future<RelayStatus?> rotate() => _ask('relay/rotate');

  /// Stops using the relay (`relay/remove`); [deleteWorker] also deletes it
  /// from the Cloudflare account, which needs [apiToken] unless one is
  /// remembered.
  Future<RelayStatus?> remove({
    bool deleteWorker = false,
    String? apiToken,
    bool? remember,
  }) =>
      _ask(
        'relay/remove',
        params: {
          'deleteWorker': deleteWorker,
          if (apiToken != null) 'apiToken': apiToken,
          if (remember != null) 'remember': remember,
        },
        viaCloudflare: deleteWorker,
      );

  /// Sends [method] and adopts the status it answers. Throws the bridge's
  /// `RpcError` when it refuses. [viaCloudflare] waits [cloudflareTimeout]
  /// for an answer the bridge gives only after Cloudflare has.
  Future<RelayStatus?> _ask(
    String method, {
    Map<String, dynamic>? params,
    bool viaCloudflare = false,
  }) async {
    final send = viaCloudflare ? _sendCloudflareRequest : _sendRequest;
    final response = await send(method, params);
    final error = response.error;
    if (error != null) throw error;
    final status = RelayStatus.fromJson(response.result);
    if (status != null) _status.add(status);
    return status;
  }

  /// Releases resources.
  Future<void> dispose() async {
    await _eventsSub.cancel();
    await _phaseSub?.cancel();
    await _status.close();
  }
}
