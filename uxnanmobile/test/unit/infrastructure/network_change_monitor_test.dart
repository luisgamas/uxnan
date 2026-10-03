import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/infrastructure/transport/network_change_monitor.dart';

void main() {
  const settle = Duration(milliseconds: 20);
  late StreamController<List<ConnectivityResult>> platform;
  late int events;
  late StreamSubscription<void> sub;

  Future<void> listen(List<ConnectivityResult> current) async {
    platform = StreamController<List<ConnectivityResult>>.broadcast();
    events = 0;
    final monitor = ConnectivityNetworkChangeMonitor(
      onChanged: () => platform.stream,
      current: () async => current,
      settle: settle,
    );
    sub = monitor.changes.listen((_) => events++);
    // Let the baseline read and the platform subscription happen.
    await Future<void>.delayed(Duration.zero);
    await Future<void>.delayed(Duration.zero);
  }

  Future<void> report(List<ConnectivityResult> results) async {
    platform.add(results);
    await Future<void>.delayed(Duration.zero);
  }

  Future<void> waitSettle() =>
      Future<void>.delayed(settle + const Duration(milliseconds: 30));

  tearDown(() async {
    await sub.cancel();
    await platform.close();
  });

  test('the network the phone is on when listening starts is not a change',
      () async {
    await listen([ConnectivityResult.mobile]);
    await report([ConnectivityResult.mobile]);
    await waitSettle();
    expect(events, 0);
  });

  test('joining a Wi-Fi from mobile data is one change, once it settles',
      () async {
    await listen([ConnectivityResult.mobile]);
    // A burst, as Android reports a Wi-Fi coming up.
    await report([ConnectivityResult.mobile, ConnectivityResult.wifi]);
    await report([ConnectivityResult.wifi]);
    await report([ConnectivityResult.wifi]);
    expect(events, 0, reason: 'nothing before the change settles');
    await waitSettle();
    expect(events, 1);
  });

  test('losing every network is not reported', () async {
    await listen([ConnectivityResult.wifi]);
    await report([ConnectivityResult.none]);
    await waitSettle();
    expect(events, 0);
    // Coming back is.
    await report([ConnectivityResult.wifi]);
    await waitSettle();
    expect(events, 1);
  });

  group('isOnLocalNetwork — where a PC can be looked for by mDNS', () {
    Future<bool> onLocal(List<ConnectivityResult> current) =>
        ConnectivityNetworkChangeMonitor(
          onChanged: () => const Stream.empty(),
          current: () async => current,
        ).isOnLocalNetwork();

    test('Wi-Fi and Ethernet are local, with or without mobile data beside',
        () async {
      expect(await onLocal([ConnectivityResult.wifi]), isTrue);
      expect(await onLocal([ConnectivityResult.ethernet]), isTrue);
      expect(
        await onLocal([ConnectivityResult.mobile, ConnectivityResult.wifi]),
        isTrue,
      );
    });

    test('cellular alone, a VPN over it, or nothing is not', () async {
      expect(await onLocal([ConnectivityResult.mobile]), isFalse);
      expect(
        await onLocal([ConnectivityResult.mobile, ConnectivityResult.vpn]),
        isFalse,
      );
      expect(await onLocal([ConnectivityResult.none]), isFalse);
      expect(await onLocal(const []), isFalse);
    });

    test('a platform that cannot say is not local', () async {
      final monitor = ConnectivityNetworkChangeMonitor(
        onChanged: () => const Stream.empty(),
        current: () async => throw StateError('no plugin'),
      );
      expect(await monitor.isOnLocalNetwork(), isFalse);
    });
  });
}
