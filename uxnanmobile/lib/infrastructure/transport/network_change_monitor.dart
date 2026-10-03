import 'dart:async';

import 'package:collection/collection.dart';
import 'package:connectivity_plus/connectivity_plus.dart';

/// Tells the session when the phone moved to another network (joined a Wi-Fi,
/// left it for mobile data, …), so it can look for a better path to the PC
/// than the one it holds (`SessionCoordinator.handleNetworkChange`).
// ignore: one_member_abstracts — a DI seam (tests supply a controller).
abstract class NetworkChangeMonitor {
  /// One event per settled change of the phone's networks. Never emits for
  /// the network the phone is on when listening starts, nor for losing every
  /// network (nothing new can be reached then; the live session's heartbeat
  /// notices the loss on its own).
  Stream<void> get changes;
}

/// [NetworkChangeMonitor] over `connectivity_plus`.
///
/// The platforms report every step of a switch — Android sends a burst of
/// capability updates as a Wi-Fi comes up — so a change is reported once the
/// set of network kinds has held still for [settle]. That also gives a newly
/// joined Wi-Fi time to hand the phone an address before anything is dialed
/// on it.
class ConnectivityNetworkChangeMonitor implements NetworkChangeMonitor {
  /// Creates a monitor. [onChanged] and [current] default to the platform's
  /// `Connectivity`; tests inject their own.
  ConnectivityNetworkChangeMonitor({
    Stream<List<ConnectivityResult>> Function()? onChanged,
    Future<List<ConnectivityResult>> Function()? current,
    Duration settle = const Duration(seconds: 2),
  })  : _onChanged = onChanged ?? (() => Connectivity().onConnectivityChanged),
        _current = current ?? (() => Connectivity().checkConnectivity()),
        _settle = settle;

  final Stream<List<ConnectivityResult>> Function() _onChanged;
  final Future<List<ConnectivityResult>> Function() _current;
  final Duration _settle;

  late final StreamController<void> _controller =
      StreamController<void>.broadcast(onListen: _start, onCancel: _stop);
  StreamSubscription<List<ConnectivityResult>>? _subscription;
  Timer? _settleTimer;
  Set<ConnectivityResult>? _last;

  @override
  Stream<void> get changes => _controller.stream;

  Future<void> _start() async {
    try {
      // The network the phone is on now is the baseline, not a change: the
      // platforms replay it to a new listener.
      _last ??= (await _current()).toSet();
    } on Object {
      // No baseline: the first report becomes it.
    }
    if (!_controller.hasListener) return;
    _subscription = _onChanged().listen(_onResults, onError: (Object _) {});
  }

  void _onResults(List<ConnectivityResult> results) {
    final next = results.toSet();
    final last = _last;
    _last = next;
    if (last == null ||
        const SetEquality<ConnectivityResult>().equals(last, next)) {
      return;
    }
    _settleTimer?.cancel();
    _settleTimer = Timer(_settle, () {
      final settled = _last;
      if (settled == null || _isOffline(settled)) return;
      if (!_controller.isClosed) _controller.add(null);
    });
  }

  static bool _isOffline(Set<ConnectivityResult> results) =>
      results.isEmpty || results.every((r) => r == ConnectivityResult.none);

  Future<void> _stop() async {
    _settleTimer?.cancel();
    _settleTimer = null;
    await _subscription?.cancel();
    _subscription = null;
  }
}
