import 'package:flutter_test/flutter_test.dart';
import 'package:uxnan/domain/enums/network_kind.dart';

void main() {
  const relayUrl = 'wss://relay.uxnan.dev';

  group('classifyEndpoint — unknown', () {
    test('null or empty endpoint is unknown', () {
      expect(classifyEndpoint(null, relayUrl: relayUrl), NetworkKind.unknown);
      expect(classifyEndpoint('', relayUrl: relayUrl), NetworkKind.unknown);
    });
  });

  group('classifyEndpoint — relay', () {
    test('an exact match with relayUrl is relay', () {
      expect(
        classifyEndpoint(relayUrl, relayUrl: relayUrl),
        NetworkKind.relay,
      );
    });

    test('a different scheme/port on the same relay host is still relay', () {
      expect(
        classifyEndpoint(
          'wss://relay.uxnan.dev:443/socket',
          relayUrl: relayUrl,
        ),
        NetworkKind.relay,
      );
    });

    test('an empty relayUrl never classifies as relay', () {
      expect(
        classifyEndpoint('ws://192.168.1.5:19850', relayUrl: ''),
        isNot(NetworkKind.relay),
      );
    });
  });

  group('classifyEndpoint — tailscale (100.64.0.0/10)', () {
    test('the low boundary 100.64.x.x is tailscale', () {
      expect(
        classifyEndpoint('ws://100.64.0.1:19850', relayUrl: relayUrl),
        NetworkKind.tailscale,
      );
    });

    test('the high boundary 100.127.x.x is tailscale', () {
      expect(
        classifyEndpoint('ws://100.127.255.255:19850', relayUrl: relayUrl),
        NetworkKind.tailscale,
      );
    });

    test('a mid-range address (100.100.x.x) is tailscale', () {
      expect(
        classifyEndpoint('ws://100.100.1.2:19850', relayUrl: relayUrl),
        NetworkKind.tailscale,
      );
    });

    test('just below the range (100.63.x.x) is NOT tailscale', () {
      expect(
        classifyEndpoint('ws://100.63.255.255:19850', relayUrl: relayUrl),
        NetworkKind.direct,
      );
    });

    test('just above the range (100.128.x.x) is NOT tailscale', () {
      expect(
        classifyEndpoint('ws://100.128.0.0:19850', relayUrl: relayUrl),
        NetworkKind.direct,
      );
    });
  });

  group('classifyEndpoint — lan (RFC 1918 + link-local)', () {
    test('10.0.0.0/8 is lan', () {
      expect(
        classifyEndpoint('ws://10.0.0.1:19850', relayUrl: relayUrl),
        NetworkKind.lan,
      );
      expect(
        classifyEndpoint('ws://10.255.255.255:19850', relayUrl: relayUrl),
        NetworkKind.lan,
      );
    });

    test('172.16.0.0/12 boundaries are lan (172.16.x – 172.31.x)', () {
      expect(
        classifyEndpoint('ws://172.16.0.1:19850', relayUrl: relayUrl),
        NetworkKind.lan,
      );
      expect(
        classifyEndpoint('ws://172.31.255.255:19850', relayUrl: relayUrl),
        NetworkKind.lan,
      );
    });

    test('172.15.x.x and 172.32.x.x are NOT lan (outside the /12)', () {
      expect(
        classifyEndpoint('ws://172.15.0.1:19850', relayUrl: relayUrl),
        NetworkKind.direct,
      );
      expect(
        classifyEndpoint('ws://172.32.0.1:19850', relayUrl: relayUrl),
        NetworkKind.direct,
      );
    });

    test('192.168.0.0/16 is lan', () {
      expect(
        classifyEndpoint('ws://192.168.1.5:19850', relayUrl: relayUrl),
        NetworkKind.lan,
      );
    });

    test('169.254.0.0/16 (link-local) is lan', () {
      expect(
        classifyEndpoint('ws://169.254.1.1:19850', relayUrl: relayUrl),
        NetworkKind.lan,
      );
    });
  });

  group('classifyEndpoint — direct', () {
    test('a public IPv4 is direct', () {
      expect(
        classifyEndpoint('ws://203.0.113.7:19850', relayUrl: relayUrl),
        NetworkKind.direct,
      );
    });

    test('a plain hostname that is not the relay is direct', () {
      expect(
        classifyEndpoint('ws://my-pc.local:19850', relayUrl: relayUrl),
        NetworkKind.direct,
      );
    });

    test('a bare host:port with no scheme is classified the same way', () {
      expect(
        classifyEndpoint('192.168.1.5:19850', relayUrl: relayUrl),
        NetworkKind.lan,
      );
      expect(
        classifyEndpoint('100.64.1.2:19850', relayUrl: relayUrl),
        NetworkKind.tailscale,
      );
    });
  });
}
