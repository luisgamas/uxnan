import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/infrastructure/discovery/bridge_discovery_service.dart';

Uint8List _txt(String value) => Uint8List.fromList(utf8.encode(value));

void main() {
  test('prefers the advertised TXT addr/port hints', () {
    final bridge = parseDiscoveredBridge(
      name: 'studio-pc',
      host: 'studio-pc.local',
      port: 5,
      addresses: [InternetAddress('10.0.0.9')],
      txt: {
        'v': _txt('1'),
        'addr': _txt('192.168.1.50'),
        'port': _txt('19850'),
        'id': _txt('mac-abc'),
      },
    );
    expect(bridge, isNotNull);
    expect(bridge!.host, '192.168.1.50');
    expect(bridge.port, 19850);
    expect(bridge.name, 'studio-pc');
    expect(bridge.deviceId, 'mac-abc');
    expect(bridge.hostPort, '192.168.1.50:19850');
  });

  test('falls back to the first IPv4 address + SRV port without TXT addr', () {
    final bridge = parseDiscoveredBridge(
      name: 'laptop',
      host: 'laptop.local',
      port: 19850,
      addresses: [
        InternetAddress('fe80::1', type: InternetAddressType.IPv6),
        InternetAddress('192.168.1.77'),
      ],
      txt: {'v': _txt('1')},
    );
    expect(bridge, isNotNull);
    expect(bridge!.host, '192.168.1.77');
    expect(bridge.port, 19850);
    expect(bridge.deviceId, isNull);
  });

  test('returns null when no usable host or port is known', () {
    expect(
      parseDiscoveredBridge(name: 'x', host: ''),
      isNull,
    );
    expect(
      parseDiscoveredBridge(name: 'x', host: 'x.local', port: 0),
      isNull,
    );
  });

  test('uses the host as the display name when the name is empty', () {
    final bridge = parseDiscoveredBridge(
      name: '   ',
      host: 'pc.local',
      port: 19850,
    );
    expect(bridge, isNotNull);
    expect(bridge!.name, 'pc.local');
  });
}
