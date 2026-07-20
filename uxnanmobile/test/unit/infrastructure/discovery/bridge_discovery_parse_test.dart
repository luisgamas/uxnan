import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/infrastructure/discovery/bridge_discovery_service.dart';

Uint8List _txt(String value) => Uint8List.fromList(utf8.encode(value));

void main() {
  test('prefers the SRV-resolved address over the TXT addr hint', () {
    // TXT records are unsigned and any device on the network can publish them,
    // so the resolved address wins. The TXT `port` hint is still honored — it
    // only narrows where on that host we knock.
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
    expect(bridge!.host, '10.0.0.9');
    expect(bridge.port, 19850);
    expect(bridge.name, 'studio-pc');
    expect(bridge.deviceId, 'mac-abc');
    expect(bridge.hostPort, '10.0.0.9:19850');
  });

  test('honors a TXT addr hint only when nothing was resolved and it is local',
      () {
    final bridge = parseDiscoveredBridge(
      name: 'studio-pc',
      port: 19850,
      txt: {'addr': _txt('192.168.1.50')},
    );
    expect(bridge!.host, '192.168.1.50');
  });

  test('ignores a TXT addr pointing off-network, even with nothing resolved',
      () {
    // The attack this blocks: a spoofed mDNS record naming an attacker host.
    // With no resolved address and no usable SRV host, the service is dropped
    // rather than contacted.
    for (final hostile in ['evil.example.com', '8.8.8.8', 'localhost']) {
      expect(
        parseDiscoveredBridge(port: 19850, txt: {'addr': _txt(hostile)}),
        isNull,
        reason: 'must not accept a TXT addr of "$hostile"',
      );
    }
  });

  test('isLocalAddressLiteral accepts private/CGNAT/loopback IPs only', () {
    for (final ok in [
      '10.0.0.9',
      '192.168.1.50',
      '172.16.0.1',
      '172.31.255.254',
      '100.64.0.1',
      '100.127.255.254',
      '169.254.1.1',
      '127.0.0.1',
    ]) {
      expect(isLocalAddressLiteral(ok), isTrue, reason: ok);
    }
    for (final no in [
      '8.8.8.8',
      '172.15.0.1',
      '172.32.0.1',
      '100.63.255.255',
      '100.128.0.1',
      'evil.example.com',
      'pc.local',
      '192.168.1',
      '192.168.1.256',
      '',
      '  ',
    ]) {
      expect(isLocalAddressLiteral(no), isFalse, reason: no);
    }
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
