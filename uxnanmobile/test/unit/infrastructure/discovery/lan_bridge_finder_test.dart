import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/entities/discovered_bridge.dart';
import 'package:uxnan/infrastructure/discovery/bridge_discovery_service.dart';

/// A sighting parsed exactly as a real one is, from the TXT keys the bridge
/// advertises (`bridge/src/transport/mdns-advertiser.ts`: `v`, `id`, `port`,
/// `addr`).
DiscoveredBridge _service(String id, String address) {
  Uint8List txt(String v) => Uint8List.fromList(utf8.encode(v));
  return parseDiscoveredBridge(
    name: 'PC $id',
    host: 'pc-$id.local',
    port: 19850,
    addresses: [InternetAddress(address)],
    txt: {
      'v': txt('1'),
      'id': txt(id),
      'port': txt('19850'),
      'addr': txt(address),
    },
  )!;
}

/// The platform browse, reporting the services it lists as it lists them.
class _Browse implements BridgeDiscoveryService {
  final StreamController<List<DiscoveredBridge>> _controller =
      StreamController<List<DiscoveredBridge>>.broadcast();
  bool started = false;
  bool disposed = false;

  void report(List<DiscoveredBridge> services) => _controller.add(services);

  @override
  Stream<List<DiscoveredBridge>> get bridges => _controller.stream;

  @override
  Future<void> start() async => started = true;

  @override
  Future<void> dispose() async {
    disposed = true;
    await _controller.close();
  }
}

void main() {
  late List<_Browse> browses;
  late MdnsLanBridgeFinder finder;

  setUp(() {
    browses = [];
    finder = MdnsLanBridgeFinder(
      createService: () {
        final browse = _Browse();
        browses.add(browse);
        return browse;
      },
    );
  });

  test('nothing browses until someone listens', () {
    finder.find('mac-1', window: const Duration(seconds: 1));
    expect(browses, isEmpty);
  });

  test('emits only this PC, and stops when the window closes', () async {
    final seen = <DiscoveredBridge>[];
    final done = Completer<void>();
    finder
        .find('mac-1', window: const Duration(milliseconds: 50))
        .listen(seen.add, onDone: done.complete);
    await pumpEventQueue();
    expect(browses.single.started, isTrue);

    browses.single.report([
      _service('someone-else', '192.168.100.20'),
      _service('mac-1', '192.168.100.140'),
    ]);
    await done.future.timeout(const Duration(seconds: 2));

    expect(seen.map((b) => b.deviceId), ['mac-1']);
    expect(seen.single.directHosts, ['192.168.100.140:19850']);
    expect(browses.single.disposed, isTrue);
  });

  test('cancelling stops the browse at once', () async {
    final subscription = finder
        .find('mac-1', window: const Duration(seconds: 30))
        .listen((_) {});
    await pumpEventQueue();
    expect(browses.single.disposed, isFalse);

    await subscription.cancel();
    expect(browses.single.disposed, isTrue);
  });
}
